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
async function fixture(page: Page) {
  await page.addInitScript(() => {
    let serial = 0;
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const opened = new Set<string>();
    const emit = (event: string, payload: Record<string, unknown>) =>
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", {
          detail: { event, payload },
        }),
      );
    Object.assign(window, {
      isTauri: true,
      apiCalls: calls,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++serial,
        unregisterCallback() {},
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "plugin:event|listen") return ++serial;
          if (command === "set_appearance") return { material: "solid" };
          if (command === "list_extensions")
            return [
              {
                id: "fixture.api",
                name: "API fixture",
                publisher: "fixture",
                version: "1.0.0",
                enabled: true,
                hasRuntime: true,
                contributes: {},
              },
            ];
          if (["terminal_profiles", "list_language_servers"].includes(command))
            return [];
          if (command === "plugin:dialog|open") return "/work/pseudo-test";
          if (["open_workspace", "refresh_workspace"].includes(command))
            return {
              root: "/work/pseudo-test",
              name: "Test",
              files: [{ path: "main.rs", name: "main.rs", directory: false }],
            };
          if (command === "read_file")
            return { content: "fn main() {}", modified: "1" };
          if (command === "terminal_create") return ++serial;
          if (command === "terminal_pid") return 123;
          if (command === "extension_host_request") {
            const method = String(args.method),
              params = (args.params ?? {}) as Record<string, unknown>;
            calls.push({ method, params });
            if (method === "restart")
              return [{ id: "fixture.api", status: "active" }];
            if (
              method === "pseudoTerminalOpen" &&
              !opened.has(String(params.id))
            ) {
              opened.add(String(params.id));
              queueMicrotask(() =>
                emit("pseudoTerminalOutput", {
                  id: params.id,
                  text: "Extension console ready\r\n",
                }),
              );
            }
            if (method === "pseudoTerminalInput")
              emit("pseudoTerminalOutput", {
                id: params.id,
                text: `echo:${params.text}`,
              });
            if (method === "saveVirtualDocument") return true;
            return null;
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  });
  await page.goto("/?playground=1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { apiCalls: { method: string }[] }).apiCalls.some(
          (call) => call.method === "restart",
        ),
      ),
    )
    .toBe(true);
}
async function request(
  page: Page,
  method: string,
  params: Record<string, unknown>,
) {
  const id = `request-${Math.random()}`;
  await page.evaluate(
    ({ id, method, params }) =>
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", {
          detail: {
            event: "workbenchRequest",
            payload: { id, method, params, extension: "fixture.api" },
          },
        }),
      ),
    { id, method, params },
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (
            window as unknown as {
              apiCalls: { method: string; params: Record<string, unknown> }[];
            }
          ).apiCalls.find(
            (call) =>
              call.method === "workbenchResponse" && call.params.id === id,
          ),
        id,
      ),
    )
    .toBeTruthy();
  const response = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          apiCalls: { method: string; params: Record<string, unknown> }[];
        }
      ).apiCalls.find(
        (call) => call.method === "workbenchResponse" && call.params.id === id,
      )!.params,
    id,
  );
  expect(response.error).toBeUndefined();
}

