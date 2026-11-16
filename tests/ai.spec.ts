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

import { chooseOption } from "./controls";
import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function fixture(
  page: Page,
  extension = false,
  oauth = false,
  missingRuntime = false,
) {
  await page.addInitScript(
    ({ extension, oauth, missingRuntime }) => {
      const callbacks = new Map<number, (v: unknown) => void>(),
        handlers = new Map<string, Set<number>>();
      let serial = 0,
        terminalSerial = 100;
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const providers = [
        {
          id: "custom-test",
          name: "Local test model",
          kind: "custom",
          model: "fixture-model",
          endpoint: "http://127.0.0.1:11434/v1",
          executable: "",
          hasKey: false,
        },
        {
          id: "chatgpt",
          name: "ChatGPT",
          kind: "chatgpt",
          endpoint: "",
          model: "",
          executable: "",
          hasKey: false,
        },
        {
          id: "claude",
          name: "Claude account",
          kind: "claude",
          endpoint: "",
          model: "",
          executable: "",
          hasKey: false,
        },
        {
          id: "antigravity",
          name: "Antigravity",
          kind: "antigravity",
          endpoint: "",
          model: "gemini-3.8-flash-high",
          executable: "",
          hasKey: false,
        },
        {
          id: "opencode",
          name: "OpenCode",
          kind: "opencode",
          endpoint: "",
          model: "claude-3-7-sonnet",
          executable: "",
          hasKey: false,
        },
      ];
      let runtimeInstalled = !missingRuntime;
      let workspaceAccess = "attached";
      let defaultRust = false;
      let accountIndex = 0,
        chatgptConnected = false;
      const savedAccounts: {
        id: string;
        email: string;
        connected: boolean;
        active: boolean;
      }[] = [];
      let resolveChat: (() => void) | undefined,
        requestId = "";
      const emit = (name: string, payload: unknown) => {
        for (const id of handlers.get(name) ?? [])
          callbacks.get(id)?.({ event: name, id, payload });
      };
      Object.assign(window, {
        isTauri: true,
        aiFixture: {
          calls,
          agent() {
            emit("devyy-ai", {
              requestId,
              kind: "tool",
              data: {
                id: "read-1",
                name: "read_file",
                path: "src/main.rs",
                status: "complete",
              },
            });
            emit("devyy-ai", {
              requestId,
              kind: "proposal",
              data: {
                id: "edit-main",
                path: "src/main.rs",
                original: "fn main() {}\n",
                modified: 'fn main() { println!("agent edit"); }\n',
                workspace: "/fixture",
                create: false,
                status: "pending",
              },
            });
            emit("devyy-ai", {
              requestId,
              kind: "proposal",
              data: {
                id: "create-file",
                path: "src/new.rs",
                original: "",
                modified: "pub fn proposed() {}\n",
                workspace: "/fixture",
                create: true,
                status: "pending",
              },
            });
          },
          terminal(text: string) {
            for (let id = 101; id <= terminalSerial; id++)
              emit("terminal-output", {
                id,
                data: Array.from(new TextEncoder().encode(`${text} ${id}\r\n`)),
              });
          },
          problems() {
            emit("lsp-diagnostics", {
              params: {
                uri: "file:///fixture/src/main.rs",
                diagnostics: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 2 },
                    },
                    severity: 1,
                    message: "Fixture type mismatch",
                  },
                ],
              },
            });
          },
          reasoning(text: string) {
            emit("devyy-ai", { requestId, kind: "reasoning", data: text });
          },
          delta(text: string) {
            emit("devyy-ai", { requestId, kind: "delta", data: text });
          },
          usage() {
            emit("devyy-ai", {
              requestId,
              kind: "usage",
              data: { input_tokens: 120, output_tokens: 40 },
            });
          },
          finish() {
            emit("devyy-ai", { requestId, kind: "done", data: null });
            resolveChat?.();
          },
          extension() {
            emit("extension-host", {
              event: "webview",
              payload: {
                id: "chatgpt.sidebarView",
                extension: "openai.chatgpt",
                title: "Codex conversation",
                html: "<h1>Codex extension ready</h1>",
                enableScripts: false,
              },
            });
          },
        },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback(fn: (v: unknown) => void) {
            callbacks.set(++serial, fn);
            return serial;
          },
          unregisterCallback(id: number) {
            callbacks.delete(id);
          },
          async invoke(command: string, args: Record<string, unknown> = {}) {
            calls.push({ command, args });
            if (command === "plugin:event|listen") {
              const name = String(args.event),
                set = handlers.get(name) ?? new Set<number>();
              set.add(Number(args.handler));
              handlers.set(name, set);
              return ++serial;
            }
            if (command === "set_appearance") return { material: "solid" };
            if (command === "plugin:dialog|open") return "/fixture";
            if (command === "take_open_targets") return [];
            if (command === "ai_workspace_access") {
              if (typeof args.mode === "string") {
                workspaceAccess = args.mode;
                if (resolveChat) {
                  emit("devyy-ai", {
                    requestId,
                    kind: "cancelled",
                    data: null,
                  });
                  resolveChat();
                  resolveChat = undefined;
                }
              }
              return workspaceAccess;
            }
            if (command === "default_app_status")
              return [
                {
                  extension: "rs",
                  mime: "text/x-rust",
                  handler: defaultRust ? "xyz.devyy.editor" : "other.editor",
                  isDefault: defaultRust,
                },
              ];
            if (command === "set_default_app") {
              defaultRust = true;
              return { changed: true, openedSettings: false };
            }
            if (command === "detect_ide_settings")
              return [
                {
                  id: "vscode",
                  name: "Visual Studio Code",
                  path: "/Code/User/settings.json",
                  kind: "vscode",
                },
                {
                  id: "cursor",
                  name: "Cursor",
                  path: "/Cursor/User/settings.json",
                  kind: "vscode",
                },
              ];
            if (command === "write_file") return "2";
            if (command === "open_workspace" || command === "refresh_workspace")
              return {
                root: "/fixture",
                name: "fixture",
                files: [
                  { path: "src", name: "src", directory: true },
                  { path: "src/main.rs", name: "main.rs", directory: false },
                  { path: "src/lib.rs", name: "lib.rs", directory: false },
                ],
              };
            if (command === "read_file")
              return { content: "fn main() {}\n", modified: "1" };
            if (command === "terminal_create") return ++terminalSerial;
            if (command === "terminal_pid") return 123;
            if (command === "git_status")
              return { branch: "main", changes: [] };
            if (command === "ai_runtime") {
              if (args.providerId === "claude" && !runtimeInstalled)
                throw new Error("Claude Code is not installed");
              return { version: "fixture-cli 1.0", executable: "/fixture/cli" };
            }
            if (command === "ai_install_runtime") {
              emit("devyy-ai", {
                requestId: args.requestId,
                kind: "install",
                data: { phase: "installing" },
              });
              await new Promise((resolve) => setTimeout(resolve, 100));
              runtimeInstalled = true;
              return {
                version: "Claude Code fixture",
                executable: "/fixture/claude",
              };
            }
            if (
              command === "terminal_profiles" ||
              command === "list_language_servers"
            )
              return [];
            if (command === "list_extensions")
              return extension
                ? [
                    {
                      id: "openai.chatgpt",
                      name: "Codex",
                      publisher: "openai",
                      version: "1",
                      enabled: true,
                      hasRuntime: true,
                      contributes: {
                        viewsContainers: {
                          activitybar: [
                            { id: "codex", title: "Codex", icon: "" },
                          ],
                        },
                        views: {
                          codex: [
                            {
                              id: "chatgpt.sidebarView",
                              name: "Codex",
                              type: "webview",
                            },
                          ],
                        },
                      },
                    },
                  ]
                : [];
            if (command === "ai_providers") return structuredClone(providers);
            if (command === "ai_save_provider") {
              const provider = args.provider as (typeof providers)[number];
              const i = providers.findIndex((p) => p.id === provider.id);
              if (i >= 0)
                providers[i] = {
                  ...provider,
                  hasKey: !!args.apiKey || provider.hasKey,
                };
              return null;
            }
            if (
              command === "ai_account" &&
              args.providerId === "chatgpt" &&
              oauth
            ) {
              if (args.action === "login" || args.action === "add") {
                chatgptConnected = true;
                if (args.action === "add" || !savedAccounts.length) {
                  accountIndex = savedAccounts.length;
                  savedAccounts.push({
                    id: `oaiapp_fixture_${accountIndex}`,
                    email: `person${accountIndex}@example.test`,
                    connected: true,
                    active: true,
                  });
                }
                for (const [i, a] of savedAccounts.entries())
                  a.active = i === accountIndex;
                emit("devyy-ai", {
                  requestId: args.requestId,
                  kind: "login",
                  data: {
                    authUrl:
                      "https://auth.openai.com/api/accounts/authorize?agent_name_hint=Devyy",
                  },
                });
              }
              if (args.action === "select") {
                accountIndex = savedAccounts.findIndex(
                  (a) => a.id === args.accountId,
                );
                chatgptConnected = true;
                for (const [i, a] of savedAccounts.entries())
                  a.active = i === accountIndex;
              }
              if (args.action === "logout") {
                chatgptConnected = false;
                savedAccounts[accountIndex].connected = false;
              }
              return {
                account: chatgptConnected
                  ? {
                      email: savedAccounts[accountIndex].email,
                      clientId: savedAccounts[accountIndex].id,
                    }
                  : null,
                planEnabled: chatgptConnected,
                accounts: structuredClone(savedAccounts),
                limits: null,
              };
            }
            if (command === "ai_models")
              return args.providerId === "chatgpt"
                ? [
                    {
                      id: "fixture-chatgpt",
                      name: "ChatGPT fixture",
                      reasoningEfforts: ["low", "medium", "high"],
                      defaultEffort: "medium",
                    },
                  ]
                : ["fixture-model", "another-model"];
            if (command === "ai_account")
              return args.providerId === "chatgpt"
                ? {
                    account: {
                      email: "fixture@example.test",
                      planType: "plus",
                    },
                    limits: {
                      rateLimits: {
                        primary: {
                          usedPercent: 25,
                          resetsAt: Math.floor(Date.now() / 1000) + 5 * 60 * 60,
                        },
                        secondary: {
                          usedPercent: 39,
                          resetsAt:
                            Math.floor(Date.now() / 1000) + 6 * 86400 + 3600,
                        },
                      },
                    },
                  }
                : { loggedIn: true, email: "claude@example.test" };
            if (command === "ai_chat") {
              requestId = String(
                (args.request as { requestId: string }).requestId,
              );
              return new Promise<void>((yes) => {
                resolveChat = yes;
              });
            }
            if (command === "ai_cancel") {
              emit("devyy-ai", { requestId, kind: "cancelled", data: null });
              resolveChat?.();
              return null;
            }
            if (command === "extension_webview_document")
              return "data:text/html,<h1>Codex extension ready</h1>";
            if (
              command === "extension_host_request" &&
              args.method === "restart"
            )
              return [{ id: "openai.chatgpt", status: "active" }];
            return null;
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      });
      localStorage.setItem("devyy.ai.provider", "custom-test");
    },
    { extension, oauth, missingRuntime },
  );
  await page.goto("/?playground=1");
}
async function control(
  page: Page,
  action:
    | "delta"
    | "reasoning"
    | "agent"
    | "finish"
    | "usage"
    | "extension"
    | "terminal"
    | "problems",
  text = "",
) {
  await page.evaluate(
    ({ action, text }) =>
      (
        window as unknown as {
          aiFixture: Record<string, (text?: string) => void>;
        }
      ).aiFixture[action](text),
    { action, text },
  );
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: "Toggle AI workspace", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toBeVisible();
}
test("native startup shows home and opens real projects with a compact AI gutter", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
  await expect(page.locator(".editor-document")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Open a project/ })
    .last()
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText("fn main()");
  await start(page);
  await expect.poll(async () =>
    page
      .locator(".ai-workspace")
      .evaluate((element) => getComputedStyle(element).paddingLeft),
  ).toBe("8px");
  const handle = page.getByRole("separator", {
    name: "Resize AI sidebar",
    exact: true,
  });
  expect((await handle.boundingBox())!.width).toBe(8);
  const editor = (await page.locator(".editor-surface").boundingBox())!;
  const composer = (await page.locator(".ai-composer").boundingBox())!;
  expect(composer.x - editor.x - editor.width).toBeLessThanOrEqual(14);
});

