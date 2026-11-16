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

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Hammer,
  Play,
  TerminalSquare,
} from "lucide-react";
import { invoke, native } from "../lib/native";
import type { Workspace } from "../lib/types";
interface Action {
  label: string;
  command: string;
  description: string;
}
export function projectActions(
  files: string[],
  scripts?: Record<string, string>,
): Action[] {
  if (files.includes("Cargo.toml"))
    return [
      {
        label: "Run",
        command: "cargo run",
        description: "Start the application",
      },
      {
        label: "Check",
        command: "cargo check",
        description: "Check code without building a binary",
      },
      {
        label: "Test",
        command: "cargo test",
        description: "Run project tests",
      },
      {
        label: "Build",
        command: "cargo build",
        description: "Build with debug symbols",
      },
      {
        label: "Release build",
        command: "cargo build --release",
        description: "Build an optimized binary",
      },
    ];
  if (scripts) {
    const manager = files.includes("pnpm-lock.yaml")
      ? "pnpm"
      : files.includes("bun.lock") || files.includes("bun.lockb")
        ? "bun"
        : files.includes("yarn.lock")
          ? "yarn"
          : "npm";
    return Object.entries(scripts)
      .filter(
        ([name, value]) => /^[\w:.-]+$/.test(name) && typeof value === "string",
      )
      .slice(0, 30)
      .map(([name, value]) => ({
        label: name,
        command: `${manager} run ${name}`,
        description: value,
      }));
  }
  if (files.some((file) => /(?:pyproject\.toml|requirements\.txt)$/.test(file)))
    return [
      {
        label: "Test",
        command: "python -m pytest",
        description: "Run tests with pytest",
      },
    ];
  return [];
}
export default function RunPanel({
  workspace,
  command,
  onChange,
  onRun,
}: {
  workspace: Workspace;
  command: string;
  onChange: (command: string) => void;
  onRun: () => void;
}) {
  const [scripts, setScripts] = useState<Record<string, string>>();
  useEffect(() => {
    let current = true;
    setScripts(undefined);
    if (
      native &&
      workspace.root !== "demo" &&
      workspace.files.some((file) => file.path === "package.json")
    )
      void invoke<{ content: string }>("read_file", { path: "package.json" })
        .then((file) => {
          const value = JSON.parse(file.content);
          if (current && value.scripts && typeof value.scripts === "object")
            setScripts(value.scripts);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [workspace.root]);
  const actions = projectActions(
    workspace.files.map((file) => file.path),
    scripts,
  );
  useEffect(() => {
    if (
      command === "cargo run" &&
      !workspace.files.some((file) => file.path === "Cargo.toml") &&
      actions.length
    )
      onChange(actions[0].command);
  }, [workspace.root, scripts]);
  const available = native && workspace.root !== "demo";
  const selected = actions.find((action) => action.command === command);
  return (
    <section className="sidebar-content run-content" aria-label="Run commands">
      <div className="run-section-heading">
        <span className="run-heading-icon">
          <TerminalSquare size={18} />
        </span>
        <span>
          <strong>Project tasks</strong>
          <small>
            {workspace.root === "demo"
              ? "Open a folder to run your project"
              : workspace.name}
          </small>
        </span>
      </div>
      {!!actions.length && (
        <div
          className="run-project-actions"
          role="group"
          aria-label="Project commands"
        >
          {actions.map((action) => (
            <button
              key={action.command}
              className={selected === action ? "selected" : ""}
              onClick={() => onChange(action.command)}
              title={action.description}
              aria-pressed={selected === action}
            >
              <Hammer size={14} />
              <span>
                <strong>{action.label}</strong>
                <code>{action.command}</code>
              </span>
              {selected === action ? (
                <Check size={13} />
              ) : (
                <ArrowUpRight size={12} />
              )}
            </button>
          ))}
        </div>
      )}
      {!actions.length && (
        <p className="run-empty">
          No project tasks found. Enter a command below to run it in the
          terminal.
        </p>
      )}
      <form
        className="run-command-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (available && command.trim()) onRun();
        }}
      >
        <label className="field-label" htmlFor="run-command">
          {selected ? "Selected command" : "Custom command"}
        </label>
        <input
          className="text-input mono"
          id="run-command"
          value={command}
          onChange={(event) => onChange(event.target.value)}
          placeholder="npm run dev"
        />
        <button
          className="primary full"
          aria-label="Run command"
          title={
            available
              ? "Run in the integrated terminal"
              : "Open a local folder in the desktop app to run commands"
          }
          type="submit"
          disabled={!available || !command.trim()}
        >
          <Play size={14} />
          {selected
            ? selected.label === "Run"
              ? "Run project"
              : `Run ${selected.label.toLowerCase()}`
            : "Run command"}
          <ArrowUpRight size={13} />
        </button>
        <small>Saves changes before running in the terminal.</small>
      </form>
    </section>
  );
}
