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
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence } from "motion/react";
import AIThinking from "./AIThinking";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FilePlus2,
  GitBranch,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  X,
  ChartNoAxesColumn,
  Search,
  MessageSquare,
  Sparkles,
  CheckCheck,
  Bot,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import {
  chooseAIModel,
  deleteAIChat,
  editAIMessage,
  forkAIChat,
  loadAI,
  newAIChat,
  renameAIChat,
  selectAIChat,
  sendAIMessage,
  stopAIChat,
  useAI,
  setAIProposalStatus,
  setAIMode,
  addAICheckpoint,
  type AIMessage,
  type AIProposal,
  type AIAgentMode,
} from "../lib/ai";
import {
  hasAIContextDrag,
  readAIContextDrag,
  resolveAIContext,
  mergeAttachments,
  messageAttachments,
  formatAttachmentLabel,
  MAX_ATTACHMENT_BYTES,
  type AIAttachment,
} from "../lib/aiContext";
import AIContextPicker, { AttachmentIcon } from "./AIContextPicker";
import AIModelPicker from "./AIModelPicker";
import AIWorkspaceAccess from "./AIWorkspaceAccess";
import AIUsage from "./AIUsage";
import { native, invoke } from "../lib/native";
import { useContextMenu } from "./ContextMenu";
import AISkillsView from "./AISkillsView";
import AISessionsView from "./AISessionsView";
import AIReviewView from "./AIReviewView";

const Reply = lazy(() => import("./AIReply"));

