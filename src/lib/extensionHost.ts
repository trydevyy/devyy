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

import { toast } from "sonner";
import { useSyncExternalStore } from "react";
import { invoke, listen, native, clearLanguageServers } from "./native";
import { allExtensions } from "./extensions";
import { refreshLanguageServers } from "./languageServers";
function extensionNotice(message: string, kind: string) {
  if (kind !== "warning" && kind !== "error") return false;
  toast[kind](message, { id: `extension:${kind}:${message}` });
  return true;
}
export interface ExtensionStatusItem {
  sourceKey?: string;
  id?: string;
  text: string;
  tooltip?: string | { value?: string };
  priority?: number;
  command?: string | { command: string; arguments?: unknown[] };
  color?: string | { id?: string };
  backgroundColor?: string | { id?: string };
  busy?: boolean;
  severity?: number;
  detail?: string;
}
export function updateExtensionStatusItem(
  items: Record<string, ExtensionStatusItem>,
  event: ExtensionStatusItem & { key: string; visible?: boolean },
) {
  const owner = event.key.split(":")[0];
  const previous = items[owner];
  if (event.visible === false) {
    if (previous?.sourceKey !== event.key) return items;
    const next = { ...items };
    delete next[owner];
    return next;
  }
  return { ...items, [owner]: { ...event, sourceKey: event.key } };
}
export interface ExtensionStatus {
  id: string;
  status: "idle" | "active" | "error";
  error?: string;
}
export interface ExtensionWebview {
  id: string;
  title: string;
  html: string;
  enableScripts: boolean;
  viewKind?: "view" | "panel";
  extension: string;
}
export type NativeNode = {
  type: "text" | "heading" | "button" | "input" | "badge" | "stack";
  text?: string;
  command?: string;
  args?: unknown[];
  placeholder?: string;
  children?: NativeNode[];
};
export interface NativeExtensionView {
  id: string;
  title?: string;
  extension: string;
  body: NativeNode[];
}
export interface HostEvent {
  event: string;
  payload: Record<string, unknown>;
}
const subscribers = new Set<() => void>();
const webviewMessages = new Map<string, unknown[]>();
export function takeWebviewMessages(id: string) {
  const messages = webviewMessages.get(id) ?? [];
  webviewMessages.delete(id);
  return messages;
}
let lspSubscribed: Promise<void> | undefined;
let snapshot = {
  contexts: {} as Record<string, unknown>,
  statusItems: {} as Record<string, ExtensionStatusItem>,
  treeVersions: {} as Record<string, number>,
  statusMessage: "",
  statusMessageKind: undefined as "info" | "warning" | "error" | undefined,
  statuses: [] as ExtensionStatus[],
  webviews: [] as ExtensionWebview[],
  views: [] as NativeExtensionView[],
  revision: 0,
};
let subscribed: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let started = false;
const languages = new Map<string, Promise<void>>();
function publish() {
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  subscribers.forEach((fn) => fn());
}
export function useExtensionHost() {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    () => snapshot,
  );
}
export function hostRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
) {
  return invoke<T>("extension_host_request", { method, params });
}
async function subscribe() {
  if (!native) return;
  await (lspSubscribed ??= Promise.all([
    listen<{ language: string; method: string; params: unknown; id?: unknown }>(
      "lsp-server-message",
      ({ payload: p }) => {
        const value = p.params as
          | {
              token?: string | number;
              value?: {
                kind?: string;
                title?: string;
                message?: string;
                percentage?: number;
                cancellable?: boolean;
              };
              message?: string;
              type?: number;
              health?: string;
              quiescent?: boolean;
            }
          | undefined;
        if (p.method === "$/progress" && value?.value) {
          const progress = value.value;
          window.dispatchEvent(
            new CustomEvent("devyy-extension-event", {
              detail: {
                event:
                  progress.kind === "begin"
                    ? "progressStart"
                    : progress.kind === "end"
                      ? "progressEnd"
                      : "progressReport",
                payload: {
                  id: `lsp:${p.language}:${typeof value.token}:${value.token}`,
                  extension: p.language,
                  title: progress.title ?? p.language,
                  message: progress.message,
                  percent: progress.percentage,
                  cancellable: progress.cancellable,
                  language: p.language,
                  token: value.token,
                },
              },
            }),
          );
        }
        if (p.method === "experimental/serverStatus" && value) {
          const key = `lsp-status:${p.language}`;
          const unhealthy =
            value.health === "error" || value.health === "warning";
          if (unhealthy) {
            extensionNotice(
              value.message ||
                `${p.language} language server reported a ${value.health}.`,
              value.health!,
            );
            snapshot.statusItems = { ...snapshot.statusItems };
            delete snapshot.statusItems[key];
          } else {
            snapshot.statusItems = {
              ...snapshot.statusItems,
              [key]: {
                text: `${value.quiescent === false ? "$(sync~spin) " : ""}${p.language}`,
                detail: value.message,
                tooltip: value.message ?? p.language,
                severity:
                  value.health === "error"
                    ? 2
                    : value.health === "warning"
                      ? 1
                      : 0,
              },
            };
          }
          publish();
        }
        if (p.method === "window/showMessage" && value?.message) {
          const kind =
            value.type === 1 ? "error" : value.type === 2 ? "warning" : "info";
          if (!extensionNotice(value.message, kind)) {
            snapshot.statusMessage = value.message;
            snapshot.statusMessageKind = "info";
            publish();
          }
        }
        void hostRequest("languageServerMessage", {
          ...p,
          request: p.id !== undefined,
        })
          .then((result) => {
            if (p.id !== undefined)
              return invoke("lsp_respond", {
                language: p.language,
                id: p.id,
                result,
                error: null,
              });
          })
          .catch((error) => {
            if (p.id !== undefined)
              void invoke("lsp_respond", {
                language: p.language,
                id: p.id,
                result: null,
                error: { code: -32601, message: String(error) },
              }).catch(() => {});
          });
      },
    ),
    listen<{ language: string; text: string }>("lsp-output", ({ payload: p }) =>
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", {
          detail: {
            event: "output",
            payload: { name: p.language, text: p.text },
          },
        }),
      ),
    ),
  ]).then(() => {}));
  await (subscribed ??= listen<HostEvent>(
    "extension-host",
    ({ payload: message }) => {
      const p = message.payload;
      if (message.event === "extensionStatus") {
        snapshot.statuses = [
          ...snapshot.statuses.filter((s) => s.id !== p.id),
          p as unknown as ExtensionStatus,
        ];
        publish();
      } else if (message.event === "treeChanged") {
        const id = String(p.id);
        snapshot.treeVersions = {
          ...snapshot.treeVersions,
          [id]: (snapshot.treeVersions[id] ?? 0) + 1,
        };
        publish();
      } else if (message.event === "statusBar") {
        if (typeof p.key !== "string" || !p.key) return;
        if (p.visible !== false && (p.severity === 1 || p.severity === 2)) {
          extensionNotice(
            String(
              p.detail ||
                (typeof p.tooltip === "string" ? p.tooltip : "") ||
                p.text ||
                "Extension needs attention",
            ),
            p.severity === 2 ? "error" : "warning",
          );
        }
        snapshot.statusItems = updateExtensionStatusItem(
          snapshot.statusItems,
          p as unknown as ExtensionStatusItem & {
            key: string;
            visible?: boolean;
          },
        );
        publish();
      } else if (message.event === "statusMessage") {
        snapshot = {
          ...snapshot,
          statusMessage: String(p.text || ""),
          statusMessageKind: "info",
        };
        publish();
      } else if (message.event === "notification") {
        const severityToast = extensionNotice(
          String(p.message || ""),
          String(p.kind),
        );
        if (!severityToast)
          snapshot = {
            ...snapshot,
            statusMessage: String(p.message || ""),
            statusMessageKind:
              (p.kind as "info" | "warning" | "error") || "info",
          };
        publish();
      } else if (message.event === "context") {
        snapshot.contexts = { ...snapshot.contexts, [String(p.key)]: p.value };
        publish();
      } else if (message.event === "webview") {
        snapshot.webviews = [
          ...snapshot.webviews.filter((v) => v.id !== p.id),
          p as unknown as ExtensionWebview,
        ];
        publish();
      } else if (message.event === "webviewMessage") {
        const id = String(p.id);
        const messages = webviewMessages.get(id) ?? [];
        messages.push(p.message);
        webviewMessages.set(id, messages);
      } else if (message.event === "webviewClosed") {
        webviewMessages.delete(String(p.id));
        snapshot.webviews = snapshot.webviews.filter((v) => v.id !== p.id);
        publish();
      } else if (message.event === "nativeView") {
        const previous = snapshot.views.find((v) => v.id === p.id);
        snapshot.views = [
          ...snapshot.views.filter((v) => v.id !== p.id),
          { ...previous, ...p } as NativeExtensionView,
        ];
        publish();
      } else if (message.event === "nativeViewClosed") {
        snapshot.views = snapshot.views.filter((v) => v.id !== p.id);
        publish();
      }
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", { detail: message }),
      );
    },
  ).then(() => {}));
}
export async function syncExtensionHost(
  after: Promise<unknown> = Promise.resolve(),
) {
  const work = queue
    .catch(() => {})
    .then(async () => {
      await after;
      await subscribe();
      await invoke("lsp_stop");
      clearLanguageServers();
      window.dispatchEvent(new Event("devyy-extension-host-reset"));
      languages.clear();
      webviewMessages.clear();
      snapshot = {
        contexts: {},
        statusItems: {},
        treeVersions: {},
        statusMessage: "",
        statusMessageKind: undefined,
        statuses: [],
        webviews: [],
        views: [],
        revision: snapshot.revision,
      };
      publish();
      if (!native) return;
      try {
        if (started || allExtensions().some((e) => e.hasRuntime)) {
          snapshot.statuses =
            (await hostRequest<ExtensionStatus[]>("restart")) ?? [];
          started = true;
          window.dispatchEvent(new Event("devyy-extension-host-ready"));
          publish();
        }
      } catch (error) {
        snapshot.statuses = allExtensions()
          .filter((e) => e.hasRuntime)
          .map((e) => ({ id: e.id, status: "error", error: String(error) }));
        publish();
      }
      await refreshLanguageServers();
      window.dispatchEvent(new Event("devyy-language-servers-changed"));
    });
  queue = work;
  return work;
}
export async function activateExtensionLanguage(language: string) {
  if (!native || !allExtensions().some((e) => e.hasRuntime)) return;
  await queue;
  if (!languages.has(language))
    languages.set(
      language,
      (async () => {
        await subscribe();
        try {
          await hostRequest("activateLanguage", { language });
        } finally {
          await refreshLanguageServers();
        }
      })().catch((error) => {
        languages.delete(language);
        throw error;
      }),
    );
  await languages.get(language);
}
export async function extensionCommand(id: string, args: unknown[] = []) {
  await queue;
  await subscribe();
  const before = JSON.stringify(await refreshLanguageServers().catch(() => []));
  const result = await hostRequest("command", { id, args });
  const after = JSON.stringify(await refreshLanguageServers().catch(() => []));
  if (before !== after) {
    clearLanguageServers();
    window.dispatchEvent(new Event("devyy-language-servers-changed"));
  }
  return result;
}

