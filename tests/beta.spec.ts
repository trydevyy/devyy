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
test("Explorer moves a dirty file into a folder and back without losing its buffer", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const file = page.locator('.tree-file[title="Cargo.toml"]');
  await file.click();
  const content = page.locator(".editor-document.visible .cm-content");
  await content.fill("# unsaved move\n[package]\nname = 'devyy'");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await file.dispatchEvent("dragstart", { dataTransfer: transfer });
  const folder = page.locator('.tree-file[title="src"]').locator("..");
  await folder.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(folder).toHaveClass(/tree-drop-target/);
  await expect(folder).toContainText("Move here");
  await folder.dispatchEvent("drop", { dataTransfer: transfer });
  const moved = page.locator('.tree-file[title="src/Cargo.toml"]');
  await expect(moved).toBeVisible();
  await expect(
    page.locator(
      '.editor-document.visible[data-path="src/Cargo.toml"] .cm-content',
    ),
  ).toContainText("# unsaved move");
  const back = await page.evaluateHandle(() => new DataTransfer());
  await moved.dispatchEvent("dragstart", { dataTransfer: back });
  await page
    .locator(".file-tree")
    .dispatchEvent("dragover", { dataTransfer: back });
  await expect(page.locator(".tree-drop-hint")).toContainText(
    "Move to project folder",
  );
  await page
    .locator(".file-tree")
    .dispatchEvent("drop", { dataTransfer: back });
  await expect(page.locator('.tree-file[title="Cargo.toml"]')).toBeVisible();
  await expect(
    page.locator(
      '.editor-document.visible[data-path="Cargo.toml"] .cm-content',
    ),
  ).toContainText("# unsaved move");
});
test("Explorer rejects dropping a folder inside itself", async ({ page }) => {
  await page.goto("/?playground=1");
  const folder = page.locator('.tree-file[title="src"]');
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await folder.dispatchEvent("dragstart", { dataTransfer: transfer });
  const row = folder.locator("..");
  await row.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(row).not.toHaveClass(/tree-drop-target/);
  await row.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(folder).toBeVisible();
  await expect(page.locator('.tree-file[title="src/main.rs"]')).toBeVisible();
});
