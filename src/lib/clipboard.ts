import { isTauri } from "@tauri-apps/api/core";
import { embeddedThemePreview } from "./previewMode";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

// Native WebViews should never request browser clipboard access.
export async function readClipboardText(): Promise<string> {
  return !embeddedThemePreview && isTauri()
    ? ((await readText()) ?? "")
    : navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (!embeddedThemePreview && isTauri()) await writeText(text);
  else await navigator.clipboard.writeText(text);
}
