import { isTauri } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

// Native WebViews should never request browser clipboard access.
export async function readClipboardText(): Promise<string> {
  return isTauri()
    ? ((await readText()) ?? "")
    : navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) await writeText(text);
  else await navigator.clipboard.writeText(text);
}
