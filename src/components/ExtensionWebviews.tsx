import { isAIExtension } from "../lib/aiExtensions";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelsTopLeft, X } from "lucide-react";
import { toast } from "sonner";
import {
  hostRequest,
  takeWebviewMessages,
  useExtensionHost,
  type ExtensionWebview,
  type HostEvent,
} from "../lib/extensionHost";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, native } from "../lib/native";
const themeProperties: Record<string, string> = {
  "--vscode-editor-background": "--surface",
  "--vscode-editor-foreground": "--ink",
  "--vscode-foreground": "--ink",
  "--vscode-descriptionForeground": "--muted",
  "--vscode-focusBorder": "--accent",
  "--vscode-button-background": "--accent",
  "--vscode-button-foreground": "--primary-ink",
  "--vscode-button-secondaryBackground": "--hover",
  "--vscode-input-background": "--hover",
  "--vscode-input-foreground": "--ink",
  "--vscode-input-border": "--line",
  "--vscode-panel-border": "--line",
  "--vscode-list-hoverBackground": "--hover",
  "--vscode-sideBar-background": "--surface",
};
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
}: {
  view: ExtensionWebview;
  shortcuts: string[];
}) {
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
  useEffect(() => {
    let outgoing: Promise<unknown> = Promise.resolve();
    let disposed = false;
    const flush = () => {
      if (!ready.current) return;
      for (const message of takeWebviewMessages(view.id))
        frame.current?.contentWindow?.postMessage(
          {
            channel: "devyy-host",
            message: window.__DEVYY_EXTENSION_MESSAGES__.decode(message),
          },
          "*",
        );
    };
    const listener = (event: MessageEvent) => {
      // Opaque iframe origins cannot be trusted by origin; bind to this frame.
      if (
        event.source !== frame.current?.contentWindow ||
        ![
          "devyy-extension",
          "devyy-state",
          "devyy-ready",
          "devyy-storage",
          "devyy-open-link",
          "devyy-shortcut",
        ].includes(event.data?.channel)
      )
        return;
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
      if (message.event === "focusWebview" && message.payload.id === view.id)
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
    // Theme changes use postMessage so running extension state is preserved.
  }, [view.html]);
  const sendTheme = () => {
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
    return (
      <div className="preview-loading" role="status">
        Opening extension…
      </div>
    );
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
}: {
  shortcuts?: string[];
  placement?: "main" | "ai";
  owner?: string;
}) {
  const host = useExtensionHost();
  const webviews = host.webviews.filter((view) =>
    placement === "ai"
      ? isAIExtension(view.extension)
      : !isAIExtension(view.extension),
  );
  const [selected, setSelected] = useState("");
  const active =
    webviews.find(
      (view) => view.id === selected && (!owner || view.extension === owner),
    ) ?? webviews.filter((view) => !owner || view.extension === owner).at(-1);
  useEffect(() => {
    setSelected(webviews.at(-1)?.id ?? "");
  }, [webviews.at(-1)?.id]);
  useEffect(() => {
    const focus = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "focusWebview")
        setSelected(String(message.payload.id));
    };
    window.addEventListener("devyy-extension-event", focus);
    return () => window.removeEventListener("devyy-extension-event", focus);
  }, []);
  if (!active && placement === "main") return null;
  return (
    <section className="extension-dock" aria-label="Extension panel">
      <div className="extension-dock-header">
        <PanelsTopLeft size={14} />
        <select
          aria-label="Active extension view"
          value={active?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {webviews
            .filter((view) => !owner || view.extension === owner)
            .map((view) => (
              <option key={view.id} value={view.id}>
                {view.title}
              </option>
            ))}
        </select>
        <button
          aria-label={`Close ${active?.title ?? "extension view"}`}
          disabled={!active}
          onClick={() => {
            void hostRequest("closeWebview", { id: active?.id }).catch((e) =>
              toast.error(String(e)),
            );
          }}
        >
          <X size={15} />
        </button>
      </div>
      {!active && (
        <p className="extension-view-note" role="status">
          Open the extension’s view to get started. If it is still loading,
          check its runtime status in Installed extensions.
        </p>
      )}
      {webviews.map((view) => (
        <div
          className="extension-frame-container"
          hidden={view.id !== active?.id}
          key={view.id}
        >
          <Frame view={view} shortcuts={shortcuts} />
        </div>
      ))}
    </section>
  );
}
