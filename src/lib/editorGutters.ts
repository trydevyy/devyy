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

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const transparentGutters = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.geometryChanged || update.viewportChanged || update.docChanged)
        this.measure();
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const gutter =
            view.scrollDOM.querySelector<HTMLElement>(".cm-gutters");
          const edge =
            gutter?.getBoundingClientRect().right ??
            view.scrollDOM.getBoundingClientRect().left;
          return [
            ...view.scrollDOM.querySelectorAll<HTMLElement>(
              ".cm-content",
            ),
          ].map((element) => ({
            element,
            left: Math.max(0, edge - element.getBoundingClientRect().left),
          }));
        },
        write: (layers) => {
          for (const { element, left } of layers)
            element.style.clipPath = `inset(0 0 0 ${left}px)`;
        },
      });
    }
  },
  {
    eventHandlers: {
      scroll() {
        this.measure();
      },
    },
  },
);