test("streams native chat, attaches explicit file context, reviews changes, and preserves conversations", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page.getByRole("button", { name: "Attach current file to AI" }).click();
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Replace this file with a small Rust example");
  await page.getByRole("button", { name: "Send AI message" }).click();
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(
    page,
    "delta",
    'Here is the complete replacement.\n\n```rust\nfn main() { println!("AI fixture"); }\n```\n',
  );
  await control(page, "usage");
  await control(page, "finish");
  await expect(
    page.getByText("Here is the complete replacement."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review replacement", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply to editor" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply to editor" }).click();
  await expect(
    page.locator(".document-workspace .cm-content").first(),
  ).toContainText("AI fixture");
  const sent = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: {
            calls: { command: string; args: Record<string, unknown> }[];
          };
        }
      ).aiFixture.calls.find((c) => c.command === "ai_chat")?.args.request,
  );
  expect(JSON.stringify(sent)).toContain("<devyy_file_context>");
  await page.getByRole("button", { name: "AI usage", exact: true }).click();
  await page.getByRole("tab", { name: "tokens", exact: true }).click();
  await expect(page.getByText("120", { exact: true })).toBeVisible();
  await expect(page.getByText("40", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close AI usage" }).click();
  await page.getByRole("button", { name: "Close AI sidebar" }).click();
  await start(page);
  await page.getByRole("button", { name: "AI conversation history" }).click();
  await expect(
    page
      .locator(".ai-history")
      .getByRole("button", { name: /^Replace this file with/ }),
  ).toBeVisible();
});
test("stops replies and retries without duplicating the last user message", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Explain cancellation");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "Partial reply");
  await page.getByRole("button", { name: "Stop AI response" }).click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry AI reply" }).click();
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "Finished reply");
  await control(page, "finish");
  await expect(page.getByText("Finished reply", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".ai-message-user")
      .getByText("Explain cancellation", { exact: true }),
  ).toHaveCount(1);
});
test("provider settings save keys through native IPC, discover models, and show reported account limits", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  const card = page.getByRole("region", { name: "Local test model" });
  const codex = page.getByRole("region", {
    name: "ChatGPT",
    exact: true,
  });
  await page.getByRole("tab", { name: /^ChatGPT/ }).click();
  await codex.getByLabel("Model", { exact: true }).fill("unsubmitted-model");
  await page.getByRole("tab", { name: /^Local test model/ }).click();
  await card
    .getByLabel("API key", { exact: true })
    .fill("test-secret-do-not-persist");
  await card
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(card.getByText("Provider saved", { exact: true })).toBeVisible();
  await expect(card.getByLabel("API key", { exact: true })).toHaveValue("");
  await card
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(card.getByText("2 models available")).toBeVisible();
  await page.getByRole("tab", { name: /^ChatGPT/ }).click();
  await expect(codex.getByLabel("Model", { exact: true })).toHaveValue(
    "unsubmitted-model",
  );
  await codex.getByRole("button", { name: "Check account & usage" }).click();
  await codex.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "ChatGPT session remaining" }),
  ).toHaveAttribute("aria-valuenow", "75");
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).not.toContain("test-secret-do-not-persist");
});
test("opens Codex extension views in the same right workspace and keeps the file editor visible", async ({
  page,
}) => {
  await fixture(page, true);
  await expect(
    page
      .locator(".activity-bar")
      .getByRole("button", { name: "Codex", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Toggle AI workspace", exact: true })
    .click();
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "AI assistant" }),
  ).toBeVisible();
  await control(page, "extension");
  await expect(
    page.getByRole("combobox", { name: "Active extension view" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".ai-workspace iframe[title='Codex conversation']"),
  ).toBeVisible();
  await expect(page.locator(".main-workspace > .extension-dock")).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "Devyy", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await expect(
    page.locator(".ai-workspace iframe[title='Codex conversation']"),
  ).toBeVisible();
  await expect(
    page.locator(".document-workspace .cm-editor").first(),
  ).toBeVisible();
});

test("AI shortcut focuses the composer and sidebar resizing uses its left edge", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await expect(
    page.getByRole("button", { name: "Toggle AI workspace", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${mod}+Shift+i`);
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toBeFocused();
  const sidebar = page.getByRole("complementary", { name: "AI assistant" }),
    handle = page.getByRole("separator", { name: "Resize AI sidebar" });
  const box = await sidebar.boundingBox(),
    grip = await handle.boundingBox();
  expect(Math.abs(box!.x - grip!.x)).toBeLessThan(2);
  expect(
    await sidebar.evaluate((el) => getComputedStyle(el).borderLeftWidth),
  ).toBe("0px");
  expect(
    await handle.evaluate((el) => {
      const grip = getComputedStyle(el, "::after");
      return { width: grip.width, height: grip.height };
    }),
  ).toEqual({ width: "4px", height: "36px" });
  await page.screenshot({ path: "artifacts/devyy-ai.png" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Toggle AI workspace", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${mod}+Shift+i`);
  await expect(
    page.getByRole("separator", { name: "Resize AI sidebar" }),
  ).toHaveAttribute("aria-valuenow", "400");
});

test("AI replacement review refuses to overwrite a newer editor buffer", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page.getByRole("button", { name: "Attach current file to AI" }).click();
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Suggest a full replacement");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  const editor = page.locator(".document-workspace .cm-content").first();
  await editor.click();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.insertText("// Newer edit\n");
  await control(page, "delta", "```rust\nfn main() {}\n```\n");
  await control(page, "finish");
  await page
    .getByRole("button", { name: "Review replacement", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply to editor" }).click();
  await expect(
    page.getByText(
      "The file changed since this suggestion. Attach its latest contents and ask again.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close diff", exact: true }).click();
  await expect(editor).toContainText("Newer edit");
});

test("composer discovers models, favorites them, and passes the selected reasoning effort", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await expect(
    page.getByRole("textbox", { name: "Search models", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Models from ChatGPT", exact: true })
    .click();
  await page.getByRole("option", { name: /^ChatGPT fixture/ }).click();
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await page.getByRole("radio", { name: "High", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "High", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("button", { name: "Favorite ChatGPT fixture", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Unfavorite ChatGPT fixture",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator(".ai-popover")
    .evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
  await page.screenshot({ path: "artifacts/devyy-ai-models.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Use this model");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  const request = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: {
            calls: {
              command: string;
              args: {
                request: { model: string; effort: string; providerId: string };
              };
            }[];
          };
        }
      ).aiFixture.calls.find((c) => c.command === "ai_chat")!.args.request,
  );
  expect(request).toMatchObject({
    providerId: "chatgpt",
    model: "fixture-chatgpt",
    effort: "high",
  });
  await control(page, "delta", "Selected model reply");
  await control(page, "finish");
});

test("context picker combines files, problems, selection, output, and device text files", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page.locator(".editor-document.visible .cm-content").first().click();
  await page.keyboard.press(`${mod}+a`);
  await page
    .getByRole("button", { name: "Attach context", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Attach context",
    exact: true,
  });
  const file = picker.getByRole("checkbox", { name: /^main.rs/ });
  await expect(file.locator(".material-file-icon img").first()).toHaveAttribute(
    "src",
    /file-icons\/rust/,
  );
  const spacing = await file.evaluate((element) => {
    const icon = element
      .querySelector(".material-file-icon")!
      .getBoundingClientRect();
    const label = element.querySelector("strong")!.getBoundingClientRect();
    return { width: icon.width, gap: label.x - icon.right };
  });
  await expect
    .poll(() =>
      file
        .locator(".material-file-icon")
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    )
    .toBe(18);
  expect(spacing.gap).toBeLessThanOrEqual(12);
  await file.click();
  await picker.getByRole("checkbox", { name: /^Problems/ }).click();
  await picker.getByRole("checkbox", { name: /^Output/ }).click();
  await picker.getByRole("checkbox", { name: /^Editor selection/ }).click();
  await picker.getByRole("button", { name: "Attach (4)", exact: true }).click();
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(4);
  await page.getByLabel("Attach files from device").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Device note snapshot"),
  });
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(5);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Review all context");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  const sent = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: { calls: { command: string; args: unknown }[] };
        }
      ).aiFixture.calls.find((c) => c.command === "ai_chat")!.args,
  );
  expect(JSON.stringify(sent)).toContain("Attached problems");
  expect(JSON.stringify(sent)).toContain("Attached output");
  expect(JSON.stringify(sent)).toContain("Attached selection");
  expect(JSON.stringify(sent)).toContain("Device note snapshot");
  await control(page, "delta", "Context received");
  await control(page, "finish");
});

test("dragging file tabs and split groups snapshots all members without changing the split", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("tab", { name: "lib.rs", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  const group = page.getByRole("group", {
    name: "Split file group",
    exact: true,
  });
  await group
    .getByRole("button", { name: "Separate file group", exact: true })
    .dragTo(page.getByRole("textbox", { name: "Message Devyy AI" }));
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(2);
  await expect(group.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".editor-document.visible")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove all attachments" }).click();
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .dragTo(page.getByRole("textbox", { name: "Message Devyy AI" }));
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(1);
  await expect(page.locator(".ai-attachment-chip")).toContainText("main.rs");
  const alpha = await page
    .getByRole("complementary", { name: "AI assistant" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(alpha).toBe("rgba(0, 0, 0, 0)");
});

test("terminal splits drag both fresh output buffers into chat without closing either session", async ({
  page,
}) => {
  await fixture(page);
  await page.keyboard.press(`${mod}+o`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { aiFixture: { calls: { command: string }[] } }
          ).aiFixture.calls.filter((c) => c.command === "terminal_create")
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Split terminal group", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { aiFixture: { calls: { command: string }[] } }
          ).aiFixture.calls.filter((c) => c.command === "terminal_create")
            .length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await control(page, "terminal", "Build output");
  await start(page);
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Separate terminal group", exact: true })
    .dragTo(page.getByRole("textbox", { name: "Message Devyy AI" }));
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(2);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Explain the builds");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  const sent = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: { calls: { command: string; args: unknown }[] };
        }
      ).aiFixture.calls.find((c) => c.command === "ai_chat")!.args,
  );
  expect(JSON.stringify(sent)).toContain("Build output 101");
  expect(JSON.stringify(sent)).toContain("Build output 102");
  await expect(
    page
      .getByRole("group", { name: "Split terminal group", exact: true })
      .getByRole("tab"),
  ).toHaveCount(2);
  await control(page, "delta", "Both terminals captured");
  await control(page, "finish");
});

