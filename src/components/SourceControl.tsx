import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  History,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { invoke } from "../lib/native";
import { filename, type GitState, type GitChange } from "../lib/types";
import { FileIcon } from "./FileTree";
import { useContextMenu } from "./ContextMenu";
interface Commit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}
export default function SourceControl({
  state,
  root,
  busy,
  commit,
  onCommitChange,
  onCommit,
  onRefresh,
  onStage,
  onStageAll,
  onDiff,
  onOpen,
  onDiscard,
  onSwitch,
  onCreateBranch,
}: {
  state: GitState;
  root: string;
  busy: boolean;
  commit: string;
  onCommitChange: (message: string) => void;
  onCommit: () => void;
  onRefresh: () => void;
  onStage: (path: string, staged: boolean) => void;
  onStageAll: (staged: boolean) => void;
  onDiff: (path: string, staged: boolean) => void;
  onOpen: (path: string) => void;
  onDiscard: (path: string) => void;
  onSwitch: (branch: string) => void;
  onCreateBranch: () => void;
}) {
  const [branches, setBranches] = useState<string[]>([]),
    [history, setHistory] = useState<Commit[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [error, setError] = useState("");
  const menu = useContextMenu();
  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      invoke<string[]>("git_branches"),
      invoke<Commit[]>("git_history"),
    ]).then(([branches, history]) => {
      if (!current) return;
      if (branches.status === "fulfilled") setBranches(branches.value ?? []);
      if (history.status === "fulfilled") setHistory(history.value ?? []);
      setError(
        [branches, history]
          .filter((item) => item.status === "rejected")
          .map((item) => String((item as PromiseRejectedResult).reason))
          .join("\n"),
      );
    });
    return () => {
      current = false;
    };
  }, [root, state]);
  const staged = state.changes.filter(
    (change) => change.index.trim() && !["?", "!", "U"].includes(change.index),
  );
  const unstaged = state.changes.filter(
    (change) => change.worktree.trim() && change.worktree !== "!",
  );
  function group(changes: GitChange[], isStaged: boolean) {
    return (
      <section
        className="scm-group"
        aria-label={isStaged ? "Staged changes" : "Working tree changes"}
      >
        <div className="section-label">
          <span>{isStaged ? "STAGED CHANGES" : "CHANGES"}</span>
          <span>{changes.length}</span>
          <button
            className="icon-button"
            aria-label={isStaged ? "Unstage all changes" : "Stage all changes"}
            disabled={busy || !changes.length}
            onClick={() => onStageAll(isStaged)}
          >
            {isStaged ? <Minus size={13} /> : <Plus size={13} />}
          </button>
        </div>
        {changes.map((change) => (
          <div
            className="change-row"
            key={change.path}
            onContextMenu={(event) =>
              menu(event, [
                {
                  label: "Open diff",
                  action: () => onDiff(change.path, isStaged),
                },
                {
                  label: "Open working file",
                  action: () => onOpen(change.path),
                },
                {
                  label: isStaged ? "Unstage file" : "Stage file",
                  disabled: busy,
                  action: () => onStage(change.path, isStaged),
                },
                ...(!isStaged && change.index !== "?"
                  ? [
                      {
                        label: "Discard working changes",
                        danger: true,
                        disabled: busy,
                        action: () => onDiscard(change.path),
                      },
                    ]
                  : []),
              ])
            }
          >
            <button
              className="change-open"
              title={`${change.path}${change.oldPath ? ` (from ${change.oldPath})` : ""}`}
              onClick={() => onDiff(change.path, isStaged)}
            >
              <FileIcon path={change.path} size={13} />
              <span>
                <strong>{filename(change.path)}</strong>
                <small>
                  {change.path.includes("/")
                    ? change.path.slice(0, change.path.lastIndexOf("/"))
                    : ""}
                </small>
              </span>
              <b>{isStaged ? change.index : change.worktree}</b>
            </button>
            {!isStaged && change.index !== "?" && (
              <button
                className="icon-button change-tool"
                aria-label={`Discard changes to ${change.path}`}
                disabled={busy}
                onClick={() => onDiscard(change.path)}
              >
                <RotateCcw size={12} />
              </button>
            )}
            <button
              className="icon-button change-tool"
              aria-label={`${isStaged ? "Unstage" : "Stage"} ${change.path}`}
              disabled={busy}
              onClick={() => onStage(change.path, isStaged)}
            >
              {isStaged ? <Minus size={13} /> : <Plus size={13} />}
            </button>
          </div>
        ))}
      </section>
    );
  }
  return (
    <div className="source-control">
      <div className="branch-card">
        <GitBranch size={15} />
        <select
          aria-label="Current Git branch"
          value={state.branch}
          disabled={busy}
          onChange={(event) => onSwitch(event.target.value)}
        >
          {[...new Set([state.branch, ...branches])].map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="Create Git branch"
          disabled={busy}
          onClick={onCreateBranch}
        >
          <Plus size={13} />
        </button>
        <button
          className="icon-button"
          aria-label="Refresh Git status"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {state.upstream && (
        <p className="scm-upstream" title={state.upstream}>
          {state.upstream}
          <span>
            ↑ {state.ahead ?? 0}　↓ {state.behind ?? 0}
          </span>
        </p>
      )}
      <textarea
        className="commit-message"
        value={commit}
        onChange={(event) => onCommitChange(event.target.value)}
        placeholder="Commit message"
        aria-label="Commit message"
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            staged.length &&
            commit.trim() &&
            !busy
          ) {
            event.preventDefault();
            onCommit();
          }
        }}
      />
      <button
        className="primary full"
        disabled={busy || !commit.trim() || !staged.length}
        onClick={onCommit}
      >
        <Check size={14} /> Commit staged changes
      </button>
      {group(staged, true)}
      {group(unstaged, false)}
      {!state.changes.length && (
        <p className="scm-clean">
          <Check size={14} /> Working tree clean
        </p>
      )}
      <button
        className="scm-history-toggle"
        aria-expanded={showHistory}
        onClick={() => setShowHistory((value) => !value)}
      >
        <History size={13} /> Commit history <ChevronDown size={12} />
      </button>
      {showHistory && (
        <section className="scm-history" aria-label="Commit history">
          {history.map((item) => (
            <div className="scm-commit" key={item.hash}>
              <GitCommitHorizontal size={13} />
              <div>
                <strong title={item.subject}>{item.subject}</strong>
                <small>
                  {item.author}
                  <time dateTime={item.date}>
                    {new Date(item.date).toLocaleDateString()}
                  </time>
                </small>
                <code title={item.hash}>{item.short}</code>
              </div>
              <button
                className="icon-button"
                aria-label={`Copy commit ${item.short}`}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(item.hash)
                    .catch(() => toast.error("Could not copy commit hash"))
                }
              >
                <ArrowUpRight size={12} />
              </button>
            </div>
          ))}
          {!history.length && <p className="muted">No commits yet.</p>}
        </section>
      )}
      {error && (
        <p className="scm-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
