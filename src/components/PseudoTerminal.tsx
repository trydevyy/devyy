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

import { writeClipboardText } from "../lib/clipboard";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
} from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { hostRequest, type HostEvent } from "../lib/extensionHost";
import {
  terminalTheme,
  terminalSnapshot,
  subscribeMotion,
  motionSnapshot,
  type TerminalHandle,
} from "./Terminal";
import type { Settings } from "../lib/types";

export default forwardRef<
  TerminalHandle,
  { id: string; settings: Settings; onError: (error: unknown) => void }
>(function PseudoTerminal({ id, settings, onError }, ref) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerminal | null>(null);
  const fit = useRef<() => void>(() => {});
  const current = useRef({ settings, onError });
  current.current = { settings, onError };
  useImperativeHandle(
    ref,
    () => ({
      focus: () => terminal.current?.focus(),
      clear: () => terminal.current?.clear(),
      selection: () => terminal.current?.getSelection() ?? "",
      snapshot: () => terminalSnapshot(terminal.current),
      paste: (text) => terminal.current?.paste(text),
      restart: () => {},
      ensure: () => {},
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    const preferences = current.current.settings;
    const term = new XTerminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: preferences.terminalFontSize,
      scrollback: preferences.terminalScrollback,
      lineHeight: preferences.terminalLineHeight,
      cursorStyle: preferences.terminalCursorStyle,
      cursorBlink:
        preferences.cursorBlink &&
        !preferences.reduceMotion &&
        !motionSnapshot(),
      theme: terminalTheme(preferences.theme),
      allowProposedApi: false,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(host.current);
    terminal.current = term;
    let disposed = false,
      frame = 0;
    const listener = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "pseudoTerminalOutput" && message.payload.id === id)
        term.write(String(message.payload.text));
    };
    window.addEventListener("devyy-extension-event", listener);
    if (host.current.clientWidth && host.current.clientHeight) addon.fit();
    let queue: Promise<unknown> = hostRequest("pseudoTerminalOpen", {
      id,
      dimensions: { columns: term.cols, rows: term.rows },
    });
    const send = (method: string, params: Record<string, unknown>) => {
      queue = queue
        .catch(() => {})
        .then(() =>
          disposed ? undefined : hostRequest(method, { id, ...params }),
        );
      void queue.catch((error) => {
        if (!disposed) current.current.onError(error);
      });
    };
    void queue.catch((error) => {
      if (!disposed) current.current.onError(error);
    });
    const input = term.onData((text) => send("pseudoTerminalInput", { text }));
    const selected = term.onSelectionChange(() => {
      const text = term.getSelection();
      if (text && current.current.settings.terminalCopyOnSelect)
        void writeClipboardText(text).catch(current.current.onError);
    });
    let columns = term.cols,
      rows = term.rows;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          disposed ||
          !host.current?.clientHeight ||
          !host.current.clientWidth
        )
          return;
        addon.fit();
        if (columns !== term.cols || rows !== term.rows) {
          columns = term.cols;
          rows = term.rows;
          send("pseudoTerminalResize", { dimensions: { columns, rows } });
        }
      });
    };
    fit.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(host.current);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("devyy-extension-event", listener);
      input.dispose();
      selected.dispose();
      fit.current = () => {};
      terminal.current = null;
      term.element?.remove();
      setTimeout(() => term.dispose(), 0);
    };
  }, [id]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    term.options.fontSize = settings.terminalFontSize;
    term.options.scrollback = settings.terminalScrollback;
    term.options.lineHeight = settings.terminalLineHeight;
    term.options.cursorStyle = settings.terminalCursorStyle;
    term.options.cursorBlink =
      settings.cursorBlink && !settings.reduceMotion && !reducedMotion;
    term.options.theme = terminalTheme(settings.theme);
    fit.current();
  }, [
    settings.terminalFontSize,
    settings.terminalScrollback,
    settings.terminalLineHeight,
    settings.terminalCursorStyle,
    settings.cursorBlink,
    settings.reduceMotion,
    settings.theme,
    reducedMotion,
  ]);
  return (
    <div className="terminal-content">
      <div className="xterm-host" ref={host} />
    </div>
  );
});