test("provider master/detail and usage tabs show real quotas and retain disabled connections", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await page.getByRole("tab", { name: /^ChatGPT/ }).click();
  const detail = page.getByRole("region", {
    name: "ChatGPT",
    exact: true,
  });
  await detail.getByRole("button", { name: "Check account & usage" }).click();
  await expect(detail.getByText("fixture@example.test")).toBeVisible();
  await expect(page.locator(".settings-empty")).toHaveCount(0);
  await page
    .locator(".settings-modal")
    .evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
  await page.screenshot({ path: "artifacts/devyy-ai-providers.png" });
  await page
    .getByRole("switch", { name: "Enable Claude account", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Enable Claude account", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await detail.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "ChatGPT session remaining" }),
  ).toHaveAttribute("aria-valuenow", "75");
  await page
    .locator(".ai-usage-dialog")
    .evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
  await page.screenshot({ path: "artifacts/devyy-ai-usage.png" });
  await page.getByRole("tab", { name: "cost", exact: true }).click();
  await expect(page.getByText("Plan allowance", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "tokens", exact: true }).click();
  await expect(page.getByText("Requests", { exact: true })).toBeVisible();
});

test("problem rows and the Problems tab drag live diagnostic snapshots into the composer", async ({
  page,
}) => {
  await fixture(page);
  await page.keyboard.press(`${mod}+o`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { aiFixture: { calls: { command: string }[] } }
          ).aiFixture.calls.filter((c) => c.command === "terminal_create")
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await start(page);
  await control(page, "problems");
  const tab = page.getByRole("tab", { name: /^problems/i });
  await tab.click();
  const diagnostic = page
    .locator(".problems-list")
    .getByRole("button", { name: /Fixture type mismatch/ });
  await expect(diagnostic).toBeVisible();
  await diagnostic.dragTo(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  );
  await expect(page.locator(".ai-attachment-chip")).toContainText(
    "Problem: main.rs",
  );
  await page.getByRole("button", { name: "Remove all attachments" }).click();
  await tab.dragTo(page.getByRole("textbox", { name: "Message Devyy AI" }));
  await expect(page.locator(".ai-attachment-chip")).toContainText("Problems");
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Fix this diagnostic");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  const sent = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: { calls: { command: string; args: unknown }[] };
        }
      ).aiFixture.calls.find((c) => c.command === "ai_chat")!.args,
  );
  expect(JSON.stringify(sent)).toContain("Fixture type mismatch");
  await control(page, "delta", "Diagnostic received");
  await control(page, "finish");
});

