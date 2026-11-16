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
  boundedContext,
  contextPrompt,
  mergeAttachments,
  readAIContextDrag,
  registerAIContext,
  resolveAIContext,
  type AIAttachment,
  MAX_ATTACHMENTS_BYTES,
} from "./aiContext";
const file = (id: string, content = "snapshot"): AIAttachment => ({
  kind: "file",
  id,
  title: id,
  path: id,
  content,
});
describe("AI context snapshots", () => {
  it("captures fresh values once and preserves them after the source changes", async () => {
    let content = "first";
    const stop = registerAIContext("test", [
      {
        kind: "file",
        id: "file.rs",
        title: "file.rs",
        read: () => file("file.rs", content),
      },
    ]);
    const [first] = await resolveAIContext([{ kind: "file", id: "file.rs" }]);
    content = "second";
    expect(first.content).toBe("first");
    expect(
      (await resolveAIContext([{ kind: "file", id: "file.rs" }]))[0].content,
    ).toBe("second");
    stop();
    await expect(
      resolveAIContext([{ kind: "file", id: "file.rs" }]),
    ).rejects.toThrow("no longer available");
  });
  it("refreshes duplicate attachments while preserving distinct split members and rejecting oversized messages", () => {
    const result = mergeAttachments(
      [
        file("left.rs"),
        {
          kind: "terminal",
          id: "terminal-1",
          title: "Shell",
          content: "old output",
        },
      ],
      [file("right.rs"), file("left.rs", "new")],
    );
    expect(result.map((item) => item.id)).toEqual([
      "left.rs",
      "terminal-1",
      "right.rs",
    ]);
    expect(result[0].content).toBe("new");
    expect(() =>
      mergeAttachments(
        [],
        [file("huge", "x".repeat(MAX_ATTACHMENTS_BYTES + 1))],
      ),
    ).toThrow("350 KB");
  });
  it("bounds UTF-8 without splitting a code point and marks the snapshot as incomplete", () => {
    const result = boundedContext("aéééé", 4);
    expect(result.content).not.toContain("\uFFFD");
    expect(result.content).toContain("Snapshot truncated");
    expect(result.truncated).toBe(true);
  });
  it("serializes all context types and preserves older single-file conversations", () => {
    const text = contextPrompt({
      content: "Review",
      attachments: [
        file("file.rs", "code"),
        {
          kind: "terminal",
          id: "1",
          title: "Build",
          content: "compiler failure",
        },
        {
          kind: "problems",
          id: "all",
          title: "Problems",
          content: "diagnostic",
        },
      ],
    });
    expect(text).toContain("Attached terminal");
    expect(text).toContain("compiler failure");
    expect(text).toContain("diagnostic");
    expect(text.match(/<devyy_file_context>/g)).toHaveLength(3);
    expect(
      contextPrompt({
        content: "Review",
        context: { path: "old.rs", content: "old snapshot" },
      }),
    ).toContain("old snapshot");
  });
  it("rejects malformed drag payloads and does not resolve arbitrary filesystem paths", () => {
    const transfer = {
      getData: () =>
        JSON.stringify({
          version: 1,
          items: [
            { kind: "executable", id: "/tmp/untrusted" },
            { kind: "file", id: 17 },
          ],
        }),
    } as unknown as DataTransfer;
    expect(readAIContextDrag(transfer)).toEqual([]);
  });
});