test("virtual documents refresh read-only content and writable providers keep language and multi-cursor edits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page);
  await request(page, "showDocument", {
    uri: "live:/overview",
    text: "# First version",
    readOnly: true,
    languageId: "markdown",
  });
  const readonly = page.locator(
    '.editor-document[data-path="live:/overview"] .cm-content',
  );
  await expect(readonly).toHaveText("# First version");
  await readonly.focus();
  await page.keyboard.press("x");
  await expect(readonly).toHaveText("# First version");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("devyy-extension-event", {
        detail: {
          event: "documentContent",
          payload: {
            uri: "live:/overview",
            text: "# Updated content",
            readOnly: true,
          },
        },
      }),
    ),
  );
  await expect(readonly).toHaveText("# Updated content");
  await request(page, "showDocument", {
    uri: "memory:/scratch",
    text: "one\ntwo",
    languageId: "typescript",
    readOnly: false,
    options: { viewColumn: -2 },
  });
  const content = page.locator(
    '.editor-document[data-path="memory:/scratch"] .cm-content',
  );
  await expect(page.locator(".editor-document.visible")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as {
            apiCalls: {
              method: string;
              params: {
                documents?: {
                  uri: string;
                  languageId: string;
                  visible: boolean;
                  viewColumn: number;
                }[];
              };
            }[];
          }
        ).apiCalls;
        return calls
          .filter((call) => call.method === "editorState")
          .at(-1)
          ?.params.documents?.map(
            ({ uri, languageId, visible, viewColumn }) => ({
              uri,
              languageId,
              visible,
              viewColumn,
            }),
          );
      }),
    )
    .toEqual([
      {
        uri: "live:/overview",
        languageId: "markdown",
        visible: true,
        viewColumn: 1,
      },
      {
        uri: "memory:/scratch",
        languageId: "typescript",
        visible: true,
        viewColumn: 2,
      },
    ]);
  await request(page, "setSelections", {
    uri: "memory:/scratch",
    selections: [
      { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } },
      { anchor: { line: 1, character: 0 }, active: { line: 1, character: 0 } },
    ],
  });
  await content.press("x");
  await expect(content).toContainText("xone");
  await expect(content).toContainText("xtwo");
  await page.keyboard.press(`${mod}+s`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              apiCalls: { method: string; params: Record<string, unknown> }[];
            }
          ).apiCalls.find((call) => call.method === "saveVirtualDocument")
            ?.params,
      ),
    )
    .toEqual({ uri: "memory:/scratch", text: "xone\nxtwo" });
  expect(errors).toEqual([]);
});

test("extension pseudoterminals render without a project, relay input/resize, rename, and dispose", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("devyy-extension-event", {
        detail: {
          event: "terminalCreate",
          payload: {
            id: "fixture.pty",
            options: { name: "Extension console", pseudoterminal: true },
          },
        },
      }),
    ),
  );
  await page
    .getByRole("tab", { name: "Extension console", exact: true })
    .click();
  const terminal = page.locator(".terminal-instance.visible");
  await expect(terminal.locator(".xterm-screen")).toContainText(
    "Extension console ready",
  );
  await terminal.locator("textarea").press("a");
  await expect(terminal.locator(".xterm-screen")).toContainText("echo:a");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { apiCalls: { method: string }[] }).apiCalls.some(
          (call) => call.method === "pseudoTerminalResize",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("devyy-extension-event", {
        detail: {
          event: "terminalName",
          payload: { id: "fixture.pty", name: "Build console" },
        },
      }),
    ),
  );
  await expect(
    page.getByRole("tab", { name: "Build console", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close Build console", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Build console", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            apiCalls: { method: string; params: Record<string, unknown> }[];
          }
        ).apiCalls.some(
          (call) =>
            call.method === "terminalState" &&
            call.params.id === "fixture.pty" &&
            call.params.closed === true &&
            call.params.reason === 3,
        ),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("native extension terminals survive renderer initialization and close only on disposal", async ({
  page,
}) => {
  await fixture(page);
  await page.locator(".project-title").click();
  await page
    .getByRole("menuitem", { name: "Open another folder…", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("devyy-extension-event", {
        detail: {
          event: "terminalCreate",
          payload: {
            id: "fixture.native-terminal",
            options: { name: "Native extension shell" },
          },
        },
      }),
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            apiCalls: { method: string; params: Record<string, unknown> }[];
          }
        ).apiCalls.some(
          (call) =>
            call.method === "terminalState" &&
            call.params.id === "fixture.native-terminal" &&
            call.params.pid === 123,
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          apiCalls: { method: string; params: Record<string, unknown> }[];
        }
      ).apiCalls.some(
        (call) =>
          call.method === "terminalState" &&
          call.params.id === "fixture.native-terminal" &&
          call.params.closed,
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Close Native extension shell", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            apiCalls: { method: string; params: Record<string, unknown> }[];
          }
        ).apiCalls.some(
          (call) =>
            call.method === "terminalState" &&
            call.params.id === "fixture.native-terminal" &&
            call.params.closed === true &&
            call.params.reason === 3,
        ),
      ),
    )
    .toBe(true);
});
