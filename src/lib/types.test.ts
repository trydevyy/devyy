import { describe, expect, it } from "vitest";
import { pathFromUri } from "./native";
import { demoEntries } from "./demo";
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
