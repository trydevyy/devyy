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

import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { languageRequest } from "./native";
import { extensionLanguageFeature } from "./extensionHost";
import { toPosition } from "../components/Editor";

export interface ParameterInformation {
  label: string | [number, number];
  documentation?: string | { value: string };
}

export interface SignatureInformation {
  label: string;
  documentation?: string | { value: string };
  parameters?: ParameterInformation[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface FormattedSignatureHelp {
  label: string;
  beforeParam: string;
  activeParam: string;
  afterParam: string;
  documentation?: string;
  counter?: string;
}

export function parseSignatureHelp(
  help: SignatureHelp,
): FormattedSignatureHelp | null {
  const sigIndex = Math.min(
    Math.max(0, help.activeSignature ?? 0),
    Math.max(0, (help.signatures?.length ?? 1) - 1),
  );
  const sig = help.signatures?.[sigIndex];
  if (!sig) return null;

  const activeParamIndex = help.activeParameter ?? sig.activeParameter ?? 0;
  const params = sig.parameters || [];

  let beforeParam = "";
  let activeParam = "";
  let afterParam = "";

  if (
    params.length > 0 &&
    activeParamIndex >= 0 &&
    activeParamIndex < params.length
  ) {
    const param = params[activeParamIndex];
    let start = -1;
    let end = -1;
    if (Array.isArray(param.label)) {
      start = param.label[0];
      end = param.label[1];
    } else if (typeof param.label === "string") {
      start = sig.label.indexOf(param.label);
      if (start >= 0) end = start + param.label.length;
    }
    if (start >= 0 && end > start && end <= sig.label.length) {
      beforeParam = sig.label.slice(0, start);
      activeParam = sig.label.slice(start, end);
      afterParam = sig.label.slice(end);
    }
  }

  const activeParamObj = params[activeParamIndex];
  const documentation =
    (typeof activeParamObj?.documentation === "string"
      ? activeParamObj.documentation
      : activeParamObj?.documentation?.value) ||
    (typeof sig.documentation === "string"
      ? sig.documentation
      : sig.documentation?.value);

  const counter =
    help.signatures.length > 1
      ? `${sigIndex + 1}/${help.signatures.length}`
      : undefined;

  return {
    label: sig.label,
    beforeParam,
    activeParam,
    afterParam,
    documentation,
    counter,
  };
}

export function createSignatureHelpDOM(
  help: SignatureHelp,
  onClose?: () => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-signature-help";

  const parsed = parseSignatureHelp(help);
  if (!parsed) return container;

  const row = document.createElement("div");
  row.className = "cm-signature-row";

  const header = document.createElement("div");
  header.className = "cm-signature-label";

  if (parsed.activeParam) {
    const before = document.createTextNode(parsed.beforeParam);
    const highlight = document.createElement("span");
    highlight.className = "cm-signature-param-active";
    highlight.textContent = parsed.activeParam;
    const after = document.createTextNode(parsed.afterParam);
    header.append(before, highlight, after);
  } else {
    header.textContent = parsed.label;
  }
  row.appendChild(header);

  if (parsed.counter) {
    const counter = document.createElement("span");
    counter.className = "cm-signature-counter";
    counter.textContent = parsed.counter;
    row.appendChild(counter);
  }

  if (onClose) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "cm-signature-close";
    closeBtn.textContent = "×";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      onClose();
    };
    row.appendChild(closeBtn);
  }

  container.appendChild(row);

  if (parsed.documentation) {
    const docEl = document.createElement("div");
    docEl.className = "cm-signature-doc";
    docEl.textContent = parsed.documentation;
    container.appendChild(docEl);
  }

  return container;
}

export const signatureHelpEffect = StateEffect.define<Tooltip | null>();

export const signatureHelpField = StateField.define<Tooltip | null>({
  create: () => null,
  update: (tooltip, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(signatureHelpEffect)) {
        tooltip = effect.value;
      }
    }
    if (tooltip && tr.docChanged) {
      const pos = Math.min(tooltip.pos, tr.newDoc.length);
      return { ...tooltip, pos };
    }
    return tooltip;
  },
  provide: (field) =>
    showTooltip.compute([field], (state) => state.field(field)),
});

export async function requestSignatureHelp(
  path: string,
  pos: { line: number; character: number },
): Promise<SignatureHelp | null> {
  try {
    let result = await languageRequest<SignatureHelp>(
      path,
      "textDocument/signatureHelp",
      pos,
      { context: { triggerKind: 1, isRetrigger: false } },
    );
    if (!result || !result.signatures || result.signatures.length === 0) {
      const extResults = await extensionLanguageFeature<SignatureHelp>(
        "provideSignatureHelp",
        path,
        pos,
        undefined,
        { triggerKind: 1, isRetrigger: false },
      );
      if (extResults && extResults[0]?.signatures?.length) {
        result = extResults[0];
      }
    }
    return result && result.signatures?.length ? result : null;
  } catch {
    return null;
  }
}

export async function triggerSignatureHelp(
  view: EditorView,
  path: string,
): Promise<boolean> {
  const head = view.state.selection.main.head;
  const pos = toPosition(view, head);
  const help = await requestSignatureHelp(path, pos);
  if (!help) {
    view.dispatch({ effects: signatureHelpEffect.of(null) });
    return false;
  }

  const tooltip: Tooltip = {
    pos: head,
    above: true,
    strictSide: false,
    create: () => ({
      dom: createSignatureHelpDOM(help, () => {
        view.dispatch({ effects: signatureHelpEffect.of(null) });
      }),
    }),
  };

  view.dispatch({ effects: signatureHelpEffect.of(tooltip) });
  return true;
}

export function closeSignatureHelp(view: EditorView) {
  if (view.state.field(signatureHelpField, false)) {
    view.dispatch({ effects: signatureHelpEffect.of(null) });
  }
}
