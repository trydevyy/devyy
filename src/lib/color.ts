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

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (i) => (parseInt(hex.slice(i, i + 2), 16) || 0) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue = !delta
    ? 0
    : max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, max ? delta / max : 0, max];
}
export function hsvToHex(h: number, s: number, v: number): string {
  const chroma = v * s,
    x = chroma * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - chroma;
  const channels =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    "#" +
    channels
      .map((c) =>
        Math.round((c + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
