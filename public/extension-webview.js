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

(() => {
  function initialize({ state, theme, storage }, installStorage) {
    installStorage(storage);
    let acquired = false;
    let savedState = state;
    let shortcuts = [];
    let focusTarget;
    document.addEventListener("focusin", (event) => {
      if (event.target instanceof HTMLElement) focusTarget = event.target;
    });
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
      if (event.data?.channel === "devyy-focus") {
        if (focusTarget?.isConnected)
          focusTarget.focus({ preventScroll: true });
        else window.focus();
        return;
      }
      if (event.data?.channel === "devyy-connect") {
        announceReady();
        return;
      }
      if (
        event.data?.channel === "devyy-shortcuts" &&
        Array.isArray(event.data.bindings)
      )
        shortcuts = event.data.bindings.filter(
          (binding) => typeof binding === "string",
        );
      if (event.data?.channel === "devyy-host") {
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
        document.documentElement.style.setProperty(
          "--vscode-editor-background",
          "transparent",
        );
        document.documentElement.style.setProperty(
          "--vscode-sideBar-background",
          "transparent",
        );
        document.documentElement.style.colorScheme =
          event.data.theme === "paper" ? "light" : "dark";
        applyTheme(event.data.theme);
      }
    });
    document.addEventListener("contextmenu", (event) => {
      const context = {};
      let element = event.target instanceof Element ? event.target : null;
      const ancestors = [];
      while (element) {
        ancestors.unshift(element);
        element = element.parentElement;
      }
      for (const node of ancestors) {
        const raw = node.getAttribute("data-vscode-context");
        if (!raw || raw.length > 16384) continue;
        try {
          const value = JSON.parse(raw);
          for (const [key, item] of Object.entries(value)) {
            if (["__proto__", "constructor", "prototype"].includes(key))
              continue;
            if (Object.keys(context).length < 128) context[key] = item;
          }
        } catch {}
      }
      event.preventDefault();
      parent.postMessage(
        {
          channel: "devyy-context-menu",
          context,
          x: event.clientX,
          y: event.clientY,
        },
        "*",
      );
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
    const bootstrap = `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>:root{${tokens};--vscode-font-family:'DM Sans',system-ui,sans-serif;--vscode-font-size:12px;color-scheme:${theme === "paper" ? "light" : "dark"}}body{margin:0;padding:0;background:transparent;color:var(--vscode-foreground);font:var(--vscode-font-size)/1.6 var(--vscode-font-family)}:where(button,input,select,textarea){font:inherit;color:inherit}:where(a){color:var(--vscode-textLink-foreground)}:where(*:focus-visible){outline:1px solid var(--vscode-focusBorder);outline-offset:2px}:root{--vscode-editor-font-size:13px;--vscode-editor-font-weight:400;--vscode-window-activeBorder:transparent;--vscode-contrastBorder:transparent}</style><script>${runtime}<\/script>`;
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
