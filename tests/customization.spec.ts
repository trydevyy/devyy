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

import { test, expect, type Page } from "@playwright/test";
import { chooseOption } from "./controls";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function settings(page: Page, tab = "Appearance") {
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: tab, exact: true }).click();
  return page.getByRole("dialog", { name: "Preferences", exact: true });
}
test("interface text and scale persist independently of editor text", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const code = page.locator(".editor-document.visible .cm-line").first();
  const size = await code.evaluate((node) => getComputedStyle(node).fontSize);
  const originalTitle = await page
    .locator(".project-title")
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  const preferences = await settings(page);
  for (let i = 0; i < 3; i++)
    await preferences
      .getByRole("button", {
        name: "Increase interface text size",
        exact: true,
      })
      .click();
  await expect
    .poll(() =>
      page
        .locator(".project-title")
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(originalTitle);
  await expect(code).toHaveCSS("font-size", size);
  for (let i = 0; i < 4; i++)
    await preferences
      .getByRole("button", { name: "Increase interface scale", exact: true })
      .click();
  await page.keyboard.press("Escape");
  await expect(preferences).toHaveCount(0);
  const bounds = await page.locator(".devyy").boundingBox();
  expect(bounds!.height).toBeCloseTo(940, 0);
  await page.reload();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("devyy.settings")!),
    ),
  ).toMatchObject({ uiTextSize: 16, uiScale: 125, fontSize: 15 });
});

test("workspace dropdown lists recent folders and find buttons use proper SVG icons", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "devyy.recent",
      JSON.stringify(["/work/first", "/work/second"]),
    ),
  );
  await page.goto("/?playground=1");
  await page
    .getByRole("button", { name: "Choose workspace", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^first / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^second / })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open another folder…", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find and replace in file" });
  await expect(
    find
      .getByRole("button", { name: "Next match", exact: true })
      .locator("svg"),
  ).toHaveAttribute("stroke-width", "1.65");
  await expect(
    find
      .getByRole("button", { name: "Close find", exact: true })
      .locator("svg"),
  ).toBeVisible();
});

test("local completion works without AI and can be disabled", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const code = page.locator(".editor-document.visible .cm-content");
  await code.fill("fn completionUnique() {}\nfn main() { comple");
  await code.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await expect(
    page.getByRole("option").filter({ hasText: "completionUnique" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const preferences = await settings(page, "Editor");
  await preferences
    .getByRole("switch", { name: "Code suggestions", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await code.focus();
  await code.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("devyy.settings")!).aiCompletions,
    ),
  ).toBe(false);
});

test("horizontally scrolled code is clipped behind transparent gutters in normal and split editors", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const content = page.locator(".editor-document.visible .cm-content");
  await content.fill(
    `fn main() { let ${"very_long_identifier_".repeat(90)} = 1; }`,
  );
  const scroll = page.locator(".editor-document.visible .cm-scroller");
  await scroll.evaluate((node) => {
    node.scrollLeft = 500;
  });
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  const gutter = page.locator(".editor-document.visible .cm-gutters");
  expect(
    await gutter.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toMatch(/rgba\([^)]*, 0\)|transparent/);
  await expect
    .poll(() =>
      content.evaluate((el) => {
        const edge = el
          .closest(".cm-scroller")!
          .querySelector(".cm-gutters")!
          .getBoundingClientRect().right;
        const inset =
          getComputedStyle(el).clipPath.match(
            /inset\(0px 0px 0px ([\d.]+)px\)/,
          )?.[1] ?? "0";
        return el.getBoundingClientRect().left + Number(inset) - edge;
      }),
    )
    .toBeGreaterThanOrEqual(-1);
  const clipping = await page
    .locator(".editor-document.visible .editor-source")
    .evaluate((node) => getComputedStyle(node).overflowX);
  expect(clipping).toBe("hidden");
  await page.keyboard.press(`${mod}+\\`);
  const gutters = page.locator(".editor-split-pane .cm-gutters");
  await expect(page.locator(".editor-split-divider")).toBeVisible();
  if (await gutters.count())
    for (const node of await gutters.all())
      expect(
        await node.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toMatch(/rgba\([^)]*, 0\)|transparent/);
});

