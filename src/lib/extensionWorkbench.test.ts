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

import { afterEach, expect, it, vi } from "vitest";
import { hostRequest } from "./extensionHost";

vi.mock("./extensionHost", () => ({ hostRequest: vi.fn() }));
vi.mock("./native", () => ({ native: true }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps only the newest editor snapshot while the extension host is busy", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  const { sendExtensionEditorState } = await import("./extensionWorkbench");
  let acknowledge!: (result: unknown) => void;
  vi.mocked(hostRequest)
    .mockImplementationOnce(
      () => new Promise((resolve) => (acknowledge = resolve)),
    )
    .mockResolvedValue(undefined);
  window.dispatchEvent(new Event("devyy-extension-host-ready"));

  sendExtensionEditorState({ version: 0 });
  await vi.advanceTimersByTimeAsync(50);
  for (let version = 1; version <= 100; version++) {
    sendExtensionEditorState({ version });
    await vi.advanceTimersByTimeAsync(60);
  }
  expect(hostRequest).toHaveBeenCalledExactlyOnceWith("editorState", {
    version: 0,
  });

  acknowledge(undefined);
  await vi.advanceTimersByTimeAsync(50);
  expect(hostRequest).toHaveBeenCalledTimes(2);
  expect(hostRequest).toHaveBeenLastCalledWith("editorState", { version: 100 });
});
