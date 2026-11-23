import { afterEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { readClipboardText, writeClipboardText } from "./clipboard";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("uses desktop clipboard access even when the WebView clipboard is blocked", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(readText).mockResolvedValue("desktop clipboard");
  vi.stubGlobal("navigator", {
    get clipboard() {
      throw new Error("WebView clipboard should not be accessed");
    },
  });

  expect(await readClipboardText()).toBe("desktop clipboard");
  await writeClipboardText("copied");
  expect(writeText).toHaveBeenCalledWith("copied");
});

it("uses browser clipboard access in the browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const browserWrite = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    clipboard: {
      readText: vi.fn().mockResolvedValue("browser clipboard"),
      writeText: browserWrite,
    },
  });

  expect(await readClipboardText()).toBe("browser clipboard");
  await writeClipboardText("copied in browser");
  expect(browserWrite).toHaveBeenCalledWith("copied in browser");
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
});