test("conversations can branch, edit a prompt, and rename without changing the original thread", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Original prompt");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "Original answer");
  await control(page, "finish");
  await page.getByRole("button", { name: "Branch conversation" }).click();
  await page.getByRole("button", { name: "Edit message" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toHaveValue("Original prompt");
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Revised prompt");
  await page.getByRole("button", { name: "Send AI message" }).click();
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "Revised answer");
  await control(page, "finish");
  await expect(page.locator(".ai-message-user")).toHaveCount(1);
  await expect(page.locator(".ai-message-user")).toContainText(
    "Revised prompt",
  );
  await page.getByRole("button", { name: "AI conversation history" }).click();
  await page
    .getByRole("button", {
      name: "Rename conversation Original prompt (branch)",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Conversation title", exact: true })
    .fill("Refinement");
  await page
    .getByRole("button", { name: "Save conversation title", exact: true })
    .click();
  await expect(
    page.locator(".ai-history").getByRole("button", { name: /^Refinement/ }),
  ).toBeVisible();
  await page
    .locator(".ai-history")
    .getByRole("button", { name: /^Original prompt Local/ })
    .click();
  await expect(page.locator(".ai-message-user")).toContainText(
    "Original prompt",
  );
  await expect(
    page.getByText("Original answer", { exact: true }),
  ).toBeVisible();
});

test("ChatGPT authorizes Devyy independently and switches saved app registrations", async ({
  page,
}) => {
  await fixture(page, false, true);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await page.getByRole("tab", { name: /^ChatGPT/ }).click();
  const provider = page.getByRole("region", { name: "ChatGPT", exact: true });
  await provider
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await expect(
    provider.locator(".ai-connection-card").getByText("person0@example.test"),
  ).toBeVisible();
  await provider
    .getByRole("button", { name: "Add ChatGPT account or workspace" })
    .click();
  await expect(
    provider.locator(".ai-connection-card").getByText("person1@example.test"),
  ).toBeVisible();
  await chooseOption(provider.getByLabel("Saved accounts"), "oaiapp_fixture_0");
  await expect(
    provider.locator(".ai-connection-card").getByText("person0@example.test"),
  ).toBeVisible();
  await provider
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    provider.getByRole("button", {
      name: "Continue with ChatGPT",
      exact: true,
    }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: {
            calls: { command: string; args: Record<string, unknown> }[];
          };
        }
      ).aiFixture.calls,
  );
  expect(
    calls
      .filter(
        (c) =>
          c.command === "ai_account" &&
          ["login", "add", "select", "logout"].includes(String(c.args.action)),
      )
      .every((c) => c.args.providerId === "chatgpt"),
  ).toBe(true);
  expect(
    calls.some(
      (c) =>
        c.command === "ai_account" &&
        c.args.accountId === "oaiapp_fixture_0" &&
        c.args.action === "select",
    ),
  ).toBe(true);
  expect(
    calls
      .filter((c) => c.command === "plugin:opener|open_url")
      .every((c) => String(c.args.url).startsWith("https://auth.openai.com/")),
  ).toBe(true);
});

