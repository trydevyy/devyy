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

export interface OpenTarget {
  path: string;
  directory: boolean;
}
const normalized = (path: string) => path.replace(/\\/g, "/");
const rootPath = (path: string) => normalized(path).replace(/\/+$/, "");
export function resolveOpenTarget(
  target: OpenTarget,
  workspaceRoot: string,
): { folder?: string; file?: string } {
  const path = normalized(target.path);
  if (!path.startsWith("/") && !/^[a-z]:\//i.test(path))
    throw new Error("Expected an absolute file-open target");
  if (target.directory) return { folder: target.path };
  const root = rootPath(workspaceRoot);
  const withinWorkspace = /^[a-z]:\//i.test(path) || path.startsWith("//")
    ? path.toLowerCase().startsWith(root.toLowerCase() + "/")
    : path.startsWith(root + "/");
  if (workspaceRoot !== "demo" && withinWorkspace)
    return { file: path.slice(root.length + 1) };
  let folder = path.slice(0, path.lastIndexOf("/")) || "/";
  if (/^[a-z]:$/i.test(folder)) folder += "/";
  return { folder, file: path.slice(path.lastIndexOf("/") + 1) };
}
export function sameWorkspacePath(left: string, right: string) {
  return rootPath(left) === rootPath(right);
}
