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
import FileIcon from "./FileIcon";
import type {
  GitBranchInfo,
  GitBranchAction,
  GitSubmodule,
  GitSubmoduleAction,
} from "../lib/git";
import GitBranches from "./GitBranches";
import GitSubmodules from "./GitSubmodules";
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
  repository,
  onRepository,
  onBranchAction,
  onSubmoduleAction,
  onRenameBranch,
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
  repository: string;
  onRepository: (repository: string) => void;
  onBranchAction: (
    action: GitBranchAction,
    branch: string,
    name?: string,
  ) => void;
  onSubmoduleAction: (
    action: GitSubmoduleAction,
    path?: string,
    url?: string,
  ) => Promise<boolean>;
  onRenameBranch: (branch: string, name: string) => void;
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
  onCreateBranch: (startPoint?: string) => void;
}) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]),
    [modules, setModules] = useState<GitSubmodule[]>([]),
    [history, setHistory] = useState<Commit[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [error, setError] = useState("");
  const menu = useContextMenu();
  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      invoke<GitBranchInfo[]>("git_branch_details", { repository }),
      invoke<Commit[]>("git_history", { repository }),
      invoke<GitSubmodule[]>("git_submodules"),
    ]).then(([branches, history, submodules]) => {
      if (!current) return;
      if (branches.status === "fulfilled") setBranches(branches.value ?? []);
      if (history.status === "fulfilled") setHistory(history.value ?? []);
      if (submodules.status === "fulfilled") setModules(submodules.value ?? []);
      setError(
        [branches, history, submodules]
          .filter((item) => item.status === "rejected")
          .map((item) => String((item as PromiseRejectedResult).reason))
          .join("\n"),
      );
    });
    return () => {
      current = false;
    };
  }, [root, repository, state]);
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
                  disabled: modules.some(
                    (item) => item.path === change.path && !item.initialized,
                  ),
                  action: () =>
                    modules.some((item) => item.path === change.path)
                      ? onRepository(change.path)
                      : onOpen(change.path),
                },
                {
                  label: isStaged ? "Unstage file" : "Stage file",
                  disabled: busy,
                  action: () => onStage(change.path, isStaged),
                },
                ...(!isStaged &&
                change.index !== "?" &&
                !modules.some((item) => item.path === change.path)
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
              <span className="change-label">
                <strong>{filename(change.path)}</strong>
                <small>
                  {change.path.includes("/")
                    ? change.path.slice(0, change.path.lastIndexOf("/"))
                    : ""}
                </small>
              </span>
              <b>{isStaged ? change.index : change.worktree}</b>
            </button>
            {!isStaged &&
              change.index !== "?" &&
              !modules.some((item) => item.path === change.path) && (
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
      {!!modules.length && (
        <label className="scm-repository-picker">
          <span>Repository</span>
          <select
            aria-label="Source Control repository"
            value={repository}
            disabled={busy}
            onChange={(event) => onRepository(event.target.value)}
          >
            <option value="">{filename(root)}</option>
            {modules
              .filter((item) => item.initialized && !item.conflict)
              .map((item) => (
                <option key={item.path} value={item.path}>
                  {item.path}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="branch-card">
        <GitBranch size={15} />
        <select
          aria-label="Current Git branch"
          value={state.branch}
          disabled={busy}
          onChange={(event) => onSwitch(event.target.value)}
        >
          {!branches.some(
            (branch) => !branch.remote && branch.name === state.branch,
          ) && <option value={state.branch}>{state.branch}</option>}
          <optgroup label="Local branches">
            {branches
              .filter((branch) => !branch.remote)
              .map((branch) => (
                <option
                  key={branch.reference}
                  value={branch.name}
                  disabled={!branch.current && !!branch.worktree}
                >
                  {branch.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Remote branches">
            {branches
              .filter((branch) => branch.remote)
              .map((branch) => (
                <option key={branch.reference} value={branch.reference}>
                  {branch.name}
                </option>
              ))}
          </optgroup>
        </select>
        <button
          className="icon-button"
          aria-label="Create Git branch"
          disabled={busy}
          onClick={() => onCreateBranch()}
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
      <GitBranches
        branches={branches}
        current={state.branch}
        busy={busy}
        onSwitch={onSwitch}
        onCreate={onCreateBranch}
        onAction={onBranchAction}
        onRename={onRenameBranch}
      />
      {state.upstream && (
        <p className="scm-upstream" title={state.upstream}>
          {state.upstream}
          <span>
            ↑ {state.ahead ?? 0}　↓ {state.behind ?? 0}
          </span>
        </p>
      )}
      <div className="scm-summary" aria-label="Change summary">
        <strong>
          {state.changes.length}{" "}
          {state.changes.length === 1 ? "changed file" : "changed files"}
        </strong>
        <span>{staged.length} staged</span>
      </div>
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
      <GitSubmodules
        modules={modules}
        repository={repository}
        busy={busy}
        onSelect={onRepository}
        onAction={onSubmoduleAction}
      />
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