test("header toggles the AI workspace and provider Usage navigates within Settings", async ({
  page,
}) => {
  await fixture(page);
  const toggle = page.getByRole("button", {
    name: "Toggle AI workspace",
    exact: true,
  });
  await expect(
    page
      .locator(".titlebar")
      .getByRole("button", { name: "Toggle AI workspace" }),
  ).toBeVisible();
  await expect(
    page.locator(".activity-bottom").getByRole("button", { name: /AI/ }),
  ).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ai-workspace-heading")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(page.locator(".ai-workspace")).toHaveCSS("padding-left", "8px");
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await page.getByRole("tab", { name: /^ChatGPT/ }).click();
  const detail = page.getByRole("region", { name: "ChatGPT", exact: true });
  await detail
    .getByLabel("Model", { exact: true })
    .fill("preserve-unsaved-default");
  const usage = detail.getByRole("button", { name: "Usage", exact: true });
  await usage.click();
  await expect(
    page.getByRole("region", { name: "AI usage", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator(".ai-modal-backdrop")).toHaveCount(0);
  await expect(detail).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Back to providers" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Back to providers" }).click();
  await expect(detail).toBeVisible();
  await expect(detail.getByLabel("Model", { exact: true })).toHaveValue(
    "preserve-unsaved-default",
  );
  await expect(usage).toBeFocused();
  await page.getByRole("button", { name: "Close preferences" }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("complementary", { name: "AI assistant" }),
  ).toBeHidden();
});

