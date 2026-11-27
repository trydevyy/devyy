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
  remotePath?: string;
}
export interface Tab {
  path: string;
  extensionUri?: string;
  webviewId?: string;
  previewKind?: import("./filePreview").FilePreviewKind;
  languageId?: string;
  readOnly?: boolean;
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
  oldPath?: string | null;
}
export interface GitState {
  branch: string;
  changes: GitChange[];
  ignored?: string[];
  upstream?: string | null;
  ahead?: number;
  behind?: number;
}
import { validBinding } from "./shortcuts";

export interface Settings {
  accent: "neutral" | "blue" | "violet" | "mint" | "amber" | "custom";
  customAccent: string;
  extensionTheme: string;
  followSystemTheme: boolean;
  fontSize: number;
  uiScale: number;
  uiTextSize: number;
  aiCompletions: boolean;
  aiPanelOnDrag: boolean;
  confirmDelete: boolean;
  aiCompletionProvider: string;
  aiCompletionModel: string;
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
  blurEnvSecrets: boolean;
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
  theme: "paper" | "midnight" | "monochrome";
  vcsProvider: "hit" | "git";
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
  collection?: string;
  path: string;
}
export const defaults: Settings = {
  accent: "neutral",
  customAccent: "#a7bcff",
  extensionTheme: "",
  followSystemTheme: false,
  fontSize: 15,
  uiScale: 100,
  uiTextSize: 13,
  aiCompletions: false,
  aiPanelOnDrag: true,
  confirmDelete: true,
  aiCompletionProvider: "",
  aiCompletionModel: "",
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
  blurEnvSecrets: true,
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
  vcsProvider: "hit",
  vibrancy: true,
  reduceMotion: false,
};
export { languageId as language } from "./languages";
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
    "followSystemTheme",
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
    "aiCompletions",
    "aiPanelOnDrag",
    "confirmDelete",
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
    ["uiScale", 80, 150],
    ["uiTextSize", 11, 18],
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
  for (const key of ["aiCompletionProvider", "aiCompletionModel"] as const)
    if (typeof s[key] === "string" && s[key].length < 256) result[key] = s[key];
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
  if (
    ["neutral", "blue", "violet", "mint", "amber", "custom"].includes(
      String(s.accent),
    )
  )
    result.accent = s.accent as Settings["accent"];
  if (
    typeof s.customAccent === "string" &&
    /^#[0-9a-f]{6}$/i.test(s.customAccent)
  )
    result.customAccent = s.customAccent;
  if (typeof s.extensionTheme === "string" && s.extensionTheme.length < 1024)
    result.extensionTheme = s.extensionTheme;
  if (s.theme === "paper" || s.theme === "monochrome") result.theme = s.theme;
  if (s.fontFamily === "menlo" || s.fontFamily === "monospace")
    result.fontFamily = s.fontFamily;
  if (s.bindings && typeof s.bindings === "object")
    result.bindings = Object.fromEntries(
      Object.entries(s.bindings).filter(([, v]) => validBinding(v)),
    ) as Record<string, string>;
  return result;
}

export const BUILTIN_OUTPUT_SERVICES = [
  "Devyy",
  "Debugger",
  "Extension Host",
  "Language Servers",
  "Tasks",
  "Git",
] as const;

export type BuiltinOutputService = (typeof BUILTIN_OUTPUT_SERVICES)[number];

export interface OutputEntry {
  id: string;
  timestamp: string;
  source: string;
  text: string;
  level?: "info" | "warn" | "error" | "debug" | "trace";
}
