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
import { groupedTabs, pairTabs, separateTab } from "./splitGroups";

describe("persistent split groups", () => {
  it("keeps independent pairs and leaves unrelated tabs standalone", () => {
    const groups = pairTabs(pairTabs([], "a", "b"), "c", "d");
    expect(
      groupedTabs(["a", "b", "c", "d", "e"], (key) => key, groups),
    ).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(groups.find((pair) => pair.includes("e"))).toBeUndefined();
    expect(groups.find((pair) => pair.includes("b"))).toEqual(["a", "b"]);
  });
  it("re-pairs members without duplicating tabs or dropping their former partners", () => {
    const groups = pairTabs(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      "b",
      "c",
    );
    expect(groupedTabs(["a", "b", "c", "d"], (key) => key, groups)).toEqual([
      ["a"],
      ["b", "c"],
      ["d"],
    ]);
  });
  it("separates either member and tolerates closed members and reversed tab order", () => {
    expect(
      separateTab(
        [
          [1, 2],
          [3, 4],
        ],
        2,
      ),
    ).toEqual([[3, 4]]);
    expect(
      groupedTabs([2, 3, 1], (key) => key, [
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([[3], [1, 2]]);
  });
  it("does not create a duplicate of the same file", () => {
    expect(pairTabs([], "a", "a")).toEqual([]);
  });
});
