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

import { StateEffect, StateField, RangeSet } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { documentCapabilities, languageRequest } from "./native";
import { extensionLanguageFeature } from "./extensionHost";

export const DEFAULT_SEMANTIC_TOKEN_TYPES = [
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
];

export const DEFAULT_SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
];

export interface DecodedSemanticToken {
  line: number;
  char: number;
  length: number;
  tokenType: string;
  tokenModifiers: string[];
}

export interface SemanticTokensResult {
  resultId?: string;
  data: number[];
  legend?: { tokenTypes: string[]; tokenModifiers: string[] };
}

export function decodeSemanticTokens(
  data: number[],
  tokenTypes: string[] = DEFAULT_SEMANTIC_TOKEN_TYPES,
  tokenModifiers: string[] = DEFAULT_SEMANTIC_TOKEN_MODIFIERS,
): DecodedSemanticToken[] {
  const tokens: DecodedSemanticToken[] = [];
  let currentLine = 0;
  let currentChar = 0;

  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaStart = data[i + 1];
    const length = data[i + 2];
    const tokenTypeIndex = data[i + 3];
    const tokenModifierBits = data[i + 4];

    currentLine += deltaLine;
    if (deltaLine > 0) {
      currentChar = deltaStart;
    } else {
      currentChar += deltaStart;
    }

    const tokenType = tokenTypes[tokenTypeIndex] || "unknown";
    const modifiers: string[] = [];
    if (tokenModifierBits > 0 && tokenModifiers.length > 0) {
      for (let bit = 0; bit < tokenModifiers.length; bit++) {
        if ((tokenModifierBits & (1 << bit)) !== 0) {
          modifiers.push(tokenModifiers[bit]);
        }
      }
    }

    tokens.push({
      line: currentLine,
      char: currentChar,
      length,
      tokenType,
      tokenModifiers: modifiers,
    });
  }

  return tokens;
}

export const semanticTokensEffect = StateEffect.define<RangeSet<Decoration>>();

export const semanticTokensField = StateField.define<RangeSet<Decoration>>({
  create: () => RangeSet.empty,
  update: (tokens, tr) => {
    tokens = tokens.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(semanticTokensEffect)) {
        tokens = effect.value;
      }
    }
    return tokens;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export async function fetchSemanticTokens(
  view: EditorView,
  path: string,
  tokenTypes: string[] = DEFAULT_SEMANTIC_TOKEN_TYPES,
  tokenModifiers: string[] = DEFAULT_SEMANTIC_TOKEN_MODIFIERS,
): Promise<RangeSet<Decoration>> {
  try {
    let result = await languageRequest<SemanticTokensResult>(
      path,
      "textDocument/semanticTokens/full",
    ).catch(() => null);
    let legend = documentCapabilities(path)?.semanticTokensProvider?.legend;
    if (!result || !result.data || result.data.length === 0) {
      const extResults = await extensionLanguageFeature<SemanticTokensResult>(
        "provideDocumentSemanticTokens",
        path,
      );
      if (extResults && extResults[0] && extResults[0].data) {
        result = extResults[0];
        legend = result.legend;
      }
    }
    if (!result || !Array.isArray(result.data) || result.data.length === 0) {
      return RangeSet.empty;
    }

    const decoded = decodeSemanticTokens(
      result.data,
      legend?.tokenTypes ?? tokenTypes,
      legend?.tokenModifiers ?? tokenModifiers,
    );
    const marks: Array<{ from: number; to: number; value: Decoration }> = [];
    const doc = view.state.doc;

    for (const token of decoded) {
      if (token.line >= doc.lines) continue;
      const line = doc.line(token.line + 1);
      const from = Math.min(line.from + token.char, line.to);
      const to = Math.min(from + token.length, line.to);
      if (from >= to) continue;

      const classNames = [
        `cm-semantic-${token.tokenType}`,
        ...token.tokenModifiers.map((m) => `cm-semantic-${m}`),
      ].join(" ");

      marks.push(Decoration.mark({ class: classNames }).range(from, to));
    }

    return RangeSet.of(marks, true);
  } catch {
    return RangeSet.empty;
  }
}
