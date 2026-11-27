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
test("the Settings dialog stays mounted when its placeholders load", async ({
  page,
}) => {
  let releaseSettings!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseSettings = resolve;
  });
  await page.route(
    /\/src\/components\/Preferences\.tsx(?:\?|$)/,
    async (route) => {
      await pending;
      await route.continue();
    },
  );
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  try {
    await expect(dialog.getByLabel("Loading settings")).toBeVisible();
    await dialog.evaluate((node) => {
      node.setAttribute("data-test-original-dialog", "");
      node.parentElement!.setAttribute("data-test-original-backdrop", "");
    });
  } finally {
    releaseSettings();
  }
  await expect(dialog.getByRole("tab", { name: "Appearance" })).toBeVisible();
  await expect(dialog.getByLabel("Loading settings")).toHaveCount(0);
  await expect(
    page.locator("[data-test-original-backdrop] > [data-test-original-dialog]"),
  ).toBeVisible();
});

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
  await expect(modal.getByRole("tab", { name: "Appearance" })).toBeVisible();
  for (const [category, destination] of [
    ["Editor", "Font size"],
    ["Appearance", "Custom accent color"],
  ]) {
    await page.evaluate(() => {
      const w = window as any;
      const previous = document.querySelector(".settings-inner");
      const values = {
        exit: [] as number[],
        enter: [] as number[],
        overlap: false,
        blur: [] as string[],
      };
      w.settingsFrames = values;
      const observer = new MutationObserver(() => {
        const entering = document.querySelector<HTMLElement>(
          ".settings-inner:not([inert])",
        );
        // Record the entrance start position even if the browser skips painted frames.
        if (entering && entering !== previous && entering.style.transform) {
          values.enter.push(new DOMMatrix(entering.style.transform).m42);
          values.blur.push(entering.style.filter);
        }
      });
      observer.observe(document.querySelector(".settings-scroll")!, {
        childList: true,
      });
      let running = true;
      w.stopSettingsFrames = () => {
        running = false;
        observer.disconnect();
      };
      function sample() {
        if (!running) return;
        const panels = document.querySelectorAll(".settings-inner");
        values.overlap ||= panels.length > 1;
        for (const current of panels) {
          const style = getComputedStyle(current);
          (current === previous ? values.exit : values.enter).push(
            new DOMMatrix(style.transform).m42,
          );
          if (current !== previous) values.blur.push(style.filter);
        }
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
          .locator(".settings-inner:not([inert])")
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    const frames = await page.evaluate(() => {
      const w = window as any;
      w.stopSettingsFrames();
      return w.settingsFrames as {
        exit: number[];
        enter: number[];
        overlap: boolean;
        blur: string[];
      };
    });
    expect(frames.overlap).toBe(false);
    expect(
      frames.blur.some((filter) => Number.parseFloat(filter.slice(5)) > 0),
      JSON.stringify(frames),
    ).toBe(true);
    expect(
      frames.exit.some((y) => (category === "Editor" ? y < 0 : y > 0)),
    ).toBe(true);
    expect(
      frames.enter.some((y) => (category === "Editor" ? y > 0 : y < 0)),
      `${category} transition frames: ${JSON.stringify(frames)}`,
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
