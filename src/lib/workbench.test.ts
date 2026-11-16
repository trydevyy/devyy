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
import { defaults, normalizeSettings } from "./types";
import {
  bindingsWith,
  defaultBindings,
  eventBinding,
  isMac,
  validBinding,
} from "./shortcuts";
import { searchScore } from "./search";
describe("settings and shortcut persistence", () => {
  it("migrates partial preferences and clamps invalid stored values", () => {
    expect(normalizeSettings(null)).toEqual(defaults);
    const s = normalizeSettings({
      theme: "paper",
      fontSize: 100,
      tabSize: -3,
      windowTransparency: 120,
      editorTransparency: NaN,
      wordWrap: "false",
      bindings: { sidebar: "A", save: "Mod+Shift+S", bad: ["x"] },
    });
    expect(s).toMatchObject({
      theme: "paper",
      fontSize: 28,
      tabSize: 1,
      windowTransparency: 90,
      editorTransparency: 0,
      wordWrap: false,
      bindings: { save: "Mod+Shift+S" },
    });
  });
  it("reassigned shortcuts take priority over defaults without collisions", () => {
    const bindings = bindingsWith({ sidebar: "Mod+P", files: "Mod+Alt+P" });
    expect(bindings.sidebar).toBe("Mod+P");
    expect(bindings.files).toBe("Mod+Alt+P");
    expect(bindingsWith({ sidebar: "Mod+P" }).files).toBe("");
    expect(new Set(Object.values(defaultBindings).filter(Boolean)).size).toBe(
      Object.values(defaultBindings).filter(Boolean).length,
    );
  });
  it("normalizes shifted punctuation and option-modified letters", () => {
    const base = {
      key: "|",
      code: "Backslash",
      metaKey: isMac,
      ctrlKey: !isMac,
      altKey: false,
      shiftKey: true,
    };
    expect(eventBinding(base)).toBe("Mod+Shift+\\");
    expect(
      eventBinding({
        ...base,
        key: "å",
        code: "KeyA",
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("Mod+Alt+A");
    expect(validBinding("Mod+Shift+\\")).toBe(true);
    expect(validBinding("A")).toBe(false);
    expect(validBinding("Shift+A")).toBe(false);
    expect(validBinding("F12")).toBe(true);
  });
});
describe("quick open ranking", () => {
  it("ranks exact names before partial paths and supports subsequences and tokens", () => {
    expect(searchScore("main.rs", "main.rs", "src/main.rs")).toBeLessThan(
      searchScore("main.rs", "lib.rs", "src/main.rs.backup"),
    );
    expect(Number.isFinite(searchScore("smrs", "main.rs", "src/main.rs"))).toBe(
      true,
    );
    expect(
      Number.isFinite(searchScore("src main", "main.rs", "src/main.rs")),
    ).toBe(true);
    expect(searchScore("nope", "main.rs", "src/main.rs")).toBe(Infinity);
  });
});
