import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, SplitSquareHorizontal, X } from "lucide-react";
import Terminal, { type TerminalHandle } from "./Terminal";
import { useContextMenu } from "./ContextMenu";
import ResizeHandle from "./ResizeHandle";
import {
  useTerminalProfiles,
  refreshTerminalProfiles,
} from "../lib/terminalProfiles";
import { native } from "../lib/native";
import type { Settings } from "../lib/types";
export interface TerminalsHandle {
  create: () => void;
  split: () => void;
  close: () => void;
  next: (delta: number) => void;
  clear: () => void;
  focus: () => void;
  rename: () => void;
  ensure: () => void;
}
export default forwardRef<
  TerminalsHandle,
  {
    toolbarHost: HTMLElement | null;
    root: string;
    settings: Settings;
    onReady: (id: number | null) => void;
    onError: (e: unknown) => void;
    onOpen: () => void;
  }
>(function TerminalGroup(
  { root, settings, onReady, onError, onOpen, toolbarHost },
  ref,
) {
  const [sessions, setSessions] = useState([
    { key: 1, name: "Terminal 1", profile: settings.terminalProfile },
  ]);
  const [active, setActive] = useState(1),
    [split, setSplit] = useState<[number, number] | null>(null),
    [renaming, setRenaming] = useState<number | null>(null),
    [ratio, setRatio] = useState(50);
  const sequence = useRef(1),
    handles = useRef(new Map<number, TerminalHandle>()),
    ids = useRef(new Map<number, number | null>()),
    host = useRef<HTMLDivElement>(null);
  const shells = useTerminalProfiles();
  const openMenu = useContextMenu(),
    cb = useRef(onReady);
  cb.current = onReady;
  useEffect(() => {
    cb.current(ids.current.get(active) ?? null);
  }, [active]);
  function create(
    inSplit = false,
    source = active,
    profile = settings.terminalProfile,
  ) {
    const key = ++sequence.current;
    setSessions((s) => [...s, { key, name: `Terminal ${key}`, profile }]);
    if (inSplit && source) {
      setSplit([source, key]);
    } else setSplit(null);
    setActive(key);
  }
  function close(key = active) {
    const rest = sessions.filter((s) => s.key !== key);
    setSessions(rest);
    ids.current.delete(key);
    handles.current.delete(key);
    if (split?.includes(key)) setSplit(null);
    if (active === key) setActive(rest.at(-1)?.key ?? 0);
    if (!rest.length) cb.current(null);
  }
  function cycle(delta: number) {
    const i = sessions.findIndex((s) => s.key === active);
    const key =
      sessions[(i + delta + sessions.length) % sessions.length]?.key ?? 0;
    setActive(key);
    if (split && !split.includes(key)) setSplit(null);
  }
  useImperativeHandle(ref, () => ({
    create: () => create(),
    split: () => create(true),
    close: () => close(),
    next: cycle,
    clear: () => handles.current.get(active)?.clear(),
    focus: () => handles.current.get(active)?.focus(),
    rename: () => setRenaming(active),
    ensure: () => {
      if (!sessions.length) create();
      else handles.current.get(active)?.ensure();
    },
  }));
  const toolbar = (
    <div className="terminal-toolbar">
      <div
        className="terminal-sessionbar"
        role="tablist"
        aria-label="Terminal sessions"
      >
        {sessions.map((s) => (
          <div
            key={s.key}
            className={`terminal-session ${active === s.key ? "active" : ""}`}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "New terminal", action: () => create() },
                { label: "Split terminal", action: () => create(true, s.key) },
                {
                  label: "Rename terminal",
                  separator: true,
                  action: () => setRenaming(s.key),
                },
                {
                  label: "Clear terminal",
                  action: () => handles.current.get(s.key)?.clear(),
                },
                {
                  label: "Restart shell",
                  action: () => handles.current.get(s.key)?.restart(),
                },
                {
                  label: "Close terminal",
                  separator: true,
                  danger: true,
                  action: () => close(s.key),
                },
              ])
            }
          >
            {renaming === s.key ? (
              <input
                autoFocus
                aria-label="Terminal name"
                defaultValue={s.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name)
                    setSessions((all) =>
                      all.map((x) => (x.key === s.key ? { ...x, name } : x)),
                    );
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                role="tab"
                id={`terminal-session-${s.key}`}
                aria-controls={`terminal-pane-${s.key}`}
                aria-selected={active === s.key}
                tabIndex={active === s.key ? 0 : -1}
                title={
                  shells.profiles.find((p) => p.id === s.profile)?.name ||
                  "System default shell"
                }
                onKeyDown={(e) => {
                  const delta =
                    e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!delta) return;
                  e.preventDefault();
                  cycle(delta);
                  const buttons = e.currentTarget
                    .closest(".terminal-sessionbar")
                    ?.querySelectorAll<HTMLButtonElement>("[role=tab]");
                  const index = sessions.findIndex((x) => x.key === s.key);
                  buttons?.[
                    (index + delta + sessions.length) % sessions.length
                  ]?.focus();
                }}
                onClick={() => {
                  setActive(s.key);
                  if (split && !split.includes(s.key)) setSplit(null);
                }}
              >
                {s.name}
              </button>
            )}
            <button
              className="terminal-session-close"
              aria-label={`Close ${s.name}`}
              onClick={() => close(s.key)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="terminal-tools">
        <button
          className="icon-button"
          aria-label="New terminal"
          title="New terminal"
          onClick={() => create()}
        >
          <Plus size={13} />
        </button>
        <button
          className="icon-button shell-profile-button"
          aria-label="Choose terminal profile"
          title="New terminal with profile"
          aria-haspopup="menu"
          disabled={!native || shells.loading}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openMenu(
              {
                ...e,
                clientX: rect.left,
                clientY: rect.bottom + 6,
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation(),
              },
              [
                { label: "New terminal with…", disabled: true },
                {
                  label: "System default",
                  action: () => create(false, active, ""),
                },
                ...shells.profiles.map((p) => ({
                  label: p.name + (p.isDefault ? " · default" : ""),
                  action: () => create(false, active, p.id),
                })),
                ...(shells.error
                  ? [{ label: "Could not discover shells", disabled: true }]
                  : []),
                {
                  label: "Refresh installed shells",
                  separator: true,
                  action: () => void refreshTerminalProfiles(),
                },
              ],
            );
          }}
        >
          <ChevronDown size={12} />
        </button>
        <button
          className="icon-button"
          aria-label="Split terminal"
          title="Split terminal"
          onClick={() => create(true)}
        >
          <SplitSquareHorizontal size={13} />
        </button>
      </div>
    </div>
  );
  return (
    <div className="terminal-group" ref={host}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
      <div className="terminal-panes">
        {sessions.map((s) => (
          <div
            key={s.key}
            id={`terminal-pane-${s.key}`}
            role="tabpanel"
            aria-labelledby={`terminal-session-${s.key}`}
            className={`terminal-instance ${(split ? split.includes(s.key) : s.key === active) ? "visible" : ""}`}
            style={
              split
                ? {
                    width: `${s.key === split[0] ? ratio : 100 - ratio}%`,
                    flex: "none",
                    order: s.key === split[0] ? 0 : 2,
                  }
                : undefined
            }
            onFocusCapture={() => setActive(s.key)}
            onContextMenu={(e) =>
              openMenu(e, [
                {
                  label: "Copy selection",
                  action: () => {
                    const text = handles.current.get(s.key)?.selection();
                    if (text)
                      void navigator.clipboard.writeText(text).catch(onError);
                  },
                },
                {
                  label: "Paste",
                  action: () => {
                    void navigator.clipboard
                      .readText()
                      .then((text) => handles.current.get(s.key)?.paste(text))
                      .catch(onError);
                  },
                },
                {
                  label: "Clear terminal",
                  separator: true,
                  action: () => handles.current.get(s.key)?.clear(),
                },
                { label: "New terminal", action: () => create() },
                { label: "Split terminal", action: () => create(true, s.key) },
                {
                  label: "Restart shell",
                  action: () => handles.current.get(s.key)?.restart(),
                },
                {
                  label: "Close terminal",
                  separator: true,
                  danger: true,
                  action: () => close(s.key),
                },
              ])
            }
          >
            <Terminal
              ref={(handle) => {
                if (handle) handles.current.set(s.key, handle);
                else handles.current.delete(s.key);
              }}
              root={root}
              profile={s.profile}
              lineHeight={settings.terminalLineHeight}
              cursorStyle={settings.terminalCursorStyle}
              copyOnSelect={settings.terminalCopyOnSelect}
              theme={settings.theme}
              fontSize={settings.terminalFontSize}
              scrollback={settings.terminalScrollback}
              cursorBlink={settings.cursorBlink && !settings.reduceMotion}
              onOpen={onOpen}
              onError={onError}
              onReady={(id) => {
                ids.current.set(s.key, id);
                if (s.key === active) cb.current(id);
              }}
            />
          </div>
        ))}
        {split && (
          <div className="terminal-divider" style={{ left: `${ratio}%` }}>
            <ResizeHandle
              label="Resize terminal split"
              value={ratio}
              min={20}
              max={80}
              onChange={setRatio}
              onReset={() => setRatio(50)}
              percentOf={() => host.current?.clientWidth ?? 1}
            />
          </div>
        )}
        {!sessions.length && (
          <div className="terminal-empty">
            <span>No active terminals</span>
            <button onClick={() => create()}>
              <Plus size={14} /> New terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
