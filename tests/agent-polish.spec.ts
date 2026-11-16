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
test("AI sidebar animates like the file sidebar and drag peeks are temporary and configurable", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const panel = page.locator(".ai-workspace");
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await page
    .getByRole("button", { name: "Toggle AI workspace", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  const durations = await page.evaluate(() => [
    getComputedStyle(document.querySelector(".sidebar")!).transitionDuration,
    getComputedStyle(document.querySelector(".ai-workspace")!)
      .transitionDuration,
  ]);
  expect(durations[1].split(",")[0]).toBe(durations[0].split(",")[0]);
  await page.getByRole("button", { name: "Close AI sidebar" }).click();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  const fileDrag = () =>
    page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["context"], "sample.txt"));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data }));
    });
  await fileDrag();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")));
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await fileDrag();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await page.locator(".ai-chat-panel").evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["context"], "sample.txt"));
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: data }),
    );
  });
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page
    .getByRole("switch", { name: "Open AI panel while dragging", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await fileDrag();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")));
  expect(await page.locator(".new-tab").count()).toBe(0);
});
test("color selection marks stay centered inside every swatch", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  const swatches = page.locator(".accent-picker > button");
  for (let i = 0; i < (await swatches.count()); i++) {
    const button = swatches.nth(i);
    await button.click();
    const svg = button.locator(":scope > svg");
    if (await svg.count()) {
      const a = await button.boundingBox(),
        b = await svg.boundingBox();
      expect(Math.abs(a!.x + a!.width / 2 - b!.x - b!.width / 2)).toBeLessThan(
        1,
      );
      expect(
        Math.abs(a!.y + a!.height / 2 - b!.y - b!.height / 2),
      ).toBeLessThan(1);
    }
  }
});
