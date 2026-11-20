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
import { parse } from "yaml";
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
    description:
      "Accelerated source control workflows using Hit: instant status, checkpointing, and branch operations.",
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
    description:
      "Automated regression testing, type checking, compiler verification, and test execution.",
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
    description:
      "Specialized idioms, borrow checker mastery, Tauri v2 bindings, and Cargo workspace architecture.",
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
    description:
      "React 19, Vite, state synchronization, Codemirror integration, and performant UI patterns.",
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
    description:
      "Surgical code modifications, preserving existing comments and conventions without full rewrites.",
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
  const frontmatter = content
    .trimStart()
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!frontmatter)
    throw new Error("Include YAML frontmatter between two --- lines.");
  const metadata: unknown = parse(frontmatter[1], { maxAliasCount: 0 });
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new Error("Skill metadata must be a YAML mapping.");
  }
  const fields = metadata as Record<string, unknown>;
  const details =
    typeof fields.metadata === "object" && fields.metadata !== null
      ? (fields.metadata as Record<string, unknown>)
      : {};
  const name = String(fields.name ?? fallbackId).trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(
      "Use a lowercase skill name with letters, numbers, and single hyphens.",
    );
  }
  if (typeof fields.description !== "string" || !fields.description.trim()) {
    throw new Error("Add a description to the skill metadata.");
  }
  const description = fields.description.trim();
  const body = frontmatter[2].trim();
  if (!body) throw new Error("Add instructions below the frontmatter.");
  const id = name;
  const title = String(fields.title ?? name);
  const version = String(details.version ?? fields.version ?? "1.0.0");
  const author = String(details.author ?? fields.author ?? "Community");
  const list = (values: unknown) =>
    Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : typeof values === "string"
        ? values.split(/\s+/).filter(Boolean)
        : [];
  const permissions = [
    ...new Set([...list(fields.permissions), ...list(fields["allowed-tools"])]),
  ];
  const dependencies = list(fields.dependencies);
  const tags = list(fields.tags);

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
    toggle: "off",
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
  sessionToggles: readLocal<Record<string, SkillToggle>>(
    SESSION_TOGGLES_KEY,
    {},
  ),
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
  try {
    const userSkills = skillState.skills.filter(
      (s) => s.source !== "builtin" || !s.installed,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userSkills));
    localStorage.setItem(
      SESSION_TOGGLES_KEY,
      JSON.stringify(skillState.sessionToggles),
    );
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

const sessionKey = (skillId: string, sessionId?: string) =>
  sessionId ? `${sessionId}:${skillId}` : skillId;

export function useSessionSkillToggles(): Record<string, SkillToggle> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => skillState.sessionToggles,
  );
}

export function setSkillToggle(
  skillId: string,
  toggle: SkillToggle,
  sessionId?: string,
) {
  skillState = {
    ...skillState,
    sessionToggles: {
      ...skillState.sessionToggles,
      [sessionKey(skillId, sessionId)]: toggle,
    },
  };
  emit();
}

export function installSkill(skill: AISkill) {
  const existing = skillState.skills.find((s) => s.id === skill.id);
  if (existing?.source === "builtin")
    throw new Error("That name belongs to a bundled skill.");
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
    skills: skillState.skills
      .filter((s) => s.id !== skillId || s.source === "builtin")
      .map((s) => (s.id === skillId ? { ...s, installed: false } : s)),
  };
  emit();
}

/**
 * Returns formatted instructions for active skills for prompt context
 */
export function skillToggle(
  skill: AISkill,
  toggles: Record<string, SkillToggle>,
  sessionId?: string,
) {
  return (
    toggles[sessionKey(skill.id, sessionId)] ??
    toggles[skill.id] ??
    skill.toggle
  );
}

export function getActiveSkillsPrompt(
  promptText = "",
  sessionId?: string,
): string {
  const activeSkills = skillState.skills.filter((s) => {
    if (!s.installed) return false;
    const toggle = skillToggle(s, skillState.sessionToggles, sessionId);
    if (toggle === "off") return false;
    if (toggle === "on") return true;
    // Auto: activate if prompt mentions relevant keywords/tags
    const lower = promptText.toLowerCase();
    return (
      s.tags.some((t) => lower.includes(t.toLowerCase())) ||
      lower.includes(s.name.toLowerCase())
    );
  });

  if (!activeSkills.length) return "";

  const sections = activeSkills.map(
    (s) => `### Skill: ${s.title} (v${s.version})\n${s.content.trim()}`,
  );

  return `\n\n[Active Skills]\n${sections.join("\n\n")}`;
}
