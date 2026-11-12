import { describe, expect, it } from "vitest";
import { defaults } from "./types";
import { translateSettings } from "./settingsImport";
import { accentColor, onAccent } from "./palette";
describe("IDE preference import", () => {
  it("maps supported preferences and normalizes numeric limits without importing unrelated values", () => {
    const result = translateSettings(
      {
        name: "VS Code",
        settings: {
          "editor.fontSize": 18,
          "editor.lineHeight": 27,
          "editor.tabSize": 2,
          "editor.wordWrap": "on",
          "editor.lineNumbers": "relative",
          "files.autoSave": "afterDelay",
          "terminal.integrated.scrollback": 999999,
          "workbench.colorTheme": "Solarized Light",
          "private.token": "secret",
        },
        keybindings: [
          {
            key: "ctrl+s",
            command: "workbench.action.files.save",
            when: "editorTextFocus",
          },
          { key: "ctrl+k ctrl+s", command: "workbench.action.openSettings" },
        ],
        extensions: [],
      },
      defaults,
    );
    expect(result.patch).toMatchObject({
      fontSize: 18,
      lineHeight: 1.5,
      tabSize: 2,
      wordWrap: true,
      relativeLineNumbers: true,
      autoSave: true,
      terminalScrollback: 50000,
      theme: "paper",
    });
    expect(result.patch).not.toHaveProperty("private.token");
    expect(result.patch).not.toHaveProperty("bindings");
    expect(result.notes.some((n) => n.includes("2 contextual"))).toBe(true);
  });
  it("uses neutral accents by default and picks a legible foreground for custom colors", () => {
    expect(accentColor(defaults, true)).toBe("#f2f2f2");
    expect(accentColor(defaults, false)).toBe("#252525");
    expect(onAccent("#ffffff")).toBe("#171717");
    expect(onAccent("#001122")).toBe("#ffffff");
  });
});
