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

import { readClipboardText, writeClipboardText } from "../lib/clipboard";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ArrowUpRight, TerminalSquare, RotateCcw } from "lucide-react";
import { invoke, listen, native } from "../lib/native";
import "@xterm/xterm/css/xterm.css";

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
export const subscribeMotion = (callback: () => void) => {
  motionQuery.addEventListener("change", callback);
  return () => motionQuery.removeEventListener("change", callback);
};
export const motionSnapshot = () => motionQuery.matches;
export function terminalSnapshot(term: XTerminal | null): string {
  if (!term) return "";
  const buffer = term.buffer.active,
    lines: string[] = [];
  for (let i = Math.max(0, buffer.length - 400); i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return `${buffer.length > 400 ? "[Showing the last 400 terminal lines]\n" : ""}${lines.join("\n").trimEnd()}`;
}
export interface TerminalHandle {
  focus: () => void;
  clear: () => void;
  restart: () => void;
  selection: () => string;
  snapshot: () => string;
  paste: (text: string) => void;
  ensure: () => void;
}
export default forwardRef<
  TerminalHandle,
  {
    root: string;
    extensionOptions?: Record<string, unknown>;
    profile: string;
    lineHeight: number;
    cursorStyle: "block" | "bar" | "underline";
    copyOnSelect: boolean;
    onReady: (id: number | null) => void;
    onExit?: () => void;
    onError: (error: unknown) => void;
    onOpen: () => void;
    theme: "paper" | "midnight" | "monochrome";
    colors?: Record<string, string>;
    fontSize: number;
    scrollback: number;
    cursorBlink: boolean;
    preview?: boolean;
  }
>(function Terminal(
  {
    root,
    extensionOptions,
    profile,
    lineHeight,
    cursorStyle,
    copyOnSelect,
    onReady,
    onExit,
    onError,
    onOpen,
    theme,
    colors,
    fontSize,
    scrollback,
    cursorBlink,
    preview = false,
  },
  ref,
) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot);
  const copySelection = useRef(copyOnSelect);
  copySelection.current = copyOnSelect;
  const terminal = useRef<XTerminal | null>(null);
  const requestFit = useRef<() => void>(() => {});
  const currentTheme = useRef(terminalTheme(theme, colors));
  currentTheme.current = terminalTheme(theme, colors);
  const host = useRef<HTMLDivElement>(null),
    callback = useRef({ onReady, onExit, onError });
  callback.current = { onReady, onExit, onError };
  const [generation, setGeneration] = useState(0),
    [exited, setExited] = useState(false);
  const exitedRef = useRef(exited);
  exitedRef.current = exited;
  useImperativeHandle(
    ref,
    () => ({
      focus: () => terminal.current?.focus(),
      clear: () => terminal.current?.clear(),
      restart: () => setGeneration((x) => x + 1),
      selection: () => terminal.current?.getSelection() ?? "",
      snapshot: () => terminalSnapshot(terminal.current),
      paste: (text) => terminal.current?.paste(text),
      ensure: () => {
        if (exitedRef.current) setGeneration((x) => x + 1);
      },
    }),
    [],
  );
  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      terminal.current.options.scrollback = scrollback;
      terminal.current.options.cursorBlink = cursorBlink && !reducedMotion;
      terminal.current.options.cursorStyle = cursorStyle;
      terminal.current.options.lineHeight = lineHeight;
      requestFit.current();
    }
  }, [
    fontSize,
    scrollback,
    cursorBlink,
    cursorStyle,
    lineHeight,
    reducedMotion,
  ]);
  useEffect(() => {
    if ((!preview && (!native || root === "demo")) || !host.current) return;
    setExited(false);
    const term = new XTerminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize,
      scrollback,
      lineHeight,
      cursorStyle,
      cursorBlink: cursorBlink && !reducedMotion,
      allowProposedApi: false,
      disableStdin: preview,
      theme: currentTheme.current,
    });
    terminal.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    if (preview) {
      const resize = () => {
        if (host.current?.clientWidth && host.current.clientHeight) fit.fit();
      };
      requestFit.current = resize;
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      resize();
      term.write(
        [
          "\x1b[36m~/playground\x1b[0m \x1b[32m❯\x1b[0m cargo run",
          "\x1b[32m   Compiling\x1b[0m devyy-playground v0.1.0",
          "\x1b[32m    Finished\x1b[0m dev profile in 0.24s",
          "\x1b[32m     Running\x1b[0m `target/debug/devyy-playground`",
          "Hello from Devyy!",
          "",
          "\x1b[36m~/playground\x1b[0m \x1b[32m❯\x1b[0m ",
        ].join("\r\n"),
      );
      return () => {
        observer.disconnect();
        requestFit.current = () => {};
        terminal.current = null;
        term.dispose();
      };
    }
    let id: number | null = null,
      disposed = false;
    const queued = new Map<number, number[][]>();
    const cleanup: (() => void)[] = [];
    const drainListeners = () => cleanup.splice(0).forEach((fn) => fn());
    const init = async () => {
      cleanup.push(
        await listen<{ id: number; data: number[] }>(
          "terminal-output",
          ({ payload }) => {
            if (disposed) return;
            if (payload.id === id) term.write(new Uint8Array(payload.data));
            else if (id === null) {
              const items = queued.get(payload.id) ?? [];
              if (items.length < 256) items.push(payload.data);
              queued.set(payload.id, items);
            }
          },
        ),
      );
      cleanup.push(
        await listen<number>("terminal-exit", ({ payload }) => {
          if (!disposed && payload === id) {
            setExited(true);
            callback.current.onReady(null);
            callback.current.onExit?.();
            term.write(
              "\r\n\x1b[90mSession ended. Use restart for a new shell.\x1b[0m\r\n",
            );
          }
        }),
      );
      if (disposed) {
        drainListeners();
        return;
      }
      id = await invoke<number>("terminal_create", {
        cols: term.cols,
        rows: term.rows,
        profile,
        options: extensionOptions,
      });
      if (disposed) {
        await invoke("terminal_close", { id });
        return;
      }
      for (const data of queued.get(id) ?? []) term.write(new Uint8Array(data));
      queued.clear();
      callback.current.onReady(id);
    };
    void init().catch((e) => {
      drainListeners();
      if (disposed) return;
      term.writeln(`Unable to start terminal: ${String(e)}`);
      callback.current.onError(e);
      callback.current.onExit?.();
    });
    const input = term.onData((data) => {
      if (id !== null && !exitedRef.current)
        void invoke("terminal_write", { id, data }).catch(
          callback.current.onError,
        );
    });
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === "keydown") {
        const isPaste =
          ((event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "v") ||
          (event.shiftKey && event.key === "Insert");
        if (isPaste) {
          event.preventDefault();
          void readClipboardText()
            .then((text) => {
              if (text) {
                term.paste(text);
              }
            })
            .catch(callback.current.onError);
          return false;
        }

        const isCopy =
          (event.ctrlKey &&
            event.shiftKey &&
            event.key.toLowerCase() === "c") ||
          ((event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "c" &&
            term.hasSelection());
        if (isCopy) {
          const text = term.getSelection();
          if (text) {
            event.preventDefault();
            void writeClipboardText(text).catch(callback.current.onError);
            return false;
          }
        }
      }
      return true;
    });
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (text) {
        e.preventDefault();
        term.paste(text);
      }
    };
    host.current.addEventListener("paste", handlePaste);
    const selection = term.onSelectionChange(() => {
      const text = term.getSelection();
      if (copySelection.current && text)
        void writeClipboardText(text).catch(callback.current.onError);
    });
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          disposed ||
          !host.current?.clientHeight ||
          !host.current.clientWidth
        )
          return;
        fit.fit();
        if (id !== null)
          void invoke("terminal_resize", {
            id,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    requestFit.current = scheduleFit;
    scheduleFit();
    observer.observe(host.current);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      drainListeners();
      observer.disconnect();
      host.current?.removeEventListener("paste", handlePaste);
      requestFit.current = () => {};
      input.dispose();
      selection.dispose();
      terminal.current = null;
      term.element?.remove();
      setTimeout(() => term.dispose(), 0);
      callback.current.onReady(null);
      if (id !== null) void invoke("terminal_close", { id }).catch(() => {});
    };
  }, [root, profile, generation, preview]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme = terminalTheme(theme, colors);
  }, [theme, colors]);
  return (
    <div className="terminal-content">
      {!preview && (root === "demo" || !native) ? (
        <div className="terminal-welcome">
          <TerminalSquare size={23} />
          <div>
            <strong>No terminal session</strong>
            <p>
              {native
                ? "Open a project folder to start an integrated shell."
                : "Open a local project in the desktop app to use the integrated terminal."}
            </p>
          </div>
          <button onClick={onOpen}>
            Open a folder <ArrowUpRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="xterm-host" ref={host} />
          {exited && (
            <button
              className="restart-terminal"
              onClick={() => setGeneration((x) => x + 1)}
            >
              <RotateCcw size={13} /> Restart shell
            </button>
          )}
        </>
      )}
    </div>
  );
});

