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
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Registry,
  parseRawGrammar,
  INITIAL,
  type IGrammar,
  type StateStack,
} from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import wasmURL from "vscode-oniguruma/release/onig.wasm?url";
import { languageId } from "./languages";
import {
  allExtensions,
  extensionAsset,
  extensionLanguage,
  readExtensionTheme,
} from "./extensions";
import type { Settings } from "./types";
let onig: Promise<{
  createOnigScanner: (sources: string[]) => OnigScanner;
  createOnigString: (str: string) => OnigString;
}>;
let registry: Registry | undefined;
export function resetTextmate() {
  registry?.dispose();
  registry = undefined;
}
export async function textmateGrammar(path: string) {
  const language = extensionLanguage(path)?.id ?? languageId(path);
  if (!language) return null;
  const entries = allExtensions().flatMap((ext) =>
    (ext.contributes.grammars ?? []).map((g) => ({ ...g, extension: ext.id })),
  );
  const main = entries.find((g) => g.language === language);
  if (!main) return null;
  onig ??= fetch(wasmURL)
    .then((r) => r.arrayBuffer())
    .then((data) => loadWASM(data))
    .then(() => ({
      createOnigScanner: (sources) => new OnigScanner(sources),
      createOnigString: (str) => new OnigString(str),
    }));
  registry ??= new Registry({
    onigLib: onig,
    loadGrammar: async (scope) => {
      const contribution = entries.find((g) => g.scopeName === scope);
      return contribution
        ? parseRawGrammar(
            await extensionAsset(contribution.extension, contribution.path),
            contribution.path,
          )
        : null;
    },
    getInjections: (scope) =>
      entries
        .filter((g) => g.injectTo?.includes(scope))
        .map((g) => g.scopeName),
  });
  return registry.loadGrammar(main.scopeName);
}
function color(scopes: string[]) {
  const scope = scopes.slice(1).join(" ");
  return /comment/.test(scope)
    ? "comment"
    : /string/.test(scope)
      ? "string"
      : /keyword|storage/.test(scope)
        ? "keyword"
        : /constant.numeric|constant.language/.test(scope)
          ? "number"
          : /entity.name.function|support.function/.test(scope)
            ? "function"
            : /entity.name.type|entity.name.class|support.type|entity.name.tag/.test(
                  scope,
                )
              ? "type"
              : /punctuation/.test(scope)
                ? "punctuation"
                : "";
}
export function textmateHighlighting(grammar: IGrammar) {
  const tokenizationTick = StateEffect.define<null>();
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      timer?: ReturnType<typeof setTimeout>;
      cache: {
        text: string;
        end: StateStack;
        tokens: { startIndex: number; endIndex: number; scopes: string[] }[];
      }[] = [];
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          let from = update.state.doc.lines;
          update.changes.iterChangedRanges((a, _b, c) => {
            from = Math.min(
              from,
              update.startState.doc.lineAt(a).number,
              update.state.doc.lineAt(c).number,
            );
          });
          this.cache.length = Math.min(this.cache.length, from - 1);
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((t) =>
            t.effects.some((e) => e.is(tokenizationTick)),
          )
        )
          this.decorations = this.build(update.view);
      }
      build(view: EditorView) {
        clearTimeout(this.timer);
        const started = performance.now();
        const builder = new RangeSetBuilder<Decoration>();
        const end = Math.min(
          view.state.doc.lineAt(view.viewport.to).number,
          30000,
        );
        const start = view.state.doc.lineAt(view.viewport.from).number;
        const parseStart = Math.min(start, this.cache.length + 1);
        let state: StateStack = this.cache[parseStart - 2]?.end ?? INITIAL;
        for (let n = parseStart; n <= end; n++) {
          const line = view.state.doc.line(n);
          let cached = this.cache[n - 1];
          if (!cached || cached.text !== line.text) {
            const parsed = grammar.tokenizeLine(
              line.text.slice(0, 20000),
              state,
              8,
            );
            cached = {
              text: line.text,
              end: parsed.ruleStack,
              tokens: parsed.tokens,
            };
            this.cache[n - 1] = cached;
          }
          state = cached.end;
          if (line.to >= view.viewport.from)
            for (const token of cached.tokens) {
              const category = color(token.scopes);
              const to = Math.min(line.to, line.from + token.endIndex);
              if (category && line.from + token.startIndex < to)
                builder.add(
                  line.from + token.startIndex,
                  to,
                  Decoration.mark({ class: `tm-${category}` }),
                );
            }
          if (n < end && performance.now() - started >= 7) {
            this.timer = setTimeout(
              () => view.dispatch({ effects: tokenizationTick.of(null) }),
              0,
            );
            break;
          }
        }
        return builder.finish();
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
const themeProperties = [
  "--syntax-keyword",
  "--syntax-function",
  "--syntax-comment",
  "--syntax-string",
  "--syntax-number",
  "--syntax-type",
  "--syntax-punctuation",
  "--syntax-meta",
  "--editor-foreground",
];
let themeRevision = 0;
export async function applyExtensionTheme(
  settings: Settings,
  storeColors?: Record<string, string>,
) {
  const revision = ++themeRevision;
  const root = document.documentElement;
  themeProperties.forEach((p) => root.style.removeProperty(p));
  if (storeColors) {
    for (const property of themeProperties) {
      const color = storeColors[property.slice(2)];
      if (color) root.style.setProperty(property, color);
    }
    return;
  }
  if (!settings.extensionTheme) return;
  const theme = await readExtensionTheme(settings.extensionTheme);
  if (!theme || revision !== themeRevision) return;
  const tokens = theme.tokenColors as {
    scope?: string | string[];
    settings?: { foreground?: string };
  }[];
  for (const token of tokens ?? []) {
    const value = token.settings?.foreground;
    if (!value || !/^#[0-9a-f]{3,8}$/i.test(value)) continue;
    const scopes =
      typeof token.scope === "string"
        ? token.scope.split(",")
        : (token.scope ?? []);
    const category = color(["", ...scopes]);
    if (category) root.style.setProperty(`--syntax-${category}`, value);
  }
  const colors = theme.colors as Record<string, string> | undefined;
  if (
    colors?.["editor.foreground"] &&
    /^#[0-9a-f]{3,8}$/i.test(colors["editor.foreground"])
  )
    root.style.setProperty("--editor-foreground", colors["editor.foreground"]);
}
