import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function fixture(page: Page, extension = false) {
  await page.addInitScript(
    ({ extension }) => {
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
          id: "codex",
          name: "Codex account",
          kind: "codex",
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
      ];
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
                id: "codex-view",
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
            if (command === "open_workspace")
              return {
                root: "/fixture",
                name: "fixture",
                files: [
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
            if (command === "ai_runtime")
              return { version: "fixture-cli 1.0", executable: "/fixture/cli" };
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
                              id: "codex-view",
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
            if (command === "ai_models")
              return args.providerId === "codex"
                ? [
                    {
                      id: "fixture-codex",
                      name: "Codex fixture",
                      reasoningEfforts: ["low", "medium", "high"],
                      defaultEffort: "medium",
                    },
                  ]
                : ["fixture-model", "another-model"];
            if (command === "ai_account")
              return args.providerId === "codex"
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
    { extension },
  );
  await page.goto("/");
}
async function control(
  page: Page,
  action: "delta" | "finish" | "usage" | "extension" | "terminal" | "problems",
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
    .getByRole("button", { name: "Open AI assistant", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Devyy AI" }),
  ).toBeVisible();
}
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
    name: "Codex account",
    exact: true,
  });
  await page.getByRole("tab", { name: /^Codex account/ }).click();
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
    .getByRole("button", { name: "Discover models", exact: true })
    .click();
  await expect(card.getByText("2 models available")).toBeVisible();
  await page.getByRole("tab", { name: /^Codex account/ }).click();
  await expect(codex.getByLabel("Model", { exact: true })).toHaveValue(
    "unsubmitted-model",
  );
  await codex.getByRole("button", { name: "Check account & usage" }).click();
  await codex.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "Codex account session remaining" }),
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
    page.getByRole("button", { name: "Codex", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "AI assistant" }),
  ).toBeVisible();
  await control(page, "extension");
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
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open AI assistant", exact: true }),
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
  await page.screenshot({ path: "artifacts/devyy-ai.png" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open AI assistant", exact: true }),
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
  await page
    .getByRole("button", { name: "Models from Codex account", exact: true })
    .click();
  await page.getByRole("option", { name: /^Codex fixture/ }).click();
  await page.getByRole("button", { name: "Choose AI model" }).click();
  await page.getByRole("radio", { name: "High", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "High", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("button", { name: "Favorite Codex fixture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unfavorite Codex fixture", exact: true }),
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
    providerId: "codex",
    model: "fixture-codex",
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
  await picker.getByRole("checkbox", { name: /^main.rs/ }).click();
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
  // xterm's selection bridge observes its parsed buffer, after the write queue drains.
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
  await page.getByRole("tab", { name: /^Codex account/ }).click();
  const detail = page.getByRole("region", {
    name: "Codex account",
    exact: true,
  });
  await detail.getByRole("button", { name: "Check account & usage" }).click();
  await expect(
    detail.getByText("Authenticated as fixture@example.test"),
  ).toBeVisible();
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
    page.getByRole("meter", { name: "Codex account session remaining" }),
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
  await expect(
    page.getByText("Not reported by this provider", { exact: true }),
  ).toBeVisible();
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