test("thinking summaries stream separately, collapse, and persist with the reply", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Explain the constraints");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "reasoning", "Checking the attached constraints. ");
  await control(page, "reasoning", "Comparing the available approaches.");
  const thinking = page.locator(".ai-thoughts");
  await expect(thinking).toHaveCount(1);
  await expect(
    thinking.getByRole("button", { name: "Thinking summary" }),
  ).toHaveAttribute("aria-expanded", "false");
  await thinking.getByRole("button", { name: "Thinking summary" }).click();
  await expect(thinking).toContainText(
    "Checking the attached constraints. Comparing the available approaches.",
  );
  await expect(
    page.locator(".ai-message-assistant .ai-markdown"),
  ).not.toContainText("Comparing the available approaches.");
  await control(page, "delta", "Here is the answer.");
  await control(page, "finish");
  await expect(
    thinking.getByRole("button", { name: "Thinking summary" }),
  ).toHaveText("Thoughts");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("devyy.ai.chats") ?? "[]",
          )[0]?.messages.at(-1)?.reasoning,
      ),
    )
    .toBe(
      "Checking the attached constraints. Comparing the available approaches.",
    );
  await page.screenshot({ path: "artifacts/devyy-ai-thinking.png" });
});

test("streaming preserves mounted code blocks while appending the answer", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Show a short example");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "```rust\nfn main() {}\n```\n\n");
  const block = page.locator(".ai-code-block").first();
  await expect(block).toContainText("fn main()");
  await block.evaluate((node) => node.setAttribute("data-mounted", "original"));
  await control(page, "delta", "This example has no side effects.");
  await expect(page.locator(".ai-markdown")).toContainText("no side effects");
  await expect(block).toHaveAttribute("data-mounted", "original");
  await control(page, "finish");
});

test("missing Claude runtime installs through Devyy before sign-in", async ({
  page,
}) => {
  await fixture(page, false, false, true);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Claude account/ }).click();
  const detail = page.getByRole("region", {
    name: "Claude account",
    exact: true,
  });
  await expect(
    detail.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Install", exact: true }).click();
  await expect(
    detail.getByText("Claude Code installed", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: {
            calls: { command: string; args: Record<string, unknown> }[];
          };
        }
      ).aiFixture.calls,
  );
  expect(
    calls.some(
      (call) =>
        call.command === "ai_install_runtime" &&
        call.args.providerId === "claude",
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.command === "ai_save_provider" &&
        (call.args.provider as { executable?: string })?.executable ===
          "/fixture/claude",
    ),
  ).toBe(true);
});

test("favorite models span providers and retain their provider identity", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command, args) =>
      command === "ai_models"
        ? Promise.resolve([
            {
              id: `private-model-id-${args?.providerId}`,
              name: "Shared model",
            },
          ])
        : original(command, args);
  });
  await start(page);
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await page
    .getByRole("button", { name: "Favorite Shared model", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Models from ChatGPT", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Favorite Shared model", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Favorite models", exact: true })
    .click();
  await expect(page.getByRole("option", { name: /^Shared model/ })).toHaveCount(
    2,
  );
  await expect(
    page.getByLabel("Provider: Local test model", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Provider: ChatGPT", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ai-model-options")).not.toContainText(
    "private-model-id",
  );
  await page
    .getByRole("option", { name: "Shared model / ChatGPT", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Use the ChatGPT favorite");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              aiFixture: {
                calls: {
                  command: string;
                  args: { request?: { providerId: string } };
                }[];
              };
            }
          ).aiFixture.calls.findLast((call) => call.command === "ai_chat")?.args
            .request?.providerId,
      ),
    )
    .toBe("chatgpt");
  await control(page, "delta", "Favorite selected");
  await control(page, "finish");
});

test("retiring Codex CLI preserves conversations and uses the independent ChatGPT provider", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "devyy.ai.chats",
      JSON.stringify([
        {
          id: "legacy-chat",
          title: "Existing CLI conversation",
          providerId: "codex",
          model: "retired-model",
          updatedAt: 1,
          messages: [
            { id: "one", role: "user", content: "Preserve this question" },
            { id: "two", role: "assistant", content: "Preserve this answer" },
          ],
        },
      ]),
    );
  });
  await fixture(page);
  await start(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("devyy.ai.chats") ?? "[]")[0]
            ?.providerId,
      ),
    )
    .toBe("chatgpt");
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("devyy.ai.chats") ?? "[]")[0],
  );
  expect(
    saved.messages.map((message: { content: string }) => message.content),
  ).toEqual(["Preserve this question", "Preserve this answer"]);
  expect(saved.model).toBe("");
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /^ChatGPT/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Codex/ })).toHaveCount(0);
});

