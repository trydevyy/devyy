import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { explorerFileIcons } from "./file-icons.mjs";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const platform = option(
  "--platform",
  process.platform === "win32"
    ? "windows"
    : process.platform === "linux"
      ? "linux"
      : "macos",
);
if (!["windows", "linux"].includes(platform))
  throw Error("Use build-dmg.py to package Devyy on macOS.");
const release = path.join(root, "src-tauri/target/release");
const appimage =
  platform === "linux" && !option("--app", undefined)
    ? fs
        .readdirSync(path.join(release, "bundle/appimage"))
        .filter(
          (name) =>
            name.toLowerCase().startsWith("devyy_") &&
            name.endsWith(".AppImage"),
        )
        .sort(
          (a, b) =>
            fs.statSync(path.join(release, "bundle/appimage", b)).mtimeMs -
            fs.statSync(path.join(release, "bundle/appimage", a)).mtimeMs,
        )[0]
    : undefined;

const source = path.resolve(
  option(
    "--app",
    platform === "windows"
      ? path.join(release, "Devyy.exe")
      : path.join(release, "bundle/appimage", appimage ?? "devyy.AppImage"),
  ),
);
const entries = [
  {
    name: platform === "windows" ? "devyy.exe" : "devyy.AppImage",
    bytes: fs.readFileSync(source),
  },
];
for (const name of [
  "WebView2Loader.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
])
  if (
    platform === "windows" &&
    fs.existsSync(path.join(path.dirname(source), name))
  )
    entries.push({
      name,
      bytes: fs.readFileSync(path.join(path.dirname(source), name)),
    });
if (platform === "windows") {
  for (const { name, bytes } of explorerFileIcons()) {
    entries.push({ name: `file-icons/${name}`, bytes });
  }
}
entries.push({
  name: "THIRD_PARTY_NOTICES.json",
  bytes: fs.readFileSync(path.join(root, "public/third-party-licenses.json")),
});
const table = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const locals = [],
  central = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name);
  const data = zlib.deflateRawSync(entry.bytes, { level: 6 });
  const crc = crc32(entry.bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(entry.bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50);
  header.writeUInt16LE(0x314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(entry.bytes.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE((0o100755 << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  locals.push(local, name, data);
  central.push(header, name);
  offset += local.length + name.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const destination = path.resolve(
  option("--output", path.join(root, "installer/payload/devyy.zip")),
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, Buffer.concat([...locals, directory, end]));
console.log(`Prepared ${platform} payload: ${destination}`);
