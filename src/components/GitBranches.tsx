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

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Cloud,
  Download,
  GitBranch,
  MoreHorizontal,
  Search,
} from "lucide-react";
import type { GitBranchAction, GitBranchInfo } from "../lib/git";
import { useContextMenu } from "./ContextMenu";
export default function GitBranches({
  branches,
  busy,
  current,
  onSwitch,
  onCreate,
  onAction,
  onRename,
}: {
  branches: GitBranchInfo[];
  busy: boolean;
  current: string;
  onSwitch: (branch: string) => void;
  onCreate: (startPoint?: string) => void;
  onAction: (action: GitBranchAction, branch: string) => void;
  onRename: (branch: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const menu = useContextMenu();
  const filtered = branches.filter((branch) =>
    branch.name.toLowerCase().includes(query.toLowerCase()),
  );
  function actions(branch: GitBranchInfo) {
    return [
      {
        label: "Switch to branch",
        disabled:
          busy || branch.current || (!branch.remote && !!branch.worktree),
        action: () => onSwitch(branch.remote ? branch.reference : branch.name),
      },
      {
        label: "Create branch from here",
        disabled: busy,
        action: () => onCreate(branch.reference),
      },
      {
        label: `Fast-forward ${current} to this branch`,
        disabled: busy || branch.current,
        action: () => onAction("merge", branch.reference),
      },
      ...(!branch.remote
        ? [
            {
              label: "Rename branch",
              disabled: busy,
              action: () => onRename(branch.reference, branch.name),
            },
            {
              label: "Delete branch",
              danger: true,
              disabled: busy || branch.current || !!branch.worktree,
              action: () => onAction("delete", branch.reference),
            },
          ]
        : []),
    ];
  }
  return (
    <section className="scm-branches" aria-label="Branches">
      <div className="scm-section-heading">
        <button
          className="scm-section-toggle"
          aria-label="Branches"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={12} className={open ? "" : "collapsed"} />
          <span>Branches</span>
          <small>{branches.length}</small>
        </button>
        <button
          className="icon-button"
          aria-label="Fetch all remotes"
          title="Fetch all remotes"
          disabled={busy}
          onClick={() => onAction("fetch", "")}
        >
          <Download size={13} />
        </button>
      </div>
      {open && (
        <>
          <label className="scm-branch-search">
            <Search size={13} />
            <input
              aria-label="Search branches"
              placeholder="Find a branch…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="scm-branch-list">
            {[false, true].map((remote) => {
              const entries = filtered.filter(
                (branch) => branch.remote === remote,
              );
              return (
                !!entries.length && (
                  <div
                    key={String(remote)}
                    role="group"
                    aria-label={remote ? "Remote branches" : "Local branches"}
                  >
                    <p className="scm-list-label">
                      {remote ? "Remotes" : "Local"}
                    </p>
                    {entries.map((branch) => (
                      <div
                        className="scm-branch-row"
                        key={branch.reference}
                        onContextMenu={(event) => menu(event, actions(branch))}
                      >
                        <button
                          className="scm-branch-open"
                          disabled={
                            busy ||
                            branch.current ||
                            (!branch.remote && !!branch.worktree)
                          }
                          aria-label={`Switch to ${branch.name}`}
                          title={
                            branch.worktree && !branch.current
                              ? `Checked out in ${branch.worktree}`
                              : branch.subject
                          }
                          onClick={() =>
                            onSwitch(
                              branch.remote ? branch.reference : branch.name,
                            )
                          }
                        >
                          {branch.remote ? (
                            <Cloud size={13} />
                          ) : (
                            <GitBranch size={13} />
                          )}
                          <span>
                            <strong>{branch.name}</strong>
                            {(branch.upstream ||
                              (branch.worktree && !branch.current)) && (
                              <small>
                                {branch.worktree && !branch.current
                                  ? "Open in another worktree"
                                  : branch.upstream}
                              </small>
                            )}
                          </span>
                          {branch.current && <Check size={12} />}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Actions for branch ${branch.name}`}
                          disabled={busy}
                          onClick={(event) => menu(event, actions(branch))}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              );
            })}
            {!filtered.length && (
              <p className="scm-empty-list">
                {query ? "No matching branches" : "No branches yet"}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
