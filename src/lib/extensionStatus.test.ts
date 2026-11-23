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
import { clearStatusMessage, updateExtensionStatusItem, useExtensionHost } from "./extensionHost";

describe("extension status message and items", () => {
  it("replaces an extension status and ignores disposal of an older item", () => {
    const first = updateExtensionStatusItem({}, { key: "fixture:initial", text: "Starting" });
    const second = updateExtensionStatusItem(first, { key: "fixture:current", text: "Ready" });
    const current = updateExtensionStatusItem(second, { key: "fixture:initial", text: "", visible: false });
    expect(Object.keys(current)).toEqual(["fixture"]);
    expect(current.fixture.text).toBe("Ready");
    expect(updateExtensionStatusItem(current, { key: "fixture:current", text: "", visible: false })).toEqual({});
  });
  it("exports clearStatusMessage", () => {
    expect(typeof clearStatusMessage).toBe("function");
    expect(() => clearStatusMessage()).not.toThrow();
  });

  it("provides hook with statusItems and statusMessage", () => {
    expect(typeof useExtensionHost).toBe("function");
  });
});
