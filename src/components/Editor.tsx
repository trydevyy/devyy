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
  documentationBlocks,
  highlightCodeElement,
} from "../lib/codeHighlight";
import { transparentGutters } from "../lib/editorGutters";
import { memo, useEffect, useMemo, useRef } from "react";
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
  completeAnyWord,
  type CompletionContext,
  type Completion,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { aiCompletion } from "../lib/aiCompletion";
import { extensionSnippets } from "../lib/extensions";
import {
  detectContentLanguage,
  languageDescription,
  loadDocumentLanguage,
  languageId,
} from "../lib/languages";
import { editorAppearance, editorSettingKeys } from "../lib/editorAppearance";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { extensionLanguageFeature } from "../lib/extensionHost";
import { languageRequest } from "../lib/native";
import { devyySearch } from "../lib/findPanel";
import { closeSearchPanel } from "@codemirror/search";
import { type LspDiagnostic, type Position, type Settings } from "../lib/types";
import {
  computeExtensionDecorations,
  getExtensionDecorationHover,
  onDecorationsChanged,
  matchesDocPath,
} from "../lib/extensionDecorations";
import {
  signatureHelpField,
  triggerSignatureHelp,
  closeSignatureHelp,
} from "../lib/lspSignatureHelp";
import {
  inlayHintsField,
  inlayHintsEffect,
  fetchInlayHints,
} from "../lib/lspInlayHints";
import {
  codeLensesField,
  codeLensesEffect,
  fetchCodeLenses,
} from "../lib/lspCodeLenses";
import {
  semanticTokensField,
  semanticTokensEffect,
  fetchSemanticTokens,
} from "../lib/lspSemanticTokens";
import { Decoration } from "@codemirror/view";

const extensionDecorationEffect = StateEffect.define<RangeSet<Decoration>>();
const extensionDecorationField = StateField.define<RangeSet<Decoration>>({
  create: () => RangeSet.empty,
  update: (decorations, tr) => {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(extensionDecorationEffect)) decorations = effect.value;
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const extensionGutterEffect = StateEffect.define<RangeSet<GutterMarker>>();
const extensionGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (markers, tr) => {
    markers = markers.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(extensionGutterEffect)) markers = effect.value;
    return markers;
  },
});

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "breakpoint-dot";
    return dot;
  }
}

type HoverContent = string | { value: string; language?: string };

