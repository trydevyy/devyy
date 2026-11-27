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

import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { highlighting } from "./Editor";
import {
  MergeView,
  unifiedMergeView,
  getChunks,
  goToNextChunk,
  goToPreviousChunk,
} from "@codemirror/merge";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Columns2,
  Rows2,
  RefreshCw,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { searchKeymap } from "@codemirror/search";
import { devyySearch } from "../lib/findPanel";
import {
  detectContentLanguage,
  languageDescription,
  loadDocumentLanguage,
} from "../lib/languages";
import type { Settings } from "../lib/types";

export interface Comparison {
  title: string;
  path?: string;
  original: string;
  modified: string;
  binary?: boolean;
  staged?: boolean;
  source: "git" | "extension" | "ai" | "history";
  proposalId?: string;
  commitHash?: string;
  parentIndex?: number;
  workspaceRoot?: string;
  create?: boolean;
  originalLabel?: string;
  modifiedLabel?: string;
}
export default function DiffEditor({
  document,
  active,
  settings,
  busy,
  onClose,
  onOpen,
  onRefresh,
  onStage,
  onApply,
  onApplyAll,
  onHistory,
}: {
  document: Comparison;
  active: boolean;
  settings: Settings;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRefresh: () => void;
  onStage: () => void;
  onApply?: () => void;
  onApplyAll?: () => void;
  onHistory?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      view.current?.requestMeasure();
      view.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const [inline, setInline] = useState(false);
  const [collapse, setCollapse] = useState(true);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!host.current || document.binary) {
      setCount(0);
      return;
    }
    let disposed = false;
    let cleanup = () => {};
    const path = document.path ?? "";
    const inferred = !languageDescription(path)
      ? (detectContentLanguage(document.modified) ??
        detectContentLanguage(document.original))
      : undefined;
    void loadDocumentLanguage(path, inferred)
      .catch(() => null)
      .then((support) => {
        if (disposed || !host.current) return;
        const extensions = [
          devyySearch(),
          lineNumbers(),
          keymap.of(searchKeymap),
          syntaxHighlighting(highlighting),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                color: "var(--ink)",
                backgroundColor: "transparent",
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "var(--mono)",
                fontSize: `${settings.fontSize}px`,
                lineHeight: String(settings.lineHeight),
              },
              ".cm-gutters": {
                backgroundColor: "transparent",
                color: "var(--faint)",
                border: "none",
              },
              ".cm-content": { padding: "12px 0" },
              "&.cm-focused": { outline: "none" },
            },
            { dark: settings.theme !== "paper" },
          ),
          ...(support ? [support] : []),
        ];
        const collapseUnchanged = collapse
          ? { margin: 3, minSize: 8 }
          : undefined;
        if (inline) {
          const editor = new EditorView({
            parent: host.current,
            doc: document.modified,
            extensions: [
              ...extensions,
              unifiedMergeView({
                original: document.original,
                mergeControls: false,
                collapseUnchanged,
              }),
            ],
          });
          view.current = editor;
          setCount(getChunks(editor.state)?.chunks.length ?? 0);
          cleanup = () => editor.destroy();
        } else {
          const merge = new MergeView({
            parent: host.current,
            a: { doc: document.original, extensions },
            b: { doc: document.modified, extensions },
            collapseUnchanged,
            highlightChanges: true,
            gutter: true,
          });
          view.current = merge.b;
          setCount(merge.chunks.length);
          const syncA = () => {
            if (
              Math.abs(
                merge.b.scrollDOM.scrollTop - merge.a.scrollDOM.scrollTop,
              ) > 1
            )
              merge.b.scrollDOM.scrollTop = merge.a.scrollDOM.scrollTop;
          };
          const syncB = () => {
            if (
              Math.abs(
                merge.a.scrollDOM.scrollTop - merge.b.scrollDOM.scrollTop,
              ) > 1
            )
              merge.a.scrollDOM.scrollTop = merge.b.scrollDOM.scrollTop;
          };
          merge.a.scrollDOM.addEventListener("scroll", syncA, {
            passive: true,
          });
          merge.b.scrollDOM.addEventListener("scroll", syncB, {
            passive: true,
          });
          cleanup = () => {
            merge.a.scrollDOM.removeEventListener("scroll", syncA);
            merge.b.scrollDOM.removeEventListener("scroll", syncB);
            merge.destroy();
          };
        }
        if (activeRef.current) view.current?.focus();
      });
    return () => {
      disposed = true;
      view.current = null;
      cleanup();
    };
  }, [
    document,
    inline,
    collapse,
    settings.fontSize,
    settings.lineHeight,
    settings.theme,
  ]);
  return (
    <section className="diff-editor" aria-label={`Diff: ${document.title}`}>
      <div className="diff-toolbar">
        <strong title={document.path}>{document.title}</strong>
        <span className="muted" role="status">
          {document.binary
            ? "Binary file"
            : `${count} ${count === 1 ? "change" : "changes"}`}
        </span>
        <div className="diff-tools">
          <button
            className="icon-button"
            aria-label="Previous change"
            disabled={!count}
            onClick={() => {
              if (view.current) {
                goToPreviousChunk(view.current);
                view.current.focus();
              }
            }}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Next change"
            disabled={!count}
            onClick={() => {
              if (view.current) {
                goToNextChunk(view.current);
                view.current.focus();
              }
            }}
          >
            <ArrowDown size={14} />
          </button>
          <button
            className="icon-button"
            aria-label={inline ? "Show side-by-side diff" : "Show inline diff"}
            onClick={() => setInline((value) => !value)}
          >
            {inline ? <Columns2 size={14} /> : <Rows2 size={14} />}
          </button>
          <button
            className="diff-toggle"
            aria-pressed={!collapse}
            onClick={() => setCollapse((value) => !value)}
          >
            Unchanged lines
          </button>
          {document.source === "ai" && (
            <>
              <button className="diff-action" onClick={onApply}>
                Apply to editor
              </button>
              {onApplyAll && (
                <button
                  className="diff-action"
                  onClick={onApplyAll}
                  title="Approve and apply all pending proposals"
                >
                  Approve all
                </button>
              )}
            </>
          )}
          {document.source === "history" && onHistory && (
            <button className="diff-action" onClick={onHistory}>
              Back to commit graph
            </button>
          )}
          {document.source === "git" && (
            <>
              <button
                className="icon-button"
                aria-label="Refresh diff"
                disabled={busy}
                onClick={onRefresh}
              >
                <RefreshCw size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Open working file"
                onClick={onOpen}
              >
                <ArrowUpRight size={14} />
              </button>
              <button className="diff-action" disabled={busy} onClick={onStage}>
                {document.staged ? <Minus size={13} /> : <Plus size={13} />}{" "}
                {document.staged ? "Unstage file" : "Stage file"}
              </button>
            </>
          )}
          <button
            className="icon-button"
            aria-label="Close diff"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {!inline && !document.binary && (
        <div className="diff-column-labels">
          <span>
            {document.originalLabel ??
              (document.source === "git"
                ? document.staged
                  ? "HEAD"
                  : "Index"
                : "Original")}
          </span>
          <span>
            {document.modifiedLabel ??
              (document.source === "git"
                ? document.staged
                  ? "Index"
                  : "Saved working tree"
                : "Modified")}
          </span>
        </div>
      )}
      {document.binary ? (
        <div className="diff-empty">
          This binary file can be staged or opened with its associated
          application.
        </div>
      ) : (
        <div className="diff-code" ref={host} />
      )}
    </section>
  );
}
