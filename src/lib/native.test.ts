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

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./extensions", () => ({ allExtensions: () => [] }));
import {
  clearLanguageServers,
  closeDocument,
  connectDocument,
  languageRequest,
  queueDocumentChange,
} from "./native";
describe("language synchronization", () => {
  beforeEach(() => {
    clearLanguageServers();
    bridge.invoke.mockReset();
    bridge.invoke.mockImplementation(async (command, args) =>
      command === "file_uri"
        ? `file:///workspace/${args.path}`
        : command === "lsp_request" && !args.notification
          ? { items: [] }
          : null,
    );
  });
  afterEach(() => {
    clearLanguageServers();
    vi.useRealTimers();
  });
  it("deduplicates document connections and flushes the latest edit before completion", async () => {
    vi.useFakeTimers();
    await Promise.all([
      connectDocument("main.py", "python", "before"),
      connectDocument("main.py", "python", "before"),
    ]);
    await expect(connectDocument("main.py", "python", "before")).resolves.toBe(
      true,
    );
    expect(
      bridge.invoke.mock.calls.filter(([command]) => command === "file_uri"),
    ).toHaveLength(1);
    queueDocumentChange("main.py", "first");
    queueDocumentChange("main.py", "latest");
    await languageRequest("main.py", "textDocument/completion", {
      line: 0,
      character: 6,
    });
    const messages = bridge.invoke.mock.calls
      .filter(([command]) => command === "lsp_request")
      .map(([, args]) => args);
    expect(messages.map((message) => message.method)).toEqual([
      "textDocument/didOpen",
      "textDocument/didChange",
      "textDocument/completion",
    ]);
    expect(messages[1].params.contentChanges).toEqual([{ text: "latest" }]);
    await vi.runAllTimersAsync();
    expect(
      bridge.invoke.mock.calls.filter(
        ([, args]) => args?.method === "textDocument/didChange",
      ),
    ).toHaveLength(1);
  });
  it("does not open a document that closed while its server was starting", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "lsp_start") await waiting;
      return command === "file_uri" ? `file:///workspace/${args.path}` : null;
    });
    const connection = connectDocument("closed.py", "python", "text");
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith("lsp_start", {
        language: "python",
      }),
    );
    await closeDocument("closed.py");
    release();
    expect(await connection).toBe(false);
    expect(
      bridge.invoke.mock.calls.filter(
        ([, args]) => args?.method === "textDocument/didOpen",
      ),
    ).toHaveLength(0);
  });
});
