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
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, SplitSquareHorizontal, X } from "lucide-react";
import PseudoTerminal from "./PseudoTerminal";
import { registerAIContext, writeAIContextDrag } from "../lib/aiContext";
import Terminal, { type TerminalHandle } from "./Terminal";
import { useContextMenu } from "./ContextMenu";
import ResizeHandle from "./ResizeHandle";
import SplitTabGroup from "./SplitTabGroup";
import {
  groupedTabs,
  moveTabGroup,
  pairTabs,
  separateTab,
  type SplitGroup,
} from "../lib/splitGroups";
import {
  useTerminalProfiles,
  refreshTerminalProfiles,
} from "../lib/terminalProfiles";
import { native, invoke } from "../lib/native";
import {
  hostRequest,
  subscribeExtensionTerminals,
  type HostEvent,
} from "../lib/extensionHost";
interface Session {
  key: number;
  name: string;
  profile: string;
  extensionId?: string;
  options?: Record<string, unknown>;
}
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
    themeColors?: Record<string, string>;
    preview?: boolean;
    root: string;
    settings: Settings;
    onReady: (id: number | null) => void;
    onError: (e: unknown) => void;
    onOpen: () => void;
  }
>(function TerminalGroup(
  {
    root,
    settings,
    onReady,
    onError,
    onOpen,
    toolbarHost,
    themeColors,
    preview,
  },
  ref,
) {
  const [sessions, setSessions] = useState<Session[]>([
    { key: 1, name: "Terminal 1", profile: settings.terminalProfile },
  ]);
  const [active, setActive] = useState(1),
    [splits, setSplits] = useState<SplitGroup<number>[]>([]),
    [renaming, setRenaming] = useState<number | null>(null),
    [ratios, setRatios] = useState<Record<string, number>>({});
  const split = splits.find(
    (group) =>
      group.includes(active) &&
      group.every((key) => sessions.some((session) => session.key === key)),
  );
  const ratioKey = split?.join(":") ?? "";
  const ratio = ratios[ratioKey] ?? 50;
  const setRatio = (value: number) =>
    setRatios((old) => ({ ...old, [ratioKey]: value }));
  const closeSession = useRef<
    (key: number, exitCode?: number, reason?: number) => void
  >(() => {});
  const sequence = useRef(1),
    handles = useRef(new Map<number, TerminalHandle>()),
    ids = useRef(new Map<number, number | null>()),
    host = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSession = useRef(active);
  activeSession.current = active;
  const draggedSession = useRef<number | null>(null);
  useEffect(
    () =>
      registerAIContext(
        "terminals",
        sessions.map((session) => ({
          kind: "terminal" as const,
          id: `${root}:${session.key}`,
          title: session.name,
          description: splits.some((group) => group.includes(session.key))
            ? "Split terminal"
            : "Terminal",
          read: () => {
            const content = handles.current.get(session.key)?.snapshot() ?? "";
            if (!content.trim())
              throw new Error(`${session.name} has no output yet.`);
            return {
              kind: "terminal" as const,
              id: `${root}:${session.key}`,
              title: session.name,
              content,
            };
          },
        })),
      ),
    [sessions, splits, root],
  );
  function selectSession(key: number) {
    activeSession.current = key;
    setActive(key);
  }
  function updateSessions(next: Session[]) {
    sessionsRef.current = next;
    setSessions(next);
  }
  const extensionInput = useRef(new Map<string, string[]>());
  const extensionCallbacks = useRef({ onOpen, onError });
  extensionCallbacks.current = { onOpen, onError };
  useEffect(() => {
    const event = (message: HostEvent) => {
      const p = message.payload;
      const id = String(p.id);
      if (message.event === "terminalCreate") {
        const options = p.options as Record<string, unknown>;
        const session: Session = {
          key: ++sequence.current,
          name: String(options.name ?? "Extension terminal"),
          profile: "",
          extensionId: id,
          options,
        };
        updateSessions([...sessionsRef.current, session]);
      } else {
        const session = sessionsRef.current.find((s) => s.extensionId === id);
        if (!session) return;
        if (message.event === "terminalInput") {
          const terminal = ids.current.get(session.key);
          if (terminal)
            void invoke("terminal_write", {
              id: terminal,
              data: String(p.text),
            }).catch(extensionCallbacks.current.onError);
          else
            extensionInput.current.set(id, [
              ...(extensionInput.current.get(id) ?? []),
              String(p.text),
            ]);
        } else if (message.event === "terminalName") {
          updateSessions(
            sessionsRef.current.map((item) =>
              item.key === session.key
                ? { ...item, name: String(p.name) }
                : item,
            ),
          );
        } else if (message.event === "terminalShow") {
          selectSession(session.key);
          extensionCallbacks.current.onOpen();
        } else if (message.event === "terminalClose") {
          closeSession.current(
            session.key,
            typeof p.exitCode === "number" ? p.exitCode : undefined,
            2,
          );
        }
      }
    };
    const reset = () =>
      updateSessions(
        sessionsRef.current.filter((session) => !session.extensionId),
      );
    const stop = subscribeExtensionTerminals(event);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      stop();
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  const shells = useTerminalProfiles();
  const openMenu = useContextMenu(),
    cb = useRef(onReady);
  cb.current = onReady;
  useEffect(() => {
    cb.current(ids.current.get(active) ?? null);
    if (native && sessionsRef.current.some((session) => session.extensionId))
      void hostRequest("terminalState", {
        id: sessionsRef.current.find((session) => session.key === active)
          ?.extensionId,
        active: true,
      }).catch(() => {});
    document
      .getElementById(`terminal-session-${active}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  useEffect(() => {
    if (!sessions.some((session) => session.key === active))
      selectSession(sessions.at(-1)?.key ?? 0);
    setSplits((groups) =>
      groups.every((group) =>
        group.every((key) => sessions.some((session) => session.key === key)),
      )
        ? groups
        : groups.filter((group) =>
            group.every((key) =>
              sessions.some((session) => session.key === key),
            ),
          ),
    );
  }, [sessions, active]);
  function create(
    inSplit = false,
    source = activeSession.current,
    profile = settings.terminalProfile,
  ) {
    const key = ++sequence.current;
    updateSessions([
      ...sessionsRef.current,
      { key, name: `Terminal ${key}`, profile },
    ]);
    if (inSplit && source) {
      setSplits((groups) => pairTabs(groups, source, key));
    }
    selectSession(key);
  }
  function close(key = activeSession.current, exitCode?: number, reason = 3) {
    const all = sessionsRef.current;
    const session = all.find((s) => s.key === key);
    if (!session) return;
    if (session.extensionId)
      void hostRequest("terminalState", {
        id: session.extensionId,
        closed: true,
        exitCode,
        reason,
      }).catch(() => {});
    const rest = all.filter((s) => s.key !== key);
    updateSessions(rest);
    ids.current.delete(key);
    handles.current.delete(key);
    const partner = splits
      .find((group) => group.includes(key))
      ?.find((member) => member !== key);
    setSplits((groups) => separateTab(groups, key));
    if (session?.extensionId)
      extensionInput.current.delete(session.extensionId);
    if (activeSession.current === key)
      selectSession(
        partner && rest.some((session) => session.key === partner)
          ? partner
          : (rest.at(-1)?.key ?? 0),
      );
    if (!rest.length) cb.current(null);
  }
  closeSession.current = close;
  const sessionGroups = groupedTabs(sessions, (session) => session.key, splits);
  const sessionOrder = sessionGroups.flat();
  function cycle(delta: number) {
    const i = sessionOrder.findIndex((s) => s.key === activeSession.current);
    const key =
      sessionOrder[(i + delta + sessionOrder.length) % sessionOrder.length]
        ?.key ?? 0;
    selectSession(key);
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
      if (
        !sessions.length ||
        sessions.find((session) => session.key === active)?.options
          ?.pseudoterminal
      )
        create();
      else handles.current.get(active)?.ensure();
    },
  }));
  function renderSession(s: Session, pane?: number) {
    return (
      <div
        key={s.key}
        className={`terminal-session ${active === s.key ? "active" : ""}`}
        draggable={renaming !== s.key}
        onDragStart={(event) => {
          draggedSession.current = s.key;
          writeAIContextDrag(event.dataTransfer, [
            { kind: "terminal", id: `${root}:${s.key}` },
          ]);
          event.dataTransfer.setData("text/plain", String(s.key));
        }}
        onDragEnd={() => {
          draggedSession.current = null;
        }}
        onDragOver={(event) => {
          if (draggedSession.current !== null) event.preventDefault();
        }}
        onDrop={(event) => {
          const from = draggedSession.current;
          if (from === null) return;
          event.preventDefault();
          updateSessions(
            moveTabGroup(
              sessionsRef.current,
              (session) => session.key,
              splits,
              from,
              s.key,
            ),
          );
          draggedSession.current = null;
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            close(s.key);
          }
        }}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: "New terminal", action: () => create() },
            { label: "Split terminal", action: () => create(true, s.key) },
            ...(active !== s.key
              ? [
                  {
                    label: "Open in split terminal",
                    action: () => {
                      setSplits((groups) => pairTabs(groups, active, s.key));
                      selectSession(s.key);
                    },
                  },
                ]
              : []),
            ...(splits.some((group) => group.includes(s.key))
              ? [
                  {
                    label: "Separate split group",
                    action: () =>
                      setSplits((groups) => separateTab(groups, s.key)),
                  },
                ]
              : []),
            {
              label: "Rename terminal",
              separator: true,
              action: () => setRenaming(s.key),
            },
            {
              label: "Clear terminal",
              action: () => handles.current.get(s.key)?.clear(),
            },
            ...(!s.options?.pseudoterminal
              ? [
                  {
                    label: "Restart shell",
                    action: () => handles.current.get(s.key)?.restart(),
                  },
                ]
              : []),
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
            aria-label={s.name}
            aria-description={
              pane ? `Pane ${pane} of split terminal group` : undefined
            }
            id={`terminal-session-${s.key}`}
            aria-controls={`terminal-pane-${s.key}`}
            aria-selected={active === s.key}
            tabIndex={active === s.key ? 0 : -1}
            title={
              shells.profiles.find((p) => p.id === s.profile)?.name ||
              "System default shell"
            }
            onKeyDown={(e) => {
              const index = sessionOrder.findIndex(
                (session) => session.key === s.key,
              );
              const nextIndex =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? sessionOrder.length - 1
                    : e.key === "ArrowRight"
                      ? (index + 1) % sessionOrder.length
                      : e.key === "ArrowLeft"
                        ? (index - 1 + sessionOrder.length) %
                          sessionOrder.length
                        : -1;
              if (nextIndex < 0) return;
              e.preventDefault();
              selectSession(sessionOrder[nextIndex].key);
              const buttons = e.currentTarget
                .closest(".terminal-sessionbar")
                ?.querySelectorAll<HTMLButtonElement>("[role=tab]");
              buttons?.[nextIndex]?.focus();
            }}
            onClick={() => {
              selectSession(s.key);
            }}
          >
            {pane && (
              <span className="pane-number" aria-hidden="true">
                {pane}
              </span>
            )}
            <span className="tab-label">{s.name}</span>
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
    );
  }
  const toolbar = (
    <div className="terminal-toolbar">
      <div
        className="terminal-sessionbar"
        role="tablist"
        aria-label="Terminal sessions"
      >
        {sessionGroups.map((group) =>
          group.length === 2 ? (
            <SplitTabGroup
              key={`split-${group[0].key}`}
              kind="terminal"
              onDragStart={(event) => {
                draggedSession.current = group[0].key;
                event.dataTransfer.setData("text/plain", String(group[0].key));
                writeAIContextDrag(
                  event.dataTransfer,
                  group.map((session) => ({
                    kind: "terminal",
                    id: `${root}:${session.key}`,
                  })),
                );
              }}
              onDragEnd={() => {
                draggedSession.current = null;
              }}
              active={group.some((session) => session.key === active)}
              onSeparate={() =>
                setSplits((groups) => separateTab(groups, group[0].key))
              }
            >
              {renderSession(group[0], 1)}
              {renderSession(group[1], 2)}
            </SplitTabGroup>
          ) : (
            renderSession(group[0])
          ),
        )}
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
                  label: p.name + (p.isDefault ? " (default)" : ""),
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
            onFocusCapture={() => selectSession(s.key)}
            onContextMenu={(e) =>
              openMenu(e, [
                {
                  label: "Copy selection",
                  action: () => {
                    const text = handles.current.get(s.key)?.selection();
                    if (text) void writeClipboardText(text).catch(onError);
                  },
                },
                {
                  label: "Paste",
                  action: () => {
                    void readClipboardText()
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
                ...(!s.options?.pseudoterminal
                  ? [
                      {
                        label: "Restart shell",
                        action: () => handles.current.get(s.key)?.restart(),
                      },
                    ]
                  : []),
                {
                  label: "Close terminal",
                  separator: true,
                  danger: true,
                  action: () => close(s.key),
                },
              ])
            }
          >
            {split?.includes(s.key) && (
              <div
                className="terminal-pane-heading"
                draggable
                onDragStart={(event) => {
                  event.stopPropagation();
                  writeAIContextDrag(event.dataTransfer, [
                    { kind: "terminal", id: `${root}:${s.key}` },
                  ]);
                }}
              >
                <span className="pane-number">{split.indexOf(s.key) + 1}</span>
                <span className="tab-label">{s.name}</span>
              </div>
            )}
            {s.options?.pseudoterminal && s.extensionId ? (
              <PseudoTerminal
                ref={(handle) => {
                  if (handle) handles.current.set(s.key, handle);
                  else handles.current.delete(s.key);
                }}
                id={s.extensionId}
                settings={settings}
                onError={onError}
              />
            ) : (
              <Terminal
                ref={(handle) => {
                  if (handle) handles.current.set(s.key, handle);
                  else handles.current.delete(s.key);
                }}
                root={root}
                extensionOptions={s.options}
                profile={s.profile}
                lineHeight={settings.terminalLineHeight}
                cursorStyle={settings.terminalCursorStyle}
                copyOnSelect={settings.terminalCopyOnSelect}
                theme={settings.theme}
                colors={themeColors}
                preview={preview}
                fontSize={settings.terminalFontSize}
                scrollback={settings.terminalScrollback}
                cursorBlink={settings.cursorBlink && !settings.reduceMotion}
                onOpen={onOpen}
                onError={onError}
                onExit={() => {
                  if (s.extensionId)
                    void hostRequest("terminalState", {
                      id: s.extensionId,
                      closed: true,
                      reason: 2,
                    }).catch(() => {});
                }}
                onReady={(id) => {
                  ids.current.set(s.key, id);
                  if (s.extensionId) {
                    if (id) {
                      for (const data of extensionInput.current.get(
                        s.extensionId,
                      ) ?? [])
                        void invoke("terminal_write", { id, data }).catch(
                          onError,
                        );
                      extensionInput.current.delete(s.extensionId);
                      void invoke<number | null>("terminal_pid", { id })
                        .then((pid) =>
                          hostRequest("terminalState", {
                            id: s.extensionId,
                            pid,
                          }),
                        )
                        .catch(onError);
                    }
                  }
                  if (s.key === active) cb.current(id);
                }}
              />
            )}
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
