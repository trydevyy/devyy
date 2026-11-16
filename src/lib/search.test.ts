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

import { expect, it } from "vitest";
import { searchHighlights, searchScore } from "./search";

it("highlights exact and fuzzy matches while preserving the original text", () => {
  for (const [query, text, marked] of [
    ["MAIN", "main.rs", "main"],
    ["smrs", "src/main.rs", "smrs"],
    ["no-match", "main.rs", ""],
    ["", "main.rs", ""],
    ["file file", "File", "File"],
  ]) {
    const parts = searchHighlights(query, text);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(
      parts
        .filter((part) => part.match)
        .map((part) => part.text)
        .join(""),
    ).toBe(marked);
  }
  expect(searchScore("main.rs", "main.rs")).toBeLessThan(
    searchScore("main.rs", "other.rs", "src/main.rs"),
  );
});
