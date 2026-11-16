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

import { test as base, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

interface Host {
  command: <T = unknown>(id: string) => Promise<T>;
}
async function fixture(page: Page) {
  const directory = await mkdtemp(path.join(tmpdir(), "devyy-quickinput-ui-"));
  const child = spawn(
    process.execPath,
    [path.resolve("src-tauri/extension-host/host.cjs")],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let serial = 0,
    ready = false;
  let deliveries = Promise.resolve();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  child.stderr.on("data", (value) => failures.push(String(value)));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error));
      else entry?.resolve(message.result);
    } else if (
      ready &&
      ["quickInput", "quickInputHidden"].includes(message.event)
    ) {
      deliveries = deliveries
        .then(() =>
          page.evaluate(
            (message) =>
              window.dispatchEvent(
                new CustomEvent("devyy-extension-event", { detail: message }),
              ),
            message,
          ),
        )
        .then(() => {})
        .catch((error) => {
          if (!page.isClosed()) failures.push(String(error));
        });
    }
  });
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  const close = async () => {
    ready = false;
    child.kill();
    lines.close();
    await deliveries;
    await rm(directory, { recursive: true, force: true });
    expect(failures).toEqual([]);
  };
  try {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        publisher: "fixture",
        name: "quickinput",
        version: "1.0.0",
        main: "extension.cjs",
        activationEvents: ["onStartupFinished"],
      }),
    );
    await writeFile(
      path.join(directory, "extension.cjs"),
      `
      const v = require('vscode'); let q, token, events = [], first, second, extra;
      exports.activate = () => {
        v.commands.registerCommand('fixture.pick', () => {
          q = v.window.createQuickPick(); q.title = 'Repositories'; q.step = 1; q.totalSteps = 2;
          q.canSelectMany = true; q.matchOnDescription = true; q.ignoreFocusOut = true;
          const action = { iconPath: new v.ThemeIcon('refresh'), tooltip: 'Refresh repository' };
          first = { label: 'Core', description: 'TypeScript', buttons: [action] };
          second = { label: 'Server', description: 'Rust' }; extra = { label: 'Add repository', alwaysShow: true };
          q.items = [{ label: 'Projects', kind: v.QuickPickItemKind.Separator }, first, second, extra]; q.selectedItems = [first];
          q.buttons = [v.QuickInputButtons.Back];
          q.onDidChangeValue(value => events.push(['value', value]));
          q.onDidChangeSelection(items => events.push(['selection', items.map(item => item === first ? 'first' : item === second ? 'second' : 'extra')]));
          q.onDidTriggerItemButton(e => { events.push(['itemButton', e.item === first, e.button === action]); q.items = [first, second, { label: 'Tools', detail: 'New repository' }, extra]; });
          q.onDidTriggerButton(button => { events.push(['back', button === v.QuickInputButtons.Back]); q.hide(); });
          q.onDidAccept(() => { events.push(['accept', q.selectedItems.length]); q.title = 'Repositories selected'; }); q.show();
        });
        v.commands.registerCommand('fixture.reopen', () => q.show());
        v.commands.registerCommand('fixture.lock', () => { q.enabled = false; q.busy = true; });
        v.commands.registerCommand('fixture.unlock', () => { q.enabled = true; q.busy = false; q.value = 'Server'; });
        v.commands.registerCommand('fixture.input', () => v.window.showInputBox({ title: 'Project name', value: 'project', valueSelection: [0, 7], validateInput: value => value.length < 3 ? 'Use at least three characters' : { message: 'Name available', severity: v.InputBoxValidationSeverity.Info } }));
        v.commands.registerCommand('fixture.secret', () => { token = new v.CancellationTokenSource(); return v.window.showInputBox({ title: 'Access token', password: true, value: 'secret', ignoreFocusOut: true }, token.token); });
        v.commands.registerCommand('fixture.cancel', () => token.cancel());
        v.commands.registerCommand('fixture.inspect', () => events);
      };
    `,
    );
    await request("initialize", {
      storageRoot: directory,
      extensions: [{ id: "fixture.quickinput", installPath: directory }],
    });
    await page.exposeFunction("quickInputRequest", request);
    await page.addInitScript(() => {
      let serial = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback: () => ++serial,
          unregisterCallback() {},
          invoke: async (
            command: string,
            args: Record<string, unknown> = {},
          ) => {
            if (command === "plugin:event|listen") return ++serial;
            if (command === "set_appearance") return { material: "solid" };
            if (
              [
                "list_extensions",
                "terminal_profiles",
                "list_language_servers",
              ].includes(command)
            )
              return [];
            if (command === "extension_host_request") {
              if (args.method === "restart") return [];
              return (
                window as unknown as {
                  quickInputRequest: (
                    method: string,
                    params: unknown,
                  ) => Promise<unknown>;
                }
              ).quickInputRequest(String(args.method), args.params ?? {});
            }
            return null;
          },
        },
      });
    });
    await page.goto("/");
    await page.locator(".app-body").waitFor();
    ready = true;
    return {
      command: <T = unknown>(id: string) =>
        request("command", { id }) as Promise<T>,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
const test = base.extend<{ host: Host }>({
  host: async ({ page }, use) => {
    const host = await fixture(page);
    try {
      await use(host);
    } finally {
      await host.close();
    }
  },
});

test("real extension QuickPick handles multi-select, dynamic items, buttons, disabled state and reopening", async ({
  page,
  host,
}) => {
  await host.command("fixture.pick");
  let dialog = page.getByRole("dialog", { name: "Repositories", exact: true });
  const filter = page.getByRole("combobox", { name: "Filter items" });
  await expect(filter).toBeFocused();
  await expect(dialog).toContainText("1 / 2");
  await expect(
    dialog.getByRole("option", { name: "Core TypeScript" }),
  ).toHaveAttribute("aria-selected", "true");
  await filter.fill("rust");
  await expect(
    dialog.getByRole("option", { name: "Server Rust" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: "Core TypeScript" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("option", { name: "Add repository" }),
  ).toBeVisible();
  await expect(filter).toBeFocused();
  await dialog.getByRole("option", { name: "Server Rust" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm (2)" }),
  ).toBeVisible();
  await filter.fill("");
  await dialog.getByRole("button", { name: "Refresh repository" }).click();
  await expect(
    dialog.getByRole("option", { name: "Tools New repository" }),
  ).toBeVisible();
  const choices = dialog.getByRole("listbox", { name: "Extension choices" });
  await choices.focus();
  await choices.press("Space");
  await expect(
    dialog.getByRole("button", { name: "Confirm (1)" }),
  ).toBeVisible();
  await choices.press("Space");
  await expect(
    dialog.getByRole("button", { name: "Confirm (2)" }),
  ).toBeVisible();
  await choices.press("ArrowDown");
  await choices.press("Enter");
  dialog = page.getByRole("dialog", {
    name: "Repositories selected",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const events = await host.command<unknown[][]>("fixture.inspect");
  expect(events).toContainEqual(["itemButton", true, true]);
  expect(events).toContainEqual(["accept", 2]);
  await page.locator(".modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeVisible();
  await host.command("fixture.lock");
  await expect(filter).toBeDisabled();
  await expect(
    dialog.getByRole("progressbar", { name: "Loading choices" }),
  ).toBeVisible();
  await host.command("fixture.unlock");
  await expect(filter).toHaveValue("Server");
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await host.command("fixture.reopen");
  await expect(dialog).toBeVisible();
  await expect(filter).toBeFocused();
  await filter.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("real showInputBox validates in place, preserves selection and cancels password prompts", async ({
  page,
  host,
}) => {
  const result = host.command("fixture.input");
  const dialog = page.getByRole("dialog", {
    name: "Project name",
    exact: true,
  });
  const field = dialog.getByRole("textbox", { name: "Project name" });
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((node) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([0, 7]);
  await field.fill("x");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use at least three characters",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeDisabled();
  await expect(field).toBeFocused();
  await field.fill("devyy");
  await expect(dialog.getByRole("status")).toHaveText("Name available");
  await field.press("Enter");
  expect(await result).toBe("devyy");
  await expect(dialog).toHaveCount(0);
  const secret = host.command("fixture.secret");
  const password = page.locator(
    'input[type="password"][aria-label="Access token"]',
  );
  await expect(
    page.locator('input[type="password"][aria-label="Access token"]'),
  ).toBeFocused();
  await expect(password).toHaveValue("secret");
  await host.command("fixture.cancel");
  expect(await secret).toBeNull();
  await expect(
    page.getByRole("dialog", { name: "Access token", exact: true }),
  ).toHaveCount(0);
});
