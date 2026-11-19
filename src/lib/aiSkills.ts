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

import { useSyncExternalStore } from "react";
import { readLocal } from "./types";

export type SkillToggle = "auto" | "on" | "off";

export interface AISkill {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  author: string;
  source: "builtin" | "workspace" | "user" | "community";
  permissions: string[];
  dependencies: string[];
  installed: boolean;
  content: string; // The markdown body or instructions
  scripts?: Record<string, string>;
  examples?: string[];
  tags: string[];
  toggle: SkillToggle;
}

const BUILTIN_SKILLS: AISkill[] = [
  {
    id: "hit-vcs",
    name: "hit-vcs",
    title: "Hit High-Performance VCS",
    description: "Accelerated source control workflows using Hit: instant status, checkpointing, and branch operations.",
    version: "1.0.0",
    author: "Hit Core Team",
    source: "builtin",
    permissions: ["vcs_status", "vcs_diff", "vcs_checkpoint"],
    dependencies: ["hit"],
    installed: true,
    tags: ["vcs", "hit", "git", "checkpoints", "speed"],
    toggle: "auto",
    content: `### Hit High-Performance Source Control Skill
- Hit is the active default VCS inside Devyy.
- Use 'vcs_status' to check repository branches, upstream status, and dirty files.
- Before complex multi-step refactoring, create a checkpoint using 'vcs_checkpoint' with a descriptive label.
- Use 'vcs_diff' to inspect exact hunk diffs before finalizing edits.
- Take advantage of Hit's parallel object streaming and fast index caching.`,
  },
  {
    id: "qa-auditor",
    name: "qa-auditor",
    title: "Quality Assurance & Verifier",
    description: "Automated regression testing, type checking, compiler verification, and test execution.",
    version: "1.1.0",
    author: "Devyy Team",
    source: "builtin",
    permissions: ["qa_check", "run_command"],
    dependencies: ["cargo", "npm", "tsc"],
    installed: true,
    tags: ["qa", "testing", "compiler", "typecheck", "verification"],
    toggle: "auto",
    content: `### Quality Assurance & Automated Verification Skill
- Always verify changes before marking tasks complete.
- For Rust codebases, execute 'cargo check' or 'cargo test' to ensure compile-time soundness.
- For TypeScript/JavaScript projects, execute 'npm run check' or 'npx tsc --noEmit' to ensure type correctness.
- NEVER alter existing test assertions solely to make broken code pass; fix the underlying logic.
- Keep validation runs focused to avoid running excessively large end-to-end suites unnecessarily.`,
  },
  {
    id: "rust-developer",
    name: "rust-developer",
    title: "Rust System Engineer",
    description: "Specialized idioms, borrow checker mastery, Tauri v2 bindings, and Cargo workspace architecture.",
    version: "1.0.2",
    author: "Devyy Team",
    source: "builtin",
    permissions: ["run_command", "read_file", "write_file"],
    dependencies: ["rustc", "cargo"],
    installed: true,
    tags: ["rust", "cargo", "tauri", "concurrency", "systems"],
    toggle: "auto",
    content: `### Rust System Engineering Skill
- Follow idiomatic Rust patterns (Result/Option chaining, RAII, thiserror/anyhow).
- For Tauri v2 integrations, register commands in generate_handler! and manage shared state cleanly.
- Keep allocations minimal; prefer references and zero-copy slicing where sensible.
- Respect compiler warnings: treat warnings seriously and address unused/dead code or mutability issues.`,
  },
  {
    id: "fullstack-react",
    name: "fullstack-react",
    title: "Fullstack React & TypeScript",
    description: "React 19, Vite, state synchronization, Codemirror integration, and performant UI patterns.",
    version: "1.2.0",
    author: "Devyy Team",
    source: "builtin",
    permissions: ["read_file", "write_file", "propose_edit"],
    dependencies: ["typescript", "react"],
    installed: true,
    tags: ["react", "typescript", "vite", "ui", "codemirror"],
    toggle: "auto",
    content: `### Fullstack React & TypeScript Skill
- Build reactive components using modern React patterns with strict type safety.
- Keep UI operations responsive by avoiding costly synchronous computations in the render cycle.
- Leverage useSyncExternalStore or established patterns for global state subscriptions.
- Ensure all interactive elements include accessible aria labels and keyboard shortcuts.`,
  },
  {
    id: "refactoring-pro",
    name: "refactoring-pro",
    title: "Minimal Diff Refactoring",
    description: "Surgical code modifications, preserving existing comments and conventions without full rewrites.",
    version: "1.0.0",
    author: "Devyy Team",
    source: "builtin",
    permissions: ["propose_edit", "read_file"],
    dependencies: [],
    installed: true,
    tags: ["refactoring", "clean-code", "diffs", "architecture"],
    toggle: "auto",
    content: `### Minimal Diff Refactoring Skill
- Avoid whole-file rewrites: preserve unchanged code, imports, comments, and structure.
- Adhere to the existing repository code style, naming conventions, and line breaks.
- Introduce helper functions or types incrementally without disrupting neighboring interfaces.
- Separate large multi-file migrations into distinct logical phases with checkpoints.`,
  },
];

