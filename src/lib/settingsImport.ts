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

import { normalizeSettings, type Settings } from "./types";
import { isMac, validBinding } from "./shortcuts";
export interface ImportSource {
  id: string;
  name: string;
  path: string;
  kind: string;
}
export interface ImportData {
  name: string;
  settings: Record<string, unknown>;
  keybindings: { key?: string; command?: string; when?: string }[];
  extensions: string[];
}
export function translateSettings(data: ImportData, current: Settings) {
  const source = data.settings;
  const patch: Partial<Settings> = {};
  const notes: string[] = [];
  const numbers: [string, keyof Settings][] = [
    ["editor.fontSize", "fontSize"],
    ["buffer_font_size", "fontSize"],
    ["editor.tabSize", "tabSize"],
    ["tab_size", "tabSize"],
    ["editor.letterSpacing", "letterSpacing"],
    ["editor.quickSuggestionsDelay", "completionDelay"],
    ["files.autoSaveDelay", "autoSaveDelay"],
    ["terminal.integrated.fontSize", "terminalFontSize"],
    ["terminal.integrated.scrollback", "terminalScrollback"],
    ["terminal.integrated.lineHeight", "terminalLineHeight"],
  ];
  const booleans: [string, keyof Settings][] = [
    ["editor.fontLigatures", "fontLigatures"],
    ["editor.folding", "folding"],
    ["editor.scrollBeyondLastLine", "scrollPastEnd"],
    ["editor.suggestOnTriggerCharacters", "completionOnTyping"],
    ["terminal.integrated.cursorBlinking", "cursorBlink"],
    ["window.autoDetectColorScheme", "followSystemTheme"],
  ];
  for (const [from, to] of numbers)
    if (typeof source[from] === "number")
      Object.assign(patch, { [to]: source[from] });
  for (const [from, to] of booleans)
    if (typeof source[from] === "boolean")
      Object.assign(patch, { [to]: source[from] });
  const fontSize = Number(patch.fontSize ?? current.fontSize);
  const height = source["editor.lineHeight"];
  if (typeof height === "number" && height > 0)
    patch.lineHeight = height < 8 ? height : height / fontSize;
  const font = source["editor.fontFamily"] ?? source.buffer_font_family;
  if (typeof font === "string") {
    patch.fontFamily = /Menlo|Monaco/i.test(font) ? "menlo" : "system";
    if (patch.fontFamily === "system")
      notes.push(
        "Font uses the system monospace face. Custom font names are not imported.",
      );
  }
  if (source["editor.wordWrap"] !== undefined)
    patch.wordWrap = source["editor.wordWrap"] !== "off";
  if (source.soft_wrap !== undefined)
    patch.wordWrap = source.soft_wrap !== "none";
  if (typeof source["editor.lineNumbers"] === "string") {
    patch.lineNumbers = source["editor.lineNumbers"] !== "off";
    patch.relativeLineNumbers = source["editor.lineNumbers"] === "relative";
  }
  if (typeof source["files.autoSave"] === "string")
    patch.autoSave = source["files.autoSave"] !== "off";
  if (source.autosave) patch.autoSave = source.autosave !== "off";
  if (typeof source["editor.cursorStyle"] === "string")
    patch.cursorStyle = source["editor.cursorStyle"].startsWith("block")
      ? "block"
      : source["editor.cursorStyle"].startsWith("underline")
        ? "underline"
        : "line";
  if (typeof source["terminal.integrated.cursorStyle"] === "string")
    patch.terminalCursorStyle = source[
      "terminal.integrated.cursorStyle"
    ] as Settings["terminalCursorStyle"];
  if (source["editor.renderWhitespace"] !== undefined)
    patch.renderWhitespace = ["all", "boundary", "selection"].includes(
      String(source["editor.renderWhitespace"]),
    )
      ? "all"
      : source["editor.renderWhitespace"] === "trailing"
        ? "trailing"
        : "none";
  if (source["editor.autoClosingBrackets"] !== undefined)
    patch.autoCloseBrackets = source["editor.autoClosingBrackets"] !== "never";
  if (source["editor.matchBrackets"] !== undefined)
    patch.matchBrackets = source["editor.matchBrackets"] !== "never";
  if (source["editor.autoIndent"] !== undefined)
    patch.autoIndent = source["editor.autoIndent"] !== "none";
  if (source["editor.renderLineHighlight"] !== undefined)
    patch.activeLine = source["editor.renderLineHighlight"] !== "none";
  const theme = source["workbench.colorTheme"] ?? source.theme;
  if (typeof theme === "string")
    patch.theme = /light|paper|day|solarized light/i.test(theme)
      ? "paper"
      : "midnight";
  if (theme && typeof theme === "object" && "mode" in theme) {
    const t = theme as { mode: string; light?: string; dark?: string };
    patch.followSystemTheme = t.mode === "system";
    patch.theme = t.mode === "light" ? "paper" : "midnight";
  }
  if (theme)
    notes.push(
      "Appearance maps to devyy’s light or dark theme. Install matching color themes from Open VSX.",
    );
  const commandMap: Record<string, string> = {
    "workbench.action.files.save": "save",
    "workbench.action.files.saveAll": "save-all",
    "workbench.action.closeActiveEditor": "close",
    "workbench.action.quickOpen": "files",
    "workbench.action.showCommands": "commands",
    "workbench.action.toggleSidebarVisibility": "sidebar",
    "workbench.action.togglePanel": "terminal",
    "workbench.action.terminal.toggleTerminal": "focus-terminal",
    "workbench.action.terminal.new": "new-terminal",
    "workbench.action.splitEditorRight": "split",
    "workbench.action.openSettings": "settings",
    "workbench.action.files.openFolder": "open",
    "editor.action.formatDocument": "format",
    "editor.action.revealDefinition": "definition",
    "actions.find": "find",
    "workbench.action.findInFiles": "global",
    "workbench.action.gotoLine": "goto",
    "workbench.action.files.newUntitledFile": "new",
    "workbench.action.toggleZenMode": "focus",
    "editor.action.toggleWordWrap": "wrap",
  };
  let skipped = 0;
  const bindings: Record<string, string> = {};
  for (const binding of data.keybindings ?? []) {
    const id = commandMap[binding.command ?? ""];
    if (!id || !binding.key || binding.when || binding.key.includes(" ")) {
      skipped++;
      continue;
    }
    const parts = binding.key.split("+");
    const raw = parts.pop() ?? "";
    const key =
      raw.length === 1
        ? raw.toUpperCase()
        : /^f\d+$/i.test(raw)
          ? raw.toUpperCase()
          : ((
              {
                enter: "Enter",
                tab: "Tab",
                escape: "Escape",
                space: "Space",
              } as Record<string, string>
            )[raw] ?? raw);
    const modifiers = [
      (isMac && parts.includes("cmd")) || (!isMac && parts.includes("ctrl"))
        ? "Mod"
        : "",
      isMac && parts.includes("ctrl") ? "Ctrl" : "",
      !isMac && parts.includes("cmd") ? "Meta" : "",
      parts.includes("alt") ? "Alt" : "",
      parts.includes("shift") ? "Shift" : "",
    ].filter(Boolean);
    const value = [...modifiers, key].join("+");
    if (
      validBinding(value) &&
      ![
        "Mod+Q",
        "Mod+H",
        "Mod+C",
        "Mod+X",
        "Mod+V",
        "Mod+A",
        "Alt+F4",
      ].includes(value)
    )
      bindings[id] = value;
    else skipped++;
  }
  if (Object.keys(bindings).length)
    patch.bindings = { ...current.bindings, ...bindings };
  if (skipped)
    notes.push(
      `${skipped} contextual, unsupported, or reserved shortcuts were left out.`,
    );
  const normalized = normalizeSettings({ ...current, ...patch });
  const changes = Object.keys(patch).filter(
    (k) =>
      JSON.stringify(current[k as keyof Settings]) !==
      JSON.stringify(normalized[k as keyof Settings]),
  );
  return {
    patch: Object.fromEntries(
      changes.map((k) => [k, normalized[k as keyof Settings]]),
    ) as Partial<Settings>,
    notes,
    changes,
  };
}
