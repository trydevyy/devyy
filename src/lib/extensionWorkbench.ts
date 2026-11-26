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
let inFlight: Promise<unknown> | undefined;
export function sendExtensionEditorState(value: Record<string, unknown>) {
  state = value;
  clearTimeout(timer);
  if (native && running && !inFlight) timer = setTimeout(flushEditorState, 50);
}
export function sendExtensionEditorViewport(
  editors: Record<string, unknown>[],
) {
  if (!native || !running) return;
  void hostRequest("editorViewport", { editors }).catch(() => {
    // A host restart will send a fresh editor snapshot.
  });
}
async function flushEditorState() {
  const pending = state;
  if (!running || inFlight || !pending) return;
  const request = hostRequest("editorState", pending);
  inFlight = request;
  try {
    await request;
  } catch {
    // The next editor change or host restart will send a fresh snapshot.
  } finally {
    if (inFlight === request) {
      inFlight = undefined;
      if (state && state !== pending) sendExtensionEditorState(state);
    }
  }
}
window.addEventListener("devyy-extension-host-ready", () => {
  running = true;
  if (state) sendExtensionEditorState(state);
});
window.addEventListener("devyy-extension-host-reset", () => {
  running = false;
  inFlight = undefined;
  clearTimeout(timer);
});
