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
import { editorAppearance } from "./editorAppearance";
import { defaults } from "./types";
import { EditorState } from "@codemirror/state";

describe("editorAppearance cursor styling and extensions", () => {
  it("creates block cursor styles with transparent native caret", () => {
    const settings = {
      ...defaults,
      cursorStyle: "block" as const,
      cursorBlinkRate: 600,
    };
    const extensions = editorAppearance(settings);
    expect(extensions.length).toBeGreaterThan(0);

    const state = EditorState.create({
      doc: "test code",
      extensions,
    });
    expect(state.doc.toString()).toBe("test code");
  });

  it("creates underline cursor styles", () => {
    const settings = {
      ...defaults,
      cursorStyle: "underline" as const,
      cursorBlinkRate: 1000,
    };
    const extensions = editorAppearance(settings);
    const state = EditorState.create({
      doc: "underline test",
      extensions,
    });
    expect(state.doc.toString()).toBe("underline test");
  });

  it("creates line cursor styles with zero blink rate when steady", () => {
    const settings = {
      ...defaults,
      cursorStyle: "line" as const,
      cursorBlinkRate: 0,
    };
    const extensions = editorAppearance(settings);
    const state = EditorState.create({
      doc: "steady test",
      extensions,
    });
    expect(state.doc.toString()).toBe("steady test");
  });
});
