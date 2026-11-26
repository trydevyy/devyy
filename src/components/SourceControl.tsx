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
import ErrorToast from "./ui/ErrorToast";
import ActionMenu, { ActionMenuItem } from "./ui/ActionMenu";
import Select from "./ui/Select";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  GitBranch,
  GitCommitHorizontal,
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
  onSync,
  onRefresh,
  onStage,
  onStageAll,
  onDiff,
  onOpen,
  onDiscard,
  onSwitch,
  onCreateBranch,
  onGraph,
}: {
  onGraph: (hash?: string) => void;
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
  onSync: (direction: "pull" | "push") => void;
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
    [page, setPage] = useState("changes"),
    [error, setError] = useState("");
  const menu = useContextMenu();
  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      invoke<GitBranchInfo[]>("git_branch_details", { repository }),
      page === "history"
        ? invoke<Commit[]>("git_history", { repository })
        : Promise.resolve([]),
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
  }, [root, repository, state, page]);
  const staged = state.changes.filter(
    (change) => change.index.trim() && !["?", "!", "U"].includes(change.index),
  );
  const unstaged = state.changes.filter(
    (change) => change.worktree.trim() && change.worktree !== "!",
  );
  const incoming = state.behind ?? 0;
  const outgoing = state.ahead ?? 0;
  const canCommit = staged.length > 0 && !!commit.trim();
  const canPull = !!state.upstream;
  const canPush = !!state.branch && state.branch !== "detached";
  const primaryAction = staged.length
    ? "commit"
    : incoming && canPull
      ? "pull"
      : outgoing && canPush
        ? "push"
        : "commit";
  function group(changes: GitChange[], isStaged: boolean) {
    return (
      <section
        className="scm-group"
        aria-label={isStaged ? "Staged changes" : "Working tree changes"}
      >
        <div className="section-label">
          <span>{isStaged ? "Staged" : "Working tree"}</span>
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
      <header className="scm-repository">
        {modules.length ? (
          <label className="scm-repository-picker">
            <span>Repository</span>
            <Select
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
            </Select>
          </label>
        ) : (
          <strong className="scm-repository-name" title={root}>
            {filename(root)}
          </strong>
        )}
        <div className="branch-card">
          <GitBranch size={15} />
          <Select
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
          </Select>
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
        <div className="scm-tracking" title={state.upstream ?? undefined}>
          <span>
            {state.upstream ??
              (canPush ? "No upstream branch" : "Detached HEAD")}
          </span>
          {state.upstream && (
            <>
              <span aria-label={`${incoming} incoming changes`}>
                <ArrowDown size={12} /> {incoming}
              </span>
              <span aria-label={`${outgoing} outgoing changes`}>
                <ArrowUp size={12} /> {outgoing}
              </span>
            </>
          )}
        </div>
      </header>
      <nav
        className="scm-pages"
        aria-label="Source Control sections"
        role="tablist"
      >
        {[
          ["changes", "Changes"],
          ["history", "History"],
          ["repositories", "Repositories"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={page === id}
            onClick={() => setPage(id)}
          >
            {label}
            {id === "changes" && <small>{state.changes.length}</small>}
          </button>
        ))}
      </nav>
      <div hidden={page !== "changes"} role="tabpanel" aria-label="Changes">
        <div className="scm-composer">
          <label htmlFor="scm-commit-message">
            Commit message
            {!!staged.length && <small>{staged.length} staged</small>}
          </label>
          <textarea
            id="scm-commit-message"
            aria-label="Commit message"
            className="commit-message"
            value={commit}
            onChange={(event) => onCommitChange(event.target.value)}
            placeholder="Describe your changes"
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                canCommit &&
                !busy
              ) {
                event.preventDefault();
                onCommit();
              }
            }}
          />
          <div className="scm-commit-actions">
            <button
              className="primary"
              disabled={busy || (primaryAction === "commit" && !canCommit)}
              onClick={() =>
                primaryAction === "commit" ? onCommit() : onSync(primaryAction)
              }
            >
              {primaryAction === "pull" ? (
                <ArrowDown size={14} />
              ) : primaryAction === "push" ? (
                <ArrowUp size={14} />
              ) : (
                <Check size={14} />
              )}
              {primaryAction === "pull"
                ? `Pull (${incoming})`
                : primaryAction === "push"
                  ? `Push (${outgoing})`
                  : "Commit staged changes"}
            </button>
            <ActionMenu label="Commit and sync actions">
              <ActionMenuItem disabled={busy || !canCommit} onClick={onCommit}>
                <Check size={14} /> Commit staged changes
              </ActionMenuItem>
              <ActionMenuItem
                disabled={busy || !canPull}
                onClick={() => onSync("pull")}
              >
                <ArrowDown size={14} /> Pull changes
              </ActionMenuItem>
              <ActionMenuItem
                disabled={busy || !canPush}
                onClick={() => onSync("push")}
              >
                <ArrowUp size={14} />{" "}
                {state.upstream ? "Push changes" : "Publish branch"}
              </ActionMenuItem>
            </ActionMenu>
          </div>
        </div>
        {!!unstaged.length && group(unstaged, false)}
        {!!staged.length && group(staged, true)}
        {!state.changes.length && (
          <p className="scm-clean">
            <Check size={13} /> No local changes
          </p>
        )}
      </div>
      <div
        hidden={page !== "repositories"}
        role="tabpanel"
        aria-label="Repositories"
      >
        <GitBranches
          branches={branches}
          current={state.branch}
          busy={busy}
          onSwitch={onSwitch}
          onCreate={onCreateBranch}
          onAction={onBranchAction}
          onRename={onRenameBranch}
        />
        <GitSubmodules
          modules={modules}
          repository={repository}
          busy={busy}
          onSelect={onRepository}
          onAction={onSubmoduleAction}
        />
      </div>
      <div hidden={page !== "history"} role="tabpanel" aria-label="History">
        <button className="scm-open-graph" onClick={() => onGraph()}>
          <GitCommitHorizontal size={15} />
          Open commit graph
          <ArrowUpRight size={13} />
        </button>
        <section className="scm-history" aria-label="Commit history">
          {history.map((item) => (
            <div className="scm-commit" key={item.hash}>
              <button
                className="icon-button"
                aria-label={`Inspect commit ${item.short}`}
                onClick={() => onGraph(item.hash)}
              >
                <GitCommitHorizontal size={13} />
              </button>
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
                  void writeClipboardText(item.hash).catch(() =>
                    toast.error("Could not copy commit hash"),
                  )
                }
              >
                <ArrowUpRight size={12} />
              </button>
            </div>
          ))}
          {!history.length && <p className="muted">No commits yet.</p>}
        </section>
      </div>
      {error && <ErrorToast message={error} />}
    </div>
  );
}
