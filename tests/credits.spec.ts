import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
test("credits show Devyy first and expose bundled project licenses in expandable rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press(`${mod}+,`);
  await page
    .getByRole("tab", { name: "Credits & licenses", exact: true })
    .click();
  const credits = page.getByRole("region", { name: "Open source credits" });
  await expect(credits.locator(".credit-project summary")).toContainText(
    "Devyy",
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
