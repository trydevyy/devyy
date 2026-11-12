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
