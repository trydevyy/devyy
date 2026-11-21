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
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { type AIProposal } from "../lib/ai";
import { hasAIContextDrag } from "../lib/aiContext";
import DevyyLogo from "./DevyyLogo";
import AIProviderIcon from "./AIProviderIcon";
import {
  isAIExtension,
  aiMainView,
  canonicalAIExtensionId,
} from "../lib/aiExtensions";
import { useExtensions } from "../lib/extensions";
import { hostRequest, useExtensionHost, type HostEvent } from "../lib/extensionHost";
import ResizeHandle from "./ResizeHandle";
import ExtensionWebviews from "./ExtensionWebviews";
import AIChatPanel from "./AIChatPanel";

export default function AIWorkspace({
  file,
  cwd,
  onSettings,
  onReview,
  onApproveAll,
  shortcuts = [],
  peekOnDrag = true,
}: {
  file?: { path: string; content: string; readOnly?: boolean };
  cwd?: string;
  onSettings: () => void;
  onReview: (
    path: string,
    original: string,
    modified: string,
    create?: boolean,
    proposalId?: string,
  ) => void;
  onApproveAll?: (proposals?: AIProposal[]) => void;
  shortcuts?: string[];
  peekOnDrag?: boolean;
}) {
  const installed = useExtensions(),
    host = useExtensionHost();
  const [open, setOpen] = useState(() =>
    new URLSearchParams(location.search).get("showcase") === "agent",
  ),
    [selection, setSelection] = useState("chat"),
    [width, setWidth] = useState(() => {
      try {
        return Math.max(
          320,
          Math.min(720, Number(localStorage.getItem("devyy.ai.width")) || 390),
        );
      } catch {
        return 390;
      }
    });
  const extensions = installed.filter((e) => e.enabled && isAIExtension(e.id));
  const containers = extensions.map((ext) => {
    const id = (canonicalAIExtensionId(ext.id) ?? ext.id).toLowerCase();
    return {
      id,
      extension: id,
      title: ext.name,
    };
  });
  const [viewError, setViewError] = useState("");
  const [viewRetry, setViewRetry] = useState(0);
  useEffect(() => {
    const id = aiMainView(selection);
    if (!open || !id) return;
    let disposed = false;
    setViewError("");
    void hostRequest("resolveView", { id }).catch((error) => {
      if (!disposed) setViewError(String(error));
    });
    return () => {
      disposed = true;
    };
  }, [selection, open, viewRetry]);
  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    window.addEventListener("devyy-ai-toggle", toggle);
    return () => window.removeEventListener("devyy-ai-toggle", toggle);
  }, []);
  const [focusTicket, setFocusTicket] = useState(0);
  const [dragPeek, setDragPeek] = useState(false);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("devyy-ai-visibility", { detail: open || dragPeek }),
    );
  }, [open, dragPeek]);

  const handledFocus = useRef(0);
  const known = useRef(new Set<string>());
  const aiWorkspaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!peekOnDrag) {
      setDragPeek(false);
      return;
    }
    const enter = (event: DragEvent) => {
      if (event.dataTransfer && hasAIContextDrag(event.dataTransfer))
        setDragPeek(true);
    };
    const end = () => setDragPeek(false);
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget && event.clientX <= 0 && event.clientY <= 0)
        setDragPeek(false);
    };
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragstart", enter);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragend", () => setDragPeek(false));
    window.addEventListener("drop", end, true);
    return () => {
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragstart", enter);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragend", () => setDragPeek(false));
      window.removeEventListener("drop", end, true);
    };
  }, [peekOnDrag]);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("devyy.ai.width", String(width));
    } catch {}
  }, [width]);
  useEffect(() => {
    const listener = (event: Event) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      const detail = (
        event as CustomEvent<{ container?: string; extension?: string }>
      ).detail;
      if (detail?.container) {
        const canonical = canonicalAIExtensionId(detail.container);
        if (canonical) {
          setSelection(canonical);
        } else {
          const matched = extensions.find((ext) => {
            const views = ext.contributes.views ?? {};
            return (
              Object.keys(views).some(
                (k) => k.toLowerCase() === detail.container!.toLowerCase(),
              ) ||
              Object.values(views)
                .flat()
                .some(
                  (v) => v.id.toLowerCase() === detail.container!.toLowerCase(),
                )
            );
          });
          setSelection(
            matched
              ? (canonicalAIExtensionId(matched.id) ?? matched.id).toLowerCase()
              : detail.container.toLowerCase(),
          );
        }
      } else if (detail?.extension) {
        const canonical = (
          canonicalAIExtensionId(detail.extension) ?? detail.extension
        ).toLowerCase();
        setSelection(canonical);
      } else setSelection("chat");
      setOpen(true);
      if (!detail?.container && !detail?.extension)
        setFocusTicket((ticket) => ticket + 1);
    };
    window.addEventListener("devyy-ai-open", listener);
    return () => window.removeEventListener("devyy-ai-open", listener);
  }, [containers.map((c) => `${c.id}:${c.extension}`).join("|")]);
  useEffect(() => {
    if (!open || selection !== "chat" || handledFocus.current === focusTicket)
      return;
    handledFocus.current = focusTicket;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(".ai-workspace textarea")
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, selection, focusTicket]);
  useEffect(() => {
    const views = host.webviews.filter((v) => v.id === aiMainView(v.extension));
    const created = views.find((v) => !known.current.has(v.id));
    known.current = new Set(views.map((v) => v.id));
    if (created) {
      const canonical = (
        canonicalAIExtensionId(created.extension) ??
        canonicalAIExtensionId(created.id) ??
        created.extension
      ).toLowerCase();
      setSelection(canonical);
      setOpen(true);
    }
  }, [
    host.webviews,
    containers.map((c) => `${c.id}:${c.extension}`).join("|"),
  ]);
  useEffect(() => {
    const focus = (event: Event) => {
      const e = (event as CustomEvent<HostEvent>).detail;
      if (e.event !== "focusWebview") return;
      const view = host.webviews.find(
        (v) => v.id.toLowerCase() === String(e.payload.id).toLowerCase(),
      );
      if (view && isAIExtension(view.extension)) {
        const canonical = (
          canonicalAIExtensionId(view.extension) ??
          canonicalAIExtensionId(view.id) ??
          view.extension
        ).toLowerCase();
        setSelection(canonical);
        setOpen(true);
      }
    };
    window.addEventListener("devyy-extension-event", focus);
    return () => window.removeEventListener("devyy-extension-event", focus);
  }, [
    host.webviews,
    containers.map((c) => `${c.id}:${c.extension}`).join("|"),
  ]);
  const selectedOwner =
    containers.find((c) => c.id === selection)?.extension ?? selection;
  const tabs = extensions.map((e) => {
    const canonical = (canonicalAIExtensionId(e.id) ?? e.id).toLowerCase();
    return {
      id: canonical,
      title: canonical === "openai.chatgpt" ? "Codex" : "Claude",
    };
  });
  return (
    <aside
      ref={aiWorkspaceRef}
      aria-label="AI assistant"
      className={`ai-workspace ${!open && !dragPeek ? "ai-workspace-hidden" : ""}`}
      aria-hidden={!open && !dragPeek}
      inert={!open && !dragPeek}
      style={{ width: open || dragPeek ? width : 0 }}
      onDragEnter={() => {
        if (peekOnDrag) setSelection("chat");
      }}
    >
      <ResizeHandle
        label="Resize AI sidebar"
        reverse
        value={width}
        min={320}
        max={Math.min(760, Math.max(320, window.innerWidth - 440))}
        onChange={setWidth}
        onReset={() => setWidth(390)}
      />
      <header className="ai-workspace-heading">
        <div
          role="tablist"
          aria-label="AI workspace views"
          onKeyDown={(event) => {
            const ids = ["chat", ...tabs.map((tab) => tab.id)];
            const current = ids.indexOf(selection);
            const next =
              event.key === "ArrowRight"
                ? (current + 1) % ids.length
                : event.key === "ArrowLeft"
                  ? (current - 1 + ids.length) % ids.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? ids.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            setSelection(ids[next]);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          <button
            role="tab"
            className={selection === "chat" ? "active" : ""}
            aria-selected={selection === "chat"}
            aria-controls="devyy-ai-chat"
            tabIndex={selection === "chat" ? 0 : -1}
            onClick={() => setSelection("chat")}
          >
            <DevyyLogo size={14} /> Devyy
          </button>
          {tabs.map((tab) => {
            const isSelected = selection.toLowerCase() === tab.id.toLowerCase();
            return (
              <button
                key={tab.id}
                role="tab"
                className={isSelected ? "active" : ""}
                aria-selected={isSelected}
                aria-controls="devyy-ai-extensions"
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelection(tab.id)}
              >
                <AIProviderIcon
                  kind={tab.title === "Codex" ? "codex" : "claude"}
                  size={13}
                />
                {tab.title}
              </button>
            );
          })}
        </div>
        <button
          className="icon-button"
          aria-label="Close AI sidebar"
          onClick={() => {
            setOpen(false);
            returnFocus.current?.focus();
          }}
        >
          <X size={15} />
        </button>
      </header>
      <div
        id="devyy-ai-chat"
        role="tabpanel"
        aria-label="Devyy chat"
        className="ai-native-region"
        hidden={selection !== "chat"}
      >
        <AIChatPanel
          file={file}
          cwd={cwd}
          onSettings={onSettings}
          onReview={onReview}
          onApproveAll={onApproveAll}
          visible={(open || dragPeek) && selection === "chat"}
        />
      </div>
      <div
        id="devyy-ai-extensions"
        role="tabpanel"
        aria-label="Extension conversation"
        className="ai-extension-region"
        hidden={selection === "chat"}
      >
        {viewError && (
          <div className="extension-view-note">
            <ErrorToast message={viewError} />
            <p>Could not open this extension view.</p>
            <button
              className="setting-action"
              onClick={() => setViewRetry((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        )}
        <ExtensionWebviews
          visible={open && selection !== "chat"}
          placement="ai"
          owner={selectedOwner}
          shortcuts={shortcuts}
        />
      </div>
    </aside>
  );
}
