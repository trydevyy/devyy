import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Position, LspDiagnostic } from "./types";
export const native = isTauri();
export { invoke, listen };
const ready = new Map<string, Promise<void>>();
const documents = new Map<
  string,
  { uri: string; version: number; language: string }
>();
export function clearLanguageServers() {
  ready.clear();
  documents.clear();
}
export async function connectDocument(
  path: string,
  language: string,
  text: string,
) {
  if (
    !native ||
    !["rust", "typescript", "javascript", "python"].includes(language)
  )
    return;
  if (!ready.has(language))
    ready.set(language, invoke("lsp_start", { language }));
  await ready.get(language);
  const uri = await invoke<string>("file_uri", { path });
  if (documents.has(path)) return;
  documents.set(path, { uri, version: 1, language });
  await notify(language, "textDocument/didOpen", {
    textDocument: { uri, languageId: language, version: 1, text },
  });
}
async function notify(language: string, method: string, params: unknown) {
  return invoke("lsp_request", {
    language,
    method,
    params,
    notification: true,
  });
}
export async function changeDocument(path: string, text: string) {
  const doc = documents.get(path);
  if (!doc) return;
  await notify(doc.language, "textDocument/didChange", {
    textDocument: { uri: doc.uri, version: ++doc.version },
    contentChanges: [{ text }],
  });
}
export async function savedDocument(path: string, text: string) {
  const doc = documents.get(path);
  if (doc)
    await notify(doc.language, "textDocument/didSave", {
      textDocument: { uri: doc.uri },
      text,
    });
}
export async function closeDocument(path: string) {
  const doc = documents.get(path);
  if (doc) {
    documents.delete(path);
    await notify(doc.language, "textDocument/didClose", {
      textDocument: { uri: doc.uri },
    });
  }
}
export async function languageRequest<T>(
  path: string,
  method: string,
  position?: Position,
): Promise<T | null> {
  const doc = documents.get(path);
  if (!doc) return null;
  return invoke<T>("lsp_request", {
    language: doc.language,
    method,
    params: {
      textDocument: { uri: doc.uri },
      ...(position ? { position } : {}),
      ...(method.endsWith("formatting")
        ? { options: { tabSize: 4, insertSpaces: true } }
        : {}),
    },
    notification: false,
  });
}
export function pathFromUri(uri: string, root: string) {
  try {
    const decoded = decodeURIComponent(new URL(uri).pathname);
    const prefix = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : null;
  } catch {
    return null;
  }
}
export interface DiagnosticEvent {
  language: string;
  params: { uri: string; diagnostics: LspDiagnostic[] };
}
