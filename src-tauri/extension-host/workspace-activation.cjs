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

"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function activateWorkspaceContains({
  root,
  extensions,
  findFiles,
  activate,
  report,
}) {
  if (!root) return;
  const candidates = extensions.filter((ext) => !ext.active && !ext.error);
  const patterns = new Map();
  for (const ext of candidates) {
    for (const event of ext.manifest.activationEvents || []) {
      if (typeof event !== "string" || !event.startsWith("workspaceContains:"))
        continue;
      const pattern = event.slice("workspaceContains:".length);
      if (!patterns.has(pattern)) patterns.set(pattern, []);
      patterns.get(pattern).push(ext);
    }
  }
  if (!patterns.size) return;
  let canonical;
  try {
    canonical = await fs.realpath(root);
  } catch {
    return;
  }
  const matches = new Set();
  const pending = [...patterns];
  async function worker() {
    for (let entry; (entry = pending.shift());) {
      const [raw, owners] = entry;
      const pattern = raw.replace(/\\/g, "/");
      if (
        !pattern ||
        path.isAbsolute(pattern) ||
        /^[a-z]:/i.test(pattern) ||
        pattern.split("/").includes("..")
      ) {
        report(
          `Invalid workspaceContains pattern ${JSON.stringify(raw)} in ${owners.map((ext) => ext.id).join(", ")}`,
        );
        continue;
      }
      if (owners.every((ext) => matches.has(ext))) continue;
      try {
        let found;
        if (!/[?*{[]/.test(pattern)) {
          const target = await fs.realpath(path.join(canonical, pattern));
          const relative = path.relative(canonical, target);
          found =
            relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative) &&
            (await fs.stat(target)).isFile();
        } else {
          const deadline = Date.now() + 5000;
          const token = {
            get isCancellationRequested() {
              return Date.now() >= deadline;
            },
          };
          found = (await findFiles(pattern, null, 1, token)).length > 0;
          if (!found && token.isCancellationRequested)
            report(
              `workspaceContains search timed out for ${owners.map((ext) => ext.id).join(", ")}: ${pattern}`,
            );
        }
        if (found) owners.forEach((ext) => matches.add(ext));
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code))
          report(`workspaceContains ${JSON.stringify(raw)}: ${error.message}`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, worker),
  );
  await Promise.allSettled([...matches].map((ext) => activate(ext)));
};
