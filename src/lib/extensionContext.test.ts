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
