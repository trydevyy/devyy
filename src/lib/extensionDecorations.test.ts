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

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerDecorationType,
  removeDecorationType,
  setDocumentDecorations,
  clearExtensionDecorations,
  computeExtensionDecorations,
  getExtensionDecorationHover,
  buildMarkStyle,
  buildAttachmentStyle,
  resolveColor,
  matchesDocPath,
} from "./extensionDecorations";

describe("extensionDecorations", () => {
  const mockDoc = {
    lines: 3,
    length: 30,
    line(n: number) {
      if (n === 1) return { from: 0, to: 10, number: 1 };
      if (n === 2) return { from: 11, to: 20, number: 2 };
      return { from: 21, to: 30, number: 3 };
    },
  };

  beforeEach(() => {
    clearExtensionDecorations();
  });

  it("resolves colors and builds CSS styles", () => {
    expect(resolveColor("red")).toBe("red");
    expect(resolveColor({ id: "editor.foreground" })).toBe(
      "var(--vscode-editor-foreground, var(--accent, #3b82f6))",
    );
    expect(resolveColor(undefined)).toBeUndefined();

    const style = buildMarkStyle({
      backgroundColor: "yellow",
      color: "#000",
      fontStyle: "italic",
      fontWeight: "bold",
    });
    expect(style).toContain("background-color: yellow");
    expect(style).toContain("color: #000");
    expect(style).toContain("font-style: italic");
    expect(style).toContain("font-weight: bold");

    const attStyle = buildAttachmentStyle({
      contentText: " blame",
      color: "gray",
      margin: "0 4px",
    });
    expect(attStyle.color).toBe("gray");
    expect(attStyle.margin).toBe("0 4px");
  });

  it("matches document paths with URI schemes and relative paths", () => {
    expect(matchesDocPath("src/main.rs", "src/main.rs")).toBe(true);
    expect(matchesDocPath("src/main.rs", "file:///work/src/main.rs")).toBe(
      true,
    );
    expect(matchesDocPath("src/main.rs", "/work/src/main.rs")).toBe(true);
    expect(matchesDocPath("src/main.rs", "other/lib.rs")).toBe(false);
  });

  it("computes mark and widget decorations from extension ranges", () => {
    registerDecorationType("test-deco", {
      backgroundColor: "rgba(255, 0, 0, 0.2)",
      after: { contentText: "  • inline blame" },
    });

    setDocumentDecorations("test-deco", "src/main.rs", [
      {
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 8 },
        },
        hoverMessage: "Git commit info",
      },
    ]);

    const result = computeExtensionDecorations(mockDoc, "src/main.rs");
    expect(result.decorations.size).toBeGreaterThanOrEqual(1);

    const hover = getExtensionDecorationHover(mockDoc, "src/main.rs", 4);
    expect(hover).not.toBeNull();
    expect(hover?.text).toBe("Git commit info");

    setDocumentDecorations("test-deco", "src/main.rs", []);
    const cleared = computeExtensionDecorations(mockDoc, "src/main.rs");
    expect(cleared.decorations.size).toBe(0);
  });

  it("handles disposal and whole line decorations", () => {
    registerDecorationType("line-deco", {
      isWholeLine: true,
      backgroundColor: "#123456",
    });

    setDocumentDecorations("line-deco", "src/main.rs", [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
      },
    ]);

    const result = computeExtensionDecorations(mockDoc, "src/main.rs");
    expect(result.decorations.size).toBe(1);

    removeDecorationType("line-deco");
    const afterRemoval = computeExtensionDecorations(mockDoc, "src/main.rs");
    expect(afterRemoval.decorations.size).toBe(0);
  });
});
