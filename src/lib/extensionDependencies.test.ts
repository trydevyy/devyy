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
import {
  installExtensionDependencies,
  type ExtensionDependencies,
} from "./extensionDependencies";
function extension(
  id: string,
  dependencies: string[] = [],
  pack: string[] = [],
): ExtensionDependencies {
  return {
    id,
    enabled: true,
    extensionDependencies: dependencies,
    extensionPack: pack,
  };
}
describe("extension dependency installation", () => {
  it("installs transitive dependencies and pack members once and reuses installed packages", async () => {
    const packages = [
      extension("test.root", ["test.a", "test.b"], ["test.tools"]),
      extension("test.a", ["test.shared"]),
      extension("test.b", ["test.shared"]),
      extension("test.shared"),
      extension("test.tools"),
    ];
    const installed: string[] = [];
    await installExtensionDependencies(
      packages[0],
      [packages[3]],
      async (id) => {
        installed.push(id);
        return packages.find((item) => item.id === id)!;
      },
    );
    expect(installed).toEqual(["test.a", "test.b", "test.tools"]);
  });
  it("rejects required cycles but permits a pack member to depend on the pack's installed extension", async () => {
    const root = extension("test.root", ["test.dep"]),
      dep = extension("test.dep", ["test.root"]);
    await expect(
      installExtensionDependencies(root, [dep], async () => dep),
    ).rejects.toThrow("Circular extension dependency");
    root.extensionDependencies = [];
    root.extensionPack = ["test.dep"];
    await expect(
      installExtensionDependencies(root, [dep], async () => dep),
    ).resolves.toBeUndefined();
  });
  it("preserves disabled extensions and identifies disabled required dependencies", async () => {
    const disabled = { ...extension("test.disabled"), enabled: false };
    await expect(
      installExtensionDependencies(
        extension("test.root", [disabled.id]),
        [disabled],
        async () => {
          throw Error("Must not replace disabled extension");
        },
      ),
    ).rejects.toThrow("is disabled");
    await expect(
      installExtensionDependencies(
        extension("test.root", [], [disabled.id]),
        [disabled],
        async () => {
          throw Error("Must not install");
        },
      ),
    ).resolves.toBeUndefined();
  });
  it("bounds installation and reports dependency failures and invalid identities", async () => {
    await expect(
      installExtensionDependencies(
        extension("test.root", ["../escape"]),
        [],
        async () => extension("test.no"),
      ),
    ).rejects.toThrow("Invalid extension dependency");
    await expect(
      installExtensionDependencies(
        extension("test.root", ["test.dep"]),
        [],
        async () => {
          throw Error("Registry unavailable");
        },
      ),
    ).rejects.toThrow("required dependency test.dep");
    await expect(
      installExtensionDependencies(
        extension("test.root", ["test.dep"]),
        [],
        async () => extension("test.other"),
      ),
    ).rejects.toThrow("identity mismatch");
    const root = extension(
      "test.root",
      Array.from({ length: 129 }, (_, i) => `test.dep${i}`),
    );
    await expect(
      installExtensionDependencies(root, [], async (id) => extension(id)),
    ).rejects.toThrow("128-package");
  });
});