export default function AIChatPanel({
  file,
  cwd,
  onSettings,
  onReview,
  onApproveAll,
  visible,
}: {
  file?: { path: string; content: string; readOnly?: boolean };
  cwd?: string;
  visible: boolean;
  onSettings: () => void;
  onReview: (
    path: string,
    original: string,
    modified: string,
    create?: boolean,
    proposalId?: string,
  ) => void;
  onApproveAll?: (proposals?: AIProposal[]) => void;
}) {
  const ai = useAI();
  const openMenu = useContextMenu();
  const [providerId, setProviderId] = useState(() => {
    try {
      const saved = localStorage.getItem("devyy.ai.provider");
      if (saved === "codex")
        localStorage.setItem("devyy.ai.provider", "chatgpt");
      return saved && saved !== "codex" ? saved : "chatgpt";
    } catch {
      return "chatgpt";
    }
  });
  const [composerHeight, setComposerHeight] = useState<number | null>(() => {
    try {
      localStorage.removeItem("devyy.ai.composerHeight");
    } catch {}
    return null;
  });
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [screen, setScreen] = useState<"chat" | "skills" | "review">("chat");
  const [draft, setDraft] = useState(""),
    [attached, setAttached] = useState<AIAttachment[]>([]),
    [queuedMessages, setQueuedMessages] = useState<
      Array<{ id: string; content: string; attachments: AIAttachment[] }>
    >([]),
    [history, setHistory] = useState(false),
    [usage, setUsage] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [dragging, setDragging] = useState(false),
    [preview, setPreview] = useState<AIAttachment>(),
    [editing, setEditing] = useState<string>(),
    [renaming, setRenaming] = useState<string>(),
    [rename, setRename] = useState("");
  const attachedRef = useRef(attached);
  attachedRef.current = attached;
  const bottom = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    composer = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    dragDepth = useRef(0),
    previewRef = useRef<HTMLDivElement>(null);
  const chat = ai.conversations.find((c) => c.id === ai.selected),
    running = !!(chat && ai.active[chat.id]);
  const chosen = chat?.providerId ?? providerId,
    provider = ai.providers.find((p) => p.id === chosen);
  const choice = {
    model: chat?.model ?? ai.choices[chosen]?.model ?? provider?.model ?? "",
    effort: chat?.effort ?? ai.choices[chosen]?.effort ?? "",
  };
  const showcase = !native && new URLSearchParams(location.search).get("showcase") === "agent";
  const [showcaseMode, setShowcaseMode] = useState<AIAgentMode>("agent");
  const currentMode: AIAgentMode = showcase ? showcaseMode : chat?.mode ?? "agent";
  async function handleCreateCheckpoint() {
    if (!chat) return;
    try {
      const nowStr = new Date().toLocaleTimeString();
      const label = `Checkpoint ${nowStr}`;
      await invoke<string>("vcs_checkpoint", { name: label });
      addAICheckpoint(chat.id, label);
      setError("");
    } catch (err) {
      setError(`Checkpoint error: ${String(err)}`);
    }
  }
  const last = chat?.messages.at(-1);
  useEffect(() => {
    if (visible) void loadAI();
  }, [visible]);
  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [last?.content, last?.reasoning, last?.error, chat?.id, running]);
  useEffect(() => {
    const el = composer.current;
    if (el && !composerHeight) {
      if (!draft) {
        el.style.height = "";
      } else {
        el.style.height = "auto";
        el.style.height = `${Math.max(40, Math.min(220, el.scrollHeight))}px`;
      }
    }
  }, [draft, composerHeight]);
  useEffect(() => {
    const handleAttach = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.items) {
        add(detail.items);
      } else if (detail?.refs) {
        void resolveAIContext(detail.refs)
          .then(add)
          .catch((e) => setError(String(e)));
      }
    };
    const handleOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          draft?: string;
          items?: AIAttachment[];
          refs?: any[];
        }>
      ).detail;
      if (detail?.draft) {
        setDraft(detail.draft);
      }
      if (detail?.items) {
        add(detail.items);
      } else if (detail?.refs) {
        void resolveAIContext(detail.refs)
          .then(add)
          .catch((e) => setError(String(e)));
      }
      setTimeout(() => composer.current?.focus(), 60);
    };
    window.addEventListener("devyy-ai-attach", handleAttach);
    window.addEventListener("devyy-ai-open", handleOpen);
    return () => {
      window.removeEventListener("devyy-ai-attach", handleAttach);
      window.removeEventListener("devyy-ai-open", handleOpen);
    };
  }, []);
  const autoReviewed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!chat) return;
    for (const msg of chat.messages) {
      if (!msg.proposals?.length) continue;
      for (const proposal of msg.proposals) {
        if (!autoReviewed.current.has(proposal.id)) {
          autoReviewed.current.add(proposal.id);
          if (
            proposal.status !== "applied" &&
            proposal.status !== "dismissed"
          ) {
            setAIProposalStatus(proposal.id, "reviewed");
            onReview(
              proposal.path,
              proposal.original,
              proposal.modified,
              proposal.create,
              proposal.id,
            );
          }
        }
      }
    }
  }, [chat?.messages, onReview]);
  const prevRunning = useRef(running);
  useEffect(() => {
    if (prevRunning.current && !running && queuedMessages.length > 0) {
      const next = queuedMessages[0];
      setQueuedMessages((q) => q.slice(1));
      const targetChatId = chat?.id ?? newAIChat(chosen);
      void sendAIMessage(
        targetChatId,
        next.content,
        undefined,
        cwd,
        false,
        next.attachments,
      ).catch((err) => setError(String(err)));
    }
    prevRunning.current = running;
  }, [running, queuedMessages, chat?.id, chosen, cwd]);
  useEffect(() => {
    if (!preview) return;
    const previous = document.activeElement as HTMLElement | null;
    previewRef.current?.querySelector<HTMLElement>("button")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPreview(undefined);
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      previous?.isConnected && previous.focus();
    };
  }, [preview]);
  function add(items: AIAttachment[]) {
    try {
      const next = mergeAttachments(attachedRef.current, items);
      attachedRef.current = next;
      setAttached(next);
      setError("");
      setHistory(false);
    } catch (e) {
      setError(String(e));
    }
  }
  async function attachFiles(files: FileList | File[]) {
    try {
      const items: AIAttachment[] = [];
      for (const file of Array.from(files).slice(0, 32)) {
        if (file.size > MAX_ATTACHMENT_BYTES)
          throw new Error(
            `${file.name} exceeds 160 KB. Attach a smaller text file or a selection.`,
          );
        const content = await file.text();
        if (content.includes("\0") || /^(image|audio|video)\//.test(file.type))
          throw new Error(
            `${file.name} is binary. Attach a text file, code, or logs.`,
          );
        items.push({
          kind: "file",
          id: `device:${file.name}:${file.lastModified}`,
          title: file.name,
          path: file.name,
          content,
        });
      }
      add(items);
    } catch (e) {
      setError(String(e));
    }
  }
  async function drop(event: React.DragEvent) {
    if (
      !hasAIContextDrag(event.dataTransfer) &&
      !event.dataTransfer.files?.length
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    dragDepth.current = 0;
    try {
      const refs = readAIContextDrag(event.dataTransfer);
      if (refs.length) {
        add(await resolveAIContext(refs));
      } else if (event.dataTransfer.files.length) {
        await attachFiles(event.dataTransfer.files);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  function fresh() {
    newAIChat(chosen);
    setDraft("");
    setAttached([]);
    setEditing(undefined);
    setHistory(false);
    follow.current = true;
    composer.current?.focus();
  }
  async function send() {
    if (!draft.trim() && !attached.length) return;
    if (running) {
      const content = draft.trim() || "Review the attached context.";
      const items = [...attached];
      setQueuedMessages((q) => [
        ...q,
        { id: crypto.randomUUID(), content, attachments: items },
      ]);
      setDraft("");
      setAttached([]);
      setError("");
      return;
    }
    if (!provider || provider.enabled === false) {
      setError("Choose a model from an enabled provider.");
      return;
    }
    if (!native) {
      setError("Open the desktop app to connect a provider.");
      return;
    }
    const content = draft.trim() || "Review the attached context.",
      items = attached;
    const id = chat?.id ?? newAIChat(chosen);
    setDraft("");
    setAttached([]);
    setError("");
    setHistory(false);
    follow.current = true;
    try {
      if (editing) await editAIMessage(id, editing, content, items, cwd);
      else await sendAIMessage(id, content, undefined, cwd, false, items);
      setEditing(undefined);
    } catch (e) {
      setError(String(e));
      setDraft(content);
      setAttached(items);
    }
  }
  function handleComposerContextMenu(e: React.MouseEvent) {
    const el = composer.current;
    const hasSelection = el ? el.selectionStart !== el.selectionEnd : false;
    const hasText = !!draft.length;

    openMenu(e, [
      {
        label: "Cut",
        disabled: !hasSelection,
        action: () => {
          if (!el) return;
          const start = el.selectionStart;
          const end = el.selectionEnd;
          const selected = draft.slice(start, end);
          void navigator.clipboard.writeText(selected).then(() => {
            setDraft(draft.slice(0, start) + draft.slice(end));
            setTimeout(() => el.setSelectionRange(start, start), 0);
          });
        },
      },
      {
        label: "Copy",
        disabled: !hasSelection,
        action: () => {
          if (!el) return;
          const selected = draft.slice(el.selectionStart, el.selectionEnd);
          void navigator.clipboard.writeText(selected);
        },
      },
      {
        label: "Paste",
        action: () => {
          if (!el) return;
          void navigator.clipboard.readText().then((text) => {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = draft.slice(0, start) + text + draft.slice(end);
            setDraft(next);
            setTimeout(
              () =>
                el.setSelectionRange(start + text.length, start + text.length),
              0,
            );
          });
        },
      },
      {
        label: "Select all",
        separator: true,
        disabled: !hasText,
        shortcut: "⌘A",
        action: () => {
          el?.select();
        },
      },
      {
        label: "Clear",
        disabled: !hasText,
        action: () => {
          setDraft("");
          setAttached([]);
        },
      },
    ]);
  }
  function handleComposerResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.dataset.dragging = "true";
    const startY = e.clientY;
    const startHeight =
      composer.current?.getBoundingClientRect().height ??
      (composerHeight ?? 42);

    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(40, Math.min(380, Math.round(startHeight + delta)));
      setComposerHeight(next);
    };
    const onEnd = () => {
      delete handle.dataset.dragging;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }
  async function copyConversation() {
    if (!chat) return;
    try {
      await navigator.clipboard.writeText(
        chat.messages
          .map((m) => `${m.role === "user" ? "You" : "Devyy"}\n\n${m.content}`)
          .join("\n\n---\n\n"),
      );
    } catch {
      setError("Could not copy the conversation.");
    }
  }
  function startEdit(message: AIMessage) {
    setDraft(message.content);
    setAttached(messageAttachments(message));
    setEditing(message.id);
    composer.current?.focus();
  }
  return (
    <div
      className={`ai-chat-panel ${dragging ? "ai-drop-active" : ""}`}
      onDragEnter={(event) => {
        if (
          hasAIContextDrag(event.dataTransfer) ||
          event.dataTransfer.types.includes("Files")
        ) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (
          hasAIContextDrag(event.dataTransfer) ||
          event.dataTransfer.types.includes("Files")
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => void drop(event)}
    >
          <div className="ai-chat-toolbar">
            <Popover.Root open={sessionsOpen} onOpenChange={setSessionsOpen}>
              <Popover.Trigger className="ai-thread-title" title="Sessions">
                <span>{chat?.title ?? "New conversation"}</span>
                <ChevronDown size={12} />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="agent-sessions-popover" aria-label="Sessions"
                  align="start" sideOffset={6} collisionPadding={12} data-escape-scope="active">
                  <AISessionsView onSelectChat={(id) => {
                    selectAIChat(id);
                    setScreen("chat");
                    setSessionsOpen(false);
                  }} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <div className="agent-toolbar-actions">
              {screen !== "chat" && (
                <button className="icon-button" aria-label="Chat" title="Back to chat" onClick={() => setScreen("chat")}>
                  <MessageSquare size={15} />
                </button>
              )}
              <button className="icon-button" aria-label="Skills" title="Skills" aria-pressed={screen === "skills"}
                onClick={() => setScreen(screen === "skills" ? "chat" : "skills")}>
                <Sparkles size={15} />
              </button>
              <button className="icon-button" aria-label="Review" title="Review" aria-pressed={screen === "review"}
                onClick={() => setScreen(screen === "review" ? "chat" : "review")}>
                <CheckCheck size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="New AI conversation"
                title="New conversation"
                onClick={() => { fresh(); setScreen("chat"); }}
              >
                <Plus size={15} />
              </button>
              <details className="agent-thread-menu">
                <summary className="icon-button" aria-label="Conversation actions"><MoreHorizontal size={15} /></summary>
                <div>
                  <button onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    void handleCreateCheckpoint();
                  }}><Bookmark size={14} /> Save checkpoint</button>
                  <button aria-label="AI usage" onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setUsage(true);
                  }}><ChartNoAxesColumn size={14} /> Usage</button>
                </div>
              </details>
              <button
                className="icon-button"
                aria-label="AI provider settings"
                onClick={onSettings}
              >
                <Settings2 size={15} />
              </button>
            </div>
          </div>

      {screen === "skills" && <AISkillsView sessionId={chat?.id} />}
      {screen === "review" && <AIReviewView onReview={onReview} onApproveAll={onApproveAll} />}
      {screen === "chat" && (
        <>
      {history ? (
        <div className="ai-history">
          <div className="ai-history-search">
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search conversations"
              placeholder="Search conversations…"
            />
          </div>
          {ai.conversations
            .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
            .map((c) => (
              <div className={c.id === chat?.id ? "selected" : ""} key={c.id}>
                {renaming === c.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameAIChat(c.id, rename);
                      setRenaming(undefined);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Conversation title"
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenaming(undefined);
                      }}
                    />
                    <button
                      className="icon-button"
                      type="submit"
                      aria-label="Save conversation title"
                    >
                      <Check size={13} />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => {
                      selectAIChat(c.id);
                      setHistory(false);
                      setDraft("");
                      setAttached([]);
                      setEditing(undefined);
                      follow.current = true;
                    }}
                  >
                    <strong>{c.title}</strong>
                    <small>
                      {ai.providers.find((p) => p.id === c.providerId)?.name}{" "}
                      <time>{new Date(c.updatedAt).toLocaleDateString()}</time>
                    </small>
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Rename conversation ${c.title}`}
                  onClick={() => {
                    setRenaming(c.id);
                    setRename(c.title);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete conversation ${c.title}`}
                  onClick={() =>
                    void deleteAIChat(c.id).catch((e) => setError(String(e)))
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          {chat && (
            <button
              className="ai-text-action"
              onClick={() => void copyConversation()}
            >
              <Copy size={12} /> Copy conversation
            </button>
          )}
        </div>
      ) : (
        <div
          className="ai-messages"
          ref={scroller}
          onScroll={() => {
            const el = scroller.current;
            if (el)
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          }}
        >
          {!chat?.messages.length ? (
            <div className="ai-empty-conversation">
              <strong>Start a conversation</strong>
              <p>Ask a question or describe the change you want to make.</p>
            </div>
          ) : (
            chat.messages.map((message, index) => {
              const attachments = messageAttachments(message),
                source = [...chat.messages.slice(0, index)]
                  .reverse()
                  .find((m) => m.role === "user"),
                files = source
                  ? messageAttachments(source).filter(
                      (item) => item.kind === "file" && !item.truncated,
                    )
                  : [];
              return (
                <article
                  key={message.id}
                  className={`ai-message ai-message-${message.role} ${running && index === chat.messages.length - 1 ? "is-streaming" : ""}`}
                  aria-label={
                    message.role === "user"
                      ? "User message"
                      : "Assistant message"
                  }
                >
                  {!!attachments.length && (
                    <div className="ai-message-attachments">
                      {attachments.map((item) => (
                        <button
                          key={`${item.kind}:${item.id}`}
                          onClick={() => setPreview(item)}
                          title={`${item.path ?? item.title}${item.startLine ? ` (lines ${item.startLine}-${item.endLine})` : ""}`}
                        >
                          <AttachmentIcon
                            kind={item.kind}
                            path={item.path ?? item.id}
                          />
                          <span>{formatAttachmentLabel(item)}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {message.role === "assistant" &&
                    (Boolean(message.reasoning) ||
                      Boolean(message.tools?.length) ||
                      (Boolean(running) &&
                        index === chat.messages.length - 1)) && (
                      <AIThinking
                        text={message.reasoning ?? ""}
                        tools={message.tools}
                        active={
                          Boolean(running) && index === chat.messages.length - 1
                        }
                        startedAt={message.startedAt}
                        finishedAt={message.finishedAt}
                      />
                    )}
                  {Boolean(message.subagents?.length) && (
                    <div className="ai-subagents-container" aria-label="Subagent tasks">
                      {message.subagents!.map((sub) => (
                        <div key={sub.id} className="ai-subagent-card">
                          <Bot size={13} />
                          <span className="ai-subagent-role">{sub.role}:</span>
                          <span>{sub.task}</span>
                          <span className={`ai-subagent-status ${sub.status}`}>{sub.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" ? (
                    <Suspense fallback={<p>{message.content}</p>}>
                      <Reply
                        message={message}
                        streaming={
                          !!running && index === chat.messages.length - 1
                        }
                        files={files}
                        onReview={onReview}
                      />
                    </Suspense>
                  ) : (
                    <p>{message.content}</p>
                  )}
                  {!!message.proposals?.length && (
                    <section
                      className="ai-proposals"
                      aria-label="Proposed changes"
                    >
                      <div className="ai-proposals-header">
                        <span className="ai-proposals-heading">
                          {message.proposals.length} suggested change
                          {message.proposals.length > 1 ? "s" : ""}
                        </span>
                        {onApproveAll &&
                          message.proposals.some(
                            (p) =>
                              p.status !== "applied" &&
                              p.status !== "dismissed",
                          ) && (
                            <button
                              type="button"
                              className="ai-approve-all-btn"
                              title="Approve and apply all proposals"
                              onClick={() =>
                                void onApproveAll(message.proposals)
                              }
                            >
                              Approve all
                            </button>
                          )}
                      </div>
                      {message.proposals.map((proposal) => (
                        <div className="ai-proposal" key={proposal.id}>
                          <div>
                            <AttachmentIcon
                              kind="file"
                              path={proposal.path}
                              size={14}
                            />
                            <strong>{proposal.path}</strong>
                            <small>
                              {proposal.status === "applied"
                                ? "Applied to editor"
                                : proposal.create
                                  ? "New file"
                                  : "Edit"}
                            </small>
                          </div>
                          <footer>
                            <button
                              disabled={proposal.status === "applied"}
                              onClick={() => {
                                if (proposal.workspace !== cwd) {
                                  setError(
                                    "Open this proposal’s workspace before reviewing it.",
                                  );
                                  return;
                                }
                                setAIProposalStatus(proposal.id, "reviewed");
                                onReview(
                                  proposal.path,
                                  proposal.original,
                                  proposal.modified,
                                  proposal.create,
                                  proposal.id,
                                );
                              }}
                            >
                              Review diff
                            </button>
                            {!["applied", "dismissed"].includes(
                              proposal.status,
                            ) && (
                              <button
                                onClick={() =>
                                  setAIProposalStatus(proposal.id, "dismissed")
                                }
                              >
                                Dismiss
                              </button>
                            )}
                            {proposal.status === "dismissed" && (
                              <small>Dismissed</small>
                            )}
                          </footer>
                        </div>
                      ))}
                    </section>
                  )}
                  {message.error && (
                    <small className="ai-stopped">Response failed</small>
                  )}
                  {message.stopped && (
                    <small className="ai-stopped">Stopped</small>
                  )}
                  {!running && (
                    <div className="ai-message-actions">
                      <button
                        aria-label="Copy message"
                        title="Copy"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(message.content)
                            .catch(() => setError("Could not copy message."))
                        }
                      >
                        <Copy size={12} />
                      </button>
                      {message.role === "user" ? (
                        <button
                          aria-label="Edit message"
                          title="Edit and resend"
                          onClick={() => startEdit(message)}
                        >
                          <Pencil size={12} />
                        </button>
                      ) : (
                        <>
                          <button
                            aria-label="Branch conversation"
                            title="Branch from here"
                            onClick={() => {
                              forkAIChat(chat.id, message.id);
                              setDraft("");
                              setAttached([]);
                              setEditing(undefined);
                            }}
                          >
                            <GitBranch size={12} />
                          </button>
                          {index === chat.messages.length - 1 && (
                            <button
                              aria-label="Retry AI reply"
                              title="Retry"
                              onClick={() =>
                                void sendAIMessage(
                                  chat.id,
                                  "",
                                  undefined,
                                  cwd,
                                  true,
                                ).catch((e) => setError(String(e)))
                              }
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </>
                      )}
                      {message.finishedAt && message.startedAt && (
                        <time title="Response time">
                          {Math.max(
                            1,
                            Math.round(
                              (message.finishedAt - message.startedAt) / 1000,
                            ),
                          )}
                          s
                        </time>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
          <div ref={bottom} />
        </div>
      )}
      <div className="ai-compose-area">
        <ErrorToast message={visible ? error || ai.error : undefined} />
        <ErrorToast message={visible && chat?.messages.at(-1)?.error && Date.now() - (chat.messages.at(-1)?.startedAt ?? 0) < 600_000 ? chat.messages.at(-1)?.error : undefined} />
        {editing && (
          <div className="ai-editing-message">
            <Pencil size={11} /> Editing message
            <button
              aria-label="Cancel message edit"
              onClick={() => {
                setEditing(undefined);
                setDraft("");
                setAttached([]);
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {queuedMessages.length > 0 && (
          <div className="ai-queued-messages" aria-label="Queued messages">
            <div className="ai-queued-header">
              <span className="ai-queued-badge">
                Queued ({queuedMessages.length})
              </span>
              <small>Will send when current turn completes</small>
            </div>
            <div className="ai-queued-list">
              {queuedMessages.map((item, idx) => (
                <div key={item.id} className="ai-queued-item">
                  <span className="ai-queued-number">{idx + 1}</span>
                  <p className="ai-queued-text">{item.content}</p>
                  {!!item.attachments.length && (
                    <span className="ai-queued-chip">
                      {item.attachments.length} attached
                    </span>
                  )}
                  <button
                    type="button"
                    className="ai-queued-remove"
                    aria-label="Remove queued message"
                    onClick={() =>
                      setQueuedMessages((q) =>
                        q.filter((m) => m.id !== item.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <form
          className={`ai-composer ${running ? "is-agent-working" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {!!attached.length && (
            <div className="ai-attachment-list">
              {attached.map((item) => (
                <div
                  className="ai-attachment-chip"
                  key={`${item.kind}:${item.id}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreview(item)}
                    title={`${item.path ?? item.title}${item.startLine ? ` (lines ${item.startLine}-${item.endLine})` : ""}${item.truncated ? " (truncated)" : ""}`}
                  >
                    <AttachmentIcon
                      kind={item.kind}
                      path={item.path ?? item.id}
                    />
                    <span>{formatAttachmentLabel(item)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove attachment ${formatAttachmentLabel(item)}`}
                    onClick={() =>
                      setAttached((old) => old.filter((a) => a !== item))
                    }
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ai-clear-attachments"
                aria-label="Remove all attachments"
                onClick={() => setAttached([])}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div
            className="ai-composer-corner-thumb"
            title="Resize composer input (drag up to enlarge, double-click to reset)"
            aria-label="Resize composer input"
            onPointerDown={handleComposerResizeStart}
            onDoubleClick={() => {
              setComposerHeight(null);
              try {
                localStorage.removeItem("devyy.ai.composerHeight");
              } catch {}
            }}
          >
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M 4 4.5 H 9.5 A 7 7 0 0 1 16.5 11.5 V 17"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <textarea
            ref={composer}
            aria-label="Message Devyy AI"
            placeholder="Describe the change…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            style={
              composerHeight
                ? {
                    height: `${composerHeight}px`,
                    minHeight: `${composerHeight}px`,
                    maxHeight: `${composerHeight}px`,
                  }
                : undefined
            }
            onContextMenu={handleComposerContextMenu}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void attachFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
                e.stopPropagation();
                composer.current?.select();
                return;
              }
              if (e.key === "Escape" && (running || editing)) {
                e.preventDefault();
                e.stopPropagation();
                if (running && chat)
                  void stopAIChat(chat.id).catch((error) =>
                    setError(String(error)),
                  );
                else {
                  setEditing(undefined);
                  setDraft("");
                  setAttached([]);
                }
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="ai-composer-tools">
            <AIContextPicker
              onAttach={add}
              onFiles={() => fileInput.current?.click()}
            />
            {file && (
              <button
                type="button"
                className="icon-button ai-attach-current"
                aria-label="Attach current file to AI"
                title={`Attach ${file.path}`}
                onClick={() =>
                  void resolveAIContext([{ kind: "file", id: file.path }])
                    .then(add)
                    .catch((e) => setError(String(e)))
                }
              >
                <FilePlus2 size={14} />
              </button>
            )}
            <span className="ai-composer-spacer" />
            {running ? (
              <div className="ai-composer-running-actions">
                {(draft.trim() || attached.length > 0) && (
                  <button
                    type="submit"
                    className="ai-send ai-queue-btn"
                    title="Queue message"
                    aria-label="Queue message"
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className="ai-send ai-stop-btn"
                  aria-label="Stop AI response"
                  title="Stop generation"
                  onClick={() => {
                    if (chat)
                      void stopAIChat(chat.id).catch((e) =>
                        setError(String(e)),
                      );
                  }}
                >
                  <Square size={11} fill="currentColor" />
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="ai-send"
                aria-label="Send AI message"
                disabled={
                  (!draft.trim() && !attached.length) ||
                  provider?.enabled === false
                }
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </form>
        <div className="ai-chat-controls">
          <div className="ai-model-control">
            <AIModelPicker
              providerId={chosen}
              chatId={chat?.id}
              choice={choice}
              disabled={running}
              onSettings={onSettings}
              onChoose={(id, next) => {
                setProviderId(id);
                try {
                  localStorage.setItem("devyy.ai.provider", id);
                } catch {}
                if (!chat) chooseAIModel(id, next);
              }}
            />
            {!!attached.length && (
              <span className="ai-context-count" title="Attached snapshots">
                {attached.length} attached
              </span>
            )}
          </div>
          <AIWorkspaceAccess
            root={visible ? cwd : undefined}
            agentMode={currentMode}
            running={!!running}
            onAgentModeChange={(mode) => {
              if (showcase) setShowcaseMode(mode);
              else setAIMode(chat?.id ?? newAIChat(chosen), mode);
            }}
          />
        </div>
        <input
          ref={fileInput}
          className="ai-file-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-label="Attach files from device"
          onChange={(e) => {
            if (e.target.files) void attachFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
        </>
      )}
      {dragging && (
        <div className="ai-drop-target">
          <Paperclip size={24} />
          <strong>Add context</strong>
        </div>
      )}
      <AnimatePresence>
        {usage && (
          <AIUsage
            key="usage"
            providerId={chosen}
            onClose={() => setUsage(false)}
          />
        )}
      </AnimatePresence>
      {preview && (
        <div
          ref={previewRef}
          className="ai-context-preview"
          data-escape-scope="active"
          role="dialog"
          aria-label="Attachment preview"
        >
          <header>
            <AttachmentIcon
              kind={preview.kind}
              path={preview.path ?? preview.id}
            />
            <strong>{preview.title}</strong>
            <button
              className="icon-button"
              aria-label="Copy attachment"
              onClick={() =>
                void navigator.clipboard
                  .writeText(preview.content)
                  .catch(() => setError("Could not copy attachment."))
              }
            >
              <Copy size={13} />
            </button>
            <button
              className="icon-button"
              aria-label="Close attachment preview"
              onClick={() => setPreview(undefined)}
            >
              <X size={14} />
            </button>
          </header>
          <pre>{preview.content}</pre>
        </div>
      )}
    </div>
  );
}
