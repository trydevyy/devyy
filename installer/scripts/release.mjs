import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const installer = path.join(root, "installer");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
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
  run(npm, ["run", "desktop:build"]);
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
  run(npm, ["run", "desktop:build"], {
    cwd: installer,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: path.join(root, "src-tauri/target"),
    },
  });
  if (process.platform === "win32") {
    const source = path.join(
      root,
      "src-tauri/target/release/devyy-installer.exe",
    );
    const output = path.join(root, "src-tauri/target/release/bundle/installer");
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(source, path.join(output, "Devyy-Setup.exe"));
  }
}
