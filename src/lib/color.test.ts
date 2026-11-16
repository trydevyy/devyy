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

import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "./color";
describe("accent color selection", () => {
  it("keeps colors stable when moving between hex and the wheel", () => {
    for (const color of [
      "#ffffff",
      "#000000",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#589bd7",
      "#f497ca",
      "#030207",
    ])
      expect(hsvToHex(...hexToHsv(color))).toBe(color);
  });
  it("adjusts saturation and brightness independently", () => {
    expect(hsvToHex(0, 0, 1)).toBe("#ffffff");
    expect(hsvToHex(240, 1, 0.5)).toBe("#000080");
    expect(hsvToHex(120, 0.5, 1)).toBe("#80ff80");
  });
});
