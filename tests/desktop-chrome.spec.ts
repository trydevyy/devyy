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
for (const platform of ["Win32", "Linux x86_64"])
  test(`${platform} header has ordered menus, overflow and right-aligned window controls`, async ({
    page,
  }) => {
    await page.addInitScript(
      (platform) =>
        Object.defineProperty(navigator, "platform", { get: () => platform }),
      platform,
    );
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.goto("/?playground=1");
    const brand = page.getByRole("button", { name: "devyy home", exact: true });
    const workspace = page.getByRole("button", {
      name: "Choose workspace",
      exact: true,
    });
    const nav = page.getByRole("navigation", {
      name: "Application menu",
      exact: true,
    });
    await expect(
      nav.getByRole("button", { name: "File", exact: true }),
    ).toBeVisible();
    const b = await brand.boundingBox(),
      w = await workspace.boundingBox(),
      n = await nav.boundingBox();
    expect(b!.x).toBeLessThan(w!.x);
    expect(w!.x + w!.width).toBeLessThanOrEqual(n!.x);
    const close = page.getByRole("button", {
      name: "Close window",
      exact: true,
    });
    await expect(close).toBeVisible();
    expect((await close.boundingBox())!.x).toBeGreaterThan(1380);
    await nav.getByRole("button", { name: "File", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: /Save all files/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 860, height: 740 });
    const more = nav.getByRole("button", {
      name: "More application menus",
      exact: true,
    });
    await expect(more).toBeVisible();
    await more.click();
    await expect(
      page.getByRole("menuitem", { name: "Help", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page
        .locator(".titlebar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/devyy-${platform === "Win32" ? "windows" : "linux"}-header.png`,
    });
  });
