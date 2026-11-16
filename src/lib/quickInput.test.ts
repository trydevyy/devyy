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
import {
  quickInputItems,
  quickInputText,
  type QuickInputState,
} from "./quickInput";

const state = (overrides: Partial<QuickInputState> = {}): QuickInputState => ({
  id: "test",
  session: 1,
  extension: "test.extension",
  kind: "pick",
  enabled: true,
  busy: false,
  ignoreFocusOut: false,
  value: "",
  valueVersion: 0,
  selectionVersion: 0,
  itemsVersion: 1,
  buttonsVersion: 0,
  buttons: [],
  activeItems: [],
  selectedItems: [],
  items: [
    { index: 0, label: "Projects", kind: -1 },
    {
      index: 1,
      label: "$(folder) Core",
      description: "TypeScript",
      detail: "Main library",
    },
    { index: 2, label: "Server", description: "Rust" },
    { index: 3, label: "Other", kind: -1 },
    { index: 4, label: "Add project", alwaysShow: true },
  ],
  ...overrides,
});
describe("extension QuickInput matching", () => {
  it("matches fuzzy labels and searches description/detail only when requested", () => {
    expect(quickInputItems(state(), "c r").map((item) => item.index)).toEqual([
      0, 1, 3, 4,
    ]);
    expect(quickInputItems(state(), "rust").map((item) => item.index)).toEqual([
      3, 4,
    ]);
    expect(
      quickInputItems(state({ matchOnDescription: true }), "rust").map(
        (item) => item.index,
      ),
    ).toEqual([0, 2, 3, 4]);
    expect(
      quickInputItems(state({ matchOnDetail: true }), "main").map(
        (item) => item.index,
      ),
    ).toEqual([0, 1, 3, 4]);
  });
  it("removes empty groups without treating separator labels as choices", () => {
    expect(
      quickInputItems(state({ items: state().items.slice(0, 4) }), "Other"),
    ).toEqual([]);
    expect(quickInputItems(state(), "").map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
  it("keeps original order unless a filtered list explicitly allows label sorting", () => {
    const items = [
      { index: 0, label: "Zoom" },
      { index: 1, label: "Zone" },
      { index: 2, label: "Another group", kind: -1 },
      { index: 3, label: "Zebra" },
    ];
    expect(
      quickInputItems(state({ items, sortByLabel: false }), "z").map(
        (item) => item.index,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      quickInputItems(state({ items }), "z").map((item) => item.index),
    ).toEqual([1, 0, 2, 3]);
  });
  it("does not include codicon names in searchable or accessible item text", () => {
    expect(quickInputText("$(sync~spin) Fetching")).toBe("Fetching");
    expect(
      quickInputItems(
        state({ items: [{ index: 0, label: "$(folder) Core" }] }),
        "folder",
      ),
    ).toEqual([]);
  });
});
