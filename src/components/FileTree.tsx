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
import { writeAIContextDrag } from "../lib/aiContext";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  MoreHorizontal,
  Plus,
  Pencil,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { filename, type FileEntry, type GitChange } from "../lib/types";
import FileIcon from "./FileIcon";
export { default as FileIcon } from "./FileIcon";

interface Props {
  root: string;
  files: FileEntry[];
  active: string;
  dirty: Set<string>;
  changes: GitChange[];
  expanded?: Set<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  onOpen: (path: string) => void;
  onExpand?: (path: string) => void;
  onNew: (directory: boolean) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
  onMenu: (e: React.MouseEvent, path: string, selectedPaths?: string[]) => void;
  onEmptyMenu: (e: React.MouseEvent) => void;
  onDropFiles?: (files: FileList | File[], targetDir?: string) => void;
  onMove: (path: string, destination: string) => Promise<void>;
}
const FILE_MOVE_MIME = "application/x-devyy-file-move";
export default function FileTree(p: Props) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
    () => p.expanded ?? new Set(["src"]),
  );
  const expanded = p.expanded ?? internalExpanded;
  const setExpanded = (
    updater: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => {
    const next = typeof updater === "function" ? updater(expanded) : updater;
    if (p.onExpandedChange) {
      p.onExpandedChange(next);
    } else {
      setInternalExpanded(next);
    }
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastFocused = useRef<string | null>(null);
  const [treeDropActive, setTreeDropActive] = useState(false);
  const [dragging, setDragging] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hovered = useRef<string | null>(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  function resetDrag() {
    clearTimeout(hoverTimer.current);
    hovered.current = null;
    setDragging("");
    setDropTarget(null);
    setTreeDropActive(false);
  }
  function canMove(target: string) {
    const destination = target
      ? `${target}/${filename(dragging)}`
      : filename(dragging);
    return (
      !!dragging &&
      target !== dragging &&
      !target.startsWith(dragging + "/") &&
      destination !== dragging
    );
  }
  function dragOver(event: React.DragEvent, target: string) {
    const internal = event.dataTransfer.types.includes(FILE_MOVE_MIME);
    if (!internal && !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    const accepted = internal ? canMove(target) : !!p.onDropFiles;
    event.dataTransfer.dropEffect = accepted
      ? internal
        ? "move"
        : "copy"
      : "none";
    setDropTarget(accepted ? target : null);
    setTreeDropActive(accepted && !target);
    if (hovered.current !== target) {
      clearTimeout(hoverTimer.current);
      hovered.current = target;
      if (accepted && target && !expanded.has(target))
        hoverTimer.current = setTimeout(() => {
          p.onExpand?.(target);
          setExpanded((old) => new Set([...old, target]));
        }, 650);
    }
  }
  function drop(event: React.DragEvent, target: string) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes(FILE_MOVE_MIME)) {
      try {
        const data = JSON.parse(event.dataTransfer.getData(FILE_MOVE_MIME));
        if (data.root === p.root && data.path === dragging && canMove(target)) {
          const destination = target
            ? `${target}/${filename(data.path)}`
            : filename(data.path);
          setMoveError("");
          if (target) setExpanded((old) => new Set([...old, target]));
          void p
            .onMove(data.path, destination)
            .catch((error) => setMoveError(String(error)));
        }
      } catch {
        setMoveError("Could not move this item. Try again.");
      }
    } else if (event.dataTransfer.files.length)
      p.onDropFiles?.(event.dataTransfer.files, target);
    resetDrag();
  }
  const children = useMemo(() => {
    const groups = new Map<string, FileEntry[]>();
    for (const file of p.files) {
      const parent = file.path.split("/").slice(0, -1).join("/");
      const siblings = groups.get(parent) ?? [];
      siblings.push(file);
      groups.set(parent, siblings);
    }
    for (const siblings of groups.values())
      siblings.sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
    return groups;
  }, [p.files]);
  const changes = useMemo(
    () => new Map(p.changes.map((c) => [c.path, c])),
    [p.changes],
  );
  const getVisiblePaths = () => {
    const list: string[] = [];
    const walk = (parent: string) => {
      for (const file of children.get(parent) ?? []) {
        list.push(file.path);
        if (file.directory && expanded.has(file.path)) {
          walk(file.path);
        }
      }
    };
    walk("");
    return list;
  };
  function render(parent: string, depth: number): React.ReactNode {
    return (children.get(parent) ?? []).map((file) => {
      const open = expanded.has(file.path),
        change = changes.get(file.path),
        isSelected = p.active === file.path || selected.has(file.path);
      return (
        <div key={file.path}>
          <div
            className={`tree-row ${isSelected ? "selected" : ""} ${dropTarget === file.path ? "tree-drop-target" : ""} ${dragging === file.path ? "tree-dragging" : ""}`}
            style={{ paddingLeft: 14 + depth * 16 }}
            onContextMenu={(e) => {
              if (selected.has(file.path) && selected.size > 1) {
                p.onMenu(e, file.path, Array.from(selected));
              } else {
                setSelected(new Set([file.path]));
                lastFocused.current = file.path;
                p.onMenu(e, file.path, [file.path]);
              }
            }}
            onDragOver={(e) => {
              if (file.directory) dragOver(e, file.path);
            }}
            onDrop={(e) => {
              if (file.directory) drop(e, file.path);
            }}
          >
            <button
              className="tree-file"
              draggable
              onDragStart={(event) => {
                setDragging(file.path);
                setMoveError("");
                event.dataTransfer.effectAllowed = "copyMove";
                const dragPaths =
                  selected.has(file.path) && selected.size > 1
                    ? Array.from(selected)
                    : [file.path];
                event.dataTransfer.setData(
                  FILE_MOVE_MIME,
                  JSON.stringify({
                    root: p.root,
                    path: file.path,
                    paths: dragPaths,
                  }),
                );
                event.dataTransfer.setData("text/plain", dragPaths.join("\n"));
                writeAIContextDrag(
                  event.dataTransfer,
                  dragPaths.map((itemPath) => {
                    const isDir = p.files.find(
                      (f) => f.path === itemPath,
                    )?.directory;
                    return {
                      kind: isDir ? "folder" : "file",
                      id: itemPath,
                    };
                  }),
                );
              }}
              onDragEnd={resetDrag}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  });
                  lastFocused.current = file.path;
                  return;
                }
                if (event.shiftKey && lastFocused.current) {
                  const visible = getVisiblePaths();
                  const from = visible.indexOf(lastFocused.current);
                  const to = visible.indexOf(file.path);
                  if (from !== -1 && to !== -1) {
                    const [start, end] = from < to ? [from, to] : [to, from];
                    setSelected(new Set(visible.slice(start, end + 1)));
                    return;
                  }
                }
                setSelected(new Set([file.path]));
                lastFocused.current = file.path;
                if (file.directory) {
                  if (!open) p.onExpand?.(file.path);
                  setExpanded((s) => {
                    const n = new Set(s);
                    n.has(file.path) ? n.delete(file.path) : n.add(file.path);
                    return n;
                  });
                } else p.onOpen(file.path);
              }}
              title={file.path}
            >
              {file.directory ? (
                <>
                  <ChevronRight size={12} className={open ? "rotated" : ""} />
                  <FileIcon path={file.path} directory expanded={open} />
                </>
              ) : (
                <>
                  <span className="tree-spacer" />
                  <FileIcon path={file.path} />
                </>
              )}
              <span className="filename">{filename(file.path)}</span>
              {dropTarget === file.path && (
                <small className="tree-drop-label">
                  {dragging ? "Move here" : "Copy here"}
                </small>
              )}
              {p.dirty.has(file.path) && (
                <Pencil size={10} aria-label="Unsaved changes" />
              )}
              {change && (
                <span className="git-letter">
                  {change.worktree.trim() || change.index}
                </span>
              )}
            </button>
            <button
              className="tree-more icon-button"
              aria-label={`Actions for ${file.path}`}
              onClick={(e) => {
                const paths =
                  selected.has(file.path) && selected.size > 1
                    ? Array.from(selected)
                    : [file.path];
                p.onMenu(e, file.path, paths);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {file.directory && open && render(file.path, depth + 1)}
        </div>
      );
    });
  }
  return (
    <>
      <div className="section-label">
        <span>FILES</span>
        <div className="section-actions">
          <button title="New file" onClick={() => p.onNew(false)}>
            <Plus size={14} />
          </button>
          <button title="New folder" onClick={() => p.onNew(true)}>
            <FolderPlus size={14} />
          </button>
          <button title="Refresh files" onClick={p.onRefresh}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      <div
        className={`file-tree ${treeDropActive ? "file-tree-drop-active" : ""}`}
        role="navigation"
        aria-label="Project files"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            e.stopPropagation();
            const visible = getVisiblePaths();
            setSelected(new Set(visible));
            return;
          }
          if (e.key === "Escape") {
            setSelected(new Set());
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const visible = getVisiblePaths();
            if (!visible.length) return;
            e.preventDefault();
            const currentPath = lastFocused.current ?? p.active;
            const idx = visible.indexOf(currentPath);
            let nextIdx = e.key === "ArrowDown" ? idx + 1 : idx - 1;
            if (idx === -1) nextIdx = 0;
            nextIdx = Math.max(0, Math.min(visible.length - 1, nextIdx));
            const nextPath = visible[nextIdx];
            lastFocused.current = nextPath;
            if (e.shiftKey) {
              setSelected((prev) => new Set([...prev, nextPath]));
            } else {
              setSelected(new Set([nextPath]));
            }
          }
        }}
        onContextMenu={p.onEmptyMenu}
        onDragOver={(e) => {
          dragOver(e, "");
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setTreeDropActive(false);
          setDropTarget(null);
          clearTimeout(hoverTimer.current);
          hovered.current = null;
        }}
        onDrop={(e) => {
          drop(e, "");
        }}
      >
        {render("", 0)}
        {treeDropActive && (
          <div className="tree-drop-hint">
            {dragging ? "Move to project folder" : "Copy to project folder"}
          </div>
        )}
      </div>
      {moveError && (
        <ErrorToast message={moveError} />
      )}
    </>
  );
}
