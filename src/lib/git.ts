export interface GitBranchInfo {
  name: string;
  reference: string;
  current: boolean;
  remote: boolean;
  upstream?: string | null;
  worktree?: string | null;
  commit: string;
  subject: string;
}
export interface GitSubmodule {
  path: string;
  parent: string;
  expected: string;
  head?: string | null;
  branch?: string | null;
  initialized: boolean;
  dirty: boolean;
  conflict: boolean;
}
export type GitBranchAction = "fetch" | "rename" | "delete" | "merge";
export type GitSubmoduleAction = "update" | "sync" | "add";
