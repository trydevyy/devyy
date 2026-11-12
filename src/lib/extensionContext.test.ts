import { describe, expect, it } from "vitest";
import { matchesContext } from "./extensionContext";
import { fileUri } from "./fileUri";
describe("extension when clauses", () => {
  it("honors view visibility, equality, precedence, regex and collection membership", () => {
    const ctx = {
      primary: true,
      secondary: false,
      language: "rust",
      count: 3,
      file: "main.rs",
      supported: ["rust", "typescript"],
    };
    expect(matchesContext("primary && !secondary", ctx)).toBe(true);
    expect(matchesContext("!primary || secondary", ctx)).toBe(false);
    expect(matchesContext("language == rust && count >= 2", ctx)).toBe(true);
    expect(
      matchesContext("(secondary || primary) && language =~ /rust/i", ctx),
    ).toBe(true);
    expect(matchesContext("language in supported", ctx)).toBe(true);
    expect(matchesContext("language not in supported", ctx)).toBe(false);
    expect(matchesContext("primary && (", ctx)).toBe(false);
    expect(matchesContext("missing", ctx)).toBe(false);
  });
});
describe("extension file URIs", () => {
  it("encodes Unix, Windows and UNC paths without losing drive letters", () => {
    expect(fileUri("/tmp/a b/#c.ts")).toBe("file:///tmp/a%20b/%23c.ts");
    expect(fileUri("C:\\work\\a b.ts")).toBe("file:///C:/work/a%20b.ts");
    expect(fileUri("\\\\server\\share\\a b.ts")).toBe(
      "file://server/share/a%20b.ts",
    );
  });
});
