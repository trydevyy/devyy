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
