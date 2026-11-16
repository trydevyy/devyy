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
test("credits show Devyy first and expose bundled project licenses in expandable rows", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  await page
    .getByRole("tab", { name: "Credits & licenses", exact: true })
    .click();
  const credits = page.getByRole("region", { name: "Open source credits" });
  await expect(credits.locator(".credit-project summary")).toContainText(
    "Devyy",
  );
  await expect(credits.locator(".credit-project summary")).toContainText(
    "GPL-3.0-only",
  );
  await credits.locator(".credit-project summary").click();
  await expect(credits.locator(".credit-project pre")).toContainText(
    "GNU GENERAL PUBLIC LICENSE",
  );
  await expect(credits.locator(".credit-project pre")).toContainText(
    "Version 3, 29 June 2007",
  );
  await credits
    .getByRole("searchbox", { name: "Search open source licenses" })
    .fill("material-icon-theme");
  const entry = credits.locator(".credit-entry:not(.credit-project)");
  await expect(entry).toHaveCount(1);
  await entry.locator("summary").click();
  await expect(entry.locator("pre")).toContainText("MIT");
  await expect(entry.locator("summary")).toContainText("MIT");
});
