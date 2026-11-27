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

import { MotionModalSurface, ModalBody } from "./ui/ModalSurface";
import ModalBackdrop from "./ui/ModalBackdrop";
import { useIsPresent } from "motion/react";
import { modalFrameUpdate, useSurfaceMotion } from "../lib/motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Command,
  CornerDownLeft,
  Search,
  Clock3,
  X,
} from "lucide-react";
import FileIcon from "./FileIcon";
import ExtensionIcon from "./ExtensionIcon";
import AIProviderIcon from "./AIProviderIcon";
import { readLocal } from "../lib/types";
import { searchScore, searchHighlights } from "../lib/search";
export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  extension?: { id: string; icon?: string };
  run: () => void;
}
export default function Palette({
  mode,
  items,
  onClose,
  onModeChange,
}: {
  mode: "files" | "commands";
  items: PaletteItem[];
  onClose: () => void;
  onModeChange: (mode: "files" | "commands") => void;
}) {
  const { transition, instant } = useSurfaceMotion();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const present = useIsPresent();
  const [recent, setRecent] = useState(() =>
    readLocal<string[]>(`devyy.palette.${mode}`, []),
  );
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const filtered = useMemo(
    () =>
      items
        .map((item) => ({
          item,
          score: searchScore(query, item.label, item.detail),
        }))
        .filter(({ score }) => Number.isFinite(score))
        .sort(
          (a, b) =>
            a.score - b.score ||
            (query
              ? 0
              : (recent.indexOf(a.item.id) < 0
                  ? 999
                  : recent.indexOf(a.item.id)) -
                (recent.indexOf(b.item.id) < 0
                  ? 999
                  : recent.indexOf(b.item.id))),
        )
        .slice(0, 80)
        .map(({ item }) => item),
    [items, query, recent],
  );
  const selectedIndex = Math.max(0, Math.min(selected, filtered.length - 1));
  useLayoutEffect(() => {
    if (!present) return;
    setRecent(readLocal<string[]>(`devyy.palette.${mode}`, []));
    input.current?.focus();
    setQuery("");
    setSelected(0);
  }, [mode, present]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, query]);
  function choose(item: PaletteItem) {
    localStorage.setItem(
      `devyy.palette.${mode}`,
      JSON.stringify(
        [item.id, ...recent.filter((id) => id !== item.id)].slice(0, 20),
      ),
    );
    onClose();
    item.run();
  }
  return (
    <ModalBackdrop
      className="modal-backdrop palette-backdrop"
      onMouseDown={onClose}
    >
      <MotionModalSurface
        onUpdate={modalFrameUpdate}
        transition={transition}
        initial={{ y: instant ? 0 : -8 }}
        animate={{ y: 0 }}
        className="palette"
        role="dialog"
        aria-label={mode === "files" ? "Go to file" : "Command palette"}
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (
            ["ArrowDown", "ArrowUp"].includes(e.key) ||
            (e.altKey && (e.key === "Home" || e.key === "End"))
          ) {
            e.preventDefault();
            setSelected((s) =>
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? filtered.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        filtered.length - 1,
                        s + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
            );
          }
          if (
            e.key === "Enter" &&
            e.target === input.current &&
            !e.nativeEvent.isComposing &&
            filtered[selectedIndex]
          ) {
            e.preventDefault();
            choose(filtered[selectedIndex]);
          }
        }}
      >
        <header className="palette-chrome">
          <div className="palette-modes" role="group" aria-label="Search mode">
            <button
              className={mode === "files" ? "active" : ""}
              aria-pressed={mode === "files"}
              onClick={() => onModeChange("files")}
            >
              <Search size={13} /> Files
            </button>
            <button
              className={mode === "commands" ? "active" : ""}
              aria-pressed={mode === "commands"}
              onClick={() => onModeChange("commands")}
            >
              <Command size={13} /> Commands
            </button>
          </div>
          <div className="palette-input">
            {mode === "files" ? <Search size={16} /> : <Command size={16} />}
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "files" ? "Search files…" : "Search commands…"
              }
              aria-label="Search"
              aria-controls="palette-results"
              aria-activedescendant={
                filtered[selectedIndex]
                  ? `palette-option-${selectedIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="icon-button palette-close"
            aria-label="Close search"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <ModalBody flush>
          <div
            className="palette-results-heading"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>
              {query.trim()
                ? "Results"
                : mode === "files"
                  ? "Project files"
                  : "Commands"}
            </span>
            <span>{filtered.length === 80 ? "80 shown" : filtered.length}</span>
          </div>
          <div
            className="palette-list"
            id="palette-results"
            role="listbox"
            aria-label={mode === "files" ? "Files" : "Commands"}
            ref={list}
          >
            {filtered.map((item, i) => (
              <button
                role="option"
                aria-selected={i === selectedIndex}
                id={`palette-option-${i}`}
                key={item.id}
                data-index={i}
                className={i === selectedIndex ? "active" : ""}
                tabIndex={-1}
                onMouseMove={() => setSelected(i)}
                onClick={() => choose(item)}
              >
                {mode === "files" ? (
                  <FileIcon path={item.id} size={18} />
                ) : item.extension?.id === "openai.chatgpt" ? (
                  <AIProviderIcon kind="codex" size={18} />
                ) : item.extension?.id === "anthropic.claude-code" ? (
                  <AIProviderIcon kind="claude" size={18} />
                ) : item.extension ? (
                  <ExtensionIcon
                    id={item.extension.id}
                    fallback={item.extension.icon}
                    size={18}
                  />
                ) : (
                  <Command size={18} />
                )}
                <span className="palette-item-content">
                  <strong>
                    <Highlighted
                      text={
                        mode === "files"
                          ? (item.detail ?? item.label)
                          : item.label
                      }
                      query={query}
                      from={
                        mode === "files" && item.detail
                          ? item.detail.lastIndexOf("/") + 1
                          : 0
                      }
                    />
                  </strong>
                  {item.detail &&
                    (mode !== "files" || item.detail.includes("/")) && (
                      <small title={item.detail}>
                        <Highlighted
                          text={item.detail}
                          to={
                            mode === "files"
                              ? item.detail.lastIndexOf("/")
                              : undefined
                          }
                          query={query}
                        />
                      </small>
                    )}
                </span>
                {!query && recent.includes(item.id) && (
                  <Clock3
                    className="palette-recent-icon"
                    size={12}
                    aria-label="Recently opened"
                  />
                )}
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
                <CornerDownLeft
                  className="palette-enter"
                  size={14}
                  aria-hidden={i !== selectedIndex}
                />
              </button>
            ))}
            {!filtered.length && (
              <div className="palette-empty">
                <Search size={25} />
                <strong>
                  {!items.length && mode === "files"
                    ? "No project files"
                    : "No matches found"}
                </strong>
                <span>
                  {!items.length && mode === "files"
                    ? "Open a project to search its files."
                    : `Try another ${mode === "files" ? "file name or path" : "command name"}.`}
                </span>
              </div>
            )}
          </div>
        </ModalBody>
        <footer className="palette-footer">
          <span>
            <ArrowUp size={12} />
            <ArrowDown size={12} /> Navigate
          </span>
          <span>
            <CornerDownLeft size={12} />{" "}
            {mode === "files" ? "Open file" : "Run command"}
          </span>
          <span className="palette-escape">
            <kbd>esc</kbd> Close
          </span>
        </footer>
      </MotionModalSurface>
    </ModalBackdrop>
  );
}
function Highlighted({
  text,
  query,
  from = 0,
  to = text.length,
}: {
  text: string;
  query: string;
  from?: number;
  to?: number;
}) {
  let offset = 0;
  return searchHighlights(query, text).map((part, index) => {
    const start = offset;
    offset += part.text.length;
    const visible = part.text.slice(
      Math.max(0, from - start),
      Math.max(0, Math.min(part.text.length, to - start)),
    );
    if (!visible) return null;
    return part.match ? (
      <mark key={index}>{visible}</mark>
    ) : (
      <span key={index}>{visible}</span>
    );
  });
}