export async function extensionLanguageFeature<T>(
  method: string,
  path: string,
  position?: { line: number; character: number },
  range?: unknown,
  context?: unknown,
): Promise<T[]> {
  if (!native || !started) return [];
  const uri = /^[a-z][a-z\d+.-]*:/i.test(path)
    ? path
    : await invoke<string>("file_uri", { path });
  return hostRequest<T[]>("languageFeature", {
    method,
    uri,
    position,
    range,
    context,
  });
}

const terminalConsumers = new Set<(event: HostEvent) => void>();
let pendingTerminalEvents: HostEvent[] = [];
let pendingTerminalInput = 0;
if (typeof window !== "undefined")
  window.addEventListener("devyy-extension-event", (event) => {
    const message = (event as CustomEvent<HostEvent>).detail;
    if (
      ![
        "terminalCreate",
        "terminalInput",
        "terminalName",
        "terminalShow",
        "terminalHide",
        "terminalClose",
      ].includes(message.event)
    )
      return;
    if (terminalConsumers.size) {
      terminalConsumers.forEach((consume) => consume(message));
      return;
    }
    if (message.event === "terminalClose") {
      pendingTerminalEvents = pendingTerminalEvents.filter(
        (item) => item.payload.id !== message.payload.id,
      );
      pendingTerminalInput = pendingTerminalEvents.reduce(
        (size, item) =>
          size +
          (item.event === "terminalInput"
            ? String(item.payload.text).length
            : 0),
        0,
      );
      return;
    }
    if (message.event === "terminalInput") {
      const size = String(message.payload.text).length;
      if (pendingTerminalInput + size > 1024 * 1024) {
        window.dispatchEvent(
          new CustomEvent("devyy-extension-event", {
            detail: {
              event: "notification",
              payload: {
                kind: "error",
                message:
                  "An extension sent too much terminal input before its terminal was ready. The input was not sent.",
              },
            },
          }),
        );
        return;
      }
      pendingTerminalInput += size;
    }
    pendingTerminalEvents.push(message);
  });
if (typeof window !== "undefined")
  window.addEventListener("devyy-extension-host-reset", () => {
    pendingTerminalEvents = [];
    pendingTerminalInput = 0;
  });
export function subscribeExtensionTerminals(
  consume: (event: HostEvent) => void,
) {
  terminalConsumers.add(consume);
  const pending = pendingTerminalEvents;
  pendingTerminalEvents = [];
  pendingTerminalInput = 0;
  for (const message of pending) consume(message);
  return () => {
    terminalConsumers.delete(consume);
  };
}
export function clearStatusMessage() {
  if (snapshot.statusMessage) {
    snapshot = { ...snapshot, statusMessage: "", statusMessageKind: undefined };
    publish();
  }
}
