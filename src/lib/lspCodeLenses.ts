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
import { languageRequest, languageServerRequest } from "./native";
import { extensionLanguageFeature, extensionCommand } from "./extensionHost";

export interface CodeLensCommand {
  title: string;
  command: string;
  arguments?: unknown[];
  tooltip?: string;
}

export interface CodeLens {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: CodeLensCommand;
  data?: unknown;
}

export function groupCodeLensesByLine(
  lenses: CodeLens[],
): Map<number, CodeLens[]> {
  const map = new Map<number, CodeLens[]>();
  for (const lens of lenses) {
    if (!lens || !lens.range || !lens.range.start) continue;
    const line = lens.range.start.line;
    const existing = map.get(line);
    if (existing) {
      existing.push(lens);
    } else {
      map.set(line, [lens]);
    }
  }
  return map;
}

export class CodeLensLineWidget extends WidgetType {
  constructor(
    readonly lenses: CodeLens[],
    readonly onAction: (command: CodeLensCommand) => void,
  ) {
    super();
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-codelens-line";
    this.lenses.forEach((lens, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "cm-codelens-separator";
        sep.textContent = " | ";
        wrap.appendChild(sep);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-codelens-button";
      button.textContent = lens.command?.title || "…";
      if (lens.command?.tooltip) {
        button.title = lens.command.tooltip;
      }
      if (lens.command) {
        button.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (lens.command) this.onAction(lens.command);
        };
      }
      wrap.appendChild(button);
    });
    return wrap;
  }

  eq(other: CodeLensLineWidget) {
    if (this.lenses.length !== other.lenses.length) return false;
    return this.lenses.every((l, i) => {
      const o = other.lenses[i];
      return (
        l.command?.title === o.command?.title &&
        l.command?.command === o.command?.command &&
        JSON.stringify(l.command?.arguments) ===
          JSON.stringify(o.command?.arguments)
      );
    });
  }

  ignoreEvent() {
    return false;
  }
}

export const codeLensesEffect = StateEffect.define<RangeSet<Decoration>>();

export const codeLensesField = StateField.define<RangeSet<Decoration>>({
  create: () => RangeSet.empty,
  update: (lenses, tr) => {
    lenses = lenses.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(codeLensesEffect)) {
        lenses = effect.value;
      }
    }
    return lenses;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export async function fetchCodeLenses(
  view: EditorView,
  path: string,
  onAction: (command: CodeLensCommand) => void = (cmd) => {
    void extensionCommand(cmd.command, cmd.arguments).catch((e) =>
      console.warn("CodeLens action failed", e),
    );
  },
): Promise<RangeSet<Decoration>> {
  try {
    let results = await languageRequest<CodeLens[]>(
      path,
      "textDocument/codeLens",
    ).catch(() => null);
    if (results?.length)
      results = await Promise.all(
        results.map(async (lens) =>
          lens.command
            ? lens
            : ((await languageServerRequest<CodeLens>(
                path,
                "codeLens/resolve",
                lens,
              ).catch(() => null)) ?? lens),
        ),
      );
    if (!results || results.length === 0) {
      const extResults = await extensionLanguageFeature<CodeLens[]>(
        "provideCodeLenses",
        path,
        undefined,
        undefined,
        { resolve: true },
      );
      results = extResults.flat();
    }
    if (!results || !Array.isArray(results) || results.length === 0) {
      return RangeSet.empty;
    }

    const grouped = groupCodeLensesByLine(results);
    const widgets: Array<{ from: number; to: number; value: Decoration }> = [];

    for (const [lineIdx, lineLenses] of grouped.entries()) {
      const validLenses = lineLenses.filter((l) => !!l.command);
      if (validLenses.length === 0) continue;

      const lineNum = Math.min(Math.max(1, lineIdx + 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNum);
      const widget = new CodeLensLineWidget(validLenses, onAction);

      widgets.push(
        Decoration.widget({
          widget,
          side: -1,
          block: true,
        }).range(line.from, line.from),
      );
    }

    return RangeSet.of(widgets, true);
  } catch {
    return RangeSet.empty;
  }
}
