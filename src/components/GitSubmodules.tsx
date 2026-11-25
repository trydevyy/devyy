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
  ArrowUpRight,
  Check,
  ChevronDown,
  FolderGit2,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { GitSubmodule, GitSubmoduleAction } from "../lib/git";
import { useContextMenu } from "./ContextMenu";
export default function GitSubmodules({
  modules,
  repository,
  busy,
  onSelect,
  onAction,
}: {
  modules: GitSubmodule[];
  repository: string;
  busy: boolean;
  onSelect: (path: string) => void;
  onAction: (
    action: GitSubmoduleAction,
    path?: string,
    url?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(true),
    [adding, setAdding] = useState(false),
    [url, setUrl] = useState(""),
    [path, setPath] = useState("");
  const menu = useContextMenu();
  const visible = modules.filter(
    (item) =>
      !repository ||
      item.parent === repository ||
      item.path.startsWith(repository + "/"),
  );
  function actions(item: GitSubmodule) {
    return [
      {
        label: "Open in Source Control",
        disabled: busy || !item.initialized || item.conflict,
        action: () => onSelect(item.path),
      },
      {
        label: item.initialized
          ? "Update to recorded commit"
          : "Initialize submodule",
        disabled: busy || item.conflict,
        action: () => {
          void onAction("update", item.path);
        },
      },
      {
        label: "Synchronize remote URL",
        disabled: busy || item.conflict,
        action: () => {
          void onAction("sync", item.path);
        },
      },
    ];
  }
  return (
    <section className="scm-submodules" aria-label="Submodules">
      <div className="scm-section-heading">
        <button
          className="scm-section-toggle"
          aria-label="Submodules"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={12} className={open ? "" : "collapsed"} />
          <span>Submodules</span>
          <small>{visible.length}</small>
        </button>
        <button
          className="icon-button"
          aria-label="Update all submodules"
          title="Initialize and update all submodules"
          disabled={busy || !visible.length}
          onClick={() => {
            void onAction("update");
          }}
        >
          <RefreshCw size={13} />
        </button>
        <button
          className="icon-button"
          aria-label="Add submodule"
          disabled={busy}
          onClick={() => {
            setOpen(true);
            setAdding(!adding);
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      {open && (
        <>
          {visible.map((item) => {
            const status = item.conflict
              ? "Conflicted"
              : !item.initialized
                ? "Not initialized"
                : item.dirty
                  ? "Modified"
                  : item.head !== item.expected
                    ? "Commit changed"
                    : (item.branch ?? "Recorded commit");
            return (
              <div
                className="scm-submodule-row"
                key={item.path}
                onContextMenu={(event) => menu(event, actions(item))}
              >
                <button
                  className="scm-submodule-open"
                  aria-label={`Open submodule ${item.path}`}
                  disabled={busy || !item.initialized || item.conflict}
                  onClick={() => onSelect(item.path)}
                  title={`${item.path}\n${item.head ?? item.expected}`}
                >
                  <FolderGit2 size={15} />
                  <span>
                    <strong>{item.path}</strong>
                    <small>{status}</small>
                  </span>
                  {item.initialized && <ArrowUpRight size={12} />}
                </button>
                {!item.initialized && (
                  <button
                    className="icon-button"
                    aria-label={`Initialize submodule ${item.path}`}
                    aria-busy={busy}
                    disabled={busy || item.conflict}
                    onClick={() => {
                      void onAction("update", item.path);
                    }}
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Actions for submodule ${item.path}`}
                  disabled={busy}
                  onClick={(event) => menu(event, actions(item))}
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>
            );
          })}
          {!visible.length && !adding && (
            <p className="scm-empty-list">No submodules</p>
          )}
          {adding && (
            <form
              noValidate
              className="scm-submodule-form"
              onSubmit={(event) => {
                event.preventDefault();
                const full = repository
                  ? `${repository}/${path.trim()}`
                  : path.trim();
                void onAction("add", full, url.trim()).then((ok) => {
                  if (ok) {
                    setAdding(false);
                    setUrl("");
                    setPath("");
                  }
                });
              }}
            >
              <input
                aria-label="Submodule repository URL"
                placeholder="Repository URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
                required
              />
              <input
                aria-label="Submodule local path"
                placeholder="Path, e.g. packages/shared"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={busy}
                required
              />
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !url.trim() || !path.trim()}
                >
                  <Check size={12} /> Add submodule
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