async function nativeFixture(page: Page, dependencies = true) {
  await page.addInitScript(
    ({ dependencies }) => {
      let serial = 0;
      const callbacks = new Map<number, (value: unknown) => void>();
      const listeners = new Map<string, Set<number>>();
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const providers: Record<string, unknown>[] = [
        {
          id: "fixture",
          name: "Fixture",
          kind: "custom",
          endpoint: "http://127.0.0.1:11434/v1",
          model: "",
          executable: "",
          hasKey: false,
          enabled: true,
        },
      ];
      localStorage.setItem(
        "devyy.ai.verified",
        JSON.stringify({
          fixture: JSON.stringify([
            "custom",
            providers[0].endpoint,
            "",
            [],
            false,
            false,
            "",
          ]),
        }),
      );
      let connected = false;
      let complete: ((value: unknown) => void) | undefined;
      const account = {
        login: "devyy-user",
        name: "Devyy User",
        email: "devyy@example.test",
      };
      const status = () => ({
        gitInstalled: dependencies,
        cliInstalled: dependencies,
        connected,
        account: connected ? account : undefined,
        gitName: "Existing name",
        gitEmail: "existing@example.test",
      });
      const emit = (name: string, payload: unknown) => {
        for (const id of listeners.get(name) ?? [])
          callbacks.get(id)?.({ event: name, id, payload });
      };
      Object.assign(window, {
        isTauri: true,
        polishCalls: calls,
        finishGithub: () => {
          connected = true;
          complete?.(status());
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback(fn: (value: unknown) => void) {
            callbacks.set(++serial, fn);
            return serial;
          },
          unregisterCallback(id: number) {
            callbacks.delete(id);
          },
          invoke: async (
            command: string,
            args: Record<string, unknown> = {},
          ) => {
            calls.push({ command, args });
            if (command === "plugin:event|listen") {
              const set =
                listeners.get(String(args.event)) ?? new Set<number>();
              set.add(Number(args.handler));
              listeners.set(String(args.event), set);
              return ++serial;
            }
            if (
              [
                "list_extensions",
                "terminal_profiles",
                "list_language_servers",
              ].includes(command)
            )
              return [];
            if (command === "set_appearance") return { material: "solid" };
            if (command === "ai_providers") return providers;
            if (command === "ai_models")
              return [
                { id: "fixture-large", name: "Large", isDefault: true },
                { id: "fixture-mini", name: "Mini" },
              ];
            if (command === "ai_save_provider") {
              const value = args.provider as Record<string, unknown>;
              const i = providers.findIndex((p) => p.id === value.id);
              if (i >= 0) providers[i] = value;
              else providers.push(value);
              return null;
            }
            if (command === "github_status") return status();
            if (command === "github_login") {
              emit("devyy-github-auth", {
                requestId: args.requestId,
                code: "ABCD-1234",
              });
              return new Promise((resolve) => {
                complete = resolve;
              });
            }
            if (command === "plugin:dialog|open") return "/work/polish";
            if (["open_workspace", "refresh_workspace"].includes(command))
              return {
                root: "/work/polish",
                name: "polish",
                files: [
                  { path: "src/main.rs", name: "main.rs", directory: false },
                ],
              };
            if (command === "read_file")
              return { content: "fn main() {}", modified: "1" };
            if (command === "file_uri")
              return `file:///work/polish/${args.path}`;
            if (command === "extension_host_request")
              return args.method === "restart" ? [] : null;
            if (command === "ai_chat") {
              const request = args.request as { requestId: string };
              emit("devyy-ai", {
                requestId: request.requestId,
                kind: "delta",
                data: "e_value();",
              });
              emit("devyy-ai", {
                requestId: request.requestId,
                kind: "usage",
                data: { input_tokens: 11, output_tokens: 5 },
              });
              return null;
            }
            return null;
          },
        },
      });
    },
    { dependencies },
  );
  await page.goto("/");
}
async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (
        window as unknown as {
          polishCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).polishCalls.filter((call) => call.command === command),
    command,
  );
}
test("GitHub sign-in displays its code and asks before changing Git identity", async ({
  page,
}) => {
  await nativeFixture(page);
  const preferences = await settings(page, "Source control");
  await preferences
    .getByRole("button", { name: "Continue with GitHub", exact: true })
    .click();
  await expect(preferences).toContainText("ABCD-1234");
  await page.evaluate(() =>
    (window as unknown as { finishGithub: () => void }).finishGithub(),
  );
  const confirmation = page.getByRole("alertdialog", {
    name: "Use your GitHub identity for commits?",
  });
  await expect(confirmation).toContainText("Existing name");
  expect(await calls(page, "github_git_identity")).toHaveLength(0);
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(preferences).toContainText("devyy-user");
  expect(await calls(page, "github_git_identity")).toHaveLength(0);
  await preferences
    .getByRole("textbox", { name: "Commit author name", exact: true })
    .fill("Chosen name");
  await preferences
    .getByRole("textbox", { name: "Commit author email", exact: true })
    .fill("chosen@example.test");
  await preferences
    .getByRole("button", { name: "Save commit author", exact: true })
    .click();
  await expect
    .poll(() => calls(page, "github_git_identity"))
    .toEqual([
      {
        command: "github_git_identity",
        args: { name: "Chosen name", email: "chosen@example.test" },
      },
    ]);
});
test("missing tools surface the download actions needed to get started", async ({
  page,
}) => {
  await nativeFixture(page, false);
  const preferences = await settings(page, "Source control");
  await expect(
    preferences.getByRole("button", { name: "Continue with GitHub" }),
  ).toHaveCount(0);
  await expect(
    preferences.getByRole("button", { name: "Download GitHub CLI" }),
  ).toBeEnabled();
  await expect(
    preferences.getByRole("button", { name: "Save commit author" }),
  ).toBeDisabled();
  await preferences
    .getByRole("button", { name: "Download Git", exact: true })
    .click();
  await expect
    .poll(() => calls(page, "plugin:opener|open_url"))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.objectContaining({
            url: "https://git-scm.com/downloads",
          }),
        }),
      ]),
    );
});
test("GitHub onboarding applies commit identity only after accepting its confirmation", async ({
  page,
}) => {
  await nativeFixture(page);
  await page.evaluate(() => {
    localStorage.removeItem("devyy.setupCompleted");
    localStorage.removeItem("devyy.settings");
    localStorage.removeItem("devvy.settings");
  });
  await page.reload();
  const setup = page.getByRole("dialog", { name: "Set up devyy", exact: true });
  await setup.getByRole("button", { name: /Git & GitHub/ }).click();
  await setup
    .getByRole("button", { name: "Continue with GitHub", exact: true })
    .click();
  await expect(setup).toContainText("ABCD-1234");
  await page.evaluate(() =>
    (window as unknown as { finishGithub: () => void }).finishGithub(),
  );
  const confirmation = page.getByRole("alertdialog", {
    name: "Use your GitHub identity for commits?",
  });
  expect(await calls(page, "github_git_identity")).toHaveLength(0);
  await confirmation
    .getByRole("button", { name: "Set identity", exact: true })
    .click();
  await expect
    .poll(() => calls(page, "github_git_identity"))
    .toEqual([
      {
        command: "github_git_identity",
        args: { name: "Devyy User", email: "devyy@example.test" },
      },
    ]);
});
test("custom providers can use a direct CLI without an API URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 910, height: 403 });
  await nativeFixture(page);
  const preferences = await settings(page, "AI providers");
  await preferences
    .getByRole("button", { name: "Add AI provider", exact: true })
    .click();
  const add = page.getByRole("dialog", { name: "Add custom provider" });
  await expect(add).toBeVisible();
  const height = (await add.boundingBox())!.height;
  expect(height).toBeGreaterThan(180);
  expect(height).toBeLessThanOrEqual(403);
  await page.keyboard.press("Escape");
  await expect(add).toHaveCount(0);
  await expect(preferences).toBeVisible();
  await preferences
    .getByRole("button", { name: "Add AI provider", exact: true })
    .click();
  await chooseOption(
    preferences.getByRole("combobox", { name: "Connection type", exact: true }),
    "cli",
  );
  await preferences
    .getByRole("textbox", { name: "CLI executable", exact: true })
    .fill("ollama");
  await preferences
    .getByRole("textbox", { name: "Arguments (JSON array)", exact: true })
    .fill('["run", "{model}"]');
  await expect(
    preferences.getByRole("textbox", { name: "API base URL", exact: true }),
  ).toHaveCount(0);
  await preferences
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect
    .poll(
      async () => (await calls(page, "ai_save_provider")).at(-1)?.args.provider,
    )
    .toMatchObject({
      kind: "cli",
      executable: "ollama",
      args: ["run", "{model}"],
    });
});
test("AI code completion is opt-in, chooses a small model and records usage", async ({
  page,
}) => {
  await nativeFixture(page);
  await page.keyboard.press(`${mod}+o`);
  const code = page.locator(".editor-document.visible .cm-content");
  await expect(code).toBeVisible();
  await code.fill("fn main() { let answer = som");
  await code.press("Control+Space");
  expect(await calls(page, "ai_chat")).toHaveLength(0);
  await page.keyboard.press("Escape");
  const preferences = await settings(page, "Editor");
  await preferences
    .getByRole("switch", { name: "AI code suggestions", exact: true })
    .click();
  await chooseOption(
    preferences.getByRole("combobox", { name: "AI completion provider" }),
    "fixture",
  );
  const model = preferences.getByRole("combobox", {
    name: "AI completion model",
  });
  await model.click();
  await expect(
    page.getByRole("option", { name: "Mini", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await code.focus();
  await code.press("Control+Space");
  const suggestion = page.getByRole("option").filter({ hasText: "e_value();" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(code).toContainText("some_value();");
  const requests = await calls(page, "ai_chat");
  expect(requests.at(-1)?.args.request).toMatchObject({
    model: "fixture-mini",
    cwd: null,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("devyy.ai.usage") ?? "{}").fixture,
      ),
    )
    .toMatchObject({ inputTokens: 11, outputTokens: 5, requests: 1 });
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("devyy.ai.usage") ?? "{}").fixture,
    ),
  ).toMatchObject({ tokens: 16, requests: 1 });
});
