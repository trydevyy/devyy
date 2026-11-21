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
import RepositorySections from "./RepositorySections";
import Select from "./ui/Select";
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
    [showHistory, setShowHistory] = useState(true),
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
      )}
      <RepositorySections modules={modules} refreshToken={state} onRefresh={onRefresh} onDiff={(repo,path,staged)=>{onRepository(repo);onDiff(path,staged);}}/>
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
      {state.upstream && (
        <p className="scm-upstream" title={state.upstream}>
          {state.upstream}
          <span>
            ↑ {state.ahead ?? 0}　↓ {state.behind ?? 0}
          </span>
        </p>
      )}
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
        <div className="scm-summary" aria-label="Change summary">
          <strong>Commit</strong>
          {staged.length > 0 && <span>{staged.length} staged</span>}
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
          disabled={busy || (!(state.behind && !staged.length) && (!commit.trim() || !staged.length))}
          onClick={()=>{if(state.behind && !staged.length)void invoke("git_pull",{repository}).then(onRefresh).catch(error=>setError(String(error)));else onCommit();}}
        >
          <Check size={14} /> {state.behind && !staged.length ? `Pull ${state.behind} incoming changes` : "Commit staged changes"}
        </button>
        {group(staged, true)}
        {group(unstaged, false)}
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
      </div>
      {error && (
        <ErrorToast message={error} />
      )}
    </div>
  );
}
