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

test("ordinary launches show home without loading saved sample files", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "devyy.playground",
      JSON.stringify({ "old.rs": "saved sample" }),
    );
    localStorage.setItem("devyy.recent", JSON.stringify(["/work/my-project"]));
  });
  await page.goto("/");
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
  await expect(page.locator(".editor-document")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Recent projects" }),
  ).toContainText("my-project");
  await page.keyboard.press(`${mod}+p`);
  await expect(page.getByRole("dialog", { name: "Go to file" })).toContainText(
    "No project files",
  );
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => localStorage.getItem("devyy.playground")),
  ).toContain("saved sample");
});

test("search highlights matches, clears queries and supports keyboard mode switching", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+p`);
  const palette = page.getByRole("dialog", { name: "Go to file", exact: true });
  const search = palette.getByRole("textbox", { name: "Search", exact: true });
  await search.fill("smrs");
  const selected = palette.getByRole("option", { selected: true });
  await expect(selected).toContainText("main.rs");
  await expect(selected.locator("mark")).not.toHaveCount(0);
  await expect(selected.locator("small")).toHaveText("src");
  await palette
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  const commands = palette.getByRole("button", {
    name: "Commands",
    exact: true,
  });
  await commands.focus();
  await page.keyboard.press("Enter");
  const commandPalette = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await expect(commandPalette).toBeVisible();
  await expect(
    commandPalette.getByRole("textbox", { name: "Search", exact: true }),
  ).toBeFocused();
  await commandPalette
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Toggle sidebar");
  await page.keyboard.press("Enter");
  await expect(commandPalette).not.toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await page.keyboard.press(`${mod}+p`);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("main");
  await expect(page.locator(".palette")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "artifacts/devyy-search.png" });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press(`${mod}+p`);
  await expect(
    page
      .getByRole("option", { name: /main.rs/ })
      .first()
      .getByLabel("Recently opened"),
  ).toBeVisible();
});
