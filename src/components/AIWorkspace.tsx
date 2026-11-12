import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FilePlus2,
  GitBranch,
  History,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
  ChartNoAxesColumn,
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
  type AIMessage,
} from "../lib/ai";
import {
  hasAIContextDrag,
  readAIContextDrag,
  resolveAIContext,
  mergeAttachments,
  messageAttachments,
  MAX_ATTACHMENT_BYTES,
  type AIAttachment,
} from "../lib/aiContext";
import AIContextPicker, { AttachmentIcon } from "./AIContextPicker";
import AIModelPicker from "./AIModelPicker";
import DevyyLogo from "./DevyyLogo";
import AIProviderIcon from "./AIProviderIcon";
import AIUsage from "./AIUsage";
import { isAIExtension, aiMainView } from "../lib/aiExtensions";
import { useExtensions } from "../lib/extensions";
import {
  hostRequest,
  useExtensionHost,
  type HostEvent,
} from "../lib/extensionHost";
import { native } from "../lib/native";
import ResizeHandle from "./ResizeHandle";
import ExtensionWebviews from "./ExtensionWebviews";
const Reply = lazy(() => import("./AIReply"));

function ChatPanel({
  file,
  cwd,
  onSettings,
  onReview,
}: {
  file?: { path: string; content: string; readOnly?: boolean };
  cwd?: string;
  onSettings: () => void;
  onReview: (path: string, original: string, modified: string) => void;
}) {
  const ai = useAI();
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
  const [draft, setDraft] = useState(""),
    [attached, setAttached] = useState<AIAttachment[]>([]),
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
  const last = chat?.messages.at(-1);
  useEffect(() => {
    void loadAI();
  }, []);
  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [last?.content, last?.reasoning, last?.error, chat?.id, running]);
  useEffect(() => {
    const el = composer.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(220, el.scrollHeight)}px`;
    }
  }, [draft]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.refs)
        void resolveAIContext(detail.refs)
          .then(add)
          .catch((e) => setError(String(e)));
    };
    window.addEventListener("devyy-ai-attach", open);
    return () => window.removeEventListener("devyy-ai-attach", open);
  }, []);
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
    if (!hasAIContextDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    dragDepth.current = 0;
    try {
      const refs = readAIContextDrag(event.dataTransfer);
      if (refs.length) add(await resolveAIContext(refs));
      else if (event.dataTransfer.files.length)
        await attachFiles(event.dataTransfer.files);
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
    if ((!draft.trim() && !attached.length) || running) return;
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
        if (hasAIContextDrag(event.dataTransfer)) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (hasAIContextDrag(event.dataTransfer)) {
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
        <button
          className="ai-thread-title"
          onClick={() => setHistory(!history)}
          title="Conversations"
        >
          <span>{chat?.title ?? "New conversation"}</span>
          <ChevronDown size={12} />
        </button>
        <div>
          <button
            className="icon-button"
            aria-label="New AI conversation"
            title="New conversation"
            onClick={fresh}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="AI conversation history"
            aria-pressed={history}
            onClick={() => setHistory(!history)}
          >
            <History size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="AI usage"
            onClick={() => setUsage(true)}
          >
            <ChartNoAxesColumn size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="AI provider settings"
            onClick={onSettings}
          >
            <Settings2 size={15} />
          </button>
        </div>
      </div>
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
              <DevyyLogo size={26} />
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
                  className={`ai-message ai-message-${message.role}`}
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
                          title={item.path ?? item.title}
                        >
                          <AttachmentIcon
                            kind={item.kind}
                            path={item.path ?? item.id}
                          />
                          <span>{item.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" && message.reasoning && (
                    <details className="ai-reasoning">
                      <summary>
                        {running &&
                        index === chat.messages.length - 1 &&
                        !message.content
                          ? "Thinking"
                          : "Thinking summary"}
                      </summary>
                      <div>{message.reasoning}</div>
                    </details>
                  )}
                  {message.role === "assistant" ? (
                    <Suspense fallback={<p>{message.content}</p>}>
                      <Reply
                        message={message}
                        files={files}
                        onReview={onReview}
                      />
                    </Suspense>
                  ) : (
                    <p>{message.content}</p>
                  )}
                  {message.role === "assistant" &&
                    !message.content &&
                    !message.reasoning &&
                    running &&
                    index === chat.messages.length - 1 && (
                      <span className="ai-thinking" role="status">
                        <LoaderCircle className="spinning" size={13} /> Working…
                      </span>
                    )}
                  {message.error && (
                    <p className="ai-error" role="alert">
                      {message.error}
                    </p>
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
        {(error || ai.error) && (
          <p className="ai-error" role="alert">
            {error || ai.error}
          </p>
        )}
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
        <form
          className="ai-composer"
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
                    title={`${item.path ?? item.title}${item.truncated ? " (truncated)" : ""}`}
                  >
                    <AttachmentIcon
                      kind={item.kind}
                      path={item.path ?? item.id}
                    />
                    <span>{item.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove attachment ${item.title}`}
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
          <textarea
            ref={composer}
            aria-label="Message Devyy AI"
            placeholder="Describe the change…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void attachFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
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
              <button
                type="button"
                className="ai-send"
                aria-label="Stop AI response"
                onClick={() => {
                  if (chat)
                    void stopAIChat(chat.id).catch((e) => setError(String(e)));
                }}
              >
                <Square size={11} fill="currentColor" />
              </button>
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
      {dragging && (
        <div className="ai-drop-target">
          <Paperclip size={24} />
          <strong>Add context</strong>
        </div>
      )}
      {usage && <AIUsage providerId={chosen} onClose={() => setUsage(false)} />}
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
export default function AIWorkspace({
  file,
  cwd,
  onSettings,
  onReview,
  shortcuts = [],
}: {
  file?: { path: string; content: string; readOnly?: boolean };
  cwd?: string;
  onSettings: () => void;
  onReview: (path: string, original: string, modified: string) => void;
  shortcuts?: string[];
}) {
  const installed = useExtensions(),
    host = useExtensionHost();
  const [open, setOpen] = useState(false),
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
  const containers = extensions.map((ext) => ({
    id: ext.id,
    extension: ext.id,
    title: ext.name,
  }));
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
  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (event.dataTransfer && hasAIContextDrag(event.dataTransfer))
        setDragPeek(true);
    };
    const end = () => setDragPeek(false);
    window.addEventListener("dragstart", enter);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", enter);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
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
      if (detail?.container)
        setSelection(
          extensions.find((ext) => ext.contributes.views?.[detail.container!])
            ?.id ?? detail.container,
        );
      else if (detail?.extension) {
        const container = containers.find(
          (c) => c.extension === detail.extension,
        );
        setSelection(container?.id ?? detail.extension);
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
      setSelection(
        containers.find((c) => c.extension === created.extension)?.id ??
          created.extension,
      );
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
      const view = host.webviews.find((v) => v.id === e.payload.id);
      if (view && isAIExtension(view.extension)) {
        setSelection(
          containers.find((c) => c.extension === view.extension)?.id ??
            view.extension,
        );
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
  const tabs = extensions.map((e) => ({
    id: containers.find((c) => c.extension === e.id)?.id ?? e.id,
    title: e.id === "openai.chatgpt" ? "Codex" : "Claude",
  }));
  return (
    <aside
      className="ai-workspace"
      aria-label="AI assistant"
      hidden={!open && !dragPeek}
      style={{ width }}
      onDragEnter={() => {
        setOpen(true);
        setSelection("chat");
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
            aria-selected={selection === "chat"}
            aria-controls="devyy-ai-chat"
            tabIndex={selection === "chat" ? 0 : -1}
            onClick={() => setSelection("chat")}
          >
            <DevyyLogo size={14} /> Devyy
          </button>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selection === tab.id}
              aria-controls="devyy-ai-extensions"
              tabIndex={selection === tab.id ? 0 : -1}
              onClick={() => setSelection(tab.id)}
            >
              <AIProviderIcon
                kind={tab.title === "Codex" ? "codex" : "claude"}
                size={13}
              />
              {tab.title}
            </button>
          ))}
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
        <ChatPanel
          file={file}
          cwd={cwd}
          onSettings={onSettings}
          onReview={onReview}
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
          <div className="extension-view-note" role="alert">
            <p>{viewError}</p>
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
