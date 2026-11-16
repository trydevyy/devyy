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
import { pathFromUri } from "./native";
import { demoEntries } from "./demo";
import { normalizeSettings } from "./types";
describe("interface and completion preferences", () => {
  it("bounds independent UI sizes and keeps AI requests opt-in", () => {
    const settings = normalizeSettings({
      uiScale: 200,
      uiTextSize: 30,
      fontSize: 14,
    });
    expect(settings).toMatchObject({
      uiScale: 150,
      uiTextSize: 18,
      fontSize: 14,
      aiCompletions: false,
    });
    expect(
      normalizeSettings({ uiScale: NaN, aiCompletionModel: { invalid: true } }),
    ).toMatchObject({ uiScale: 100, aiCompletionModel: "" });
  });
});
describe("workspace URI mapping", () => {
  it("decodes file paths without allowing sibling-prefix matches", () => {
    expect(
      pathFromUri("file:///work/my%20app/src/main.rs", "/work/my app"),
    ).toBe("src/main.rs");
    expect(
      pathFromUri("file:///work/app-secret/main.rs", "/work/app"),
    ).toBeNull();
    expect(pathFromUri("file:///other/main.rs", "/work/app")).toBeNull();
    expect(
      pathFromUri("file:///C:/Work/My%20App/src/main.rs", "c:\\work\\my app"),
    ).toBe("src/main.rs");
    expect(
      pathFromUri("file:///C:/Work/app/main.rs", "\\\\?\\C:\\Work\\app"),
    ).toBe("main.rs");
    expect(
      pathFromUri("file://server/share/app/main.rs", "\\\\server\\share\\app"),
    ).toBe("main.rs");
    expect(
      pathFromUri("file:///C:/work/app-secret/main.rs", "C:/work/app"),
    ).toBeNull();
    expect(
      pathFromUri("https://example.com/work/app/main.rs", "/work/app"),
    ).toBeNull();
  });
});
describe("playground file tree", () => {
  it("includes every ancestor exactly once for nested files", () => {
    const entries = demoEntries({
      "src/lib/a.rs": "a",
      "src/lib/b.rs": "b",
      "README.md": "readme",
    });
    expect(
      entries
        .filter((e) => e.directory)
        .map((e) => e.path)
        .sort(),
    ).toEqual(["src", "src/lib"]);
    expect(entries.filter((e) => !e.directory)).toHaveLength(3);
  });
});
