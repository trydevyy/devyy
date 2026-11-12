/// <reference types="vite/client" />

interface Window {
  __DEVYY_INSTALL_WEBVIEW_STORAGE__(initial?: {
    local?: Record<string, string>;
    session?: Record<string, string>;
  }): void;
  __DEVYY_EXTENSION_MESSAGES__: {
    encode(value: unknown): unknown;
    decode(value: unknown): unknown;
  };
  __DEVYY_CREATE_WEBVIEW_DOCUMENT__(options: {
    html: string;
    tokens?: string;
    theme?: string;
    state?: unknown;
    storage?: {
      local?: Record<string, string>;
      session?: Record<string, string>;
    };
  }): string;
}
