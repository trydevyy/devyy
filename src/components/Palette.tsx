import { motion } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Command,
  CornerDownLeft,
  Search,
  X,
} from "lucide-react";
import FileIcon from "./FileIcon";
import ExtensionIcon from "./ExtensionIcon";
import AIProviderIcon from "./AIProviderIcon";
import { readLocal } from "../lib/types";
import { searchScore } from "../lib/search";
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
  const recent = useMemo(
    () => readLocal<string[]>(`devyy.palette.${mode}`, []),
    [mode],
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
  useEffect(() => {
    input.current?.focus();
    setQuery("");
    setSelected(0);
  }, [mode]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
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
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.div
        layout
        transition={transition}
        initial={{ opacity: 0, scale: instant ? 1 : 0.97, y: instant ? 0 : -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
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
          if (e.key === "Enter" && filtered[selected]) {
            e.preventDefault();
            choose(filtered[selected]);
          }
        }}
      >
        <div className="palette-modes">
          <button
            className={mode === "files" ? "active" : ""}
            onClick={() => onModeChange("files")}
          >
            <Search size={13} /> Files
          </button>
          <button
            className={mode === "commands" ? "active" : ""}
            onClick={() => onModeChange("commands")}
          >
            <Command size={13} /> Commands
          </button>
          <button
            className="icon-button"
            aria-label="Close search"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="palette-input">
          {mode === "files" ? <Search size={20} /> : <Command size={20} />}
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
              filtered[selected] ? `palette-option-${selected}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>esc</kbd>
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
              aria-selected={i === selected}
              id={`palette-option-${i}`}
              key={item.id}
              data-index={i}
              className={i === selected ? "active" : ""}
              onMouseEnter={() => setSelected(i)}
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
                <strong>{item.label}</strong>
                {item.detail && <small>{item.detail}</small>}
              </span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {i === selected && <CornerDownLeft size={14} />}
            </button>
          ))}
          {!filtered.length && (
            <div className="palette-empty">
              <Search size={25} />
              <strong>No matches found</strong>
              <span>Try a file name, path, or a few letters in order.</span>
            </div>
          )}
        </div>
        <div className="palette-footer">
          <span>
            <ArrowUp size={12} />
            <ArrowDown size={12} /> Navigate
          </span>
          <span>
            <CornerDownLeft size={12} /> Open
          </span>
        </div>
      </motion.div>
    </div>
  );
}
