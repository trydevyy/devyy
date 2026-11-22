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

import { expect, it } from "vitest";
import { resolveOpenTarget, sameWorkspacePath } from "./openTargets";
it("opens files in the existing workspace with a component boundary", () => {
  expect(
    resolveOpenTarget(
      { path: "/work/project/src/main.rs", directory: false },
      "/work/project",
    ),
  ).toEqual({ file: "src/main.rs" });
  expect(
    resolveOpenTarget(
      { path: "/work/project-other/main.rs", directory: false },
      "/work/project",
    ),
  ).toEqual({ folder: "/work/project-other", file: "main.rs" });
});
it("handles filesystem roots, Windows drives, UNC shares and spaces", () => {
  expect(
    resolveOpenTarget({ path: "/main.rs", directory: false }, "demo"),
  ).toEqual({ folder: "/", file: "main.rs" });
  expect(
    resolveOpenTarget({ path: "/main.rs", directory: false }, "/"),
  ).toEqual({ file: "main.rs" });
  expect(
    resolveOpenTarget({ path: "C:\\main.rs", directory: false }, "demo"),
  ).toEqual({ folder: "C:/", file: "main.rs" });
  expect(
    resolveOpenTarget({ path: "C:\\src\\main.rs", directory: false }, "C:\\"),
  ).toEqual({ file: "src/main.rs" });
  expect(
    resolveOpenTarget(
      { path: "\\\\server\\share\\folder name\\main.rs", directory: false },
      "\\\\server\\share",
    ),
  ).toEqual({ file: "folder name/main.rs" });
  expect(resolveOpenTarget(
    { path: "c:/WORK/project/source file.rs", directory: false },
    "C:/work/project",
  )).toEqual({ file: "source file.rs" });
  expect(sameWorkspacePath("C:\\", "C:/")).toBe(true);
  expect(
    resolveOpenTarget({ path: "/work/folder", directory: true }, "demo"),
  ).toEqual({ folder: "/work/folder" });
  expect(() =>
    resolveOpenTarget({ path: "relative.rs", directory: false }, "demo"),
  ).toThrow();
});
