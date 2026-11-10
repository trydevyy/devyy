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
          borderLeft: "none",
          background: "var(--accent)",
          width: ".6em",
          opacity: ".5",
        }
      : s.cursorStyle === "underline"
        ? {
            borderLeft: "none",
            borderBottom: "2px solid var(--accent)",
            width: ".6em",
            transform: "translateY(.8em)",
            height: ".15em!important",
          }
        : { borderLeft: "1.5px solid var(--accent)" };
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
    }),
  ];
}
