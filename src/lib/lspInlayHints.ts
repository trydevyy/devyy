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
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { languageRequest } from "./native";
import { extensionLanguageFeature } from "./extensionHost";
import { offset } from "../components/Editor";

export interface InlayHintLabelPart {
  value: string;
  tooltip?: string | { value: string };
}

export interface InlayHint {
  position: { line: number; character: number };
  label: string | InlayHintLabelPart[];
  kind?: number; // 1 = Type, 2 = Parameter
  textEdits?: unknown[];
  tooltip?: string | { value: string };
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export function formatInlayHintLabel(
  label: string | InlayHintLabelPart[],
): string {
  if (typeof label === "string") return label;
  if (Array.isArray(label)) {
    return label
      .map((part) => (typeof part === "string" ? part : part.value))
      .join("");
  }
  return "";
}

export class InlayHintWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind?: number,
    readonly tooltip?: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-inlay-hint ${
      this.kind === 1
        ? "cm-inlay-hint-type"
        : this.kind === 2
          ? "cm-inlay-hint-param"
          : ""
    }`;
    span.textContent = this.text;
    if (this.tooltip) span.title = this.tooltip;
    return span;
  }

  eq(other: InlayHintWidget) {
    return (
      this.text === other.text &&
      this.kind === other.kind &&
      this.tooltip === other.tooltip
    );
  }

  ignoreEvent() {
    return false;
  }
}

export const inlayHintsEffect = StateEffect.define<RangeSet<Decoration>>();

export const inlayHintsField = StateField.define<RangeSet<Decoration>>({
  create: () => RangeSet.empty,
  update: (hints, tr) => {
    hints = hints.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(inlayHintsEffect)) {
        hints = effect.value;
      }
    }
    return hints;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export async function fetchInlayHints(
  view: EditorView,
  path: string,
): Promise<RangeSet<Decoration>> {
  try {
    const range = {
      start: { line: 0, character: 0 },
      end: {
        line: view.state.doc.lines - 1,
        character: view.state.doc.line(view.state.doc.lines).length,
      },
    };
    let results = await languageRequest<InlayHint[]>(
      path,
      "textDocument/inlayHint",
      undefined,
      { range },
    ).catch(() => null);
    if (!results || results.length === 0) {
      const extResults = await extensionLanguageFeature<InlayHint[]>(
        "provideInlayHints",
        path,
        undefined,
        range,
      );
      results = extResults.flat();
    }
    if (!results || !Array.isArray(results) || results.length === 0) {
      return RangeSet.empty;
    }

    const widgets: Array<{ from: number; to: number; value: Decoration }> = [];
    for (const hint of results) {
      if (!hint || !hint.position) continue;
      const text = formatInlayHintLabel(hint.label);
      if (!text) continue;

      const pos = offset(view, hint.position);
      const tooltip =
        typeof hint.tooltip === "string" ? hint.tooltip : hint.tooltip?.value;

      const widget = new InlayHintWidget(
        (hint.paddingLeft ? " " : "") + text + (hint.paddingRight ? " " : ""),
        hint.kind,
        tooltip,
      );
      widgets.push(Decoration.widget({ widget, side: 1 }).range(pos, pos));
    }

    return RangeSet.of(widgets, true);
  } catch {
    return RangeSet.empty;
  }
}
