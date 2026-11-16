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

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, LoaderCircle, Zap } from "lucide-react";
import { useSurfaceMotion } from "../lib/motion";
import type { AITool } from "../lib/ai";

function formatToolItem(tool: AITool) {
  const name = tool.name;
  const path = tool.path || (tool.args?.path as string) || "";
  const detail = tool.detail || "";

  if (name === "read_files") {
    const paths = Array.isArray(tool.args?.paths)
      ? tool.args.paths.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">
          {tool.status === "running"
            ? "Reading"
            : tool.status === "error"
              ? "Could not read"
              : "Read"}
        </span>
        <span className="ai-agent-item-file" title={paths.join("\n")}>
          {paths.length} files
        </span>
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }
  if (name === "read_file") {
    const filename = path.split("/").pop() || path || "file";
    let range = detail.startsWith("#L") ? detail : "";
    if (!range && tool.args?.start_line && tool.args?.end_line) {
      range = `#L${tool.args.start_line}-${tool.args.end_line}`;
    }
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">Analyzed</span>
        <Zap size={11} className="ai-agent-item-icon" aria-hidden="true" />
        <span className="ai-agent-item-file" title={path}>
          {filename}
        </span>
        {range && <span className="ai-agent-item-range">{range}</span>}
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (name === "run_command") {
    const cmd = detail || (tool.args?.command as string) || "command";
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">Ran {cmd}</span>
        <ChevronRight
          size={11}
          className="ai-agent-item-arrow"
          aria-hidden="true"
        />
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (name === "list_files") {
    const label = path ? `list ${path} files` : "list directory contents";
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">Ran {label}</span>
        <ChevronRight
          size={11}
          className="ai-agent-item-arrow"
          aria-hidden="true"
        />
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (name === "search_files") {
    const q = detail || (tool.args?.query as string) || path || "workspace";
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">Ran search for "{q}"</span>
        <ChevronRight
          size={11}
          className="ai-agent-item-arrow"
          aria-hidden="true"
        />
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (name === "find_files") {
    const pattern = detail || (tool.args?.pattern as string) || "files";
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">
          Ran find files matching "{pattern}"
        </span>
        <ChevronRight
          size={11}
          className="ai-agent-item-arrow"
          aria-hidden="true"
        />
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (name === "propose_edit") {
    const filename = path.split("/").pop() || path || "file";
    return (
      <div className="ai-agent-item" key={tool.id}>
        <span className="ai-agent-item-action">Proposed</span>
        <Zap size={11} className="ai-agent-item-icon" aria-hidden="true" />
        <span className="ai-agent-item-file" title={path}>
          {filename}
        </span>
        {tool.status === "running" && (
          <LoaderCircle size={10} className="spinning" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <div className="ai-agent-item" key={tool.id}>
      <span className="ai-agent-item-action">Ran {name}</span>
      <ChevronRight
        size={11}
        className="ai-agent-item-arrow"
        aria-hidden="true"
      />
      {tool.status === "running" && (
        <LoaderCircle size={10} className="spinning" aria-hidden="true" />
      )}
    </div>
  );
}

export default function AIThinking({
  text = "",
  tools,
  active = false,
  startedAt,
  finishedAt,
}: {
  text?: string;
  tools?: AITool[];
  active?: boolean;
  startedAt?: number;
  finishedAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(true);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const { transition, instant } = useSurfaceMotion();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);

  const hasTools = Boolean(tools && tools.length > 0);

  const elapsedSeconds = useMemo(() => {
    if (!startedAt) return 1;
    return Math.max(1, Math.floor((now - startedAt) / 1000));
  }, [startedAt, now]);

  const finishInfo = useMemo(() => {
    if (active) return null;
    const ts = finishedAt || (startedAt ? startedAt + 1000 : Date.now());
    const date = new Date(ts);
    return {
      timeStr: date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      fullDateTime: date.toLocaleString([], {
        dateStyle: "full",
        timeStyle: "medium",
      }),
    };
  }, [active, finishedAt, startedAt]);

  const buttonLabel = hasTools
    ? active
      ? `Worked for ${elapsedSeconds}s`
      : finishInfo
        ? `Finished at ${finishInfo.timeStr}`
        : "Finished"
    : active
      ? "Thinking"
      : "Thoughts";

  const groupLabel = useMemo(() => {
    if (!tools || !tools.length) return "Explored files, ran commands";
    const hasCmds = tools.some(
      (t) => t.name === "run_command" || t.name === "list_files",
    );
    const hasFiles = tools.some(
      (t) =>
        t.name === "read_file" ||
        t.name === "read_files" ||
        t.name === "find_files" ||
        t.name === "search_files",
    );
    if (hasCmds && hasFiles) return "Explored files, ran commands";
    if (hasCmds) return "Ran workspace commands";
    return "Analyzed workspace files";
  }, [tools]);

  return (
    <div
      className={`ai-thoughts ${active ? "active" : ""} ${hasTools ? "with-agent-tools" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label="Thinking summary"
        title={!active && finishInfo ? finishInfo.fullDateTime : undefined}
        className="ai-thoughts-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{buttonLabel}</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className="thoughts-chevron"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        {active && (
          <LoaderCircle size={12} className="spinning" aria-hidden="true" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="ai-thoughts-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
          >
            {hasTools ? (
              <div
                className="ai-agent-timeline"
                style={{ transition: instant ? "none" : undefined }}
              >
                <div className="ai-agent-group">
                  <button
                    type="button"
                    className="ai-agent-group-header"
                    onClick={() => setGroupOpen((prev) => !prev)}
                  >
                    <span>{groupLabel}</span>
                    <ChevronDown
                      size={12}
                      className="thoughts-chevron"
                      style={{
                        transform: groupOpen
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                      }}
                    />
                  </button>
                  {groupOpen && (
                    <div className="ai-agent-items">
                      {tools!.map((tool) => formatToolItem(tool))}
                    </div>
                  )}
                </div>

                {text.trim() && (
                  <div className="ai-agent-sub-thoughts">
                    <button
                      type="button"
                      className="ai-agent-group-header"
                      onClick={() => setThoughtsOpen((prev) => !prev)}
                    >
                      <span>Reasoning thoughts</span>
                      <ChevronDown
                        size={12}
                        className="thoughts-chevron"
                        style={{
                          transform: thoughtsOpen
                            ? "rotate(0deg)"
                            : "rotate(-90deg)",
                        }}
                      />
                    </button>
                    {thoughtsOpen && (
                      <div className="ai-thoughts-content">{text}</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="ai-thoughts-content"
                style={{ transition: instant ? "none" : undefined }}
              >
                {text}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
