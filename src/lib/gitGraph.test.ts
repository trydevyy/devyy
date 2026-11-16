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

import { describe, expect, it } from "vitest";
import { graphLanes, type GraphCommit } from "./git";
const commit = (hash: string, parents: string[]): GraphCommit => ({
  hash,
  parents,
  short: hash,
  author: "Test",
  email: "test@example.test",
  date: "2026-11-13",
  subject: hash,
  refs: [],
  body: hash,
});
describe("commit graph topology", () => {
  it("connects both merge parents and retains the other lane until the common ancestor", () => {
    const rows = graphLanes([
      commit("merge", ["main", "feature"]),
      commit("main", ["root"]),
      commit("feature", ["root"]),
      commit("root", []),
    ]);
    expect(rows[0].edges).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 0 },
    ]);
    expect(rows[1].edges.some((edge) => edge.from === 1 && edge.to === 1)).toBe(
      true,
    );
    expect(rows[2].edges.some((edge) => edge.from === 1 && edge.to === 0)).toBe(
      true,
    );
    expect(rows[3].edges).toHaveLength(0);
    expect(rows.every((row) => row.edges.every((edge) => edge.to >= 0))).toBe(
      true,
    );
  });
  it("keeps independent branch heads apart and reuses empty lanes", () => {
    const rows = graphLanes([
      commit("one", ["parent"]),
      commit("two", []),
      commit("parent", []),
      commit("independent", []),
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(1);
    expect(rows[2].lane).toBe(0);
    expect(rows[3].lane).toBe(0);
  });
});
