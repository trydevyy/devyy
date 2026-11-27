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

import {
  Accessibility,
  Code2,
  Files,
  AppWindow,
  AtSign,
  Keyboard,
  Layout,
  Palette,
  SwatchBook,
  TerminalSquare,
  Asterisk,
  Blocks,
  Plug,
  Sparkles,
  SlidersHorizontal,
  HeartHandshake,
  GitBranch,
} from "lucide-react";
import type { Settings } from "./types";
export const categories = [
  {
    id: "account",
    label: "Account & sync",
    description: "Devyy account, devices and selective synchronization.",
    icon: AtSign,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Interface size, accent color, transparency, and motion.",
    icon: Palette,
  },
  {
    id: "themes",
    label: "Themes",
    description: "Browse, import, and manage workbench themes.",
    icon: SwatchBook,
  },
  {
    id: "editor",
    label: "Editor",
    description: "Text, indentation, navigation, and code suggestions.",
    icon: Code2,
  },
  {
    id: "files",
    label: "Files & saving",
    description: "Save behavior and timing.",
    icon: Files,
  },
  {
    id: "applications",
    label: "Default applications",
    description: "Open source files and documents in Devyy.",
    icon: AppWindow,
  },
  {
    id: "layout",
    label: "Layout",
    description: "Workspace panels and navigation.",
    icon: Layout,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Shell profiles and terminal behavior.",
    icon: TerminalSquare,
  },
  {
    id: "keyboard",
    label: "Keyboard shortcuts",
    description: "Customize command shortcuts.",
    icon: Keyboard,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    description: "Motion and accessibility preferences.",
    icon: Accessibility,
  },
  {
    id: "extensions",
    label: "Extensions",
    description: "Find extensions and manage the ones you have installed.",
    icon: Blocks,
  },
  {
    id: "ai",
    label: "AI providers",
    description: "Connect accounts, choose models, and view usage.",
    icon: Sparkles,
  },
  {
    id: "git",
    label: "Source control",
    description:
      "Source control provider (Hit / Git), GitHub sign-in, and commit identity.",
    icon: GitBranch,
  },
  {
    id: "languages",
    label: "Language servers",
    description: "Completions, diagnostics, and navigation for your languages.",
    icon: Plug,
  },
  {
    id: "setup",
    label: "Setup & import",
    description: "Bring over preferences or revisit your setup.",
    icon: SlidersHorizontal,
  },
  {
    id: "credits",
    label: "Credits & licenses",
    description: "Open source projects and their licenses.",
    icon: HeartHandshake,
  },
  {
    id: "about",
    label: "About devyy",
    description: "Version, build details, and updates.",
    icon: Asterisk,
  },
] as const;
export type SettingsCategory = (typeof categories)[number]["id"];
export interface SettingControl {
  key: Exclude<keyof Settings, "bindings">;
  category: SettingsCategory;
  section: string;
  label: string;
  description: string;
  keywords?: string;
  type:
    | "switch"
    | "range"
    | "select"
    | "theme-store"
    | "font-size"
    | "stepper"
    | "profile"
    | "accent";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string | number; label: string }[];
}
const switches = (
  category: SettingsCategory,
  section: string,
  items: [SettingControl["key"], string, string, string?][],
): SettingControl[] =>
  items.map(([key, label, description, keywords]) => ({
    key,
    label,
    description,
    keywords,
    category,
    section,
    type: "switch",
  }));
