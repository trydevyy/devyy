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

import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";

test("file pairs survive standalone navigation, keep independent editors, and separate cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?playground=1");
  const main = page.locator('.editor-document[data-path="src/main.rs"]');
  const lib = page.locator('.editor-document[data-path="src/lib.rs"]');
  await main.locator(".cm-content").click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("\n// kept undo history");
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
  await expect(group.getByRole("tab")).toHaveCount(2);
  await expect(main).toBeVisible();
  await expect(lib).toBeVisible();
  await expect(main.locator(".cm-content")).toContainText("kept undo history");
  await expect(lib.locator(".cm-content")).toContainText("pub struct Project");
  expect(await main.boundingBox()).not.toEqual(await lib.boundingBox());
  await expect(page.locator(".cm-editor")).toHaveCount(3);
  await main.locator(".cm-content").click();
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await lib.locator(".cm-content").click();
  await expect(
    page.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
  await expect(
    page.getByRole("separator", { name: "Resize editor split" }),
  ).toHaveCount(0);
  await expect(group).toBeVisible();
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(2);
  await main.locator(".cm-content").click();
  await page.keyboard.press(`${mod}+z`);
  await expect(main.locator(".cm-content")).not.toContainText(
    "kept undo history",
  );
  await page
    .getByRole("button", { name: "Separate file group", exact: true })
    .click();
  await expect(group).toHaveCount(0);
  await expect(main).toBeVisible();
  await expect(lib).not.toBeVisible();
  await page.getByRole("tab", { name: "lib.rs", exact: true }).click();
  await expect(lib).toBeVisible();
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("explorer split action retains two distinct files when opening another file and closing a member", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page
    .locator(".tree-file")
    .filter({ hasText: /^Cargo\.toml$/ })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  const group = page.getByRole("group", {
    name: "Split file group",
    exact: true,
  });
  await expect(
    group.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await expect(
    group.getByRole("tab", { name: "Cargo.toml", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".editor-document.visible")).toHaveCount(2);
  await page
    .locator(".tree-file")
    .filter({ hasText: /^README\.md$/ })
    .click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
  await page.getByRole("tab", { name: "Cargo.toml", exact: true }).click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Close Cargo.toml", exact: true })
    .click();
  await expect(group).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
});

test("terminal groups persist independently and separating tabs keeps sessions alive", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  const groups = page.getByRole("group", {
    name: "Split terminal group",
    exact: true,
  });
  await expect(groups).toHaveCount(2);
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await expect(page.locator("#terminal-pane-1")).toBeVisible();
  await expect(page.locator("#terminal-pane-2")).toBeVisible();
  await expect(page.locator("#terminal-pane-3")).not.toBeVisible();
  await groups
    .first()
    .getByRole("button", { name: "Separate terminal group", exact: true })
    .click();
  await expect(groups).toHaveCount(1);
  await expect(page.locator(".terminal-instance")).toHaveCount(4);
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(1);
  await page.getByRole("tab", { name: "Terminal 4", exact: true }).click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Close Terminal 4", exact: true })
    .click();
  await expect(groups).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Terminal 3", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(1);
});

test("multiple file groups coexist and re-pairing a member preserves former partners", async ({
  page,
}, testInfo) => {
  await page.goto("/?playground=1");
  await page
    .getByRole("tab", { name: "lib.rs", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page
    .locator(".tree-file")
    .filter({ hasText: /^Cargo\.toml$/ })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  const groups = page.getByRole("group", {
    name: "Split file group",
    exact: true,
  });
  await expect(groups).toHaveCount(2);
  await expect(
    page.locator('.editor-document[data-path="README.md"]'),
  ).toBeVisible();
  await expect(
    page.locator('.editor-document[data-path="Cargo.toml"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath("split-tabs.png") });
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(
    page.locator('.editor-document[data-path="src/main.rs"]'),
  ).toBeVisible();
  await expect(
    page.locator('.editor-document[data-path="src/lib.rs"]'),
  ).toBeVisible();
  await expect(
    page.locator('.editor-document[data-path="Cargo.toml"]'),
  ).not.toBeVisible();
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page
    .getByRole("tab", { name: "lib.rs", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  await expect(groups).toHaveCount(1);
  await expect(
    groups.getByRole("tab", { name: "README.md", exact: true }),
  ).toBeVisible();
  await expect(
    groups.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-editor")).toHaveCount(4);
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
  await page.getByRole("tab", { name: "Cargo.toml", exact: true }).click();
  await expect(page.locator(".editor-document.visible")).toHaveCount(1);
});

test("file shortcuts and close-to-right follow the displayed group order", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page
    .getByRole("tab", { name: "README.md", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  const tabs = page.getByRole("tablist", { name: "Open files", exact: true });
  expect(
    await tabs
      .getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label"))),
  ).toEqual(["main.rs", "README.md", "lib.rs"]);
  await tabs.getByRole("tab", { name: "main.rs", exact: true }).click();
  await page.keyboard.press("Control+Tab");
  await expect(
    tabs.getByRole("tab", { name: "README.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+Tab");
  await expect(
    tabs.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await tabs
    .getByRole("tab", { name: "lib.rs", exact: true })
    .dragTo(tabs.getByRole("tab", { name: "main.rs", exact: true }));
  await expect(tabs.getByRole("tab")).toHaveText([
    "lib.rs",
    "1main.rs",
    "2README.md",
  ]);
  await tabs
    .getByRole("tab", { name: "README.md", exact: true })
    .dragTo(tabs.getByRole("tab", { name: "lib.rs", exact: true }));
  await expect(tabs.getByRole("tab")).toHaveText([
    "1main.rs",
    "2README.md",
    "lib.rs",
  ]);
  await tabs.getByRole("tab", { name: "lib.rs", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    tabs.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    tabs.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toBeFocused();
  await tabs
    .getByRole("tab", { name: "README.md", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close tabs to the right", exact: true })
    .click();
  await expect(
    tabs.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Split file group", exact: true })
      .getByRole("tab"),
  ).toHaveCount(2);
});

test("file groups and Markdown previews retain independent widths", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page
    .getByRole("tab", { name: "lib.rs", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in split editor", exact: true })
    .click();
  const divider = page.getByRole("separator", {
    name: "Resize editor split",
    exact: true,
  });
  await divider.focus();
  for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "40");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page
    .getByRole("button", { name: "Markdown preview to the side", exact: true })
    .click();
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await divider.focus();
  for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "60");
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(divider).toHaveAttribute("aria-valuenow", "40");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await expect(divider).toHaveAttribute("aria-valuenow", "60");
  await divider.focus();
  await page.keyboard.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await page.getByRole("tab", { name: "main.rs", exact: true }).click();
  await expect(divider).toHaveAttribute("aria-valuenow", "40");
});

test("terminal tabs reorder entire groups, support boundary keys, and close with the middle button", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const tabs = page.getByRole("tablist", {
    name: "Terminal sessions",
    exact: true,
  });
  const terminal = (name: string) =>
    tabs.getByRole("tab", { name, exact: true });
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await terminal("Terminal 1").click();
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  await terminal("Terminal 2").dragTo(terminal("Terminal 1"));
  await expect(tabs.getByRole("tab")).toHaveText([
    "Terminal 2",
    "1Terminal 1",
    "2Terminal 3",
  ]);
  await terminal("Terminal 3").dragTo(terminal("Terminal 2"));
  await expect(tabs.getByRole("tab")).toHaveText([
    "1Terminal 1",
    "2Terminal 3",
    "Terminal 2",
  ]);
  await expect(page.locator(".terminal-instance")).toHaveCount(3);
  await terminal("Terminal 1").focus();
  await page.keyboard.press("End");
  await expect(terminal("Terminal 2")).toBeFocused();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(1);
  await page.keyboard.press("Home");
  await expect(terminal("Terminal 1")).toBeFocused();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await terminal("Terminal 3").click({ button: "middle" });
  await expect(terminal("Terminal 3")).toHaveCount(0);
  await expect(terminal("Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".terminal-instance")).toHaveCount(2);
});

test("bursts of extension terminal creation and disposal preserve surviving sessions", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await expect(
    page.getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const emit = (event: string, payload: Record<string, unknown>) =>
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", {
          detail: { event, payload },
        }),
      );
    for (const id of ["a", "b", "c"])
      emit("terminalCreate", { id, options: { name: `Extension ${id}` } });
    emit("terminalClose", { id: "a" });
    emit("terminalClose", { id: "b" });
    emit("terminalShow", { id: "c" });
  });
  const tabs = page.getByRole("tablist", {
    name: "Terminal sessions",
    exact: true,
  });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(
    tabs.getByRole("tab", { name: "Extension c", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => {
    const emit = (event: string, payload: Record<string, unknown>) =>
      window.dispatchEvent(
        new CustomEvent("devyy-extension-event", {
          detail: { event, payload },
        }),
      );
    emit("terminalCreate", { id: "d", options: { name: "Extension d" } });
    emit("terminalCreate", { id: "e", options: { name: "Extension e" } });
    emit("terminalShow", { id: "d" });
    emit("terminalClose", { id: "c" });
    emit("terminalClose", { id: "d" });
  });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(
    tabs.getByRole("tab", { name: "Extension e", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    tabs.getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toBeVisible();
});
