import { AnimatePresence } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  FileCode2,
  Folder,
  LoaderCircle,
  Paperclip,
  Search,
  TerminalSquare,
  TextCursorInput,
  Upload,
  X,
  Braces,
} from "lucide-react";
import {
  resolveAIContext,
  useAIContext,
  type AIAttachment,
  type AIContextKind,
} from "../lib/aiContext";
import AIPopover from "./AIPopover";
import FileIcon from "./FileIcon";
export function AttachmentIcon({
  kind,
  path,
  size = 13,
}: {
  kind: AIContextKind;
  path?: string;
  size?: number;
}) {
  if (path && (kind === "file" || kind === "folder"))
    return <FileIcon path={path} directory={kind === "folder"} size={size} />;
  const Icon =
    kind === "terminal"
      ? TerminalSquare
      : kind === "problem" || kind === "problems"
        ? AlertCircle
        : kind === "selection"
          ? TextCursorInput
          : kind === "folder"
            ? Folder
            : kind === "output"
              ? Braces
              : FileCode2;
  return <Icon size={size} />;
}
export default function AIContextPicker({
  onAttach,
  onFiles,
  disabled,
}: {
  onAttach: (items: AIAttachment[]) => void;
  onFiles: () => void;
  disabled?: boolean;
}) {
  const sources = useAIContext(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const items = useMemo(
    () =>
      sources.filter(
        (source) =>
          (filter === "all" ||
            (filter === "files" &&
              ["file", "folder", "selection"].includes(source.kind)) ||
            (filter === "terminals" && source.kind === "terminal") ||
            (filter === "problems" &&
              ["problem", "problems"].includes(source.kind))) &&
          `${source.title} ${source.description ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [sources, filter, query],
  );
  async function attach() {
    setBusy(true);
    setError("");
    try {
      const refs = sources.filter((s) =>
        selected.includes(`${s.kind}:${s.id}`),
      );
      onAttach(await resolveAIContext(refs));
      setSelected([]);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="icon-button"
        aria-label="Attach context"
        title="Attach files, problems, terminals, or a selection"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Paperclip size={15} />
      </button>
      <AnimatePresence>
        {open && (
          <AIPopover
            anchor={anchor}
            label="Attach context"
            width={500}
            onClose={() => setOpen(false)}
          >
            <div className="ai-context-picker">
              <div className="ai-model-search">
                <Search size={14} />
                <input
                  aria-label="Search context"
                  placeholder="Search files and context…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  aria-label="Close context picker"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <div
                className="ai-context-filters"
                role="tablist"
                aria-label="Context types"
              >
                {["all", "files", "terminals", "problems"].map((kind) => (
                  <button
                    role="tab"
                    key={kind}
                    aria-selected={filter === kind}
                    onClick={() => setFilter(kind)}
                  >
                    {kind}
                  </button>
                ))}
              </div>
              <div className="ai-context-list">
                {items.slice(0, 160).map((item) => {
                  const id = `${item.kind}:${item.id}`,
                    checked = selected.includes(id);
                  return (
                    <button
                      key={id}
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() =>
                        setSelected((old) =>
                          checked ? old.filter((k) => k !== id) : [...old, id],
                        )
                      }
                    >
                      <AttachmentIcon
                        kind={item.kind}
                        path={item.id}
                        size={18}
                      />
                      <span className="ai-context-label">
                        <strong>{item.title}</strong>
                        {item.description && <small>{item.description}</small>}
                      </span>
                      <i>{checked && <Check size={11} />}</i>
                    </button>
                  );
                })}
                {!items.length && (
                  <p className="ai-picker-status">No matching context</p>
                )}
              </div>
              {error && (
                <p role="alert" className="ai-error">
                  {error}
                </p>
              )}
              <footer>
                <button
                  className="ai-text-action"
                  onClick={() => {
                    setOpen(false);
                    onFiles();
                  }}
                >
                  <Upload size={13} /> From device
                </button>
                <button
                  className="setting-action"
                  disabled={!selected.length || busy}
                  onClick={() => void attach()}
                >
                  {busy ? (
                    <LoaderCircle size={13} className="spinning" />
                  ) : (
                    <Paperclip size={13} />
                  )}{" "}
                  Attach{selected.length ? ` (${selected.length})` : ""}
                </button>
              </footer>
            </div>
          </AIPopover>
        )}
      </AnimatePresence>
    </>
  );
}
