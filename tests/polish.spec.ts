import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";

test("glass overlays share transparency, blur and solid accessibility fallbacks", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press(`${mod}+,`);
  const glass = async (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, blur: s.backdropFilter };
    });
  await expect(page.locator(".app-body")).toBeVisible();
  await page
    .getByRole("slider", { name: "Menu transparency", exact: true })
    .press("End");
  await page
    .getByRole("slider", { name: "Glass softness", exact: true })
    .press("End");
  await expect
    .poll(() => glass(".settings-modal"))
    .toMatchObject({
      background: "rgba(27, 27, 30, 0.25)",
      blur: "blur(40px) saturate(1.15)",
    });
  await page
    .getByRole("combobox", { name: "Interface motion", exact: true })
    .selectOption("instant");
  expect(
    await page
      .locator(".settings-modal")
      .evaluate((el) => getComputedStyle(el).animationDuration),
  ).toBe("0s");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-body")).toBeVisible();
  await page.keyboard.press(`${mod}+p`);
  expect(await glass(".palette")).toEqual(
    await page.evaluate(() => ({
      background: "rgba(27, 27, 30, 0.25)",
      blur: "blur(40px) saturate(1.15)",
    })),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .click({ button: "right" });
  expect((await glass(".context-menu")).background).toBe(
    "rgba(27, 27, 30, 0.25)",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .first()
    .click();
  expect((await glass(".input-modal")).background).toBe(
    "rgba(27, 27, 30, 0.25)",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Toggle vibrancy", exact: true })
    .click();
  await page.keyboard.press(`${mod}+,`);
  expect(await glass(".settings-modal")).toEqual({
    background: "rgb(27, 27, 30)",
    blur: "none",
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .click({ button: "right" });
  expect(await glass(".context-menu")).toEqual({
    background: "rgb(27, 27, 30)",
    blur: "none",
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.keyboard.press(`${mod}+,`);
  await expect(
    page.getByRole("slider", { name: "Menu transparency", exact: true }),
  ).toHaveValue("75");
  await expect(
    page.getByRole("combobox", { name: "Interface motion", exact: true }),
  ).toHaveValue("instant");
});

test("live editor preferences change the editor and preserve text and undo history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await editor.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type("\n// preference history");
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: "Editor", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Editor preview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("switch", { name: "Automatic indentation", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Relative line numbers", exact: true })
    .click();
  await page.getByRole("switch", { name: "Code folding", exact: true }).click();
  await page
    .getByRole("switch", { name: "Active line highlight", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Visible whitespace", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Cursor shape", exact: true })
    .selectOption("block");
  await page
    .getByRole("combobox", { name: "Column ruler", exact: true })
    .selectOption("80");
  await page
    .getByRole("combobox", { name: "Cursor blink", exact: true })
    .selectOption("0");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("preference history");
  const root = page.locator(".editor-document.visible").first();
  await expect(root.locator(".cm-foldGutter")).toHaveCount(0);
  await expect(root.locator(".cm-activeLine")).toHaveCount(0);
  await expect(root.locator(".cm-highlightSpace").first()).toBeVisible();
  await expect(root.locator(".cm-indent-guide").first()).toBeVisible();
  expect(
    await editor.evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain("linear-gradient");
  await editor.click();
  await page.keyboard.press(`${mod}+End`);
  expect(
    await root
      .locator(".cm-cursor")
      .first()
      .evaluate((el) => getComputedStyle(el).borderLeftStyle),
  ).toBe("none");
  await page.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("preference history");
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("\n    let plain = 1;");
  await page.keyboard.press("Enter");
  await expect(editor.locator(".cm-line").last()).toHaveText("");
  await page.reload();
  await expect(
    page.locator(".editor-document.visible .cm-foldGutter"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("devyy.settings")!),
    ),
  ).toMatchObject({
    relativeLineNumbers: true,
    folding: false,
    activeLine: false,
    renderWhitespace: "all",
    cursorStyle: "block",
    rulerColumn: 80,
    cursorBlinkRate: 0,
  });
  expect(errors).toEqual([]);
});

test("About devyy is available from Settings and commands with usable details", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.keyboard.press(`${mod}+Shift+p`);
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("About devyy");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "About devyy", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "devyy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Copy app details", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "devyy 0.1.0",
  );
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "App details copied",
  );
  await page.screenshot({ path: "artifacts/devyy-about.png" });
  await expect(page.locator(".about-details")).toContainText("OS build");
  await expect(page.locator(".about-details")).toContainText("Built on");
  await expect(page.locator(".about-details")).not.toContainText(
    "Rust at the core",
  );
  await page.setViewportSize({ width: 900, height: 680 });
  await page.getByRole("tab", { name: "About devyy", exact: true }).click();
  expect(
    await page
      .locator(".settings-modal")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Close preferences" }),
  ).toBeInViewport();
});
