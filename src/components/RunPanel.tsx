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
import { Play } from "lucide-react";
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
  onRun,
}: {
  workspace: Workspace;
  onRun: (command: string) => void;
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
  const available = native && workspace.root !== "demo";
  return (
    <section className="sidebar-content run-content" aria-label="Run commands">
      {actions.length ? (
        <div
          className="run-project-actions"
          role="group"
          aria-label="Project commands"
        >
          {actions.map((action) => (
            <button
              key={action.command}
              disabled={!available}
              onClick={() => onRun(action.command)}
              title={action.description}
            >
              <Play size={14} />
              <span>
                <strong>{action.label}</strong>
                <code>{action.command}</code>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="run-empty">
          {available
            ? "No project tasks found. Run a command in the terminal."
            : "Open a local folder to run project tasks."}
        </p>
      )}
    </section>
  );
}
