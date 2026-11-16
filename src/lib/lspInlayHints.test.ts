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
import { formatInlayHintLabel, InlayHintWidget } from "./lspInlayHints";

describe("lspInlayHints", () => {
  it("formats string labels and part arrays", () => {
    expect(formatInlayHintLabel(": i32")).toBe(": i32");
    expect(
      formatInlayHintLabel([
        { value: "x: " },
        { value: "i32" },
      ]),
    ).toBe("x: i32");
    expect(formatInlayHintLabel([])).toBe("");
  });

  it("checks equality and widget attributes", () => {
    const w1 = new InlayHintWidget(": i32", 1, "Type annotation");
    const w2 = new InlayHintWidget(": i32", 1, "Type annotation");
    const w3 = new InlayHintWidget("x: ", 2);

    expect(w1.eq(w2)).toBe(true);
    expect(w1.eq(w3)).toBe(false);
    expect(w1.ignoreEvent()).toBe(false);
  });
});
