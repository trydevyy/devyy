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
test("in-file find uses compact controls, validates regex and replaces with undo", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+f`);
  const panel = page.getByRole("search", { name: "Find and replace in file" });
  await expect(
    panel.getByRole("textbox", { name: "Find", exact: true }),
  ).toBeFocused();
  await panel.getByRole("textbox", { name: "Find", exact: true }).fill("greet");
  await expect(panel.locator(".devyy-find-count")).toHaveText("2");
  await page.keyboard.press("Enter");
  await expect(panel.locator(".devyy-find-count")).toContainText("of 2");
  await panel
    .getByRole("button", { name: "Use regular expression", exact: true })
    .click();
  await panel.getByRole("textbox", { name: "Find", exact: true }).fill("[");
  await expect(panel).toContainText("Invalid expression");
  await expect(
    panel.getByRole("button", { name: "Next match", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Use regular expression", exact: true })
    .click();
  await panel.getByRole("textbox", { name: "Find", exact: true }).fill("greet");
  await panel
    .getByRole("button", { name: "Show replace", exact: true })
    .click();
  await panel
    .getByRole("textbox", { name: "Replace", exact: true })
    .fill("welcome");
  await panel
    .getByRole("button", { name: "Replace all matches", exact: true })
    .click();
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText('welcome("world")');
  await page.screenshot({ path: "artifacts/devyy-find-replace.png" });
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await page.keyboard.press(`${mod}+z`);
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText('greet("world")');
});
test("folder deletion uses Devyy confirmation, cancels safely and removes descendants", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const folder = page.getByRole("button", { name: "src", exact: true });
  await folder.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete folder", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete folder “src”?",
  });
  await expect(dialog).toContainText("everything inside");
  await page.screenshot({ path: "artifacts/devyy-delete-confirmation.png" });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await folder.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete folder", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete folder", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "lib.rs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "README.md", exact: true }),
  ).toBeVisible();
  await expect(folder).toHaveCount(0);
});
test("settings dropdowns and the accent picker use Devyy surfaces", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  const trigger = page.getByRole("combobox", {
    name: "Interface motion",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const options = page.getByRole("listbox");
  await expect(options).toBeVisible();
  await page.screenshot({ path: "artifacts/devyy-select.png" });
  await page.keyboard.press("End");
  await expect(
    options.getByRole("option", { name: "Instant", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("data-value", "instant");
  await expect(trigger).toBeFocused();
  await page
    .getByRole("button", { name: "Custom accent color", exact: true })
    .click();
  const hex = page.getByRole("textbox", {
    name: "Accent hex value",
    exact: true,
  });
  await hex.fill("#91acdc");
  await page.screenshot({ path: "artifacts/devyy-color-picker.png" });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("devyy.settings") ?? "{}").customAccent,
    ),
  ).toBe("#91acdc");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Preferences", exact: true }),
  ).toBeVisible();
  await expect(hex).not.toBeVisible();
});
