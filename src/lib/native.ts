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

import { invoke as invokeNative, isTauri } from "@tauri-apps/api/core";
import { listen as listenNative } from "@tauri-apps/api/event";
import { serverLanguages } from "./languageServers";
import { activateExtensionLanguage } from "./extensionHost";
import type { Position, LspDiagnostic } from "./types";
import { embeddedThemePreview } from "./previewMode";
export const native = !embeddedThemePreview && isTauri();
export const nativeLinux =
  native && globalThis.document?.documentElement.dataset.platform === "linux";
export const invoke: typeof invokeNative = embeddedThemePreview
  ? () => Promise.reject(Error("This action is unavailable in the preview."))
  : invokeNative;
export const listen: typeof listenNative = native
  ? listenNative
  : async () => () => {};
interface ServerCapabilities {
  semanticTokensProvider?: {
    legend?: { tokenTypes: string[]; tokenModifiers: string[] };
  };
}
const capabilities = new Map<string, ServerCapabilities>();
export function documentCapabilities(path: string) {
  return capabilities.get(documents.get(path)?.language ?? "");
}
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
  capabilities.clear();
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
      invoke<{ capabilities?: ServerCapabilities }>("lsp_start", { language })
        .then((result) => {
          if (epoch === generation)
            capabilities.set(language, result?.capabilities ?? {});
        })
        .catch((e) => {
          if (epoch === generation) ready.delete(language);
          throw e;
        }),
    );
  await ready.get(language);
  if (epoch !== generation || tickets.get(path) !== ticket) return false;
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
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("devyy-document-connected", { detail: { path } }),
    );
  return true;
}
export function connectDocument(path: string, language: string, text: string) {
  const existing = connections.get(path);
  if (existing) return existing;
  if (documents.get(path)?.language === language) return Promise.resolve(true);
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
  extraParams?: Record<string, unknown>,
): Promise<T | null> {
  await connections.get(path)?.catch(() => false);
  const doc = documents.get(path);
  if (!doc) return null;
  return languageServerRequest<T>(path, method, {
    textDocument: { uri: doc.uri },
    ...(position ? { position } : {}),
    ...(method.endsWith("formatting")
      ? { options: { tabSize: 4, insertSpaces: true } }
      : {}),
    ...(method === "textDocument/signatureHelp"
      ? { context: { triggerKind: 1, isRetrigger: false } }
      : {}),
    ...(extraParams ? extraParams : {}),
  });
}
export async function languageServerRequest<T>(
  path: string,
  method: string,
  params: unknown,
): Promise<T | null> {
  await flushDocumentChanges(path);
  const doc = documents.get(path);
  if (!doc) return null;
  await doc.updates;
  return invoke<T>("lsp_request", {
    language: doc.language,
    method,
    params,
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
