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
test("color wheel adjusts hue, saturation and brightness and saves the selection", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  await page
    .getByRole("button", { name: "Custom accent color", exact: true })
    .click();
  const hex = page.getByRole("textbox", { name: "Accent hex value" });
  await hex.fill("#ff0000");
  const wheel = page.getByRole("slider", { name: "Hue and saturation" });
  await wheel.focus();
  await wheel.press("ArrowRight");
  await expect(hex).not.toHaveValue("#ff0000");
  await wheel.press("Home");
  await expect(hex).toHaveValue("#ffffff");
  await page.getByRole("slider", { name: "Color brightness" }).fill("50");
  await expect(hex).toHaveValue("#808080");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("devyy.settings")!).customAccent,
    ),
  ).toBe("#808080");
});
test("settings pages reverse direction with progressive blur and modals animate closed", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  const modal = page.getByRole("dialog", { name: "Preferences", exact: true });
  await expect(modal).toBeVisible();
  for (const [category, destination] of [
    ["Editor", "Font size"],
    ["Appearance", "Custom accent color"],
  ]) {
    await page.evaluate(() => {
      const w = window as any;
      const previous = document.querySelector(".settings-inner");
      const values = { exit: [] as number[], enter: [] as number[] };
      w.settingsFrames = values;
      let running = true;
      w.stopSettingsFrames = () => {
        running = false;
      };
      function sample() {
        if (!running) return;
        const current = document.querySelector(".settings-inner");
        if (current)
          (current === previous ? values.exit : values.enter).push(
            new DOMMatrix(getComputedStyle(current).transform).m42,
          );
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await modal.getByRole("tab", { name: category, exact: true }).click();
    if (category === "Editor")
      await expect(
        modal.getByRole("group", { name: destination, exact: true }),
      ).toBeVisible();
    else
      await expect(
        modal.getByRole("button", { name: destination, exact: true }),
      ).toBeVisible();
    await expect
      .poll(() =>
        modal
          .locator(".settings-inner")
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    const frames = await page.evaluate(() => {
      const w = window as any;
      w.stopSettingsFrames();
      return w.settingsFrames as { exit: number[]; enter: number[] };
    });
    expect(
      frames.exit.some((y) => (category === "Editor" ? y < 0 : y > 0)),
    ).toBe(true);
    expect(
      frames.enter.some((y) => (category === "Editor" ? y > 0 : y < 0)),
    ).toBe(true);
  }
  await modal
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  await expect(
    page.locator('.preferences-backdrop[data-closing="true"]'),
  ).toHaveCount(1);
  await expect(page.locator(".preferences-backdrop")).toHaveCount(0);
});