function createHoverDOM(content: HoverContent[], path: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "hover-doc";

  const appendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\n\s*---\s*\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        const hr = document.createElement("hr");
        hr.className = "hover-divider";
        container.appendChild(hr);
      }
      const p = document.createElement("div");
      p.className = "hover-body";
      const lines = parts[i].split("\n");
      for (const line of lines) {
        const lineEl = document.createElement("div");
        lineEl.className = "hover-line";
        const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
        for (const token of tokens) {
          if (token.startsWith("`") && token.endsWith("`")) {
            const code = document.createElement("code");
            code.className = "hover-inline-code";
            code.textContent = token.slice(1, -1);
            lineEl.appendChild(code);
          } else if (token.startsWith("**") && token.endsWith("**")) {
            const strong = document.createElement("strong");
            strong.textContent = token.slice(2, -2);
            lineEl.appendChild(strong);
          } else if (token) {
            lineEl.appendChild(document.createTextNode(token));
          }
        }
        p.appendChild(lineEl);
      }
      container.appendChild(p);
    }
  };

  function appendCode(code: string, language?: string) {
    const block = document.createElement("div");
    block.className = "hover-signature";
    if (language) {
      const badge = document.createElement("span");
      badge.className = "hover-signature-badge";
      badge.textContent = language;
      block.appendChild(badge);
    }
    const pre = document.createElement("pre");
    pre.className = "hover-signature-code";
    highlightCodeElement(pre, code, { language, path });
    block.appendChild(pre);
    container.appendChild(block);
  }

  for (const [index, part] of content.entries()) {
    if (index > 0) {
      const divider = document.createElement("hr");
      divider.className = "hover-divider";
      container.appendChild(divider);
    }
    if (typeof part !== "string" && part.language) {
      appendCode(part.value, part.language);
      continue;
    }
    for (const block of documentationBlocks(
      typeof part === "string" ? part : part.value,
    )) {
      if ("code" in block) appendCode(block.code, block.language);
      else appendText(block.text);
    }
  }

  return container;
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
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
    ],
    color: "var(--syntax-keyword)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-function)",
  },
  { tag: tags.comment, color: "var(--syntax-comment)" },
  {
    tag: [tags.string, tags.attributeValue, tags.regexp, tags.escape],
    color: "var(--syntax-string)",
  },
  { tag: [tags.number, tags.bool], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
  {
    tag: [tags.operator, tags.punctuation],
    color: "var(--syntax-punctuation)",
  },
  { tag: tags.meta, color: "var(--syntax-meta)" },
  {
    tag: [tags.tagName, tags.attributeName, tags.propertyName, tags.namespace],
    color: "var(--syntax-type)",
  },
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
  range?:
    | { start: Position; end: Position }
    | {
        inserting: { start: Position; end: Position };
        replacing: { start: Position; end: Position };
      };
  detail?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEditText?: string;
  additionalTextEdits?: {
    range: { start: Position; end: Position };
    newText: string;
  }[];
  textEdit?: {
    newText: string;
    range?: { start: Position; end: Position };
    insert?: { start: Position; end: Position };
    replace?: { start: Position; end: Position };
  };
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
async function languageComplete(
  ctx: CompletionContext,
  source: "server" | "extension" = "server",
): Promise<CompletionResult | null> {
  const view = ctx.view;
  if (!view) return null;
  const word = ctx.matchBefore(/[\w!$]+/);
  if (
    !word &&
    !ctx.explicit &&
    !/[.:>]$/.test(ctx.state.sliceDoc(Math.max(0, ctx.pos - 1), ctx.pos))
  )
    return null;
  const path = view.dom.closest<HTMLElement>("[data-path]")?.dataset.path;
  if (!path) return null;
  const position = toPosition(view, ctx.pos);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      if (source === "server") {
        const result = await languageRequest<
          | CompletionItem[]
          | {
              items: CompletionItem[];
              itemDefaults?: {
                insertTextFormat?: number;
                editRange?:
                  | { start: Position; end: Position }
                  | {
                      insert: { start: Position; end: Position };
                      replace: { start: Position; end: Position };
                    };
              };
            }
        >(path, "textDocument/completion", position, {
          context: {
            triggerKind: ctx.explicit ? 1 : word ? 1 : 2,
            ...(!word && !ctx.explicit
              ? { triggerCharacter: ctx.state.sliceDoc(ctx.pos - 1, ctx.pos) }
              : {}),
          },
        }).catch(() => null);
        if (Array.isArray(result)) return result;
        const defaults = result?.itemDefaults;
        return (result?.items ?? []).map((item) => ({
          ...item,
          insertTextFormat: item.insertTextFormat ?? defaults?.insertTextFormat,
          textEdit:
            item.textEdit ??
            (defaults?.editRange
              ? {
                  newText: item.textEditText ?? item.insertText ?? item.label,
                  ...("start" in defaults.editRange
                    ? { range: defaults.editRange }
                    : defaults.editRange),
                }
              : undefined),
        }));
      }
      type Item = Omit<CompletionItem, "label" | "insertText"> & {
        label: string | { label: string };
        insertText?: string | { value: string };
      };
      const provided = await extensionLanguageFeature<
        Item[] | { items: Item[] }
      >("provideCompletionItems", path, position, undefined, {
        triggerKind: ctx.explicit || word ? 0 : 1,
        ...(!word && !ctx.explicit
          ? { triggerCharacter: ctx.state.sliceDoc(ctx.pos - 1, ctx.pos) }
          : {}),
      }).catch(() => []);
      return (provided ?? [])
        .flatMap((value) =>
          Array.isArray(value) ? value : (value.items ?? []),
        )
        .map((item) => ({
          ...item,
          label: typeof item.label === "string" ? item.label : item.label.label,
          insertText:
            typeof item.insertText === "string"
              ? item.insertText
              : item.insertText?.value,
          insertTextFormat:
            typeof item.insertText === "object" ? 2 : item.insertTextFormat,
          kind: item.kind === undefined ? undefined : item.kind + 1,
        }));
    };
    const items = await Promise.race([
      work().catch(() => []),
      new Promise<CompletionItem[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 5000);
      }),
    ]);
    if (ctx.aborted || !items.length) return null;
    return {
      from: word?.from ?? ctx.pos,
      validFor: /^[\w!$]*$/,
      options: items.map((item) => {
        const text = item.textEdit?.newText ?? item.insertText ?? item.label;
        const completion = {
          label: item.label,
          detail: item.detail,
          type:
            item.kind === 3
              ? "function"
              : item.kind === 6
                ? "variable"
                : "text",
        };
        const snippet =
          item.insertTextFormat === 2
            ? snippetCompletion(text, completion)
            : undefined;
        const range =
          item.textEdit?.range ??
          item.textEdit?.replace ??
          item.textEdit?.insert ??
          (item.range &&
            ("replacing" in item.range ? item.range.replacing : item.range));
        return {
          ...completion,
          apply: (
            editor: EditorView,
            choice: Completion,
            from: number,
            to: number,
          ) => {
            if (range) {
              from = offset(editor, range.start);
              to = offset(editor, range.end);
            }
            const additional = (item.additionalTextEdits ?? []).map((edit) => ({
              from: offset(editor, edit.range.start),
              to: offset(editor, edit.range.end),
              insert: edit.newText,
            }));
            if (snippet && typeof snippet.apply === "function") {
              if (additional.length) {
                const changes = editor.state.changes(additional);
                from = changes.mapPos(from, 1);
                to = changes.mapPos(to, 1);
                editor.dispatch({ changes, userEvent: "input.complete" });
              }
              snippet.apply(editor, choice, from, to);
            } else {
              const changes = editor.state.changes([
                ...additional,
                { from, to, insert: text },
              ]);
              editor.dispatch({
                changes,
                selection: { anchor: changes.mapPos(from, -1) + text.length },
                userEvent: "input.complete",
              });
            }
          },
        };
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}
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
  const inferredLanguage = useMemo(
    () =>
      !props.languageId && !languageDescription(props.path)
        ? detectContentLanguage(props.value)
        : undefined,
    [props.languageId, props.path, props.value],
  );
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null),
    current = useRef(props);
  current.current = props;
  const config = useRef(new Compartment());
  const langConfig = useRef(new Compartment());
  const accessConfig = useRef(new Compartment());
  function settingsExtensions(settings: Settings) {
    return [
      ...editorAppearance(settings),
      settings.autocomplete
        ? autocompletion({
            activateOnTyping: settings.completionOnTyping,
            activateOnTypingDelay: settings.completionDelay,
            updateSyncTime: 80,
            override: [
              localComplete,
              completeAnyWord,
              languageComplete,
              (ctx) => languageComplete(ctx, "extension"),
              (ctx) => {
                const word = ctx.matchBefore(/[\w!$]+/);
                return {
                  from: word?.from ?? ctx.pos,
                  options: snippetOptions.current,
                  validFor: /^[\w!$]*$/,
                };
              },
              (ctx) =>
                aiCompletion(
                  ctx,
                  current.current.settings,
                  current.current.path,
                ).catch(() => null),
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
    let lspTimer: ReturnType<typeof setTimeout> | undefined;
    let lspRevision = 0;
    let scheduleLsp = () => {};
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current.current.value,
        extensions: [
          transparentGutters,
          devyySearch(),
          breakpointField,
          extensionDecorationField,
          extensionGutterField,
          signatureHelpField,
          inlayHintsField,
          codeLensesField,
          semanticTokensField,
          gutter({
            class: "cm-extension-gutter",
            markers: (view) => view.state.field(extensionGutterField),
          }),
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
          accessConfig.current.of(
            EditorState.readOnly.of(!!current.current.readOnly),
          ),
          EditorState.lineSeparator.of(
            current.current.value.includes("\r\n") ? "\r\n" : "\n",
          ),
          keymap.of([
            {
              key: "Escape",
              run: (view) => {
                closeSignatureHelp(view);
                return closeSearchPanel(view);
              },
            },
            {
              key: "Mod-Shift-Space",
              run: (view) => {
                void triggerSignatureHelp(view, current.current.path);
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          hoverTooltip(async (view, pos) => {
            const extHover = getExtensionDecorationHover(
              view.state.doc,
              current.current.path,
              pos,
            );
            try {
              let result = await languageRequest<{
                contents: HoverContent | HoverContent[];
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

              const content = result?.contents;
              const parts = Array.isArray(content)
                ? [...content]
                : content
                  ? [content]
                  : [];
              if (extHover) parts.unshift(extHover.text);
              if (
                !parts.some((part) =>
                  typeof part === "string" ? part.trim() : part.value.trim(),
                )
              )
                return null;
              const path = current.current.path;
              return {
                pos: extHover ? extHover.from : pos,
                end: extHover ? extHover.to : undefined,
                create: () => ({ dom: createHoverDOM(parts, path) }),
              };
            } catch {
              if (extHover) {
                return {
                  pos: extHover.from,
                  end: extHover.to,
                  create: () => ({
                    dom: createHoverDOM([extHover.text], current.current.path),
                  }),
                };
              }
              return null;
            }
          }),
          config.current.of(settingsExtensions(current.current.settings)),
          EditorView.updateListener.of((update) => {
            if (update.focusChanged && update.view.hasFocus)
              current.current.onView(current.current.path, update.view);
            if (update.docChanged) {
              ++lspRevision;
              scheduleLsp();
              current.current.onChange(
                current.current.path,
                update.state.sliceDoc(),
              );
              update.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
                const s = text.toString();
                if (s.includes("(") || s.includes(",")) {
                  void triggerSignatureHelp(update.view, current.current.path);
                }
              });
            }
            if (
              update.viewportChanged &&
              !update.selectionSet &&
              !update.docChanged
            )
              window.dispatchEvent(new Event("devyy-editor-viewport"));
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
              overscrollBehavior: "contain",
              contain: "layout paint",
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

    const updateDecorations = () => {
      if (editor.current !== view) return;
      const res = computeExtensionDecorations(
        view.state.doc,
        current.current.path,
      );
      view.dispatch({
        effects: [
          extensionDecorationEffect.of(res.decorations),
          extensionGutterEffect.of(res.gutterMarkers),
        ],
      });
    };
    updateDecorations();
    const unlistenDecorations = onDecorationsChanged((path) => {
      if (!path || matchesDocPath(current.current.path, path)) {
        updateDecorations();
      }
    });

    const updateLspDecorations = async () => {
      if (editor.current !== view) return;
      const revision = ++lspRevision,
        doc = view.state.doc;
      const [hints, lenses, tokens] = await Promise.all([
        fetchInlayHints(view, current.current.path),
        fetchCodeLenses(view, current.current.path),
        fetchSemanticTokens(view, current.current.path),
      ]);
      if (
        editor.current === view &&
        revision === lspRevision &&
        view.state.doc === doc
      ) {
        view.dispatch({
          effects: [
            inlayHintsEffect.of(hints),
            codeLensesEffect.of(lenses),
            semanticTokensEffect.of(tokens),
          ],
        });
      }
    };
    scheduleLsp = () => {
      clearTimeout(lspTimer);
      lspTimer = setTimeout(() => void updateLspDecorations(), 300);
    };
    const connected = (event: Event) => {
      if (
        (event as CustomEvent<{ path: string }>).detail.path ===
        current.current.path
      )
        scheduleLsp();
    };
    const providerChanged = (event: Event) => {
      if (
        [
          "languageProvider",
          "languageProviderChanged",
          "languageProviderRemoved",
        ].includes((event as CustomEvent<{ event: string }>).detail.event)
      )
        scheduleLsp();
    };
    window.addEventListener("devyy-document-connected", connected);
    window.addEventListener("devyy-extension-event", providerChanged);
    window.addEventListener("devyy-language-servers-changed", scheduleLsp);
    void updateLspDecorations();

    current.current.onView(current.current.path, view);
    return () => {
      ++lspRevision;
      clearTimeout(lspTimer);
      window.removeEventListener("devyy-document-connected", connected);
      window.removeEventListener("devyy-extension-event", providerChanged);
      window.removeEventListener("devyy-language-servers-changed", scheduleLsp);
      window.removeEventListener("devyy-extensions-changed", refresh);
      unlistenDecorations();
      current.current.onView(current.current.path, null);
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    let cancelled = false;
    void (async () => {
      const support = await loadDocumentLanguage(
        props.path,
        inferredLanguage,
        props.languageId,
      );
      if (!cancelled && editor.current === view)
        view.dispatch({
          effects: langConfig.current.reconfigure(support ?? []),
        });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.path, props.languageId, inferredLanguage]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.sliceDoc() !== props.value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
      });
      const res = computeExtensionDecorations(view.state.doc, props.path);
      view.dispatch({
        effects: [
          extensionDecorationEffect.of(res.decorations),
          extensionGutterEffect.of(res.gutterMarkers),
        ],
      });
    }
  }, [props.value]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: accessConfig.current.reconfigure(
        EditorState.readOnly.of(!!props.readOnly),
      ),
    });
  }, [props.readOnly]);
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
