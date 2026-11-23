import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The small bitmap glyphs stay readable in Explorer's 16px file list.
const glyphs = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  I: [7, 2, 2, 2, 7],
  K: [5, 5, 6, 5, 5],
  Q: [7, 5, 5, 7, 1],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  1: [2, 6, 2, 2, 7],
  "+": [0, 2, 7, 2, 0],
  "#": [5, 7, 5, 7, 5],
  C: [7, 4, 4, 4, 7],
  G: [7, 4, 5, 5, 7],
  H: [5, 5, 7, 5, 5],
  J: [3, 1, 1, 5, 7],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  D: [6, 5, 5, 5, 6],
  N: [5, 7, 7, 7, 5],
  O: [7, 5, 5, 5, 7],
  P: [7, 5, 7, 4, 4],
  R: [7, 5, 7, 6, 5],
  S: [7, 4, 7, 1, 7],
  T: [7, 2, 2, 2, 2],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  "{": [3, 2, 6, 2, 3],
  "}": [6, 2, 3, 2, 6],
};

// Butt-ended strokes from the Devyy mark, with the dark ink from devyy-light.svg.
const logoSegments = [
  [32, 12, 32, 52],
  [14.7, 22, 49.3, 42],
  [14.7, 42, 49.3, 22],
];
const logoInk = [41, 38, 37];

function logoPixel(x, y, left, top, width, paper) {
  const samples = 8;
  const result = [0, 0, 0];
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const u = ((x + (sx + 0.5) / samples - left) * 64) / width;
      const v = ((y + (sy + 0.5) / samples - top) * 64) / width;
      const stroke = logoSegments.some(([x1, y1, x2, y2]) => {
        const vx = x2 - x1;
        const vy = y2 - y1;
        const lengthSquared = vx * vx + vy * vy;
        const projection = (u - x1) * vx + (v - y1) * vy;
        const cross = (u - x1) * vy - (v - y1) * vx;
        return (
          projection >= 0 &&
          projection <= lengthSquared &&
          cross * cross <= 16 * lengthSquared
        );
      });
      const color = stroke ? logoInk : paper;
      for (let channel = 0; channel < 3; channel++)
        result[channel] += color[channel];
    }
  }
  return result.map((value) => Math.round(value / (samples * samples)));
}

function bitmap(size, label, accent) {
  const maskStride = Math.ceil(size / 32) * 4;
  const pixels = Buffer.alloc(40 + size * size * 4 + size * maskStride);
  pixels.writeUInt32LE(40, 0);
  pixels.writeUInt32LE(size, 4);
  pixels.writeUInt32LE(size * 2, 8);
  pixels.writeUInt16LE(1, 12);
  pixels.writeUInt16LE(32, 14);
  const scale = Math.max(1, Math.floor(size / 16));
  const glyphWidth = (label.length * 4 - 1) * scale;
  const left = Math.floor((size - glyphWidth) / 2);
  const top = Math.floor(size * 0.64 - 2.5 * scale);
  const fold = Math.round(size * 0.24);
  const margin = Math.max(1, Math.floor(size / 12));
  const logoWidth = size * 0.43;
  const logoLeft = margin;
  const logoTop = (margin + top - logoWidth) / 2;
  const paper = [accent & 255, (accent >> 8) & 255, (accent >> 16) & 255];
  const tint = [
    Math.round((accent & 255) * 0.68),
    Math.round(((accent >> 8) & 255) * 0.68),
    Math.round(((accent >> 16) & 255) * 0.68),
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = 40 + ((size - y - 1) * size + x) * 4;
      const corner = x - (size - margin - fold);
      if (
        x < margin ||
        x >= size - margin ||
        y < margin ||
        y >= size - margin ||
        corner > y - margin
      ) {
        const mask =
          40 + size * size * 4 + (size - y - 1) * maskStride + (x >> 3);
        pixels[mask] |= 128 >> (x & 7);
        continue;
      }
      const gx = Math.floor((x - left) / scale);
      const gy = Math.floor((y - top) / scale);
      const glyph = glyphs[label[Math.floor(gx / 4)]];
      const ink =
        gx >= 0 &&
        gy >= 0 &&
        gy < 5 &&
        gx % 4 < 3 &&
        Boolean(glyph?.[gy] & (4 >> (gx % 4)));
      const inLogo =
        x + 1 > logoLeft &&
        x < logoLeft + logoWidth &&
        y + 1 > logoTop &&
        y < logoTop + logoWidth;
      const tone = inLogo
        ? logoPixel(x, y, logoLeft, logoTop, logoWidth, paper)
        : ink
          ? [42, 32, 23]
          : corner >= 0 && y < margin + fold
            ? tint
            : paper;
      pixels.set([...tone, 255], offset);
    }
  }
  return pixels;
}

export function fileTypeIcon(label, color) {
  label = label === "JSON" ? "{}" : label;
  if (label.length > 3 || [...label].some((char) => !glyphs[char]))
    throw new Error(`Unsupported file icon label: ${label}`);
  const sizes = [16, 32, 48];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  const bitmaps = sizes.map((size, index) => {
    const image = bitmap(size, label, Number.parseInt(color.slice(1), 16));
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
    return image;
  });
  return Buffer.concat([header, ...bitmaps]);
}

export function explorerFileIcons() {
  const readJson = (relative) =>
    JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
  const designs = readJson("./file-types.json");
  const { bundle } = readJson("../../src-tauri/tauri.conf.json");
  const extensions = bundle.fileAssociations.flatMap((type) => type.ext);
  if (
    extensions.length !== Object.keys(designs).length ||
    extensions.some((ext) => !Object.hasOwn(designs, ext))
  ) {
    throw new Error(
      "Windows file associations and their icon designs must match.",
    );
  }
  return extensions.map((ext) => ({
    name: `${ext}.ico`,
    bytes: fileTypeIcon(...designs[ext]),
  }));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const output = resolve(
    process.argv[2] ?? "src-tauri/target/explorer-file-icons",
  );
  const icons = explorerFileIcons();
  mkdirSync(output, { recursive: true });
  for (const { name, bytes } of icons) writeFileSync(join(output, name), bytes);
  console.log(`Generated ${icons.length} Explorer icons in ${output}`);
}
