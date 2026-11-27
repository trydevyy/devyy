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

import Skeleton from "./ui/Skeleton";
import { aiMainView } from "../lib/aiExtensions";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  hostRequest,
  takeWebviewMessages,
  useExtensionHost,
  type ExtensionWebview,
  type HostEvent,
} from "../lib/extensionHost";
import { openUrl } from "@tauri-apps/plugin-opener";
import { extensionMenuItems } from "../lib/extensionMenus";
import { useExtensions } from "../lib/extensions";
import { useContextMenu } from "./ContextMenu";
import { invoke, native } from "../lib/native";
const themeProperties: Record<string, string> = {};
for (const [source, names] of Object.entries({
  "--ink": [
    "foreground",
    "editor-foreground",
    "sideBar-foreground",
    "panelTitle-activeForeground",
    "input-foreground",
    "dropdown-foreground",
    "list-activeSelectionForeground",
    "list-inactiveSelectionForeground",
    "list-hoverForeground",
    "menu-foreground",
    "menu-selectionForeground",
    "quickInput-foreground",
    "notificationCenterHeader-foreground",
    "chat-requestForeground",
    "icon-foreground",
  ],
  "--muted": [
    "descriptionForeground",
    "disabledForeground",
    "input-placeholderForeground",
    "sideBarTitle-foreground",
    "sideBarSectionHeader-foreground",
    "panelTitle-inactiveForeground",
    "tab-inactiveForeground",
    "breadcrumb-foreground",
    "chat-slashCommandForeground",
  ],
  "--surface": [
    "editor-background",
    "sideBar-background",
    "panel-background",
    "chat-requestBackground",
  ],
  "--raised": [
    "dropdown-background",
    "menu-background",
    "quickInput-background",
    "notifications-background",
    "editorWidget-background",
    "editorHoverWidget-background",
  ],
  "--line": [
    "input-border",
    "dropdown-border",
    "panel-border",
    "sideBar-border",
    "sideBarSectionHeader-border",
    "widget-border",
    "menu-border",
    "menu-separatorBackground",
    "editorWidget-border",
    "chat-requestBorder",
    "toolbar-separator",
  ],
  "--hover": [
    "input-background",
    "button-secondaryBackground",
    "list-hoverBackground",
    "toolbar-hoverBackground",
    "list-inactiveSelectionBackground",
    "tab-hoverBackground",
  ],
  "--selection": [
    "list-activeSelectionBackground",
    "editor-selectionBackground",
    "selection-background",
  ],
  "--accent": [
    "focusBorder",
    "textLink-foreground",
    "textLink-activeForeground",
    "button-background",
    "button-hoverBackground",
    "progressBar-background",
    "badge-background",
    "checkbox-selectBackground",
    "inputOption-activeBorder",
    "activityBar-activeBorder",
  ],
  "--primary-ink": ["button-foreground", "badge-foreground"],
  "--secondary": ["button-secondaryForeground", "textPreformat-foreground"],
  "--accent-soft": [
    "button-secondaryHoverBackground",
    "inputOption-activeBackground",
  ],
  "--green": ["testing-iconPassed", "gitDecoration-addedResourceForeground"],
  "--mono": ["editor-font-family"],
}))
  for (const name of names) themeProperties[`--vscode-${name}`] = source;