export function terminalTheme(
  theme: "paper" | "midnight" | "monochrome",
  colors?: Record<string, string>,
) {
  const light = theme === "paper";
  const oled = theme === "monochrome";
  return {
    background:
      colors?.["terminal"] ??
      (light ? "#f0eff3" : oled ? "#0a0a0a" : "#2a2b2e"),
    foreground:
      colors?.["terminal-foreground"] ??
      (light ? "#494453" : oled ? "#eaeaea" : "#d7d3de"),
    cursor:
      colors?.["terminal-cursor"] ??
      (light ? "#80659f" : oled ? "#ffffff" : "#b9a2d7"),
    selectionBackground:
      colors?.["terminal-selection"] ??
      (light ? "#dcd3e8" : oled ? "#2a2a2a" : "#494053"),
    black: colors?.["terminal-black"] ?? "#28262e",
    red: colors?.["terminal-red"] ?? "#d28c8d",
    green: colors?.["terminal-green"] ?? "#9eb394",
    yellow: colors?.["terminal-yellow"] ?? "#c5b189",
    blue: colors?.["terminal-blue"] ?? "#8eaac6",
    magenta: colors?.["terminal-magenta"] ?? "#b499cd",
    cyan: colors?.["terminal-cyan"] ?? "#8eafb5",
    white: colors?.["terminal-white"] ?? "#ddd9e4",
    brightBlack: colors?.["terminal-bright-black"] ?? "#797480",
    brightRed: colors?.["terminal-bright-red"] ?? "#e4a1a1",
    brightGreen: colors?.["terminal-bright-green"] ?? "#b0c8a5",
    brightYellow: colors?.["terminal-bright-yellow"] ?? "#ddc79a",
    brightBlue: colors?.["terminal-bright-blue"] ?? "#a8c0dd",
    brightMagenta: colors?.["terminal-bright-magenta"] ?? "#cab1df",
    brightCyan: colors?.["terminal-bright-cyan"] ?? "#a3c5cb",
    brightWhite: colors?.["terminal-bright-white"] ?? "#ffffff",
  };
}
