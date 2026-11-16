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

import { expect, type Locator } from "@playwright/test";
export async function chooseOption(
  trigger: Locator,
  value: string | { label: string },
) {
  await trigger.click();
  const popup = trigger.page().locator(".devyy-select-popup");
  await expect(popup).toBeVisible();
  if (typeof value !== "string")
    await popup.getByRole("option", { name: value.label, exact: true }).click();
  else {
    const options = popup.getByRole("option");
    const index = await options.evaluateAll(
      (elements, selected) =>
        elements.findIndex(
          (element) => (element as HTMLElement).dataset.value === selected,
        ),
      value,
    );
    if (index < 0) throw Error(`No option with value ${value}`);
    await options.nth(index).click();
  }
}