/**
 * Parses official SKILL.md format (YAML frontmatter + Markdown body)
 */
export function parseSkillMd(content: string, fallbackId = ""): AISkill {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const metadata: Record<string, unknown> = {};
  let body = content;

  if (frontmatterMatch) {
    const rawYaml = frontmatterMatch[1];
    body = frontmatterMatch[2].trim();
    rawYaml.split("\n").forEach((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Simple YAML array or string parsing
        if (value.startsWith("[") && value.endsWith("]")) {
          try {
            metadata[key] = JSON.parse(value);
          } catch {
            metadata[key] = value.slice(1, -1).split(",").map((s) => s.trim());
          }
        } else {
          // Strip surrounding quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          metadata[key] = value;
        }
      }
    });
  }

  const id = String(metadata.id || metadata.name || fallbackId || `skill-${Date.now()}`);
  const name = String(metadata.name || id);
  const title = String(metadata.title || name);
  const description = String(metadata.description || "");
  const version = String(metadata.version || "1.0.0");
  const author = String(metadata.author || "Community");
  const permissions = Array.isArray(metadata.permissions) ? (metadata.permissions as string[]) : [];
  const dependencies = Array.isArray(metadata.dependencies) ? (metadata.dependencies as string[]) : [];
  const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : [];

  return {
    id,
    name,
    title,
    description,
    version,
    author,
    source: "community",
    permissions,
    dependencies,
    installed: true,
    content: body,
    tags,
    toggle: "auto",
  };
}

interface SkillStoreState {
  skills: AISkill[];
  sessionToggles: Record<string, SkillToggle>; // skillId -> toggle
}

const STORAGE_KEY = "devyy.ai.skills";
const SESSION_TOGGLES_KEY = "devyy.ai.skillToggles";

function loadSkills(): AISkill[] {
  const saved = readLocal<AISkill[]>(STORAGE_KEY, []);
  const map = new Map<string, AISkill>();
  BUILTIN_SKILLS.forEach((s) => map.set(s.id, { ...s }));
  saved.forEach((s) => map.set(s.id, s));
  return Array.from(map.values());
}

let skillState: SkillStoreState = {
  skills: loadSkills(),
  sessionToggles: readLocal<Record<string, SkillToggle>>(SESSION_TOGGLES_KEY, {}),
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
  try {
    const userSkills = skillState.skills.filter((s) => s.source !== "builtin" || !s.installed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userSkills));
    localStorage.setItem(SESSION_TOGGLES_KEY, JSON.stringify(skillState.sessionToggles));
  } catch {}
}

export function useSkills(): AISkill[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => skillState.skills,
  );
}

export function useSessionSkillToggles(): Record<string, SkillToggle> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => skillState.sessionToggles,
  );
}

export function setSkillToggle(skillId: string, toggle: SkillToggle) {
  skillState = {
    ...skillState,
    sessionToggles: {
      ...skillState.sessionToggles,
      [skillId]: toggle,
    },
    skills: skillState.skills.map((s) =>
      s.id === skillId ? { ...s, toggle } : s,
    ),
  };
  emit();
}

export function installSkill(skill: AISkill) {
  const existing = skillState.skills.find((s) => s.id === skill.id);
  if (existing) {
    skillState = {
      ...skillState,
      skills: skillState.skills.map((s) =>
        s.id === skill.id ? { ...skill, installed: true } : s,
      ),
    };
  } else {
    skillState = {
      ...skillState,
      skills: [...skillState.skills, { ...skill, installed: true }],
    };
  }
  emit();
}

export function removeSkill(skillId: string) {
  skillState = {
    ...skillState,
    skills: skillState.skills.filter((s) => s.id !== skillId || s.source === "builtin").map((s) =>
      s.id === skillId ? { ...s, installed: false } : s,
    ),
  };
  emit();
}

/**
 * Returns formatted instructions for active skills for prompt context
 */
export function getActiveSkillsPrompt(promptText = ""): string {
  const activeSkills = skillState.skills.filter((s) => {
    if (!s.installed) return false;
    const toggle = skillState.sessionToggles[s.id] ?? s.toggle;
    if (toggle === "off") return false;
    if (toggle === "on") return true;
    // Auto: activate if prompt mentions relevant keywords/tags
    const lower = promptText.toLowerCase();
    return s.tags.some((t) => lower.includes(t.toLowerCase())) ||
      lower.includes(s.name.toLowerCase());
  });

  if (!activeSkills.length) return "";

  const sections = activeSkills.map(
    (s) => `### Skill: ${s.title} (v${s.version})\n${s.content.trim()}`,
  );

  return `\n\n[Active Skills]\n${sections.join("\n\n")}`;
}
