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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostEvent } from "./extensionHost";
let subscribe: typeof import("./extensionHost").subscribeExtensionTerminals;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
  subscribe = (await import("./extensionHost")).subscribeExtensionTerminals;
});
afterEach(() => vi.unstubAllGlobals());
const emit = (event: string, id: string, text?: string) =>
  window.dispatchEvent(
    new CustomEvent("devyy-extension-event", {
      detail: { event, payload: { id, text } },
    }),
  );
describe("extension terminal startup", () => {
  it("replays creation and input emitted before the lazy terminal UI mounts", () => {
    emit("terminalCreate", "early");
    emit("terminalInput", "early", "queued input");
    const received: HostEvent[] = [];
    const stop = subscribe((event) => received.push(event));
    expect(received.map((event) => event.event)).toEqual([
      "terminalCreate",
      "terminalInput",
    ]);
    emit("terminalShow", "early");
    expect(received.at(-1)?.event).toBe("terminalShow");
    stop();
    const second: HostEvent[] = [];
    subscribe((event) => second.push(event))();
    expect(second).toEqual([]);
  });
  it("does not resurrect terminals disposed during startup or reset", () => {
    emit("terminalCreate", "disposed");
    emit("terminalInput", "disposed", "input");
    emit("terminalClose", "disposed");
    emit("terminalCreate", "old-host");
    window.dispatchEvent(new Event("devyy-extension-host-reset"));
    const received: HostEvent[] = [];
    subscribe((event) => received.push(event))();
    expect(received).toEqual([]);
  });
});
