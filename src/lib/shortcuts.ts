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
  ["about", "About devyy", "Settings", ""],
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
  if (
    ["Meta", "Control", "Alt", "Shift", "Dead", "Unidentified"].includes(e.key)
  )
    return "";
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Keyboard codes keep punctuation shortcuts stable when Shift/Option changes the character.
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
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
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
    result[id as CommandId] = key;
    if (key)
      for (const other of Object.keys(result) as CommandId[])
        if (other !== id && result[other] === key) result[other] = "";
  }
  return result;
}
export function validBinding(value: unknown): value is string {
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
