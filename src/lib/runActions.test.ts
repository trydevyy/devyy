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
import { projectActions } from "../components/RunPanel";
describe("project run commands", () => {
  it("uses the project's package manager and scripts instead of Rust commands", () => {
    const actions = projectActions(["package.json", "pnpm-lock.yaml"], {
      dev: "vite",
      "test:unit": "vitest",
      "invalid;command": "invalid",
    });
    expect(actions.map((action) => action.command)).toEqual([
      "pnpm run dev",
      "pnpm run test:unit",
    ]);
    expect(actions[0].description).toBe("vite");
  });
  it("offers a debug build for Cargo projects and keeps unknown projects editable", () => {
    expect(
      projectActions(["Cargo.toml"]).find((action) => action.label === "Build")
        ?.command,
    ).toBe("cargo build");
    expect(projectActions(["README.md"])).toEqual([]);
  });
});
