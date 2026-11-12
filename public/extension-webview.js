/* Shared by the desktop workbench and native extension compatibility checks. */
(() => {
  function initialize({ state, theme, storage }, installStorage) {
    installStorage(storage);
    let acquired = false;
    let savedState = state;
    let shortcuts = [];
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.isComposing ||
          !(event.metaKey || event.ctrlKey || event.altKey)
        )
          return;
        const mac = /Mac|iPhone|iPad/.test(navigator.platform);
        const punctuation = {
          Backquote: "`",
          Backslash: "\\",
          BracketLeft: "[",
          BracketRight: "]",
          Comma: ",",
          Period: ".",
          Slash: "/",
          Equal: "=",
          Minus: "-",
        };
        let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        if (event.code in punctuation) key = punctuation[event.code];
        if (
          (event.altKey || !/^[a-z]$/i.test(event.key)) &&
          /^Key[A-Z]$/.test(event.code)
        )
          key = event.code.slice(3);
        const binding = [
          mac ? (event.metaKey ? "Mod" : "") : event.ctrlKey ? "Mod" : "",
          mac && event.ctrlKey ? "Ctrl" : "",
          !mac && event.metaKey ? "Meta" : "",
          event.altKey ? "Alt" : "",
          event.shiftKey ? "Shift" : "",
          key,
        ]
          .filter(Boolean)
          .join("+");
        if (!shortcuts.includes(binding)) return;
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage({ channel: "devyy-shortcut", binding }, "*");
      },
      true,
    );
    const announceReady = () =>
      parent.postMessage({ channel: "devyy-ready" }, "*");
    const applyTheme = (theme) => {
      if (!document.body) return;
      const light = theme === "paper";
      document.body.classList.remove("vscode-light", "vscode-dark");
      document.body.classList.add(light ? "vscode-light" : "vscode-dark");
      document.body.dataset.vscodeThemeKind = light
        ? "vscode-light"
        : "vscode-dark";
      document.body.dataset.vscodeThemeName = light
        ? "Devyy Light"
        : "Devyy Dark";
      document.body.dataset.vscodeThemeId = light
        ? "devyy-light"
        : "devyy-dark";
    };
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        applyTheme(theme);
        announceReady();
      },
      { once: true },
    );
    window.acquireVsCodeApi = () => {
      if (acquired) throw Error("API already acquired");
      acquired = true;
      // Some module entrypoints await their host before DOMContentLoaded.
      queueMicrotask(announceReady);
      return Object.freeze({
        postMessage: (message) =>
          parent.postMessage({ channel: "devyy-extension", message }, "*"),
        getState: () => savedState,
        setState: (value) => {
          savedState = value;
          parent.postMessage({ channel: "devyy-state", state: value }, "*");
          return value;
        },
      });
    };
    window.addEventListener("message", (event) => {
      if (event.source !== parent) return;
      if (
        event.data?.channel === "devyy-shortcuts" &&
        Array.isArray(event.data.bindings)
      )
        shortcuts = event.data.bindings.filter(
          (binding) => typeof binding === "string",
        );
      if (event.data?.channel === "devyy-host") {
        // VS Code delivers host messages with the webview's own origin. Several
        // extensions validate that origin before accepting an RPC response.
        window.dispatchEvent(
          new MessageEvent("message", {
            data: event.data.message,
            origin: window.location.origin,
            source: window,
          }),
        );
      }
      if (event.data?.channel === "devyy-theme") {
        document.documentElement.style.cssText = event.data.tokens;
        document.documentElement.style.colorScheme =
          event.data.theme === "paper" ? "light" : "dark";
        applyTheme(event.data.theme);
      }
    });
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (anchor && /^https?:/.test(anchor.href)) {
        event.preventDefault();
        parent.postMessage(
          { channel: "devyy-open-link", uri: anchor.href },
          "*",
        );
      }
    });
  }
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http://localhost:* http://127.0.0.1:* devyy-extension: http://devyy-extension.localhost; style-src 'unsafe-inline' data: https: devyy-extension: http://devyy-extension.localhost; img-src data: blob: https: devyy-extension: http://devyy-extension.localhost; font-src data: https: devyy-extension: http://devyy-extension.localhost; connect-src https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* devyy-extension: http://devyy-extension.localhost; worker-src blob: devyy-extension: http://devyy-extension.localhost; frame-src https:; form-action https:; base-uri devyy-extension: http://devyy-extension.localhost";
  window.__DEVYY_CREATE_WEBVIEW_DOCUMENT__ = function ({
    html,
    tokens = "",
    theme = "midnight",
    state = null,
    storage = {},
  }) {
    const config = JSON.stringify({ state, theme, storage }).replace(
      /</g,
      "\\u003c",
    );
    const runtime = `(${initialize.toString()})(${config},${window.__DEVYY_INSTALL_WEBVIEW_STORAGE__.toString()})`;
    const bootstrap = `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>:root{${tokens};--vscode-font-family:'DM Sans',system-ui,sans-serif;--vscode-font-size:12px;color-scheme:${theme === "paper" ? "light" : "dark"}}body{margin:0;padding:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:var(--vscode-font-size)/1.6 var(--vscode-font-family)}button,input,select,textarea{font:inherit;color:inherit;border:1px solid var(--vscode-input-border);border-radius:6px;padding:7px 10px;background:var(--vscode-input-background)}button{cursor:pointer}button:hover{background:var(--vscode-list-hoverBackground)}*:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}h1,h2,h3{font-weight:500;letter-spacing:-.02em}a{color:var(--vscode-focusBorder)}</style><script>${runtime}<\/script>`;
    const source = (html || "<html><head></head><body></body></html>").replace(
      /<!doctype[^>]*>/i,
      "",
    );
    return (
      "<!doctype html>" +
      (/<head(?:\s[^>]*)?>/i.test(source)
        ? source.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bootstrap)
        : bootstrap + source)
    );
  };
})();
