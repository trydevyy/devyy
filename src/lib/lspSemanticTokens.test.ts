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

import { describe, it, expect } from "vitest";
import { decodeSemanticTokens } from "./lspSemanticTokens";

describe("Semantic tokens 5-tuple decoding", () => {
  it("decodes multiple tokens on same and subsequent lines", () => {
    const data = [
      0, 0, 5, 0, 0,
      0, 6, 4, 7, 1,
      2, 4, 8, 11, 4,
    ];

    const decoded = decodeSemanticTokens(data);
    expect(decoded.length).toBe(3);

    expect(decoded[0]).toEqual({
      line: 0,
      char: 0,
      length: 5,
      tokenType: "type",
      tokenModifiers: [],
    });

    expect(decoded[1]).toEqual({
      line: 0,
      char: 6,
      length: 4,
      tokenType: "variable",
      tokenModifiers: ["declaration"],
    });

    expect(decoded[2]).toEqual({
      line: 2,
      char: 4,
      length: 8,
      tokenType: "function",
      tokenModifiers: ["readonly"],
    });
  });

  it("handles empty or incomplete data arrays without crashing", () => {
    expect(decodeSemanticTokens([])).toEqual([]);
    expect(decodeSemanticTokens([1, 2, 3])).toEqual([]);
  });
});
