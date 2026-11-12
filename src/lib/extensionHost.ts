import { useSyncExternalStore } from "react";
import { invoke, listen, native, clearLanguageServers } from "./native";
import { allExtensions } from "./extensions";
import { refreshLanguageServers } from "./languageServers";
export interface ExtensionStatusItem {
  text: string;
  tooltip?: string | { value?: string };
  priority?: number;
  command?: string | { command: string; arguments?: unknown[] };
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
let snapshot = {
  contexts: {} as Record<string, unknown>,
  statusItems: {} as Record<string, ExtensionStatusItem>,
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
      } else if (message.event === "statusBar") {
        snapshot.statusItems = { ...snapshot.statusItems };
        if (p.visible === false) delete snapshot.statusItems[String(p.key)];
        else
          snapshot.statusItems[String(p.key)] =
            p as unknown as ExtensionStatusItem;
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
export async function syncExtensionHost() {
  const work = queue
    .catch(() => {})
    .then(async () => {
      await subscribe();
      window.dispatchEvent(new Event("devyy-extension-host-reset"));
      languages.clear();
      webviewMessages.clear();
      snapshot = {
        contexts: {},
        statusItems: {},
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
      await invoke("lsp_stop");
      clearLanguageServers();
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
  const before = JSON.stringify(await refreshLanguageServers());
  await hostRequest("command", { id, args });
  const after = JSON.stringify(await refreshLanguageServers());
  if (before !== after) {
    await invoke("lsp_stop");
    clearLanguageServers();
    window.dispatchEvent(new Event("devyy-language-servers-changed"));
  }
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

// Extensions can create terminals during startup, before the lazy terminal UI mounts.
// Keep these events until its consumer is ready, including inputs sent immediately after creation.
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
