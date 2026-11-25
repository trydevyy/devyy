// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { productionDependencies } from "./production-dependencies.mjs";
const root = path.resolve(import.meta.dirname, "..");
const includeRust = process.argv.includes("--include-rust");
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v));
};
const themeRoot = path.join(root, "node_modules/material-icon-theme");
const theme = JSON.parse(
  read(path.join(themeRoot, "dist/material-icons.json")),
);
const icons = {};
for (const [id, definition] of Object.entries(theme.iconDefinitions))
  if (definition.iconPath) icons[id] = path.basename(definition.iconPath);
fs.mkdirSync(path.join(root, "public/file-icons"), { recursive: true });
fs.cpSync(path.join(themeRoot, "icons"), path.join(root, "public/file-icons"), {
  recursive: true,
});
const mapping = { icons };
for (const key of [
  "file",
  "folder",
  "folderExpanded",
  "folderNames",
  "folderNamesExpanded",
  "fileNames",
  "fileExtensions",
  "languageIds",
  "light",
])
  if (theme[key]) mapping[key] = theme[key];
write(path.join(root, "src/lib/generated/file-icons.json"), mapping);
const texts = {},
  packages = [];
function licenseTexts(dir) {
  const names = fs
    .readdirSync(dir)
    .filter((n) =>
      /^(licen[sc]es?|copying|notice|copyright|ofl)([-_.]|$)/i.test(n),
    );
  const result = [];
  for (const name of names) {
    const file = path.join(dir, name),
      stat = fs.statSync(file);
    const files = stat.isDirectory()
      ? fs.readdirSync(file).map((n) => path.join(file, n))
      : [file];
    for (const f of files)
      if (fs.statSync(f).isFile() && fs.statSync(f).size < 600000) {
        const text = read(f);
        if (text.includes("\0")) continue;
        const id = crypto
          .createHash("sha256")
          .update(text)
          .digest("hex")
          .slice(0, 20);
        texts[id] = text;
        result.push({ name: path.relative(dir, f), text: id });
      }
  }
  return result;
}
for (const { directory: dir, pkg } of productionDependencies(root)) {
  packages.push({
    name: pkg.name,
    version: pkg.version,
    ecosystem: "JavaScript",
    license:
      typeof pkg.license === "string"
        ? pkg.license
        : (pkg.license?.type ?? "Not specified"),
    url:
      pkg.homepage ??
      (typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository?.url
      )
        ?.replace(/^git\+/, "")
        .replace(/\.git$/, ""),
    files: licenseTexts(dir),
  });
}
if (includeRust) {
  const rustHost = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.*)$/m,
  )[1];
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        path.join(root, "src-tauri/Cargo.toml"),
        "--format-version",
        "1",
        "--locked",
        "--filter-platform",
        rustHost,
      ],
      { maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
    ),
  );
  for (const pkg of metadata.packages)
    if (!metadata.workspace_members.includes(pkg.id))
      packages.push({
        name: pkg.name,
        version: pkg.version,
        ecosystem: "Rust",
        license: pkg.license ?? "Not specified",
        url:
          pkg.homepage ??
          pkg.repository ??
          `https://crates.io/crates/${pkg.name}/${pkg.version}`,
        files: licenseTexts(path.dirname(pkg.manifest_path)),
      });
}
const material = JSON.parse(read(path.join(themeRoot, "package.json")));
packages.push({
  name: material.name,
  version: material.version,
  ecosystem: "Artwork",
  license: material.license,
  url: "https://github.com/material-extensions/vscode-material-icon-theme",
  files: licenseTexts(themeRoot),
});
const editorMarks = path.join(root, "public/ide-icons");
if (fs.existsSync(editorMarks))
  packages.push({
    name: "Editor identification marks",
    version: "Bundled assets",
    ecosystem: "Artwork",
    license: "Upstream licensing and trademark terms",
    url: "https://github.com/microsoft/vscode",
    files: licenseTexts(editorMarks),
  });
const ownFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].find((n) =>
  fs.existsSync(path.join(root, n)),
);
const own = {
  name: "Devyy",
  version: JSON.parse(read(path.join(root, "package.json"))).version,
  license:
    JSON.parse(read(path.join(root, "package.json"))).license ??
    (ownFile ? "Project license" : "No license specified"),
  files: ownFile ? licenseTexts(root) : [],
};
packages.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
write(path.join(root, "public/third-party-licenses.json"), {
  app: own,
  packages,
  texts,
});
console.log(
  `Generated Material file icons and credits for ${packages.length} packages.`,
);
