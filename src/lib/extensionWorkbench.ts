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

import { hostRequest } from "./extensionHost";
import { native } from "./native";
export { fileUri } from "./fileUri";
let state: Record<string, unknown> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
export function sendExtensionEditorState(value: Record<string, unknown>) {
  state = value;
  clearTimeout(timer);
  if (native && running)
    timer = setTimeout(() => {
      void hostRequest("editorState", state).catch(() => {});
    }, 50);
}
window.addEventListener("devyy-extension-host-ready", () => {
  running = true;
  if (state) sendExtensionEditorState(state);
});
window.addEventListener("devyy-extension-host-reset", () => {
  running = false;
  clearTimeout(timer);
});
