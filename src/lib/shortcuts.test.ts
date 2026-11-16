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
  bindingsWith,
  contributedBinding,
  eventBinding,
  isMac,
  normalizeBinding,
  validBinding,
} from "./shortcuts";
const event = (values: Partial<KeyboardEvent>) => ({
  key: "s",
  code: "KeyS",
  metaKey: isMac,
  ctrlKey: !isMac,
  altKey: false,
  shiftKey: false,
  ...values,
});
describe("shortcut normalization", () => {
  it("matches platform modifiers and repairs legacy modifier ordering and casing", () => {
    expect(eventBinding(event({}))).toBe("Mod+S");
    expect(normalizeBinding("shift+cmd+p", true)).toBe("Mod+Shift+P");
    expect(normalizeBinding("shift+control+p", false)).toBe("Mod+Shift+P");
    expect(normalizeBinding("control+shift+p", true)).toBe("Ctrl+Shift+P");
    expect(bindingsWith({ sidebar: "Shift+Mod+p" }).sidebar).toBe(
      "Mod+Shift+P",
    );
    expect(bindingsWith({ sidebar: "Shift+Mod+p" }).commands).toBe("");
  });
  it("handles dead Option keys, non-Latin shortcut letters, and shifted punctuation", () => {
    expect(
      eventBinding(event({ key: "Dead", code: "KeyV", altKey: true })),
    ).toBe("Mod+Alt+V");
    expect(eventBinding(event({ key: "ы", code: "KeyS" }))).toBe("Mod+S");
    expect(
      eventBinding(event({ key: "|", code: "Backslash", shiftKey: true })),
    ).toBe("Mod+Shift+\\");
    expect(
      eventBinding(event({ key: "Dead", metaKey: false, ctrlKey: false })),
    ).toBe("");
  });
  it("normalizes VS Code chords while rejecting malformed application shortcuts", () => {
    expect(contributedBinding("ctrl+k ctrl+c")).toBe(
      isMac ? "Ctrl+K Ctrl+C" : "Mod+K Mod+C",
    );
    expect(validBinding("shift+mod+p")).toBe(true);
    expect(validBinding("Mod+DangerousKey")).toBe(false);
    expect(normalizeBinding("hyper+s")).toBeNull();
  });
});
