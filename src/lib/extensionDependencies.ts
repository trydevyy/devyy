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

export interface ExtensionDependencies {
  id: string;
  enabled: boolean;
  extensionDependencies?: string[];
  extensionPack?: string[];
}
function identifier(id: string) {
  if (!/^[a-z\d_-]{1,128}\.[a-z\d_-]{1,128}$/i.test(id))
    throw new Error(`Invalid extension dependency: ${id}`);
  return id.toLowerCase();
}
export async function installExtensionDependencies<
  T extends ExtensionDependencies,
>(root: T, installed: readonly T[], install: (id: string) => Promise<T>) {
  const known = new Map(
    installed.map((extension) => [identifier(extension.id), extension]),
  );
  known.set(identifier(root.id), root);
  const visited = new Set<string>();
  async function visit(extension: T, chain: string[]) {
    const id = identifier(extension.id);
    if (chain.includes(id))
      throw new Error(
        `Circular extension dependency: ${[...chain, id].join(" → ")}`,
      );
    if (visited.has(id)) return;
    if (visited.size >= 128)
      throw new Error(
        "The extension bundle exceeds the 128-package dependency limit.",
      );
    visited.add(id);
    async function get(value: string, required: boolean) {
      const childId = identifier(value);
      let child = known.get(childId);
      if (!child) {
        if (known.size >= installed.length + 128)
          throw new Error(
            "The extension bundle exceeds the 128-package dependency limit.",
          );
        try {
          child = await install(childId);
        } catch (error) {
          throw new Error(
            `Could not install ${required ? "required dependency" : "pack member"} ${childId} for ${id}: ${String(error)}`,
          );
        }
        if (identifier(child.id) !== childId)
          throw new Error(`Dependency package identity mismatch: ${childId}`);
        known.set(childId, child);
      }
      if (!child.enabled) {
        if (required)
          throw new Error(
            `Required dependency ${childId} is disabled. Enable it in Installed extensions and retry.`,
          );
        return;
      }
      await visit(child, required ? [...chain, id] : []);
    }
    for (const dependency of extension.extensionDependencies ?? [])
      await get(dependency, true);
    for (const member of extension.extensionPack ?? [])
      await get(member, false);
  }
  await visit(root, []);
}
