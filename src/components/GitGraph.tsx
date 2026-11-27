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

import { useDialogMotion } from "../lib/motion";
import Skeleton from "./ui/Skeleton";
import { MotionModalSurface, ModalBody, ModalHeader } from "./ui/ModalSurface";
import { writeClipboardText } from "../lib/clipboard";
import ErrorToast from "./ui/ErrorToast";
import ModalBackdrop from "./ui/ModalBackdrop";
import Select from "./ui/Select";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, GitCommitHorizontal, RefreshCw, Search } from "lucide-react";
import { invoke } from "../lib/native";
import {
  graphLanes,
  type CommitFile,
  type GraphCommit,
  type GraphPage,
} from "../lib/git";
import FileIcon from "./FileIcon";
export default function GitGraph({
  repository,
  initialHash,
  initialParent = 0,
  onClose,
  onDiff,
}: {
  repository: string;
  initialHash?: string;
  initialParent?: number;
  onClose: () => void;
  onDiff: (
    hash: string,
    path: string,
    parent: number,
    parentHash?: string,
  ) => void;
}) {
  const [commits, setCommits] = useState<GraphCommit[]>([]),
    [more, setMore] = useState(false),
    [detached, setDetached] = useState<GraphCommit>(),
    [selected, setSelected] = useState(initialHash ?? ""),
    [parent, setParent] = useState(initialParent),
    [files, setFiles] = useState<CommitFile[]>([]),
    [busy, setBusy] = useState(true),
    [filesBusy, setFilesBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const dialog = useRef<HTMLDivElement>(null),
    ticket = useRef(0);
  const dialogMotion = useDialogMotion();
  const close = useRef(onClose);
  close.current = onClose;
  async function load(reset = false) {
    const current = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const page = await invoke<GraphPage>("git_graph", {
        repository,
        offset: reset ? 0 : commits.length,
        limit: 100,
      });
      if (current !== ticket.current) return;
      setCommits((old) => (reset ? page.commits : [...old, ...page.commits]));
      setMore(page.hasMore);
      if (reset) setSelected((old) => old || page.commits[0]?.hash || "");
    } catch (e) {
      if (current === ticket.current) setError(String(e));
    } finally {
      if (current === ticket.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load(true);
    return () => {
      ++ticket.current;
    };
  }, [repository]);
  useEffect(() => {
    if (!selected || commits.some((commit) => commit.hash === selected)) {
      setDetached(undefined);
      return;
    }
    let current = true;
    void invoke<GraphCommit>("git_commit_details", {
      repository,
      hash: selected,
    })
      .then((commit) => {
        if (current) setDetached(commit);
      })
      .catch((error) => {
        if (current) setError(String(error));
      });
    return () => {
      current = false;
    };
  }, [repository, selected, commits]);
  useEffect(() => {
    if (!selected) {
      setFiles([]);
      return;
    }
    let current = true;
    setFilesBusy(true);
    setFiles([]);
    void invoke<CommitFile[]>("git_commit_files", {
      repository,
      hash: selected,
      parent,
    })
      .then((value) => {
        if (current) setFiles(value);
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setFilesBusy(false);
      });
    return () => {
      current = false;
    };
  }, [repository, selected, parent]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,[tabindex='0']",
          ) ?? [],
        ).filter((el) => el.offsetParent !== null && el.tabIndex >= 0);
        if (e.shiftKey && document.activeElement === elements[0]) {
          e.preventDefault();
          elements.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === elements.at(-1)) {
          e.preventDefault();
          elements[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.isConnected && previous.focus();
    };
  }, []);
  const rows = useMemo(() => graphLanes(commits), [commits]),
    commit =
      commits.find((c) => c.hash === selected) ??
      (detached?.hash === selected ? detached : undefined),
    width = Math.max(3, ...rows.map((r) => r.width)) * 16 + 12;
  const filtered = rows.filter(({ commit }) =>
    `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const description = commit
    ? (commit.body.startsWith(commit.subject)
        ? commit.body.slice(commit.subject.length)
        : commit.body
      ).trim()
    : "";
  return createPortal(
    <ModalBackdrop
      className="modal-backdrop git-graph-backdrop"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <MotionModalSurface
        {...dialogMotion}
        className="git-graph"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Commit graph"
        data-escape-scope="active"
      >
        <ModalHeader
          title="Commit graph"
          icon={<GitCommitHorizontal size={17} />}
          onClose={onClose}
          closeLabel="Close commit graph"
        />
        <ModalBody flush>
          <header>
            <label>
              <Search size={14} />
              <input
                aria-label="Search commits"
                placeholder="Search commits, authors or branches…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Refresh commit graph"
              disabled={busy}
              onClick={() => void load(true)}
            >
              <RefreshCw size={15} />
            </button>
          </header>
          {error && <ErrorToast message={error} />}
          <div className="git-graph-body">
            <section
              className="git-graph-list"
              role="listbox"
              aria-label="Commits"
              onKeyDown={(event) => {
                const options = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="option"]',
                  ),
                );
                const index = options.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                if (index < 0) return;
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(options.length - 1, index + 1)
                    : event.key === "ArrowUp"
                      ? Math.max(0, index - 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? options.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                options[next]?.click();
                options[next]?.focus();
                options[next]?.scrollIntoView({ block: "nearest" });
              }}
            >
              {filtered.map(({ commit, lane, edges }, index) => (
                <button
                  key={commit.hash}
                  className={`git-graph-row ${selected === commit.hash ? "selected" : ""}`}
                  role="option"
                  aria-label={`${commit.subject} (${commit.short})`}
                  aria-selected={selected === commit.hash}
                  tabIndex={
                    selected === commit.hash ||
                    (index === 0 &&
                      !filtered.some((row) => row.commit.hash === selected))
                      ? 0
                      : -1
                  }
                  onClick={() => {
                    setParent(0);
                    setSelected(commit.hash);
                  }}
                >
                  <svg
                    width={query ? 28 : width}
                    height={52}
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  >
                    {!query &&
                      edges.map((edge, i) => (
                        <path
                          key={i}
                          d={`M${12 + edge.from * 16} ${edge.from === lane ? 22 : 0} C${12 + edge.from * 16} 38 ${12 + edge.to * 16} 38 ${12 + edge.to * 16} 52`}
                          className={`graph-lane graph-color-${edge.color % 6}`}
                          fill="none"
                        />
                      ))}
                    {!query && lane >= 0 && (
                      <path
                        d={`M${12 + lane * 16} 0 V22`}
                        className={`graph-lane graph-color-${lane % 6}`}
                      />
                    )}
                    <circle
                      cx={query ? 12 : 12 + lane * 16}
                      cy={22}
                      r={4}
                      className={`graph-node graph-color-${lane % 6}`}
                    />
                  </svg>
                  <span>
                    <strong>{commit.subject}</strong>
                    <small>
                      {commit.author}
                      <time dateTime={commit.date}>
                        {new Date(commit.date).toLocaleDateString()}
                      </time>
                    </small>
                    {!!commit.refs.length && (
                      <span className="git-graph-refs">
                        {commit.refs.map((ref) => (
                          <i key={ref}>{ref}</i>
                        ))}
                      </span>
                    )}
                  </span>
                  <code>{commit.short}</code>
                </button>
              ))}
              {!busy && !filtered.length && (
                <p className="muted">
                  {query ? "No matching commits" : "No commits yet"}
                </p>
              )}
              {more && (
                <button
                  className="git-graph-more"
                  aria-busy={busy}
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Load older commits
                </button>
              )}
              {busy && (
                <Skeleton variant="sidebar" label="Loading commit graph" />
              )}
            </section>
            <section className="git-commit-detail" aria-label="Commit details">
              {!commit && busy && (
                <Skeleton variant="table" label="Loading commit details" />
              )}
              {commit && (
                <>
                  <h2>{commit.subject}</h2>
                  <p>
                    {commit.author} <span>{commit.email}</span>
                  </p>
                  <time dateTime={commit.date}>
                    {new Date(commit.date).toLocaleString()}
                  </time>
                  <button
                    className="git-hash"
                    onClick={() =>
                      void writeClipboardText(commit.hash).catch(() =>
                        setError("Could not copy commit hash"),
                      )
                    }
                  >
                    <Copy size={12} />
                    {commit.hash}
                  </button>
                  {description && <pre>{description}</pre>}
                  <label>
                    Compare with
                    <Select
                      aria-label="Commit parent"
                      value={parent}
                      onChange={(e) => setParent(Number(e.target.value))}
                    >
                      {commit.parents.length ? (
                        commit.parents.map((hash, i) => (
                          <option key={hash} value={i}>
                            Parent {i + 1}: {hash.slice(0, 10)}
                          </option>
                        ))
                      ) : (
                        <option value={0}>Empty tree (initial commit)</option>
                      )}
                    </Select>
                  </label>
                  <h3>
                    Changed files <small>{files.length}</small>
                  </h3>
                  {filesBusy ? (
                    <Skeleton variant="sidebar" label="Loading changed files" />
                  ) : (
                    files.map((file) => (
                      <button
                        className="git-commit-file"
                        key={file.path}
                        title={
                          file.oldPath
                            ? `${file.oldPath} → ${file.path}`
                            : file.path
                        }
                        onClick={() =>
                          onDiff(
                            commit.hash,
                            file.path,
                            parent,
                            commit.parents[parent],
                          )
                        }
                      >
                        <FileIcon path={file.path} />
                        <span className="git-commit-file-label">
                          {file.path}
                          {file.oldPath && <small>{file.oldPath}</small>}
                        </span>
                        <i>{file.status}</i>
                      </button>
                    ))
                  )}
                </>
              )}
            </section>
          </div>
        </ModalBody>
      </MotionModalSurface>
    </ModalBackdrop>,
    document.body,
  );
}
