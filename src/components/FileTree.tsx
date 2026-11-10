import { useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import {
  filename,
  language,
  type FileEntry,
  type GitChange,
} from "../lib/types";
export function FileIcon({ path, size = 15 }: { path: string; size?: number }) {
  const lang = language(path);
  const Icon =
    lang === "json"
      ? FileJson
      : lang === "markdown"
        ? FileText
        : lang === "text" || lang === "toml"
          ? File
          : FileCode2;
  return <Icon size={size} className={`file-icon file-${lang}`} />;
}
interface Props {
  files: FileEntry[];
  active: string;
  dirty: Set<string>;
  changes: GitChange[];
  onOpen: (path: string) => void;
  onNew: (directory: boolean) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
  onMenu: (e: React.MouseEvent, path: string) => void;
  onEmptyMenu: (e: React.MouseEvent) => void;
}
export default function FileTree(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src"]));
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
  function render(parent: string, depth: number): React.ReactNode {
    return (children.get(parent) ?? []).map((file) => {
      const open = expanded.has(file.path),
        change = changes.get(file.path);
      return (
        <div key={file.path}>
          <div
            className={`tree-row ${p.active === file.path ? "selected" : ""}`}
            style={{ paddingLeft: 14 + depth * 16 }}
            onContextMenu={(e) => p.onMenu(e, file.path)}
          >
            <button
              className="tree-file"
              onClick={() => {
                if (file.directory)
                  setExpanded((s) => {
                    const n = new Set(s);
                    n.has(file.path) ? n.delete(file.path) : n.add(file.path);
                    return n;
                  });
                else p.onOpen(file.path);
              }}
              title={file.path}
            >
              {file.directory ? (
                <>
                  <ChevronRight size={12} className={open ? "rotated" : ""} />
                  {open ? <FolderOpen size={15} /> : <Folder size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-spacer" />
                  <FileIcon path={file.path} />
                </>
              )}
              <span className="filename">{filename(file.path)}</span>
              {p.dirty.has(file.path) && <span className="dirty-dot" />}
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
                p.onMenu(e, file.path);
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
        className="file-tree"
        role="navigation"
        aria-label="Project files"
        onContextMenu={p.onEmptyMenu}
      >
        {render("", 0)}
      </div>
    </>
  );
}
