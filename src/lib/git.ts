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
export interface GraphCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
  body: string;
}
export interface CommitFile {
  path: string;
  oldPath?: string;
  status: string;
}
export interface GraphPage {
  commits: GraphCommit[];
  hasMore: boolean;
}
export function graphLanes(commits: GraphCommit[]) {
  let lanes: (string | null)[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = commit.hash;
    }
    const before = [...lanes];
    lanes[lane] = null;
    for (const [index, parent] of commit.parents.entries()) {
      if (!lanes.includes(parent)) {
        let slot =
          index === 0 && lanes[lane] === null ? lane : lanes.indexOf(null);
        if (slot < 0) slot = lanes.length;
        lanes[slot] = parent;
      }
    }
    const edges: { from: number; to: number; color: number }[] = [];
    before.forEach((hash, from) => {
      if (hash && hash !== commit.hash) {
        const to = lanes.indexOf(hash);
        if (to >= 0) edges.push({ from, to, color: from });
      }
    });
    commit.parents.forEach((parent) =>
      edges.push({ from: lane, to: lanes.indexOf(parent), color: lane }),
    );
    const width = Math.max(before.length, lanes.length, 1);
    while (lanes.at(-1) === null) lanes.pop();
    return { commit, lane, edges, width };
  });
}
