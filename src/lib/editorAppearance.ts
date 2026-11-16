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

import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  Decoration,
  GutterMarker,
  gutter,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightWhitespace,
  highlightTrailingWhitespace,
  scrollPastEnd,
  highlightSpecialChars,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { insertNewline } from "@codemirror/commands";
import { closeBrackets } from "@codemirror/autocomplete";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightSelectionMatches } from "@codemirror/search";
import type { Settings } from "./types";
export const editorSettingKeys: (keyof Settings)[] = [
  "fontSize",
  "lineHeight",
  "fontFamily",
  "tabSize",
  "lineNumbers",
  "wordWrap",
  "fontLigatures",
  "letterSpacing",
  "activeLine",
  "relativeLineNumbers",
  "folding",
  "matchBrackets",
  "autoCloseBrackets",
  "indentGuides",
  "autoIndent",
  "highlightMatches",
  "renderWhitespace",
  "cursorStyle",
  "cursorBlinkRate",
  "scrollPastEnd",
  "editorPadding",
  "rulerColumn",
  "autocomplete",
  "completionOnTyping",
  "completionDelay",
  "aiCompletions",
  "aiCompletionProvider",
  "aiCompletionModel",
];
class NumberMarker extends GutterMarker {
  constructor(readonly value: string) {
    super();
  }
  eq(other: NumberMarker) {
    return this.value === other.value;
  }
  toDOM() {
    return document.createTextNode(this.value);
  }
}
const relativeNumbers = gutter({
  class: "cm-lineNumbers",
  lineMarker: (view, line) => {
    const n = view.state.doc.lineAt(line.from).number,
      current = view.state.doc.lineAt(view.state.selection.main.head).number;
    return new NumberMarker(String(n === current ? n : Math.abs(n - current)));
  },
  lineMarkerChange: (update) => update.selectionSet || update.docChanged,
  initialSpacer: (view) =>
    new NumberMarker("9".repeat(String(view.state.doc.lines).length)),
});
const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>(),
        seen = new Set<number>();
      for (const range of view.visibleRanges)
        for (let pos = range.from; pos <= range.to;) {
          const line = view.state.doc.lineAt(pos),
            whitespace = /^[\t ]+/.exec(line.text)?.[0];
          if (whitespace && !seen.has(line.from)) {
            builder.add(
              line.from,
              line.from + whitespace.length,
              Decoration.mark({ class: "cm-indent-guide" }),
            );
            seen.add(line.from);
          }
          pos = line.to + 1;
        }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
export function editorAppearance(s: Settings): Extension[] {
  const cursor: Record<string, string> =
    s.cursorStyle === "block"
      ? {
          borderLeft: "none !important",
          borderRight: "none !important",
          borderTop: "none !important",
          borderBottom: "none !important",
          backgroundColor: "var(--accent) !important",
          width: "0.6em !important",
          opacity: "0.55 !important",
          marginLeft: "0 !important",
          boxShadow: "none !important",
        }
      : s.cursorStyle === "underline"
        ? {
            borderLeft: "none !important",
            borderRight: "none !important",
            borderTop: "none !important",
            borderBottom: "none !important",
            backgroundColor: "transparent !important",
            width: "0.6em !important",
            boxShadow: "inset 0 -2.5px 0 0 var(--accent) !important",
            marginLeft: "0 !important",
            transform: "none !important",
            opacity: "1 !important",
          }
        : {
            borderLeft: "2px solid var(--accent) !important",
            borderRight: "none !important",
            borderTop: "none !important",
            borderBottom: "none !important",
            backgroundColor: "transparent !important",
            width: "0 !important",
            marginLeft: "-1px !important",
            boxShadow: "none !important",
            opacity: "1 !important",
          };
  return [
    s.lineNumbers
      ? s.relativeLineNumbers
        ? relativeNumbers
        : lineNumbers()
      : [],
    s.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    s.wordWrap ? EditorView.lineWrapping : [],
    s.folding ? foldGutter() : [],
    s.matchBrackets ? bracketMatching() : [],
    s.autoCloseBrackets ? closeBrackets() : [],
    s.indentGuides ? indentGuides : [],
    s.autoIndent
      ? indentOnInput()
      : Prec.high(keymap.of([{ key: "Enter", run: insertNewline }])),
    s.highlightMatches ? highlightSelectionMatches() : [],
    highlightSpecialChars(),
    s.renderWhitespace === "all"
      ? highlightWhitespace()
      : s.renderWhitespace === "trailing"
        ? highlightTrailingWhitespace()
        : [],
    s.scrollPastEnd ? scrollPastEnd() : [],
    drawSelection({ cursorBlinkRate: s.reduceMotion ? 0 : s.cursorBlinkRate }),
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(" ".repeat(s.tabSize)),
    EditorView.theme({
      "&": { fontSize: `${s.fontSize}px`, "--indent-size": `${s.tabSize}ch` },
      ".cm-scroller": {
        lineHeight: String(s.lineHeight),
        letterSpacing: `${s.letterSpacing}px`,
        fontVariantLigatures: s.fontLigatures ? "normal" : "none",
      },
      ".cm-content": {
        caretColor:
          s.cursorStyle === "line" ? "var(--accent)" : "transparent !important",
        paddingTop: `${s.editorPadding}px`,
        ...(s.scrollPastEnd ? {} : { paddingBottom: `${s.editorPadding}px` }),
        ...(s.rulerColumn
          ? {
              backgroundImage: "linear-gradient(var(--line),var(--line))",
              backgroundSize: "1px 100%",
              backgroundRepeat: "no-repeat",
              backgroundPosition: `calc(${s.rulerColumn}ch + 10px) 0`,
            }
          : {}),
      },
      ".cm-gutters": { paddingLeft: `${s.editorPadding}px` },
      ".cm-cursor": cursor,
      ".cm-cursor-primary": cursor,
      ".cm-cursor-secondary": cursor,
    }),
  ];
}