test("reduced motion keeps settings navigation immediate and returns keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  const detail = page.getByRole("region", {
    name: "Local test model",
    exact: true,
  });
  const usage = detail.getByRole("button", { name: "Usage", exact: true });
  await usage.click();
  await expect(
    page.getByRole("button", { name: "Back to providers" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await expect(usage).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Preferences" })).toBeVisible();
});

test("workspace access requires consent and agent proposals are reviewed before edits or saves", async ({
  page,
}) => {
  await fixture(page);
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator(".code-editor .cm-content:visible")).toContainText(
    "fn main()",
  );
  await start(page);
  const access = page.getByRole("combobox", { name: "Agent workspace access" });
  await expect(access).toHaveAttribute("data-value", "attached");
  await chooseOption(access, "full");
  const consent = page.getByRole("dialog", {
    name: "Workspace access",
    exact: true,
  });
  await expect(consent).toContainText("including ignored files");
  await consent.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(access).toHaveAttribute("data-value", "attached");
  await chooseOption(access, "full");
  await consent
    .getByRole("button", { name: "Allow full workspace access", exact: true })
    .click();
  await expect(access).toHaveAttribute("data-value", "full");
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Inspect the workspace and propose a focused edit");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "agent");
  await control(
    page,
    "delta",
    "I inspected main.rs and staged two proposals for review.",
  );
  await control(page, "finish");
  await page.screenshot({ path: "artifacts/devyy-ai-agent.png" });
  const proposal = page
    .locator(".ai-proposal")
    .filter({ hasText: "src/main.rs" });
  await expect(
    page.getByRole("button", { name: "Apply to editor", exact: true }),
  ).toBeVisible();
  await proposal.getByRole("button", { name: "Review diff" }).click();
  await page
    .getByRole("button", { name: "Apply to editor", exact: true })
    .click();
  await expect(page.locator(".code-editor .cm-content:visible")).toContainText(
    "agent edit",
  );
  const created = page
    .locator(".ai-proposal")
    .filter({ hasText: "src/new.rs" });
  await created.getByRole("button", { name: "Review diff" }).click();
  await page
    .getByRole("button", { name: "Apply to editor", exact: true })
    .click();
  await expect(page.locator(".code-editor .cm-content:visible")).toContainText(
    "pub fn proposed()",
  );
  let calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          aiFixture: {
            calls: { command: string; args: Record<string, unknown> }[];
          };
        }
      ).aiFixture.calls,
  );
  expect(
    calls.some((c) => ["write_file", "create_file"].includes(c.command)),
  ).toBe(false);
  await page.keyboard.press(`${mod}+s`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            aiFixture: {
              calls: { command: string; args: Record<string, unknown> }[];
            };
          }
        ).aiFixture.calls.some(
          (c) =>
            c.command === "write_file" &&
            c.args.path === "src/new.rs" &&
            c.args.expected === "devyy:new",
        ),
      ),
    )
    .toBe(true);
  await chooseOption(access, "attached");
  await expect(access).toHaveAttribute("data-value", "attached");
});

test("workspace shell and first document appear while indexing and services remain pending", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command, args) =>
      ["lsp_stop", "debug_stop", "refresh_workspace"].includes(command)
        ? new Promise(() => {})
        : invoke(command, args);
  });
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator(".code-editor .cm-content")).toContainText(
    "fn main()",
    { timeout: 4000 },
  );
  await expect(page.locator(".opening-indicator")).toHaveCount(0);
  const content = page.locator(".code-editor .cm-content");
  await expect(page.locator(".devyy")).toHaveAttribute("aria-busy", "false");
  await expect(content).not.toHaveAttribute("aria-readonly", "true");
  await content.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("\n// editing before services finish");
  await expect(content).toContainText("editing before services finish");
  await page
    .getByRole("button", { name: "lib.rs", exact: true })
    .first()
    .click();
  await expect(page.getByRole("tab", { name: /lib.rs/ }).first()).toBeVisible();
});

test("default-app settings use native associations and imported editors show their marks", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page
    .getByRole("tab", { name: "Default applications", exact: true })
    .click();
  await page.getByRole("button", { name: "Use Devyy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Default", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Setup & import", exact: true }).click();
  const icons = page.locator(".import-sources .ide-import-icon");
  await expect(icons).toHaveCount(2);
  expect(
    await icons.evaluateAll((images) =>
      images.every(
        (img) =>
          (img as HTMLImageElement).complete &&
          (img as HTMLImageElement).naturalWidth > 0,
      ),
    ),
  ).toBe(true);
});

test("Antigravity and OpenCode providers display real logos, models, and CLI notices", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Antigravity/ }).click();
  const agDetail = page.getByRole("region", {
    name: "Antigravity",
    exact: true,
  });
  await expect(agDetail).toBeVisible();
  await expect(
    agDetail.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeVisible();
  const agIcon = agDetail.locator('img[src="/providers/antigravity.png"]');
  await expect(agIcon.first()).toBeVisible();
  await agDetail
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(agDetail.getByLabel("Model", { exact: true })).toHaveValue(
    "fixture-model",
  );

  await page.getByRole("tab", { name: /^OpenCode/ }).click();
  const ocDetail = page.getByRole("region", {
    name: "OpenCode",
    exact: true,
  });
  await expect(ocDetail).toBeVisible();
  await expect(
    ocDetail.getByRole("button", { name: "Connect an account", exact: true }),
  ).toBeVisible();
  const ocIcon = ocDetail.locator('img[src="/providers/opencode.png"]');
  await expect(ocIcon.first()).toBeVisible();
  await ocDetail
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(ocDetail.getByLabel("Model", { exact: true })).toHaveValue(
    "fixture-model",
  );
});

test("Google and OpenCode sign-in open provider-owned sessions and clean up on close", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  for (const [name, label, expectedArgs] of [
    ["Antigravity", "Sign in with Google", ["acp", "--login"]],
    ["OpenCode", "Connect an account", ["auth", "login"]],
  ] as const) {
    await page.getByRole("tab", { name: new RegExp("^" + name) }).click();
    const detail = page.getByRole("region", { name, exact: true });
    await detail.getByRole("button", { name: label, exact: true }).click();
    await expect(
      detail.getByRole("region", { name: name + " sign-in" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).aiFixture.calls
              .filter((c: any) => c.command === "terminal_create")
              .at(-1)?.args.options,
        ),
      )
      .toMatchObject({ shellPath: "/fixture/cli", shellArgs: expectedArgs });
    await detail
      .getByRole("button", { name: "Close sign-in session", exact: true })
      .click();
    await expect(
      detail.getByRole("region", { name: name + " sign-in" }),
    ).toHaveCount(0);
  }
});

