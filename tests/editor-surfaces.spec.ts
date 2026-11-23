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
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function fixture(page: Page, lsp = false, dependencyTree = false) {
  await page.addInitScript(
    ({ lsp, dependencyTree }) => {
      let serial = 0,
        hintSerial = 0;
      const callbacks = new Map<number, (value: unknown) => void>();
      const listeners = new Map<string, Set<number>>();
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>';
      const files = [
        "main.rs",
        ".env",
        "photo.png",
        "drawing.svg",
        "sound.mp3",
      ].map((path) => ({ path, name: path, directory: false }));
      files.push({ path: "target", name: "target", directory: true });
      const workspace = { root: "/fixture", name: "Fixture", files };
      const emit = (name: string, payload: unknown) => {
        for (const id of listeners.get(name) ?? [])
          callbacks.get(id)?.({ event: name, id, payload });
      };
      const hostEvent = (event: string, payload: unknown) =>
        emit("extension-host", { event, payload });
      const extension = (id: string, key: string) => ({
        id,
        name: id === "openai.chatgpt" ? "Codex" : "Claude Code",
        publisher: id.split(".")[0],
        enabled: true,
        hasRuntime: true,
        version: "1",
        contributes: {
          configuration: {
            properties: {
              [key]: {
                type: "boolean",
                default: false,
                description: "Extension option",
              },
            },
          },
        },
      });
      let dependenciesReady = false;
      let extensionHostReady = false;
      window.addEventListener("devyy-extension-host-reset", () => { extensionHostReady = false; });
      window.addEventListener("devyy-extension-host-ready", () => { extensionHostReady = true; });
      Object.assign(window, {
        isTauri: true,
        surfaceFixture: {
          emit,
          hostEvent,
          calls,
          get extensionHostReady() { return extensionHostReady; },
          loadDependencies() {
            dependenciesReady = true;
            hostEvent("treeChanged", { id: "rustDependencies" });
          },
        },
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
          async invoke(command: string, args: Record<string, unknown> = {}) {
            calls.push({ command, args });
            if (command === "plugin:event|listen") {
              const set = listeners.get(String(args.event)) ?? new Set();
              set.add(Number(args.handler));
              listeners.set(String(args.event), set);
              return ++serial;
            }
            if (command === "plugin:dialog|open") return "/fixture";
            if (["open_workspace", "refresh_workspace"].includes(command))
              return workspace;
            if (command === "list_files") return files;
            if (command === "list_directory")
              return [{ path: "target/debug", name: "debug", directory: true }];
            if (command === "read_file")
              return {
                content: String(args.path).endsWith(".svg")
                  ? svg
                  : "fn main() {}",
                modified: "1",
              };
            if (command === "read_preview_image")
              return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
            if (command === "read_preview_media")
              return "data:audio/mpeg;base64,";
            if (command === "list_extensions")
              return [
                extension("openai.chatgpt", "chatgpt.runCodex"),
                extension("anthropic.claude-code", "claudeCode.useTerminal"),
                ...(dependencyTree
                  ? [
                      {
                        id: "rust-lang.rust-analyzer",
                        name: "rust-analyzer",
                        publisher: "rust-lang",
                        version: "1",
                        enabled: true,
                        hasRuntime: true,
                        contributes: {
                          views: {
                            explorer: [
                              {
                                id: "rustDependencies",
                                name: "Rust Dependencies",
                                when: "inRustProject",
                              },
                            ],
                          },
                        },
                      },
                    ]
                  : []),
              ];
            if (command === "list_language_servers")
              return lsp ? [{ language: "rust", enabled: true }] : [];
            if (command === "file_uri") return `file:///fixture/${args.path}`;
            if (command === "lsp_start")
              return {
                capabilities: {
                  semanticTokensProvider: {
                    legend: { tokenTypes: ["function"], tokenModifiers: [] },
                  },
                },
              };
            if (command === "lsp_request" && !args.notification && lsp) {
              if (args.method === "textDocument/inlayHint")
                return [
                  {
                    position: { line: 0, character: 7 },
                    label: `: Hint${++hintSerial}`,
                  },
                ];
              if (args.method === "textDocument/codeLens")
                return [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 4 },
                    },
                    data: "resolve-me",
                  },
                ];
              if (args.method === "codeLens/resolve")
                return {
                  ...(args.params as object),
                  command: {
                    title: "Run sample",
                    command: "fixture.runSample",
                  },
                };
              if (args.method === "textDocument/semanticTokens/full")
                return { data: [0, 3, 4, 0, 0] };
            }
            if (
              [
                "list_language_servers",
                "terminal_profiles",
                "ai_providers",
              ].includes(command)
            )
              return [];
            if (command === "set_appearance") return { material: "solid" };
            if (command === "git_status")
              return { branch: "main", changes: [] };
            if (command === "extension_host_request") {
              const p = (args.params ?? {}) as Record<string, unknown>;
              if (args.method === "restart") {
                if (dependencyTree)
                  hostEvent("context", { key: "inRustProject", value: true });
                return [];
              }
              if (args.method === "tree" && p.id === "rustDependencies")
                return !dependenciesReady
                  ? []
                  : p.parent
                    ? [
                        {
                          key: "serde-lib",
                          label: "lib.rs",
                          collapsibleState: 0,
                        },
                      ]
                    : [
                        {
                          key: "serde",
                          label: "serde",
                          description: "1.0",
                          collapsibleState: 1,
                        },
                      ];
              if (args.method === "readConfiguration")
                return {
                  "chatgpt.runCodex": false,
                  "claudeCode.useTerminal": false,
                };
              if (args.method === "closeWebview")
                hostEvent("webviewClosed", { id: p.id });
            }
            return null;
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      });
    },
    { lsp, dependencyTree },
  );
  await page.goto("/");
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator('.tree-file[title="main.rs"]')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as {
    surfaceFixture: { extensionHostReady: boolean };
  }).surfaceFixture.extensionHostReady);
}
async function host(
  page: Page,
  event: string,
  payload: Record<string, unknown>,
) {
  await page.evaluate(
    ({ event, payload }) => {
      (
        window as unknown as {
          surfaceFixture: {
            hostEvent: (event: string, payload: unknown) => void;
          };
        }
      ).surfaceFixture.hostEvent(event, payload);
    },
    { event, payload },
  );
}
test("extension progress shows one current report per owner and restores the remaining report", async ({
  page,
}) => {
  await fixture(page);
  await host(page, "progressStart", {
    id: "check",
    extension: "rust-lang.rust-analyzer",
    title: "cargo check",
    cancellable: true,
  });
  await host(page, "progressStart", {
    id: "index",
    extension: "rust-lang.rust-analyzer",
    title: "Indexing",
  });
  const footer = page.locator(".statusbar");
  await expect(footer.getByRole("progressbar", { name: "Indexing", exact: true })).toBeVisible();
  await expect(footer.getByRole("progressbar", { name: "cargo check", exact: true })).toHaveCount(0);
  await host(page, "progressReport", {
    id: "check",
    message: "Checking crate",
    increment: 40,
  });
  await expect(
    footer.getByRole("progressbar", { name: "cargo check", exact: true }),
  ).toHaveAttribute("aria-valuenow", "40");
  await expect(page.locator(".extension-progress-stack")).toHaveCount(0);
  await host(page, "notification", { message: "Check finished", kind: "info" });
  await expect(
    footer.getByText("Check finished", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Check finished" }),
  ).toHaveCount(0);
  await host(page, "progressEnd", { id: "check" });
  await expect(
    footer.getByRole("progressbar", { name: "cargo check", exact: true }),
  ).toHaveCount(0);
  await expect(
    footer.getByRole("progressbar", { name: "Indexing", exact: true }),
  ).toBeVisible();
});
test("ignored files and generated folders remain browsable; images use editor preview tabs", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator('.tree-file[title=".env"]')).toBeVisible();
  await page.locator('.tree-file[title="target"]').click();
  await expect(page.locator('.tree-file[title="target/debug"]')).toBeVisible();
  await page.locator('.tree-file[title="photo.png"]').click();
  const preview = page.getByRole("region", {
    name: "Preview photo.png",
    exact: true,
  });
  await expect(
    preview.getByRole("img", { name: "photo.png", exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "125%", exact: true }),
  ).toBeVisible();
  await page.locator('.tree-file[title="drawing.svg"]').click();
  const svg = page.getByRole("region", {
    name: "Preview drawing.svg",
    exact: true,
  });
  await expect(
    svg.getByRole("img", { name: "drawing.svg", exact: true }),
  ).toBeVisible();
  await svg.getByRole("button", { name: "Source", exact: true }).click();
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText("<svg");
  await page
    .getByRole("button", { name: "Show image preview", exact: true })
    .click();
  await expect(
    svg.getByRole("img", { name: "drawing.svg", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText("fn main");
});
test("Codex and Claude panels open in the editor and settings render their declared controls", async ({
  page,
}) => {
  await fixture(page);
  for (const [extension, id, title] of [
    ["openai.chatgpt", "codex.settings", "Codex details"],
    ["anthropic.claude-code", "claude.plan", "Claude plan"],
  ]) {
    await host(page, "webview", {
      id,
      extension,
      title,
      viewKind: "panel",
      html: `<h1>${title}</h1>`,
      enableScripts: false,
    });
    await expect(
      page.locator(".tabs").getByRole("tab", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".editor-document.visible .extension-editor-panel"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Close ${title}`, exact: true })
      .click();
    await expect(
      page.locator(".tabs").getByRole("tab", { name: title, exact: true }),
    ).toHaveCount(0);
  }
  await host(page, "workbenchRequest", {
    id: "settings",
    extension: "openai.chatgpt",
    method: "openSettings",
    params: { query: "@ext:openai.chatgpt" },
  });
  const settings = page
    .locator(".editor-document.visible")
    .getByRole("region", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  const toggle = settings.getByRole("switch", {
    name: "chatgpt.runCodex",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await host(page, "workbenchRequest", {
    id: "claude-settings",
    extension: "anthropic.claude-code",
    method: "openSettings",
    params: { query: "claudeCode.useTerminal" },
  });
  await expect(
    settings.getByRole("switch", {
      name: "claudeCode.useTerminal",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Preferences", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press(`${mod}+w`);
  await expect(
    page.locator(".tabs").getByRole("tab", { name: "Settings", exact: true }),
  ).toHaveCount(0);
});

test("native LSP work reports and server health use the footer; Run and Debug retain separate surfaces", async ({
  page,
}) => {
  await fixture(page);
  const emit = async (method: string, params: unknown) =>
    page.evaluate(
      ({ method, params }) => {
        (
          window as unknown as {
            surfaceFixture: { emit: (event: string, payload: unknown) => void };
          }
        ).surfaceFixture.emit("lsp-server-message", {
          language: "rust",
          method,
          params,
        });
      },
      { method, params },
    );
  await emit("$/progress", {
    token: "check",
    value: {
      kind: "begin",
      title: "Rust check",
      percentage: 10,
      cancellable: true,
    },
  });
  const progress = page
    .locator(".statusbar")
    .getByRole("progressbar", { name: "Rust check", exact: true });
  await expect(progress).toHaveAttribute("aria-valuenow", "10");
  await emit("$/progress", {
    token: "check",
    value: { kind: "report", message: "Checking crate", percentage: 60 },
  });
  await expect(progress).toHaveAttribute("aria-valuenow", "60");
  await page
    .getByRole("button", { name: "Cancel Rust check", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            surfaceFixture: {
              calls: { command: string; args: { method?: string } }[];
            };
          }
        ).surfaceFixture.calls.some(
          (call) =>
            call.command === "lsp_request" &&
            call.args.method === "window/workDoneProgress/cancel",
        ),
      ),
    )
    .toBe(true);
  await emit("$/progress", { token: "check", value: { kind: "end" } });
  await expect(progress).toHaveCount(0);
  await emit("experimental/serverStatus", {
    health: "ok",
    quiescent: false,
    message: "Checking dependencies",
  });
  await expect(
    page
      .locator(".statusbar")
      .getByRole("button", { name: /rust.*Checking dependencies/ }),
  ).toBeVisible();
  await emit("experimental/serverStatus", { health:"warning", quiescent:true, message:"Workspace configuration needs attention" });
  await expect(page.locator('[data-sonner-toast]').filter({hasText:'Workspace configuration needs attention'})).toBeVisible();
  await expect(page.locator('.statusbar')).not.toContainText('Workspace configuration needs attention');
  await page.getByRole("button", { name: "Run & build", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Run commands", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Debugger", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Run commands", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Step over", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("run-debug.png") });
});

test("language decorations refresh after typing, send valid ranges, resolve lenses and honor the server legend", async ({
  page,
}) => {
  await fixture(page, true);
  const hints = page.locator(".editor-document.visible .cm-inlay-hint");
  await expect(hints).toContainText(": Hint");
  await expect(
    page.locator(".editor-document.visible .cm-semantic-function"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run sample", exact: true }),
  ).toBeVisible();
  const previous = await hints.textContent();
  await page
    .locator(".editor-document.visible .cm-content")
    .fill("fn updated() {}\n");
  await expect.poll(() => hints.textContent()).not.toBe(previous);
  const requests = await page.evaluate(
    () =>
      (
        window as unknown as {
          surfaceFixture: {
            calls: {
              command: string;
              args: {
                method?: string;
                params?: { range?: unknown; data?: string };
              };
            }[];
          };
        }
      ).surfaceFixture.calls,
  );
  const last = requests
    .filter((call) => call.args.method === "textDocument/inlayHint")
    .at(-1);
  expect(last?.args.params?.range).toEqual({
    start: { line: 0, character: 0 },
    end: { line: 1, character: 0 },
  });
  expect(
    requests.some(
      (call) =>
        call.args.method === "codeLens/resolve" &&
        call.args.params?.data === "resolve-me",
    ),
  ).toBe(true);
});

test("Rust Dependencies refreshes after startup and retains expanded crates", async ({
  page,
}) => {
  await fixture(page, false, true);
  const dependencies = page.getByRole("region", {
    name: "Rust Dependencies",
    exact: true,
  });
  await expect(dependencies.getByText("Nothing to show yet.")).toBeVisible();
  await page.evaluate(() => (window as any).surfaceFixture.loadDependencies());
  await dependencies.getByRole("treeitem", { name: "serde 1.0" }).click();
  await expect(
    dependencies.getByRole("treeitem", { name: "lib.rs" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).surfaceFixture.loadDependencies());
  await expect(
    dependencies.getByRole("treeitem", { name: "lib.rs" }),
  ).toBeVisible();
  await expect(
    page.locator(".tree-row .filename").filter({ hasText: /^main.rs$/ }),
  ).toBeVisible();
});

test("local completions appear while a language server is still responding", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (
        command === "lsp_request" &&
        args.method === "textDocument/completion"
      ) {
        w.surfaceFixture.completionRequested = true;
        return new Promise((resolve) => {
          w.surfaceFixture.releaseCompletion = () =>
            resolve([{ label: "uniqueServer", kind: 6 }]);
        });
      }
      return original(command, args);
    };
  });
  await page.locator('.tree-file[title="main.rs"]').click();
  const code = page.locator(".editor-document.visible .cm-content");
  await code.fill("fn uniqueLocal() {}\nfn main() { uni");
  await code.press("Control+Space");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).surfaceFixture.completionRequested),
    )
    .toBe(true);
  await expect(
    page.getByRole("option").filter({ hasText: "uniqueLocal" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).surfaceFixture.releaseCompletion());
  await expect(
    page.getByRole("option").filter({ hasText: "uniqueServer" }),
  ).toBeVisible();
});

test("member completions after a dot apply server default edit ranges", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (
        command === "lsp_request" &&
        args.method === "textDocument/completion"
      ) {
        w.surfaceFixture.completionContext = args.params.context;
        return Promise.resolve({
          itemDefaults: {
            editRange: {
              start: { line: 0, character: 16 },
              end: { line: 0, character: 16 },
            },
          },
          items: [{ label: "field_name", textEditText: "field_value" }],
        });
      }
      return original(command, args);
    };
  });
  await page.locator('.tree-file[title="main.rs"]').click();
  const code = page.locator(".editor-document.visible .cm-content");
  await code.fill("fn main() { obj");
  await code.press("End");
  await code.press(".");
  await expect(
    page.getByRole("option").filter({ hasText: "field_name" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).surfaceFixture.completionContext),
  ).toMatchObject({ triggerKind: 2, triggerCharacter: "." });
  await page.getByRole("option").filter({ hasText: "field_name" }).click();
  await expect(code).toContainText("obj.field_value");
});

test("language-server snippets apply their imports and select the editable argument", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (
        command === "lsp_request" &&
        args.method === "textDocument/completion"
      )
        return Promise.resolve([
          {
            label: "helper",
            insertTextFormat: 2,
            textEdit: {
              range: {
                start: { line: 0, character: 12 },
                end: { line: 0, character: 14 },
              },
              newText: "helper(${1:value})",
            },
            additionalTextEdits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: "use helper;\n",
              },
            ],
          },
        ]);
      return original(command, args);
    };
  });
  await page.locator('.tree-file[title="main.rs"]').click();
  const code = page.locator(".editor-document.visible .cm-content");
  await code.fill("fn main() { he");
  await code.press("Control+Space");
  await page.getByRole("option").filter({ hasText: "helper" }).click();
  await expect(code).toContainText("use helper;");
  await expect(code).toContainText("helper(value)");
  await page.keyboard.insertText("42");
  await expect(code).toContainText("helper(42)");
});

test("documentation cards and diagnostic highlights share the editor surface style", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) =>
      command === "lsp_request" && args.method === "textDocument/hover"
        ? Promise.resolve({
            contents: {
              kind: "markdown",
              value:
                "```rust\nfn main()\n```\n\nRuns the **entry point** with `Result`.",
            },
          })
        : original(command, args);
  });
  await page.locator('.tree-file[title="main.rs"]').click();
  await expect(
    page.locator(".editor-document.visible .cm-inlay-hint"),
  ).toBeVisible();
  const line = page.locator(".editor-document.visible .cm-line").first();
  await line.hover({ position: { x: 38, y: 8 } });
  const card = page.locator(".hover-doc");
  await expect(card).toBeVisible();
  await expect(card.locator(".hover-signature-code")).toHaveText("fn main()");
  await expect(card.locator("strong")).toHaveText("entry point");
  await expect(card.locator(".hover-signature")).toHaveCSS(
    "border-radius",
    "8px",
  );
  await page.screenshot({ path: "artifacts/devyy-editor-hover.png" });
  await page.evaluate(() =>
    (window as any).surfaceFixture.emit("lsp-diagnostics", {
      params: {
        uri: "file:///fixture/main.rs",
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 2 },
            },
            severity: 3,
            message: "Info",
          },
          {
            range: {
              start: { line: 0, character: 3 },
              end: { line: 0, character: 7 },
            },
            severity: 2,
            message: "Warning",
          },
          {
            range: {
              start: { line: 0, character: 10 },
              end: { line: 0, character: 12 },
            },
            severity: 1,
            message: "Error",
          },
        ],
      },
    }),
  );
  for (const severity of ["info", "warning", "error"]) {
    const highlight = page
      .locator(`.editor-document.visible .cm-lintRange-${severity}`)
      .first();
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveCSS("text-decoration-style", "wavy");
    await expect(highlight).toHaveCSS("background-image", "none");
  }
});

test("extension warnings and errors are toasts while background status remains in the footer", async ({
  page,
}) => {
  await fixture(page);
  await host(page, "notification", {
    kind: "warning",
    message: "Extension warning example",
  });
  await host(page, "notification", {
    kind: "error",
    message: "Extension error example",
  });
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Extension warning example" }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Extension error example" }),
  ).toBeVisible();
  await expect(page.locator(".statusbar")).not.toContainText(
    "Extension warning example",
  );
  await expect(page.locator(".statusbar")).not.toContainText(
    "Extension error example",
  );
  await host(page, "statusMessage", { text: "Indexing workspace" });
  await expect(page.locator(".statusbar")).toContainText("Indexing workspace");
});

test("editor footer clips long extension content without wrapping or widening the editor", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 860, height: 740 });
  await page.locator('.tree-file[title="main.rs"]').click();
  await host(page, "statusBar", {
    key: "long-item",
    visible: true,
    text: "A very long extension status ".repeat(20),
    priority: 100,
  });
  const footer = page.locator(".statusbar");
  await expect(footer).toHaveCSS("overflow-x", "hidden");
  const dimensions = await footer.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    width: el.clientWidth,
    scroll: el.scrollWidth,
    parent: el.parentElement!.clientWidth,
  }));
  expect(dimensions.height).toBeLessThan(29);
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.parent);
});
