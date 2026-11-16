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

export const commandInfo = [
  ["files", "Go to file", "Navigation", "Mod+P"],
  ["quick-open", "Quick open", "Navigation", "Mod+K"],
  ["commands", "Command palette", "Navigation", "Mod+Shift+P"],
  ["open", "Open folder", "Files", "Mod+O"],
  ["new", "New file", "Files", "Mod+N"],
  ["save", "Save file", "Files", "Mod+S"],
  ["save-all", "Save all files", "Files", "Mod+Alt+S"],
  ["close", "Close active tab", "Files", "Mod+W"],
  ["close-all", "Close all tabs", "Files", "Mod+Shift+W"],
  ["next-tab", "Next tab", "Navigation", "Ctrl+Tab"],
  ["previous-tab", "Previous tab", "Navigation", "Ctrl+Shift+Tab"],
  ["find", "Find and replace in file", "Editor", "Mod+F"],
  ["global", "Search across workspace", "Navigation", "Mod+Shift+F"],
  ["goto", "Go to line", "Navigation", "Mod+L"],
  ["definition", "Go to definition", "Editor", "F12"],
  ["references", "Find all references", "Editor", "Shift+F12"],
  ["rename", "Rename symbol", "Editor", "F2"],
  ["signature-help", "Trigger parameter hints", "Editor", "Mod+Shift+Space"],
  ["markdown-preview", "Toggle Markdown preview", "Editor", "Mod+Shift+V"],
  [
    "markdown-preview-beside",
    "Open Markdown preview to the side",
    "Editor",
    "Mod+Alt+V",
  ],
  ["format", "Format document", "Editor", "Alt+Shift+F"],
  ["undo", "Undo", "Editor", "Mod+Z"],
  ["redo", "Redo", "Editor", "Mod+Shift+Z"],
  ["sidebar", "Toggle sidebar", "Layout", "Mod+B"],
  ["terminal", "Toggle terminal", "Layout", "Mod+J"],
  ["split", "Toggle split editor", "Layout", "Mod+\\"],
  ["focus", "Toggle focus mode", "Layout", "Mod+Shift+Enter"],
  ["focus-editor", "Focus editor", "Navigation", "Mod+1"],
  ["focus-terminal", "Focus terminal", "Terminal", "Mod+`"],
  ["new-terminal", "New terminal", "Terminal", "Ctrl+Shift+`"],
  ["split-terminal", "Split terminal", "Terminal", "Mod+Alt+\\"],
  ["next-terminal", "Next terminal", "Terminal", "Mod+Alt+]"],
  ["previous-terminal", "Previous terminal", "Terminal", "Mod+Alt+["],
  ["close-terminal", "Close terminal", "Terminal", ""],
  ["clear-terminal", "Clear terminal", "Terminal", ""],
  ["rename-terminal", "Rename terminal", "Terminal", ""],
  ["maximize-panel", "Maximize / restore panel", "Layout", "Mod+Shift+J"],
  ["reset-layout", "Reset panel sizes", "Layout", ""],
  ["run", "Run project", "Run", "Ctrl+F5"],
  ["wrap", "Toggle word wrap", "Editor", "Alt+Z"],
  ["theme", "Switch color theme", "Appearance", ""],
  ["settings", "Preferences", "Settings", "Mod+,"],
  ["help", "Keyboard shortcuts & help", "Settings", "F1"],
  ["extensions", "Browse extensions", "Extensions", "Mod+Shift+X"],
  ["ai", "Open AI assistant", "AI", "Mod+Shift+I"],
  ["ai-settings", "AI provider settings", "AI", ""],
  ["setup", "Set up devyy", "Settings", ""],
  ["about", "About devyy", "Settings", ""],
  ["reload", "Reload window", "Window", "Mod+Alt+R"],
] as const;
export type CommandId = (typeof commandInfo)[number][0];
export const defaultBindings = Object.fromEntries(
  commandInfo.map(([id, , , key]) => [
    id,
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? key
      : key.replace(/^Ctrl\+/, "Mod+"),
  ]),
) as Record<CommandId, string>;
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
export function eventBinding(
  e:
    | KeyboardEvent
    | {
        key: string;
        code: string;
        metaKey: boolean;
        ctrlKey: boolean;
        altKey: boolean;
        shiftKey: boolean;
      },
): string {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return "";
  if (
    (e.key === "Dead" || e.key === "Unidentified") &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey
  )
    return "";
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const punctuation: Record<string, string> = {
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Equal: "=",
    Minus: "-",
  };
  if (e.code in punctuation) key = punctuation[e.code];
  if (
    (e.altKey || !/^[a-z]$/i.test(e.key)) &&
    (e.metaKey || e.ctrlKey || e.altKey) &&
    /^Key[A-Z]$/.test(e.code)
  )
    key = e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code) && (e.altKey || e.key === "Unidentified"))
    key = e.code.slice(5);
  if (key === " ") key = "Space";
  return [
    isMac ? (e.metaKey ? "Mod" : "") : e.ctrlKey ? "Mod" : "",
    isMac && e.ctrlKey ? "Ctrl" : "",
    !isMac && e.metaKey ? "Meta" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function displayBinding(binding: string) {
  return binding
    .split("+")
    .map(
      (k) =>
        ({
          Mod: isMac ? "⌘" : "Ctrl",
          Ctrl: isMac ? "⌃" : "Ctrl",
          Alt: isMac ? "⌥" : "Alt",
          Shift: isMac ? "⇧" : "Shift",
          Enter: "↵",
          ArrowUp: "↑",
          ArrowDown: "↓",
        })[k] ?? k,
    )
    .join(" ");
}
export function bindingsWith(overrides: Record<string, string>) {
  const result = { ...defaultBindings };
  for (const [id, key] of Object.entries(overrides)) {
    if (!(id in result)) continue;
    const normalized = normalizeBinding(key);
    if (normalized === null) continue;
    result[id as CommandId] = normalized;
    if (normalized)
      for (const other of Object.keys(result) as CommandId[])
        if (other !== id && result[other] === normalized) result[other] = "";
  }
  return result;
}
export function normalizeBinding(value: string, mac = isMac): string | null {
  if (!value.trim()) return "";
  const parts = value.trim().split("+");
  const raw = parts.pop() ?? "";
  const modifiers = new Set<string>(
    parts.map((part) => {
      const lower = part.toLowerCase();
      if (["cmd", "command", "meta", "super"].includes(lower))
        return mac ? "Mod" : "Meta";
      if (["ctrl", "control"].includes(lower)) return mac ? "Ctrl" : "Mod";
      if (lower === "mod") return "Mod";
      if (["alt", "option"].includes(lower)) return "Alt";
      if (lower === "shift") return "Shift";
      return "?";
    }),
  );
  if (modifiers.has("?")) return null;
  const aliases: Record<string, string> = {
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    space: "Space",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    escape: "Escape",
    esc: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
  };
  const key =
    raw.length === 1
      ? raw.toUpperCase()
      : (aliases[raw.toLowerCase()] ??
        (/^f\d{1,2}$/i.test(raw) ? raw.toUpperCase() : raw));
  if (!key) return null;
  return [
    ...["Mod", "Ctrl", "Meta", "Alt", "Shift"].filter((part) =>
      modifiers.has(part),
    ),
    key,
  ].join("+");
}
export function contributedBinding(value: string): string | null {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((stroke) => normalizeBinding(stroke));
  return parts.length > 0 && parts.length <= 3 && parts.every(Boolean)
    ? parts.join(" ")
    : null;
}
export function validBinding(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizeBinding(value);
  if (normalized === null) return false;
  value = normalized;
  return (
    typeof value === "string" &&
    (value === "" ||
      ((/^(?:.*\+)?F\d{1,2}$/.test(value) ||
        /^(?:Mod|Ctrl|Meta|Alt)\+/.test(value)) &&
        /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:[A-Z0-9]|F\d{1,2}|Enter|Tab|Space|Arrow(?:Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown|[`,.\/\\\[\]=;'-])$/.test(
          value,
        )))
  );
}
