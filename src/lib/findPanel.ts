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

import { EditorState } from "@codemirror/state";
import { type EditorView, type Panel } from "@codemirror/view";
import {
  search,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  closeSearchPanel,
} from "@codemirror/search";

export const devyySearch = () => search({ top: true, createPanel });
function createPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search devyy-find";
  dom.setAttribute("role", "search");
  dom.setAttribute("aria-label", "Find and replace in file");
  dom.dataset.escapeScope = "active";
  const findRow = document.createElement("div"),
    replaceRow = document.createElement("div");
  findRow.className = "devyy-find-row";
  replaceRow.className = "devyy-find-row devyy-replace-row";
  replaceRow.hidden = true;
  const input = document.createElement("input"),
    replacement = document.createElement("input");
  input.name = "search";
  input.placeholder = "Find in file";
  input.setAttribute("aria-label", "Find");
  input.setAttribute("main-field", "true");
  replacement.name = "replace";
  replacement.placeholder = "Replace";
  replacement.setAttribute("aria-label", "Replace");
  for (const field of [input, replacement]) {
    field.spellcheck = false;
    field.autocomplete = "off";
    field.className = "devyy-find-input";
  }
  const count = document.createElement("span");
  count.className = "devyy-find-count";
  count.setAttribute("aria-live", "polite");
  count.setAttribute("aria-atomic", "true");
  function button(label: string, text: string, action: () => void) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "devyy-find-button";
    el.setAttribute("aria-label", label);
    el.title = label;
    const paths: Record<string, string[]> = {
      "Show replace": ["m9 6 6 6-6 6"],
      "Previous match": ["m6 12 6-6 6 6", "M12 6v12"],
      "Next match": ["m6 12 6 6 6-6", "M12 6v12"],
      "Close find": ["m6 6 12 12", "M6 18 18 6"],
      "Select all matches": ["M8 6h13M8 12h13M8 18h13", "m2 12 2 2 3-4"],
      "Replace next match": [
        "M4 7h10a4 4 0 0 1 4 4v2",
        "m14 10 4 4 4-4",
        "M4 17h7",
      ],
      "Replace all matches": [
        "M3 6h13a4 4 0 0 1 4 4v2",
        "m16 9 4 4 3-3",
        "M3 14h8M3 19h14",
      ],
    };
    if (paths[label]) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({
        viewBox: "0 0 24 24",
        width: "14",
        height: "14",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.65",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      }))
        svg.setAttribute(key, value);
      for (const d of paths[label]) {
        const path = document.createElementNS(svg.namespaceURI, "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      el.append(svg);
      if (label.startsWith("Replace")) {
        const span = document.createElement("span");
        span.textContent = text;
        el.append(span);
      }
    } else el.textContent = text;
    el.onclick = action;
    return el;
  }
  const toggle = button("Show replace", "›", () => {
    replaceRow.hidden = !replaceRow.hidden;
    toggle.setAttribute("aria-expanded", String(!replaceRow.hidden));
    toggle.setAttribute(
      "aria-label",
      replaceRow.hidden ? "Show replace" : "Hide replace",
    );
    if (!replaceRow.hidden) replacement.focus();
    view.requestMeasure();
  });
  toggle.classList.add("devyy-find-expand");
  toggle.setAttribute("aria-expanded", "false");
  const options = (
    [
      ["caseSensitive", "Match case", "Aa"],
      ["wholeWord", "Match whole word", "ab"],
      ["regexp", "Use regular expression", ".*"],
    ] as const
  ).map(([key, label, text]) => {
    const el = button(label, text, () => {
      updateQuery({ [key]: !getSearchQuery(view.state)[key] });
      input.focus();
    });
    el.classList.add("devyy-find-option");
    return { el, key };
  });
  const previous = button("Previous match", "↑", () => findPrevious(view));
  const next = button("Next match", "↓", () => findNext(view));
  const all = button("Select all matches", "≡", () => {
    selectMatches(view);
    view.focus();
  });
  const close = button("Close find", "×", () => {
    closeSearchPanel(view);
    view.focus();
  });
  close.name = "close";
  const replace = button("Replace next match", "Replace", () => {
    replaceNext(view);
    replacement.focus();
  });
  const replaceEvery = button("Replace all matches", "Replace all", () => {
    replaceAll(view);
    replacement.focus();
  });
  findRow.append(
    toggle,
    input,
    ...options.map(({ el }) => el),
    count,
    previous,
    next,
    all,
    close,
  );
  replaceRow.append(replacement, replace, replaceEvery);
  dom.append(findRow, replaceRow);
  function updateQuery(patch: Partial<SearchQuery>) {
    const query = getSearchQuery(view.state);
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ ...query, ...patch })),
    });
  }
  input.oninput = () => updateQuery({ search: input.value });
  replacement.oninput = () => updateQuery({ replace: replacement.value });
  dom.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (event.target === replacement) replaceNext(view);
      else if (event.altKey) {
        selectMatches(view);
        view.focus();
      } else if (event.shiftKey) findPrevious(view);
      else findNext(view);
    }
  };
  let previousDoc = view.state.doc,
    previousQuery: SearchQuery | undefined,
    matches: { from: number; to: number }[] = [],
    capped = false;
  function sync() {
    const query = getSearchQuery(view.state),
      readonly = view.state.facet(EditorState.readOnly);
    if (input.value !== query.search) input.value = query.search;
    if (replacement.value !== query.replace) replacement.value = query.replace;
    options.forEach(({ el, key }) =>
      el.setAttribute("aria-pressed", String(query[key])),
    );
    toggle.hidden = readonly;
    if (readonly) replaceRow.hidden = true;
    if (view.state.doc !== previousDoc || !previousQuery?.eq(query)) {
      previousDoc = view.state.doc;
      previousQuery = query;
      matches = [];
      capped = false;
      if (query.valid) {
        const cursor = query.getCursor(view.state);
        for (let match = cursor.next(); !match.done; match = cursor.next()) {
          if (matches.length === 10000) {
            capped = true;
            break;
          }
          matches.push(match.value);
        }
      }
    }
    const invalid = !!query.search && !query.valid;
    input.setAttribute("aria-invalid", String(invalid));
    const selection = view.state.selection.main;
    const current = matches.findIndex(
      (match) => match.from === selection.from && match.to === selection.to,
    );
    count.textContent = !query.search
      ? ""
      : invalid
        ? "Invalid expression"
        : !matches.length
          ? "No results"
          : `${current >= 0 ? `${current + 1} of ` : ""}${matches.length}${capped ? "+" : ""}`;
    count.dataset.empty = String(!!query.search && !matches.length);
    previous.disabled = next.disabled = all.disabled = !matches.length;
    replace.disabled = replaceEvery.disabled = readonly || !matches.length;
  }
  sync();
  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
    },
    update() {
      sync();
    },
  };
}
