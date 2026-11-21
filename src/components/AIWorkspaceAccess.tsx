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

import ErrorToast from "./ui/ErrorToast";
import { AnimatePresence } from "motion/react";
import ModalBackdrop from "./ui/ModalBackdrop";
import * as Popover from "@radix-ui/react-popover";
import type { AIAgentMode } from "../lib/ai";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ShieldCheck, X } from "lucide-react";
import { invoke, native } from "../lib/native";
const modes = { agent: "Agent", ask: "Ask", plan: "Plan", review: "Review" };
const permissions = { attached: "Attachments only", read: "Read workspace", full: "Full workspace" };

export default function AIWorkspaceAccess({ root, agentMode, running, onAgentModeChange }: {
  root?: string;
  agentMode: AIAgentMode;
  running: boolean;
  onAgentModeChange: (mode: AIAgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState("attached"),
    [pending, setPending] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const previous = useRef<HTMLElement | null>(null),
    dialog = useRef<HTMLDivElement>(null);
  const owner = useRef(root);
  owner.current = root;
  useEffect(() => {
    let current = true;
    setMode("attached");
    setBusy(false);
    setPending(undefined);
    setError("");
    if (root && native)
      void invoke<string>("ai_workspace_access", { root, mode: null })
        .then((value) => {
          if (current && ["attached", "read", "full"].includes(value))
            setMode(value);
        })
        .catch((e) => {
          if (current) setError(String(e));
        });
    return () => {
      current = false;
    };
  }, [root]);
  useEffect(() => {
    if (!pending) return;
    previous.current = trigger.current;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, [pending]);
  async function grant(next: string) {
    if (!root) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<string>("ai_workspace_access", {
        root,
        mode: next,
      });
      if (owner.current !== root) return;
      setMode(result ?? next);
      setPending(undefined);
    } catch (e) {
      if (owner.current === root) setError(String(e));
    } finally {
      if (owner.current === root) setBusy(false);
    }
  }
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger ref={trigger} className="agent-options-trigger"
          aria-label={`Agent options: ${modes[agentMode]}, ${permissions[mode as keyof typeof permissions] ?? permissions.attached}`}>
          <span>{modes[agentMode]}</span>
          <span className="agent-access-summary"><ShieldCheck size={13} />{permissions[mode as keyof typeof permissions] ?? permissions.attached}</span>
          <ChevronDown size={12} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="agent-options-popover" aria-label="Agent options"
            side="top" align="end" sideOffset={6} collisionPadding={12} data-escape-scope="active"
            onCloseAutoFocus={(event) => { if (pending) event.preventDefault(); }}>
            <label>
              Mode
              <select aria-label="Agent mode" value={agentMode} disabled={running}
                onChange={(event) => onAgentModeChange(event.target.value as AIAgentMode)}>
                {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Workspace permissions
              <select aria-label="Agent workspace access" value={mode} disabled={!root || !native || busy}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === "attached") void grant(next);
                  else {
                    setOpen(false);
                    setPending(next);
                  }
                }}>
                {Object.entries(permissions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {createPortal(
        <AnimatePresence>
          {pending && (
            <ModalBackdrop
              key="workspace-access"
              className="ai-modal-backdrop"
              onMouseDown={(e) => {
                if (e.currentTarget === e.target && !busy)
                  setPending(undefined);
              }}
            >
              <div
                ref={dialog}
                className="ai-access-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Workspace access"
                data-escape-scope="active"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !busy) {
                    e.preventDefault();
                    e.stopPropagation();
                    setPending(undefined);
                  }
                  if (e.key === "Tab") {
                    const buttons = Array.from(
                      dialog.current?.querySelectorAll<HTMLElement>(
                        "button:not(:disabled)",
                      ) ?? [],
                    );
                    if (e.shiftKey && document.activeElement === buttons[0]) {
                      e.preventDefault();
                      buttons.at(-1)?.focus();
                    } else if (
                      !e.shiftKey &&
                      document.activeElement === buttons.at(-1)
                    ) {
                      e.preventDefault();
                      buttons[0]?.focus();
                    }
                  }
                }}
              >
                <header>
                  <ShieldCheck size={20} />
                  <h2>
                    {pending === "full"
                      ? "Allow full workspace access?"
                      : "Allow workspace reading?"}
                  </h2>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label="Cancel workspace access"
                    onClick={() => setPending(undefined)}
                  >
                    <X size={17} />
                  </button>
                </header>
                <p>
                  {pending === "full"
                    ? "Devyy can read saved text files throughout this workspace, including ignored files, and propose changes for your review."
                    : "Devyy can list, search and read saved workspace text files. Common credential paths, such as .env and .ssh, require full workspace access."}
                </p>
                <code>{root}</code>
                <p>
                  File contents requested by the agent are sent to your selected
                  provider. Changes require diff review. Access lasts for this
                  Devyy session and can be revoked here.
                </p>
                {error && (
                  <ErrorToast message={error} />
                )}
                <footer>
                  <button
                    className="setting-action"
                    disabled={busy}
                    onClick={() => setPending(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void grant(pending)}
                  >
                    {busy
                      ? "Allowing…"
                      : pending === "full"
                        ? "Allow full workspace access"
                        : "Allow workspace reading"}
                  </button>
                </footer>
              </div>
            </ModalBackdrop>
          )}
        </AnimatePresence>,
        document.body,
      )}
      {error && !pending && (
        <ErrorToast message={error} />
      )}
    </>
  );
}