test("model and access controls share a row", async ({ page }) => {
  await fixture(page);
  await start(page);
  const controls = page.locator(".ai-chat-controls");
  await expect(controls).toBeVisible();
  const model = await controls.locator(".ai-model-control").boundingBox();
  const access = await controls.locator(".ai-access-control").boundingBox();
  expect(
    Math.abs(model!.y + model!.height / 2 - (access!.y + access!.height / 2)),
  ).toBeLessThan(4);
});

test("reasoning follows model capabilities and preserves provider-specific option names", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) =>
      command === "ai_models"
        ? Promise.resolve([
            {
              id: "adaptive",
              name: "Adaptive model",
              reasoningLabel: "Thinking",
              defaultEffort: "adaptive",
              reasoningOptions: [
                { id: "adaptive", label: "Automatic" },
                { id: "budget_8k", label: "Extended thinking" },
              ],
            },
            { id: "simple", name: "Simple model" },
          ])
        : invoke(command, args);
  });
  await start(page);
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await page.getByRole("option", { name: /^Adaptive model/ }).click();
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await expect(
    page.getByRole("radio", { name: "Default (Automatic)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "High", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("radio", { name: "Extended thinking", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Choose AI model" }),
  ).toContainText("Extended thinking");
  await page
    .getByRole("button", { name: "Favorite Adaptive model", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Favorite models", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Extended thinking", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await page
    .getByRole("button", { name: "Models from Local test model", exact: true })
    .click();
  await page.getByRole("option", { name: /^Simple model/ }).click();
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Reasoning effort" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose AI model" }),
  ).not.toContainText("Extended thinking");
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Use simple model");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).aiFixture.calls.find(
            (c: any) => c.command === "ai_chat",
          )?.args.request,
      ),
    )
    .toMatchObject({ model: "simple", effort: null });
});

test("live answers reveal new words without remounting existing text or changing code blocks", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Explain streaming");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();
  await control(page, "delta", "Hello **streaming**");
  await expect(page.locator(".ai-markdown").last()).toContainText(
    "Hello streaming",
  );
  const firstWord = await page
    .locator(".ai-stream-word")
    .first()
    .elementHandle();
  await control(page, "delta", " world.\n\n```rust\nfn main() {}\n```\n");
  await expect(page.locator(".ai-code-block code")).toHaveText("fn main() {}");
  expect(await firstWord!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.locator(".ai-code-block .ai-stream-word")).toHaveCount(0);
  await control(page, "finish");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toHaveCount(0);
});

test("right-click problems in problems tab explains or fixes with Devyy AI", async ({
  page,
}) => {
  await fixture(page);
  await page.keyboard.press(`${mod}+o`);
  await start(page);
  await control(page, "problems");
  const tab = page.getByRole("tab", { name: /^problems/i });
  await tab.click();
  const problem = page.locator(".problems-list button").first();
  await expect(problem).toBeVisible();
  await problem.click({ button: "right" });
  const explain = page.getByRole("menuitem", { name: "Explain with Devyy AI" });
  await expect(explain).toBeVisible();
  const fix = page.getByRole("menuitem", { name: "Fix with Devyy AI" });
  await expect(fix).toBeVisible();
  await explain.click();
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toHaveValue(/Explain this diagnostic/);
  await expect(page.locator(".ai-attachment-chip")).toBeVisible();
});

test("composer supports Cmd+A select all and message queuing while running", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  const composer = page.getByRole("textbox", { name: "Message Devyy AI" });
  await composer.fill("Initial long query for the agent");
  await composer.press(`${mod}+a`);
  const selectionLen = await composer.evaluate(
    (el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart,
  );
  expect(selectionLen).toBe("Initial long query for the agent".length);

  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop AI response" }),
  ).toBeVisible();

  await composer.fill("Queued second prompt");
  await page.keyboard.press("Enter");

  await expect(page.locator(".ai-queued-messages")).toBeVisible();
  await expect(page.locator(".ai-queued-text")).toHaveText(
    "Queued second prompt",
  );

  await control(page, "delta", "First reply done");
  await control(page, "finish");

  await expect(page.locator(".ai-queued-messages")).toHaveCount(0);
});

test("changing a provider default updates conversations that still use the old default", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  await page
    .getByRole("button", { name: "AI provider settings", exact: true })
    .click();
  const provider = page.getByRole("region", {
    name: "Local test model",
    exact: true,
  });
  await provider.getByLabel("Model", { exact: true }).fill("another-model");
  await provider
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(
    provider.getByText("Provider saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message Devyy AI" })
    .fill("Use the configured default");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).aiFixture.calls
            .filter((c: any) => c.command === "ai_chat")
            .at(-1)?.args.request.model,
      ),
    )
    .toBe("another-model");
});

test("composer input box has corner drag thumb and dropping context keeps AI workspace open", async ({
  page,
}) => {
  await fixture(page);
  await start(page);
  const cornerThumb = page.locator(".ai-composer-corner-thumb");
  await expect(cornerThumb).toBeVisible();
  await expect(cornerThumb.locator("path")).toHaveAttribute(
    "stroke-linecap",
    "round",
  );
  const composerBox = page.getByRole("textbox", { name: "Message Devyy AI" });
  const initialHeight = await composerBox.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(initialHeight).toBeLessThanOrEqual(55);

  await page.keyboard.press(`${mod}+o`);
  await control(page, "problems");
  const tab = page.getByRole("tab", { name: /^problems/i });
  await tab.click();
  const diagnostic = page
    .locator(".problems-list")
    .getByRole("button", { name: /Fixture type mismatch/ });
  await expect(diagnostic).toBeVisible();

  await diagnostic.dragTo(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  );

  await expect(page.locator(".ai-workspace")).not.toHaveClass(/ai-workspace-hidden/);
  await expect(page.locator(".ai-attachment-chip")).toContainText(
    "Problem: main.rs",
  );
});