export const controls: SettingControl[] = [
  {
    key: "uiScale",
    category: "appearance",
    section: "Interface size",
    label: "Interface scale",
    description: "Resize the entire interface, including controls and panels.",
    keywords: "zoom size accessibility",
    type: "stepper",
    min: 80,
    max: 150,
    step: 5,
    unit: "%",
  },
  {
    key: "uiTextSize",
    category: "appearance",
    section: "Interface size",
    label: "Interface text size",
    description:
      "Resize labels, menus and chat text. Editor and terminal fonts have their own settings.",
    keywords: "font text size accessibility",
    type: "stepper",
    min: 11,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    key: "theme",
    category: "themes",
    section: "Theme store",
    label: "Color theme",
    description: "Browse, preview, and apply workbench themes.",
    keywords: "light dark monochrome default appearance",
    type: "theme-store",
  },
  {
    key: "accent",
    category: "appearance",
    section: "Color & material",
    label: "Accent color",
    description: "Used for selection, controls, and focus indicators.",
    keywords: "white neutral custom color secondary",
    type: "accent",
  },
  ...switches("themes", "System appearance", [
    [
      "followSystemTheme",
      "Follow system appearance",
      "Switch between light and dark with your operating system.",
    ],
  ]),
  ...switches("appearance", "Color & material", [
    [
      "vibrancy",
      "Window vibrancy",
      "Let the desktop softly blend into your workspace.",
      "blur glass material",
    ],
  ]),
  {
    key: "windowTransparency",
    category: "appearance",
    section: "Glass",
    label: "Window transparency",
    description: "Adjust how much of your desktop shows through the app.",
    keywords: "opacity background",
    type: "range",
    min: 0,
    max: 90,
    step: 1,
    unit: "%",
  },
  {
    key: "editorTransparency",
    category: "appearance",
    section: "Glass",
    label: "Editor transparency",
    description: "Adjust the editor background separately from other panels.",
    keywords: "opacity code background",
    type: "range",
    min: 0,
    max: 90,
    step: 1,
    unit: "%",
  },
  {
    key: "overlayTransparency",
    category: "appearance",
    section: "Glass",
    label: "Menu transparency",
    description:
      "One glass material for settings, search, dialogs, and context menus.",
    keywords: "opacity overlay modal popup",
    type: "range",
    min: 0,
    max: 75,
    step: 1,
    unit: "%",
  },
  {
    key: "glassBlur",
    category: "appearance",
    section: "Glass",
    label: "Glass softness",
    description: "Blur the content beneath menus and dialogs.",
    keywords: "blur frosting translucent popup",
    type: "range",
    min: 0,
    max: 40,
    step: 2,
    unit: "px",
  },
  {
    key: "animationSpeed",
    category: "appearance",
    section: "Motion",
    label: "Interface motion",
    description: "Choose the speed of menus and transitions.",
    keywords: "animations snappy speed instant",
    type: "select",
    options: [
      { value: "snappy", label: "Snappy" },
      { value: "smooth", label: "Relaxed" },
      { value: "instant", label: "Instant" },
    ],
  },
  {
    key: "fontFamily",
    category: "editor",
    section: "Typography",
    label: "Font family",
    description: "Choose the font used in the editor.",
    keywords: "typeface",
    type: "select",
    options: [
      { value: "system", label: "System mono" },
      { value: "menlo", label: "Menlo" },
      { value: "monospace", label: "Monospace" },
    ],
  },
  {
    key: "fontSize",
    category: "editor",
    section: "Typography",
    label: "Font size",
    description: "Editor text size in pixels.",
    keywords: "zoom typography",
    type: "font-size",
  },
  {
    key: "lineHeight",
    category: "editor",
    section: "Typography",
    label: "Line height",
    description: "Adjust the space between lines of code.",
    keywords: "spacing leading",
    type: "range",
    min: 1.2,
    max: 2.4,
    step: 0.1,
    unit: "×",
  },
  {
    key: "letterSpacing",
    category: "editor",
    section: "Typography",
    label: "Letter spacing",
    description: "Fine-tune the space between characters.",
    keywords: "tracking typography",
    type: "range",
    min: -0.5,
    max: 2,
    step: 0.1,
    unit: "px",
  },
  ...switches("editor", "Typography", [
    [
      "fontLigatures",
      "Font ligatures",
      "Allow connected glyphs when your chosen font supports them.",
      "typography symbols",
    ],
  ]),
  {
    key: "tabSize",
    category: "editor",
    section: "Editing",
    label: "Indentation",
    description: "Number of spaces in each indentation level.",
    keywords: "tabs indent",
    type: "select",
    options: [2, 4, 8].map((value) => ({ value, label: `${value} spaces` })),
  },
  ...switches("editor", "Editing", [
    [
      "wordWrap",
      "Wrap long lines",
      "Keep long lines within the editor width.",
      "word wrapping",
    ],
    [
      "autoIndent",
      "Automatic indentation",
      "Adjust indentation as you type.",
      "tabs typing",
    ],
    [
      "autoCloseBrackets",
      "Auto-close brackets",
      "Complete parentheses, quotes, and brackets as you type.",
      "pairs quotes",
    ],
    [
      "matchBrackets",
      "Matching brackets",
      "Highlight the pair beside your cursor.",
      "parentheses pairs",
    ],
    [
      "highlightMatches",
      "Selection matches",
      "Highlight other occurrences of selected text.",
      "occurrences highlight",
    ],
  ]),
  ...switches("editor", "Privacy", [
    [
      "blurEnvSecrets",
      "Blur sensitive .env values",
      "Hide likely secrets in the editor. Click a value to reveal or hide it.",
      "dotenv API key password secret privacy mask",
    ],
  ]),
  ...switches("editor", "Guides & gutters", [
    [
      "lineNumbers",
      "Line numbers",
      "Keep a clear reference beside every line.",
      "gutter",
    ],
    [
      "relativeLineNumbers",
      "Relative line numbers",
      "Show distances from the current line.",
      "vim gutter",
    ],
    [
      "indentGuides",
      "Indent guides",
      "Subtle guides through leading whitespace.",
      "indentation structure",
    ],
    [
      "folding",
      "Code folding",
      "Collapse functions and blocks from the gutter.",
      "gutter fold",
    ],
    [
      "activeLine",
      "Active line highlight",
      "A quiet highlight behind the line you are editing.",
      "cursor gutter",
    ],
  ]),
  {
    key: "renderWhitespace",
    category: "editor",
    section: "Guides & gutters",
    label: "Visible whitespace",
    description: "Reveal spaces and tabs only where you need them.",
    keywords: "trailing invisible spaces",
    type: "select",
    options: [
      { value: "none", label: "Hidden" },
      { value: "trailing", label: "Trailing only" },
      { value: "all", label: "All whitespace" },
    ],
  },
  {
    key: "rulerColumn",
    category: "editor",
    section: "Guides & gutters",
    label: "Column ruler",
    description: "Show a guide at your preferred line length.",
    keywords: "80 100 120 margin",
    type: "select",
    options: [
      { value: 0, label: "Off" },
      ...[80, 100, 120].map((value) => ({ value, label: `${value} columns` })),
    ],
  },
  {
    key: "cursorStyle",
    category: "editor",
    section: "Cursor & viewport",
    label: "Cursor shape",
    description: "Choose the shape that is easiest to follow.",
    keywords: "caret block underline line",
    type: "select",
    options: [
      { value: "line", label: "Line" },
      { value: "block", label: "Block" },
      { value: "underline", label: "Underline" },
    ],
  },
  {
    key: "cursorBlinkRate",
    category: "editor",
    section: "Cursor & viewport",
    label: "Cursor blink",
    description: "Use a steady cursor or choose its blink cycle.",
    keywords: "caret motion",
    type: "select",
    options: [
      { value: 0, label: "Steady" },
      { value: 600, label: "Fast" },
      { value: 1000, label: "Balanced" },
      { value: 1400, label: "Slow" },
    ],
  },
  {
    key: "editorPadding",
    category: "editor",
    section: "Cursor & viewport",
    label: "Editor inset",
    description: "Space around the gutter and above the first line.",
    keywords: "padding comfort",
    type: "range",
    min: 4,
    max: 40,
    step: 2,
    unit: "px",
  },
  ...switches("editor", "Cursor & viewport", [
    [
      "scrollPastEnd",
      "Scroll past the last line",
      "Bring the end of a file into a comfortable reading position.",
      "scroll viewport",
    ],
  ]),
  ...switches("editor", "Suggestions", [
    [
      "aiCompletions",
      "AI code suggestions",
      "Send nearby code to your selected provider while typing. Uses account tokens or API credits; off by default.",
      "AI autocomplete model tokens usage",
    ],
    [
      "autocomplete",
      "Code suggestions",
      "Offer completions from your code and connected language servers.",
      "intellisense autocomplete",
    ],
    [
      "completionOnTyping",
      "Suggest while typing",
      "Show suggestions automatically. Manual completion still uses Control Space.",
      "autocomplete completion",
    ],
  ]),
  {
    key: "completionDelay",
    category: "editor",
    section: "Suggestions",
    label: "Suggestion delay",
    description: "A short pause before automatic suggestions appear.",
    keywords: "autocomplete speed typing",
    type: "range",
    min: 50,
    max: 500,
    step: 10,
    unit: "ms",
  },
  ...switches("files", "Saving", [
    [
      "autoSave",
      "Auto save",
      "Save after you pause typing, using the delay below.",
      "autosave files saving",
    ],
  ]),
  {
    key: "autoSaveDelay",
    category: "files",
    section: "Saving",
    label: "Auto save delay",
    description: "How long to wait after your last edit.",
    keywords: "autosave timing",
    type: "select",
    options: [
      { value: 500, label: "0.5 seconds" },
      { value: 1000, label: "1 second" },
      { value: 1500, label: "1.5 seconds" },
      { value: 3000, label: "3 seconds" },
      { value: 5000, label: "5 seconds" },
    ],
  },
  ...switches("files", "Deletion", [
    [
      "confirmDelete",
      "Confirm file deletion",
      "Ask before deleting files and folders. Unsaved changes always require confirmation.",
    ],
  ]),
  ...switches("layout", "Workspace", [
    [
      "aiPanelOnDrag",
      "Open AI panel while dragging",
      "Temporarily reveal the AI panel when dragging files or context. It closes when the drag ends.",
    ],
    [
      "showBreadcrumbs",
      "Breadcrumbs",
      "Show the current file path above your code.",
      "navigation path",
    ],
    [
      "showStatusbar",
      "Status bar",
      "Keep cursor, language, and project status in view.",
      "bottom footer",
    ],
  ]),
  {
    key: "terminalProfile",
    category: "terminal",
    section: "Shell profiles",
    label: "Default shell",
    description: "Used for new sessions. Existing shells keep running.",
    keywords: "bash zsh powershell cmd windows command prompt profile fish",
    type: "profile",
  },
  {
    key: "terminalFontSize",
    category: "terminal",
    section: "Typography",
    label: "Terminal font size",
    description: "Text size for your shell sessions.",
    keywords: "zoom",
    type: "range",
    min: 10,
    max: 24,
    step: 1,
    unit: "px",
  },
  {
    key: "terminalLineHeight",
    category: "terminal",
    section: "Typography",
    label: "Terminal line height",
    description: "Space between lines of shell output.",
    keywords: "spacing",
    type: "range",
    min: 1,
    max: 2,
    step: 0.1,
    unit: "×",
  },
  {
    key: "terminalCursorStyle",
    category: "terminal",
    section: "Cursor & selection",
    label: "Terminal cursor shape",
    description: "Choose the cursor displayed in the terminal.",
    keywords: "caret",
    type: "select",
    options: [
      { value: "block", label: "Block" },
      { value: "bar", label: "Bar" },
      { value: "underline", label: "Underline" },
    ],
  },
  ...switches("terminal", "Cursor & selection", [
    [
      "cursorBlink",
      "Blinking terminal cursor",
      "Animate the cursor in your terminal sessions.",
      "caret motion",
    ],
    [
      "terminalCopyOnSelect",
      "Copy on selection",
      "Copy selected terminal output to the clipboard.",
      "clipboard mouse",
    ],
  ]),
  {
    key: "terminalScrollback",
    category: "terminal",
    section: "History",
    label: "Scrollback",
    description: "Lines of output retained in each session.",
    keywords: "buffer shell",
    type: "select",
    options: [1000, 5000, 10000, 50000].map((value) => ({
      value,
      label: `${value.toLocaleString()} lines`,
    })),
  },
  ...switches("accessibility", "Comfort", [
    [
      "reduceMotion",
      "Reduce motion",
      "Keep transitions and cursor animations still. System preferences take priority.",
      "animation accessibility",
    ],
  ]),
  {
    key: "vcsProvider",
    category: "git",
    section: "Version control provider",
    label: "Active source control provider",
    description:
      "Choose between Hit (next-gen blazingly fast VCS, default) and standard Git.",
    keywords: "git hit vcs source control version repository",
    type: "select",
    options: [
      { value: "hit", label: "Hit (Fast, default)" },
      { value: "git", label: "Git (Standard)" },
    ],
  },
];
