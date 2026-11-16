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
import { groupCodeLensesByLine, CodeLens } from "./lspCodeLenses";

describe("CodeLens grouping and parsing", () => {
  it("groups code lenses on the same line together in order", () => {
    const lenses: CodeLens[] = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        command: { title: "▶ Run Test", command: "test.run", arguments: ["test_1"] },
      },
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        command: { title: "Debug", command: "test.debug", arguments: ["test_1"] },
      },
      {
        range: { start: { line: 5, character: 2 }, end: { line: 5, character: 15 } },
        command: { title: "3 references", command: "editor.action.findReferences" },
      },
    ];

    const grouped = groupCodeLensesByLine(lenses);
    expect(grouped.size).toBe(2);

    const line0 = grouped.get(0);
    expect(line0).toBeDefined();
    expect(line0?.length).toBe(2);
    expect(line0?.[0].command?.title).toBe("▶ Run Test");
    expect(line0?.[1].command?.title).toBe("Debug");

    const line5 = grouped.get(5);
    expect(line5).toBeDefined();
    expect(line5?.length).toBe(1);
    expect(line5?.[0].command?.title).toBe("3 references");
  });

  it("gracefully ignores empty or malformed lenses", () => {
    const lenses = [
      null as unknown as CodeLens,
      { range: null } as unknown as CodeLens,
      {
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      },
    ];

    const grouped = groupCodeLensesByLine(lenses);
    expect(grouped.size).toBe(1);
    expect(grouped.get(2)?.length).toBe(1);
  });
});
