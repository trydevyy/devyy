import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function contributedShortcuts(page: Page, override = false) {
  await page.addInitScript((override) => {
    if (override)
      localStorage.setItem(
        "devyy.settings",
        JSON.stringify({ bindings: { sidebar: "Mod+K" } }),
      );
    let serial = 0;
    const requests: { method: string; params: Record<string, unknown> }[] = [];
    const extension = {
      id: "fixture.shortcuts",
      name: "Shortcut fixture",
      publisher: "fixture",
      version: "1.0.0",
      enabled: true,
      hasRuntime: true,
      description: "Shortcuts",
      contributes: {
        commands: [{ command: "fixture.chord", title: "Run fixture command" }],
        keybindings: [
          {
            command: "fixture.chord",
            key: "ctrl+k ctrl+c",
            mac: "cmd+k cmd+c",
            when: "editorTextFocus && resourceLangId == rust",
            args: { message: "Hello" },
          },
        ],
      },
    };
    Object.assign(window, {
      isTauri: true,
      shortcutRequests: requests,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++serial,
        unregisterCallback() {},
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "plugin:event|listen") return ++serial;
          if (command === "list_extensions") return [extension];
          if (["list_language_servers", "terminal_profiles"].includes(command))
            return [];
          if (command === "set_appearance") return { material: "solid" };
          if (command === "extension_host_request") {
            const method = String(args.method),
              params = args.params as Record<string, unknown>;
            requests.push({ method, params });
            if (method === "restart")
              return [{ id: extension.id, status: "idle" }];
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  }, override);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { shortcutRequests: { method: string }[] }
        ).shortcutRequests.some((request) => request.method === "restart"),
      ),
    )
    .toBe(true);
}

test("global shortcuts handle native commands, window targets, dead keys and Settings navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("devyy-native-command", { detail: "files" }),
    ),
  );
  await expect(
    page.getByRole("dialog", { name: "Go to file", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+,`);
  await expect(
    page.getByRole("dialog", { name: "Preferences", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${mod}+p`);
  await expect(
    page.getByRole("dialog", { name: "Preferences", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Go to file", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  const prevented = await page.evaluate(() => {
    const mac = /Mac/.test(navigator.platform);
    return !window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Dead",
        code: "KeyV",
        altKey: true,
        metaKey: mac,
        ctrlKey: !mac,
        cancelable: true,
        bubbles: true,
      }),
    );
  });
  expect(prevented).toBe(true);
  await expect(
    page.getByRole("article", {
      name: "Markdown preview: README.md",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("extension chords activate commands with arguments and honor when clauses", async ({
  page,
}) => {
  await contributedShortcuts(page);
  await page.locator(".editor-document.visible .cm-content").click();
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByRole("status")).toContainText(
    "waiting for the next key",
  );
  await page.keyboard.press(`${mod}+c`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            shortcutRequests: {
              method: string;
              params: { id?: string; args?: unknown[] };
            }[];
          }
        ).shortcutRequests.filter(
          (request) =>
            request.method === "command" &&
            request.params.id === "fixture.chord",
        ),
      ),
    )
    .toEqual([
      {
        method: "command",
        params: { id: "fixture.chord", args: [{ message: "Hello" }] },
      },
    ]);
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page.locator(".editor-document.visible .cm-content").click();
  await page.keyboard.press(`${mod}+k`);
  await expect(
    page.getByRole("dialog", { name: "Go to file", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await page.locator(".editor-document.visible .cm-content").click();
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByRole("status")).toContainText(
    "waiting for the next key",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".shortcut-hint")).toHaveCount(0);
});

test("explicit user shortcuts take priority over contributed chord prefixes", async ({
  page,
}) => {
  await contributedShortcuts(page, true);
  await page.locator(".editor-document.visible .cm-content").click();
  await page.keyboard.press(`${mod}+k`);
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".shortcut-hint")).toHaveCount(0);
});
