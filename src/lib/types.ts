export interface FileEntry {
  path: string;
  name: string;
  directory: boolean;
}
export interface Workspace {
  root: string;
  name: string;
  files: FileEntry[];
  logo?: string | null;
}
export interface Tab {
  path: string;
  content: string;
  saved: string;
  modified: string;
}
export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  column: number;
}
export interface GitChange {
  path: string;
  index: string;
  worktree: string;
}
export interface GitState {
  branch: string;
  changes: GitChange[];
}
import { validBinding } from "./shortcuts";

export interface Settings {
  fontSize: number;
  overlayTransparency: number;
  glassBlur: number;
  animationSpeed: "snappy" | "smooth" | "instant";
  fontLigatures: boolean;
  letterSpacing: number;
  activeLine: boolean;
  relativeLineNumbers: boolean;
  folding: boolean;
  matchBrackets: boolean;
  autoCloseBrackets: boolean;
  indentGuides: boolean;
  autoIndent: boolean;
  highlightMatches: boolean;
  renderWhitespace: "none" | "trailing" | "all";
  cursorStyle: "line" | "block" | "underline";
  cursorBlinkRate: number;
  scrollPastEnd: boolean;
  editorPadding: number;
  rulerColumn: number;
  autocomplete: boolean;
  completionOnTyping: boolean;
  completionDelay: number;
  autoSaveDelay: number;
  terminalProfile: string;
  terminalLineHeight: number;
  terminalCursorStyle: "block" | "bar" | "underline";
  terminalCopyOnSelect: boolean;
  lineHeight: number;
  fontFamily: "system" | "menlo" | "monospace";
  windowTransparency: number;
  editorTransparency: number;
  terminalFontSize: number;
  terminalScrollback: number;
  cursorBlink: boolean;
  showBreadcrumbs: boolean;
  showStatusbar: boolean;
  bindings: Record<string, string>;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
  vibrancy: boolean;
  reduceMotion: boolean;
  theme: "paper" | "midnight";
}
export interface Position {
  line: number;
  character: number;
}
export interface LspDiagnostic {
  range: { start: Position; end: Position };
  severity?: number;
  message: string;
  source?: string;
}
export interface Problem extends LspDiagnostic {
  path: string;
}
export const defaults: Settings = {
  fontSize: 14,
  overlayTransparency: 26,
  glassBlur: 24,
  animationSpeed: "snappy",
  fontLigatures: false,
  letterSpacing: 0,
  activeLine: true,
  relativeLineNumbers: false,
  folding: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  indentGuides: true,
  autoIndent: true,
  highlightMatches: true,
  renderWhitespace: "none",
  cursorStyle: "line",
  cursorBlinkRate: 1000,
  scrollPastEnd: true,
  editorPadding: 14,
  rulerColumn: 0,
  autocomplete: true,
  completionOnTyping: true,
  completionDelay: 120,
  autoSaveDelay: 1500,
  terminalProfile: "",
  terminalLineHeight: 1.5,
  terminalCursorStyle: "block",
  terminalCopyOnSelect: false,
  lineHeight: 1.8,
  fontFamily: "system",
  windowTransparency: 26,
  editorTransparency: 0,
  terminalFontSize: 12,
  terminalScrollback: 5000,
  cursorBlink: true,
  showBreadcrumbs: true,
  showStatusbar: true,
  bindings: {},
  tabSize: 4,
  wordWrap: false,
  lineNumbers: true,
  autoSave: false,
  theme: "midnight",
  vibrancy: true,
  reduceMotion: false,
};
export function language(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    (
      {
        rs: "rust",
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        json: "json",
        html: "html",
        css: "css",
        md: "markdown",
        toml: "toml",
        yaml: "yaml",
        yml: "yaml",
        sh: "shell",
      } as Record<string, string>
    )[ext ?? ""] ?? "text"
  );
}
export function filename(path: string) {
  return path.split("/").pop() ?? path;
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const stored =
      localStorage.getItem(key) ??
      (key.startsWith("devyy.")
        ? localStorage.getItem(key.replace(/^devyy\./, "devvy."))
        : null);
    return JSON.parse(stored ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizeSettings(value: unknown): Settings {
  const s =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const result = { ...defaults, bindings: {} };
  for (const key of [
    "fontLigatures",
    "activeLine",
    "relativeLineNumbers",
    "folding",
    "matchBrackets",
    "autoCloseBrackets",
    "indentGuides",
    "autoIndent",
    "highlightMatches",
    "scrollPastEnd",
    "autocomplete",
    "completionOnTyping",
    "terminalCopyOnSelect",
    "wordWrap",
    "lineNumbers",
    "autoSave",
    "vibrancy",
    "reduceMotion",
    "cursorBlink",
    "showBreadcrumbs",
    "showStatusbar",
  ] as const)
    if (typeof s[key] === "boolean") result[key] = s[key];
  for (const [key, min, max] of [
    ["overlayTransparency", 0, 75],
    ["glassBlur", 0, 40],
    ["letterSpacing", -0.5, 2],
    ["cursorBlinkRate", 0, 1600],
    ["editorPadding", 4, 40],
    ["rulerColumn", 0, 160],
    ["completionDelay", 50, 500],
    ["autoSaveDelay", 500, 5000],
    ["terminalLineHeight", 1, 2],
    ["fontSize", 10, 28],
    ["lineHeight", 1.2, 2.4],
    ["tabSize", 1, 8],
    ["windowTransparency", 0, 90],
    ["editorTransparency", 0, 90],
    ["terminalFontSize", 10, 24],
    ["terminalScrollback", 1000, 50000],
  ] as const)
    if (typeof s[key] === "number" && Number.isFinite(s[key]))
      result[key] = Math.max(min, Math.min(max, s[key] as number));
  result.tabSize = Math.round(result.tabSize);
  result.rulerColumn = Math.round(result.rulerColumn);
  for (const [key, values] of [
    ["animationSpeed", ["snappy", "smooth", "instant"]],
    ["renderWhitespace", ["none", "trailing", "all"]],
    ["cursorStyle", ["line", "block", "underline"]],
    ["terminalCursorStyle", ["block", "bar", "underline"]],
  ] as const)
    if (
      typeof s[key] === "string" &&
      (values as readonly string[]).includes(s[key] as string)
    )
      Object.assign(result, { [key]: s[key] });
  if (typeof s.terminalProfile === "string" && s.terminalProfile.length < 4096)
    result.terminalProfile = s.terminalProfile;
  if (s.theme === "paper") result.theme = "paper";
  if (s.fontFamily === "menlo" || s.fontFamily === "monospace")
    result.fontFamily = s.fontFamily;
  if (s.bindings && typeof s.bindings === "object")
    result.bindings = Object.fromEntries(
      Object.entries(s.bindings).filter(([, v]) => validBinding(v)),
    ) as Record<string, string>;
  return result;
}
