import { memo, useEffect, useRef } from "react";
import {
  EditorState,
  Compartment,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  rectangularSelection,
  crosshairCursor,
  hoverTooltip,
  gutter,
  GutterMarker,
} from "@codemirror/view";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
} from "@codemirror/language";
import {
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
  completeFromList,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { extensionSnippets } from "../lib/extensions";
import { loadLanguage, languageId } from "../lib/languages";
import { editorAppearance, editorSettingKeys } from "../lib/editorAppearance";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { extensionLanguageFeature } from "../lib/extensionHost";
import { languageRequest } from "../lib/native";
import { type LspDiagnostic, type Position, type Settings } from "../lib/types";

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "breakpoint-dot";
    return dot;
  }
}
const marker = new BreakpointMarker();
const breakpointEffect = StateEffect.define<number[]>();
const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (markers, tr) => {
    markers = markers.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(breakpointEffect))
        markers = RangeSet.of(
          effect.value
            .filter((line) => line <= tr.state.doc.lines)
            .map((line) => marker.range(tr.state.doc.line(line).from)),
          true,
        );
    return markers;
  },
});
export const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-function)",
  },
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
  {
    tag: [tags.operator, tags.punctuation],
    color: "var(--syntax-punctuation)",
  },
  { tag: tags.meta, color: "var(--syntax-meta)" },
  { tag: [tags.tagName, tags.attributeName], color: "var(--syntax-type)" },
  { tag: [tags.atom, tags.null, tags.unit], color: "var(--syntax-number)" },
  {
    tag: [tags.regexp, tags.special(tags.string)],
    color: "var(--syntax-string)",
  },
  { tag: tags.heading, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.invalid, textDecoration: "underline wavy #cf9696" },
]);
function toPosition(view: EditorView, offset: number): Position {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}
function offset(view: EditorView, pos: Position) {
  const line = view.state.doc.line(
    Math.max(1, Math.min(pos.line + 1, view.state.doc.lines)),
  );
  return Math.min(line.to, line.from + pos.character);
}
interface CompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  textEdit?: { newText: string };
  kind?: number;
}
const localComplete = completeFromList(
  [
    "fn",
    "let",
    "mut",
    "pub",
    "struct",
    "impl",
    "use",
    "mod",
    "match",
    "if",
    "else",
    "for",
    "while",
    "return",
    "const",
    "async",
    "await",
    "function",
    "import",
    "export",
    "class",
    "def",
    "self",
    "String",
    "Vec",
    "Option",
    "Result",
    "println!",
  ].map((label) => ({ label, type: "keyword" })),
);
export interface EditorProps {
  path: string;
  value: string;
  settings: Settings;
  diagnostics: LspDiagnostic[];
  onChange: (path: string, text: string) => void;
  onCursor: (path: string, line: number, col: number) => void;
  onView: (path: string, view: EditorView | null) => void;
  onDefinition: () => void;
  readOnly?: boolean;
  languageId?: string;
  breakpoints: number[];
  onBreakpoint: (path: string, line: number) => void;
}
function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null),
    current = useRef(props);
  current.current = props;
  const config = useRef(new Compartment());
  const langConfig = useRef(new Compartment());
  function settingsExtensions(settings: Settings) {
    return [
      ...editorAppearance(settings),
      settings.autocomplete
        ? autocompletion({
            activateOnTyping: settings.completionOnTyping,
            activateOnTypingDelay: settings.completionDelay,
            override: [
              async (ctx) => {
                const word = ctx.matchBefore(/[\w!]+/);
                if (!word && !ctx.explicit) return null;
                try {
                  let result = await languageRequest<
                    CompletionItem[] | { items: CompletionItem[] }
                  >(
                    current.current.path,
                    "textDocument/completion",
                    toPosition(ctx.view!, ctx.pos),
                  );
                  if (!result) {
                    type Item = {
                      label: string | { label: string };
                      detail?: string;
                      insertText?: string | { value: string };
                      kind?: number;
                      textEdit?: { newText: string };
                    };
                    const provided = await extensionLanguageFeature<
                      Item[] | { items: Item[] }
                    >(
                      "provideCompletionItems",
                      current.current.path,
                      toPosition(ctx.view!, ctx.pos),
                    );
                    result = provided
                      .flatMap((value) =>
                        Array.isArray(value) ? value : value.items,
                      )
                      .map((item) => ({
                        label:
                          typeof item.label === "string"
                            ? item.label
                            : item.label.label,
                        detail: item.detail,
                        insertText:
                          typeof item.insertText === "string"
                            ? item.insertText
                            : item.insertText?.value,
                        kind:
                          item.kind === undefined ? undefined : item.kind + 1,
                        textEdit: item.textEdit,
                      }));
                  }
                  if (result) {
                    const items = Array.isArray(result) ? result : result.items;
                    if (items.length)
                      return {
                        from: word?.from ?? ctx.pos,
                        options: items.map((item) => ({
                          label: item.label,
                          detail: item.detail,
                          apply:
                            item.textEdit?.newText ??
                            item.insertText ??
                            item.label,
                          type:
                            item.kind === 3
                              ? "function"
                              : item.kind === 6
                                ? "variable"
                                : "text",
                        })),
                      };
                  }
                } catch {
                  /* Local completion remains available when a server is busy. */
                }
                const local = await localComplete(ctx);
                const snippets = snippetOptions.current;
                return snippets.length
                  ? {
                      from: word?.from ?? ctx.pos,
                      options: [...snippets, ...(local?.options ?? [])],
                    }
                  : local;
              },
            ],
          })
        : [],
    ];
  }
  const extensionConfig = useRef(new Compartment());
  const snippetOptions = useRef<ReturnType<typeof snippetCompletion>[]>([]);
  const configuration =
    editorSettingKeys.map((key) => props.settings[key]).join("|") +
    "|" +
    props.settings.reduceMotion;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current.current.value,
        extensions: [
          breakpointField,
          gutter({
            class: "cm-breakpoint-gutter",
            renderEmptyElements: true,
            markers: (view) => view.state.field(breakpointField),
            initialSpacer: () => marker,
            domEventHandlers: {
              mousedown: (view, line) => {
                current.current.onBreakpoint(
                  current.current.path,
                  view.state.doc.lineAt(line.from).number,
                );
                return true;
              },
            },
          }),
          history(),
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          lintGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          syntaxHighlighting(highlighting),
          langConfig.current.of([]),
          extensionConfig.current.of([]),
          EditorState.readOnly.of(!!current.current.readOnly),
          EditorState.lineSeparator.of(
            current.current.value.includes("\r\n") ? "\r\n" : "\n",
          ),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          hoverTooltip(async (view, pos) => {
            try {
              let result = await languageRequest<{
                contents:
                  | string
                  | { value: string }
                  | Array<string | { value: string }>;
              }>(
                current.current.path,
                "textDocument/hover",
                toPosition(view, pos),
              );
              if (!result)
                result =
                  (
                    await extensionLanguageFeature<NonNullable<typeof result>>(
                      "provideHover",
                      current.current.path,
                      toPosition(view, pos),
                    )
                  )[0] ?? null;
              if (!result?.contents) return null;
              const c = result.contents;
              const text = Array.isArray(c)
                ? c.map((x) => (typeof x === "string" ? x : x.value)).join("\n")
                : typeof c === "string"
                  ? c
                  : c.value;
              return {
                pos,
                create: () => {
                  const dom = document.createElement("pre");
                  dom.className = "hover-doc";
                  dom.textContent = text;
                  return { dom };
                },
              };
            } catch {
              return null;
            }
          }),
          config.current.of(settingsExtensions(current.current.settings)),
          EditorView.updateListener.of((update) => {
            if (update.focusChanged && update.view.hasFocus)
              current.current.onView(current.current.path, update.view);
            if (update.docChanged)
              current.current.onChange(
                current.current.path,
                update.state.sliceDoc(),
              );
            if (
              update.viewportChanged &&
              !update.selectionSet &&
              !update.docChanged
            )
              window.dispatchEvent(new Event("devyy-editor-selection"));
            if (update.selectionSet || update.docChanged) {
              window.dispatchEvent(new Event("devyy-editor-selection"));
              const line = update.state.doc.lineAt(
                update.state.selection.main.head,
              );
              current.current.onCursor(
                current.current.path,
                line.number,
                update.state.selection.main.head - line.from + 1,
              );
            }
          }),
          EditorView.theme({
            "&": { height: "100%", background: "transparent" },
            ".cm-scroller": {
              fontFamily: "var(--editor-mono, var(--mono))",
              lineHeight: "var(--editor-line-height, 1.8)",
              overflow: "auto",
            },
            ".cm-content": {
              caretColor: "var(--accent)",
            },
            ".cm-line": { padding: "0 28px 0 10px" },
            ".cm-gutters": {
              background: "transparent",
              border: "none",
              color: "var(--faint)",
            },
            ".cm-lineNumbers .cm-gutterElement": {
              minWidth: "31px",
              paddingRight: "12px",
            },
            ".cm-activeLine": { backgroundColor: "var(--active-line)" },
            ".cm-activeLineGutter": {
              backgroundColor: "transparent",
              color: "var(--ink)",
            },
            ".cm-cursor": { borderLeftColor: "var(--accent)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              background: "var(--selection) !important",
            },
            ".cm-foldGutter": { width: "15px" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    editor.current = view;
    void loadLanguage(
      current.current.languageId ?? current.current.path,
      !!current.current.languageId,
    )
      .then((ext) => {
        if (editor.current === view)
          view.dispatch({ effects: langConfig.current.reconfigure(ext ?? []) });
      })
      .catch(() => {});
    let extensionRevision = 0;
    const loadExtensions = async () => {
      const revision = ++extensionRevision;
      const language =
        current.current.languageId ?? languageId(current.current.path);
      const snippets = language ? await extensionSnippets(language) : [];
      if (revision !== extensionRevision || editor.current !== view) return;
      snippetOptions.current = snippets.map((s) =>
        snippetCompletion(s.template.replace(/\$([A-Z_][A-Z_0-9]*)/g, ""), {
          label: s.label,
          detail: s.detail,
          type: "snippet",
        }),
      );
      const { textmateGrammar, textmateHighlighting } =
        await import("../lib/textmate");
      const grammar = await textmateGrammar(current.current.path);
      if (editor.current === view && revision === extensionRevision)
        view.dispatch({
          effects: extensionConfig.current.reconfigure(
            grammar ? textmateHighlighting(grammar) : [],
          ),
        });
    };
    const refresh = () => {
      void loadExtensions().catch(() => {});
    };
    refresh();
    window.addEventListener("devyy-extensions-changed", refresh);
    current.current.onView(current.current.path, view);
    return () => {
      window.removeEventListener("devyy-extensions-changed", refresh);
      current.current.onView(current.current.path, null);
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.sliceDoc() !== props.value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
      });
    }
  }, [props.value]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: config.current.reconfigure(settingsExtensions(props.settings)),
    });
  }, [configuration]);
  useEffect(() => {
    const view = editor.current;
    if (view)
      view.dispatch(
        setDiagnostics(
          view.state,
          props.diagnostics.map((d) => ({
            from: offset(view, d.range.start),
            to: offset(view, d.range.end),
            severity:
              d.severity === 1
                ? "error"
                : d.severity === 2
                  ? "warning"
                  : "info",
            message: d.message,
            source: d.source,
          })),
        ),
      );
  }, [props.diagnostics]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: breakpointEffect.of(props.breakpoints),
    });
  }, [props.breakpoints]);
  return <div className="code-editor" ref={host} />;
}
export default memo(Editor);
export { offset, toPosition };