function themeTokens() {
  const css = getComputedStyle(document.documentElement);
  return Object.entries(themeProperties)
    .map(
      ([key, source]) => `${key}:${css.getPropertyValue(source) || "inherit"}`,
    )
    .join(";");
}
let documentRevision = 0;
function Frame({
  view,
  shortcuts,
  visible,
}: {
  view: ExtensionWebview;
  shortcuts: string[];
  visible: boolean;
}) {
  const openMenu = useContextMenu();
  const installed = useExtensions();
  const host = useExtensionHost();
  const menuData = useRef({ installed, contexts: host.contexts });
  menuData.current = { installed, contexts: host.contexts };
  useEffect(() => {
    void hostRequest("webviewState", {
      id: view.id,
      visible,
      active: visible,
    }).catch(() => {});
  }, [view.id, visible]);
  const shortcutRef = useRef(shortcuts);
  shortcutRef.current = shortcuts;
  const frame = useRef<HTMLIFrameElement>(null);
  const savedState = useRef<unknown>(undefined);
  const ready = useRef(false);
  const storageKey = "devyy.extensionStorage." + view.extension.toLowerCase();
  const sessionStorage = useRef<Record<string, string>>({});
  const readStorage = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  };
  const [url, setUrl] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(!native);
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme,
  );
  const [tokens, setTokens] = useState(themeTokens);
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      const css = getComputedStyle(root);
      setTheme(root.dataset.theme);
      setTokens(
        Object.entries(themeProperties)
          .map(
            ([key, source]) =>
              `${key}:${css.getPropertyValue(source) || "inherit"}`,
          )
          .join(";"),
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    let outgoing: Promise<unknown> = Promise.resolve();
    let disposed = false;
    const flush = () => {
      const target = frame.current?.contentWindow;
      if (!ready.current || !target) return;
      for (const message of takeWebviewMessages(view.id))
        target.postMessage(
          {
            channel: "devyy-host",
            message: window.__DEVYY_EXTENSION_MESSAGES__.decode(message),
          },
          "*",
        );
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        ![
          "devyy-extension",
          "devyy-state",
          "devyy-ready",
          "devyy-storage",
          "devyy-open-link",
          "devyy-shortcut",
          "devyy-context-menu",
        ].includes(event.data?.channel)
      )
        return;
      if (event.data.channel === "devyy-context-menu") {
        const context = {
          ...menuData.current.contexts,
          webviewId: view.id,
          ...event.data.context,
        };
        const items = extensionMenuItems(
          menuData.current.installed,
          "webview/context",
          context,
          (id) =>
            void hostRequest("command", { id, args: [context] }).catch(
              (error) => toast.error(String(error)),
            ),
        );
        const rect = frame.current!.getBoundingClientRect();
        if (items.length)
          openMenu(
            {
              clientX: rect.left + Number(event.data.x || 0),
              clientY: rect.top + Number(event.data.y || 0),
              preventDefault() {},
              stopPropagation() {},
              currentTarget: frame.current,
            },
            items,
          );
        return;
      }
      if (event.data.channel === "devyy-shortcut") {
        if (shortcutRef.current.includes(event.data.binding))
          window.dispatchEvent(
            new CustomEvent("devyy-webview-shortcut", {
              detail: event.data.binding,
            }),
          );
        return;
      }
      if (event.data.channel === "devyy-open-link") {
        if (
          typeof event.data.uri === "string" &&
          /^https?:/.test(event.data.uri)
        )
          void openUrl(event.data.uri).catch((error) =>
            toast.error(String(error)),
          );
        return;
      }
      if (event.data.channel === "devyy-ready") {
        ready.current = true;
        flush();
        return;
      }
      if (event.data.channel === "devyy-storage") {
        const { kind, operation, key, value } = event.data;
        if (!["local", "session"].includes(kind)) return;
        const values =
          kind === "local" ? readStorage() : sessionStorage.current;
        if (operation === "clear")
          for (const key of Object.keys(values)) delete values[key];
        else if (operation === "remove" && typeof key === "string")
          delete values[key];
        else if (
          operation === "set" &&
          typeof key === "string" &&
          typeof value === "string"
        )
          Object.defineProperty(values, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        const serialized = JSON.stringify(values);
        if (serialized.length > 5 * 1024 * 1024) return;
        if (kind === "local") {
          try {
            localStorage.setItem(storageKey, serialized);
          } catch {
            return;
          }
          window.dispatchEvent(
            new CustomEvent("devyy-extension-storage", {
              detail: {
                extension: view.extension,
                source: frame.current,
                kind,
                operation,
                key,
                value,
              },
            }),
          );
        } else sessionStorage.current = values;
        return;
      }
      if (event.data.channel === "devyy-state") {
        savedState.current = event.data.state;
        return;
      }
      const message = window.__DEVYY_EXTENSION_MESSAGES__.encode(
        event.data.message,
      );
      outgoing = outgoing
        .catch(() => {})
        .then(() =>
          disposed
            ? undefined
            : hostRequest("webviewMessage", { id: view.id, message }),
        );
      void outgoing.catch((e) => toast.error(String(e)));
    };
    const incoming = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "webviewMessage" && message.payload.id === view.id)
        flush();
      if (
        message.event === "focusWebview" &&
        message.payload.id === view.id &&
        !message.payload.preserveFocus
      )
        frame.current?.focus();
    };
    const storageChanged = (event: Event) => {
      const { extension, source, ...change } = (event as CustomEvent).detail;
      if (extension === view.extension && source !== frame.current)
        frame.current?.contentWindow?.postMessage(
          { channel: "devyy-storage-sync", ...change },
          "*",
        );
    };
    window.addEventListener("devyy-extension-storage", storageChanged);
    window.addEventListener("message", listener);
    window.addEventListener("devyy-extension-event", incoming);
    return () => {
      disposed = true;
      window.removeEventListener("devyy-extension-storage", storageChanged);
      window.removeEventListener("message", listener);
      window.removeEventListener("devyy-extension-event", incoming);
    };
  }, [view.id]);
  const html = useMemo(() => {
    ready.current = false;
    return window.__DEVYY_CREATE_WEBVIEW_DOCUMENT__({
      html: view.html,
      tokens,
      theme: theme ?? "midnight",
      state: savedState.current,
      storage: { local: readStorage(), session: sessionStorage.current },
    });
  }, [view.html]);
  const sendTheme = () => {
    frame.current?.contentWindow?.postMessage(
      { channel: "devyy-connect" },
      "*",
    );
    frame.current?.contentWindow?.postMessage(
      { channel: "devyy-theme", theme, tokens },
      "*",
    );
    frame.current?.contentWindow?.postMessage(
      { channel: "devyy-shortcuts", bindings: shortcutRef.current },
      "*",
    );
  };
  const shortcutSignature = JSON.stringify(shortcuts);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { channel: "devyy-shortcuts", bindings: shortcuts },
      "*",
    );
  }, [shortcutSignature, url]);
  useEffect(sendTheme, [theme, tokens, url]);
  useEffect(() => {
    if (visible) {
      sendTheme();
    }
  }, [visible]);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void invoke<string>("extension_webview_document", {
      id: view.id,
      html,
      revision: ++documentRevision,
    })
      .then((result) => {
        if (!cancelled) {
          setUrl(result);
          setPrepared(true);
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [view.id, html]);
  if (!prepared)
    return <Skeleton variant="workbench" label="Opening extension" />;
  return (
    <iframe
      ref={frame}
      title={view.title}
      src={url ?? undefined}
      srcDoc={url ? undefined : html}
      onLoad={sendTheme}
      sandbox={view.enableScripts ? "allow-scripts" : ""}
      referrerPolicy="no-referrer"
      className="extension-webview-frame"
    />
  );
}
export default function ExtensionWebviews({
  shortcuts = [],
  placement = "main",
  owner,
  viewId,
  visible = true,
}: {
  shortcuts?: string[];
  placement?: "main" | "ai" | "view" | "editor";
  owner?: string;
  viewId?: string;
  visible?: boolean;
}) {
  const matchesOwner = (viewExt: string, ownerExt?: string) =>
    !ownerExt || viewExt.toLowerCase() === ownerExt.toLowerCase();
  const host = useExtensionHost();
  const webviews = host.webviews.filter((view) =>
    placement === "ai"
      ? matchesOwner(view.extension, owner) &&
        view.id === aiMainView(view.extension)
      : placement === "view" || placement === "editor"
        ? view.id === viewId
        : view.viewKind !== "view",
  );
  const [selected, setSelected] = useState("");
  const active = !visible
    ? undefined
    : (webviews.find(
        (view) => view.id === selected && matchesOwner(view.extension, owner),
      ) ??
      webviews.filter((view) => matchesOwner(view.extension, owner)).at(-1));
  useEffect(() => {
    const matching = webviews.filter((view) =>
      matchesOwner(view.extension, owner),
    );
    if (matching.length > 0 && !matching.some((v) => v.id === selected)) {
      setSelected(matching.at(-1)?.id ?? "");
    }
  }, [owner, webviews.map((v) => v.id).join(",")]);
  useEffect(() => {
    const focus = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "focusWebview" && !message.payload.preserveFocus)
        setSelected(String(message.payload.id));
    };
    window.addEventListener("devyy-extension-event", focus);
    return () => window.removeEventListener("devyy-extension-event", focus);
  }, []);
  if (!active && placement === "main") return null;
  return (
    <section
      className={`extension-dock${placement === "editor" ? " extension-editor-panel" : ""}`}
      aria-label="Extension panel"
    >
      {placement === "main" && (
        <div className="extension-dock-header">
          <div
            className="extension-panel-tabs"
            role="tablist"
            aria-label="Extension panels"
          >
            {webviews.map((view) => (
              <button
                key={view.id}
                role="tab"
                aria-selected={active?.id === view.id}
                tabIndex={active?.id === view.id ? 0 : -1}
                onClick={() => setSelected(view.id)}
                onKeyDown={(event) => {
                  const i = webviews.findIndex((v) => v.id === view.id),
                    next =
                      event.key === "ArrowRight"
                        ? (i + 1) % webviews.length
                        : event.key === "ArrowLeft"
                          ? (i - 1 + webviews.length) % webviews.length
                          : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setSelected(webviews[next].id);
                    const tabs =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      );
                    tabs?.[next]?.focus();
                  }
                }}
              >
                {view.title}
              </button>
            ))}
          </div>
          <button
            aria-label={`Close ${active?.title ?? "extension view"}`}
            disabled={!active}
            onClick={() =>
              void hostRequest("closeWebview", { id: active?.id }).catch(
                (error) => toast.error(String(error)),
              )
            }
          >
            <X size={15} />
          </button>
        </div>
      )}
      {!active && <Skeleton variant="workbench" label="Opening extension" />}
      {webviews.map((view) => (
        <div
          className="extension-frame-container"
          hidden={view.id !== active?.id}
          key={view.id}
        >
          <Frame
            view={view}
            shortcuts={shortcuts}
            visible={view.id === active?.id}
          />
        </div>
      ))}
    </section>
  );
}
