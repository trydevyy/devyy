import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const installer = path.join(root, "installer");
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!process.argv.includes("--skip-editor-build"))
  run(npm, ["run", "desktop:build", ...(windows ? ["--", "--no-bundle"] : [])]);
if (process.platform === "darwin") {
  const appArgument = process.argv.indexOf("--app");
  const app =
    appArgument >= 0
      ? path.resolve(process.argv[appArgument + 1])
      : path.join(root, "src-tauri/target/release/bundle/macos/Devyy.app");
  run("swift", [
    path.join(installer, "scripts/dmg-background.swift"),
    path.join(installer, "assets/dmg-background.png"),
  ]);
  const python = path.join(installer, ".dmg-tools/bin/python3");
  if (!fs.existsSync(python)) {
    run("python3", ["-m", "venv", path.join(installer, ".dmg-tools")]);
    run(python, [
      "-m",
      "pip",
      "install",
      "-r",
      path.join(installer, "scripts/requirements-dmg.txt"),
    ]);
  }
  run(python, [
    path.join(installer, "scripts/build-dmg.py"),
    ...process.argv.slice(2).filter((a) => a !== "--skip-editor-build"),
  ]);
} else {
  run(process.execPath, [path.join(installer, "scripts/prepare-payload.mjs")]);
  const installerArgs = ["run", "desktop:build"];
  if (windows) installerArgs.push("--", "--runner", "cargo", "--no-bundle");
  run(npm, installerArgs, {
    cwd: installer,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: path.join(root, "src-tauri/target"),
    },
  });
  if (windows) {
    const source = path.join(
      root,
      "src-tauri/target/release/devyy-installer.exe",
    );
    const output = path.join(root, "src-tauri/target/release/bundle/installer");
    fs.mkdirSync(output, { recursive: true });
    const destination = path.join(output, "Devyy-Setup.exe");
    // The build cache can restore a read-only executable, and Windows copies that attribute.
    const staging = fs.mkdtempSync(path.join(output, ".setup-"));
    const staged = path.join(staging, "Devyy-Setup.exe");
    try {
      fs.copyFileSync(source, staged);
      fs.chmodSync(staged, 0o666);
      if (fs.existsSync(destination)) fs.chmodSync(destination, 0o666);
      fs.renameSync(staged, destination);
      console.log(`Prepared Windows installer: ${destination}`);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
