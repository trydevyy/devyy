import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const notices = JSON.parse(
  fs.readFileSync(path.join(root, "public/third-party-licenses.json"), "utf8"),
);
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      path.join(root, "installer/src-tauri/Cargo.toml"),
    ],
    { maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  ),
);
for (const pkg of metadata.packages) {
  if (
    pkg.name === "devyy-installer" ||
    notices.packages.some(
      (p) =>
        p.ecosystem === "Rust" &&
        p.name === pkg.name &&
        p.version === pkg.version,
    )
  )
    continue;
  const directory = path.dirname(pkg.manifest_path);
  const files = [];
  for (const name of fs
    .readdirSync(directory)
    .filter((n) => /^(licen[cs]e|copying|notice|ofl)([._-]|$)/i.test(n))) {
    const file = path.join(directory, name);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024)
      continue;
    const text = `installer-rust:${pkg.name}:${pkg.version}:${name}`;
    notices.texts[text] = fs.readFileSync(file, "utf8");
    files.push({ name, text });
  }
  notices.packages.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? "See source",
    ecosystem: "Rust",
    url: pkg.repository,
    files,
  });
}
// Include frontend packages unique to the installer as well as the Rust crates.
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "installer/package-lock.json"), "utf8"),
);
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative || entry.dev) continue;
  const directory = path.join(root, "installer", relative);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  if (
    notices.packages.some(
      (p) =>
        p.ecosystem === "JavaScript" &&
        p.name === pkg.name &&
        p.version === pkg.version,
    )
  )
    continue;
  const files = [];
  for (const name of fs
    .readdirSync(directory)
    .filter((n) => /^(licen[cs]e|copying|notice|ofl)([._-]|$)/i.test(n))) {
    const file = path.join(directory, name);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024)
      continue;
    const text = `installer-js:${pkg.name}:${pkg.version}:${name}`;
    notices.texts[text] = fs.readFileSync(file, "utf8");
    files.push({ name, text });
  }
  // The drag JS package omits license metadata/files. Its upstream workspace
  // declares Apache-2.0 OR MIT; preserve the same project's complete notices.
  const drag =
    pkg.name === "@crabnebula/tauri-plugin-drag"
      ? notices.packages.find(
          (p) => p.ecosystem === "Rust" && p.name === "tauri-plugin-drag",
        )
      : undefined;
  notices.packages.push({
    name: pkg.name,
    version: pkg.version,
    ecosystem: "JavaScript",
    license: pkg.license ?? entry.license ?? drag?.license ?? "See source",
    files: files.length ? files : (drag?.files ?? []),
  });
}
notices.app = {
  name: "Devyy Installer",
  version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    .version,
  license: "GPL-3.0-only",
  files: [{ name: "LICENSE", text: "installer-own" }],
};
notices.texts["installer-own"] = fs.readFileSync(
  path.join(root, "LICENSE"),
  "utf8",
);
notices.packages.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.join(root, "installer/public"), { recursive: true });
fs.writeFileSync(
  path.join(root, "installer/public/third-party-licenses.json"),
  JSON.stringify(notices),
);
console.log(
  `Prepared installer license notices for ${notices.packages.length} packages.`,
);
