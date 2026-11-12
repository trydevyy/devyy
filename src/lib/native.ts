import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { serverLanguages } from "./languageServers";
import { activateExtensionLanguage } from "./extensionHost";
import type { Position, LspDiagnostic } from "./types";
export const native = isTauri();
export { invoke, listen };
const ready = new Map<string, Promise<void>>();
const documents = new Map<
  string,
  { uri: string; version: number; language: string; updates: Promise<void> }
>();
const connections = new Map<string, Promise<boolean>>();
const tickets = new Map<string, number>();
const queuedChanges = new Map<
  string,
  { text: string; timer?: ReturnType<typeof setTimeout> }
>();
let connectionSerial = 0;
let generation = 0;
export function clearLanguageServers() {
  generation++;
  for (const change of queuedChanges.values()) clearTimeout(change.timer);
  queuedChanges.clear();
  connections.clear();
  tickets.clear();
  ready.clear();
  documents.clear();
}
async function openDocument(
  path: string,
  language: string,
  text: string,
  ticket: number,
  epoch: number,
) {
  if (!native) return false;
  // Activation failures are reported in Installed extensions. A configured or
  // discovered server can still work when its extension uses an unsupported API.
  await activateExtensionLanguage(language).catch(() => {});
  if (
    epoch !== generation ||
    tickets.get(path) !== ticket ||
    !serverLanguages.has(language)
  )
    return false;
  if (!ready.has(language))
    ready.set(
      language,
      invoke<void>("lsp_start", { language }).catch((e) => {
        if (epoch === generation) ready.delete(language);
        throw e;
      }),
    );
  await ready.get(language);
  const uri = await invoke<string>("file_uri", { path });
  if (epoch !== generation || tickets.get(path) !== ticket) return false;
  if (documents.has(path)) return true;
  await notify(language, "textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: language === "c++" ? "cpp" : language,
      version: 1,
      text,
    },
  });
  if (epoch !== generation || tickets.get(path) !== ticket) return false;
  documents.set(path, {
    uri,
    version: 1,
    language,
    updates: Promise.resolve(),
  });
  await flushDocumentChanges(path);
  return true;
}
export function connectDocument(path: string, language: string, text: string) {
  const existing = connections.get(path);
  if (existing) return existing;
  const ticket = ++connectionSerial;
  tickets.set(path, ticket);
  const pending = openDocument(
    path,
    language,
    text,
    ticket,
    generation,
  ).finally(() => {
    if (connections.get(path) === pending) connections.delete(path);
  });
  connections.set(path, pending);
  return pending;
}
export function queueDocumentChange(path: string, text: string) {
  if (!native) return;
  clearTimeout(queuedChanges.get(path)?.timer);
  queuedChanges.set(path, {
    text,
    timer: setTimeout(() => {
      void flushDocumentChanges(path).catch(() => {});
    }, 80),
  });
}
async function flushDocumentChanges(path: string) {
  const change = queuedChanges.get(path);
  if (!change || !documents.has(path)) return;
  clearTimeout(change.timer);
  queuedChanges.delete(path);
  await changeDocument(path, change.text);
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
  doc.updates = doc.updates
    .catch(() => {})
    .then(async () => {
      if (documents.get(path) !== doc) return;
      await notify(doc.language, "textDocument/didChange", {
        textDocument: { uri: doc.uri, version: ++doc.version },
        contentChanges: [{ text }],
      });
    });
  await doc.updates;
}
export async function savedDocument(path: string, text: string) {
  await flushDocumentChanges(path);
  const doc = documents.get(path);
  if (doc)
    await notify(doc.language, "textDocument/didSave", {
      textDocument: { uri: doc.uri },
      text,
    });
}
export async function closeDocument(path: string) {
  tickets.delete(path);
  connections.delete(path);
  clearTimeout(queuedChanges.get(path)?.timer);
  queuedChanges.delete(path);
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
  await flushDocumentChanges(path);
  const doc = documents.get(path);
  if (!doc) return null;
  await doc.updates;
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
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    let decoded = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost")
      decoded = `//${url.hostname}${decoded}`;
    if (/^\/[a-z]:\//i.test(decoded)) decoded = decoded.slice(1);
    return workspaceRelativePath(decoded, root);
  } catch {
    return null;
  }
}
export function workspaceRelativePath(path: string, root: string) {
  const normalize = (value: string) =>
    value
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\/UNC\//i, "//")
      .replace(/^\/\/\?\//, "");
  const decoded = normalize(path);
  const prefix = normalize(root).replace(/\/$/, "") + "/";
  const windows = /^[a-z]:\//i.test(prefix) || prefix.startsWith("//");
  return (
    windows
      ? decoded.toLowerCase().startsWith(prefix.toLowerCase())
      : decoded.startsWith(prefix)
  )
    ? decoded.slice(prefix.length)
    : null;
}
export interface DiagnosticEvent {
  language: string;
  params: { uri: string; diagnostics: LspDiagnostic[] };
}
