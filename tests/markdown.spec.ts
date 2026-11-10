import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
const markdown =
  '# Preview test\n\n[Jump to details](#details) · [Open guide](docs/guide.md)\n\n## Details\n\n**Bold text** and ~~removed~~.\n\n- [x] Completed\n- [ ] Pending\n\n| Name | Value |\n| --- | --- |\n| Editor | devyy |\n\n```go\npackage main\nfunc main() { println("hello") }\n```\n\n<script>window.markdownInjected = true</script>\n\n[unsafe](javascript:alert(1))\n';
test("Markdown previews render GFM and code, update live, and preserve source undo", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(
    (content) =>
      localStorage.setItem(
        "devyy.playground",
        JSON.stringify({
          "README.md": content,
          "docs/guide.md": "# Guide\n\nProject guide.",
        }),
      ),
    markdown,
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  const source = page
    .locator(".editor-document.visible .editor-source .cm-content")
    .first();
  await source.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("\n\nLive edit marker");
  await page
    .getByRole("button", { name: "Markdown preview to the side", exact: true })
    .click();
  const preview = page.getByRole("article", {
    name: "Markdown preview: README.md",
    exact: true,
  });
  await expect(
    preview.getByRole("heading", { name: "Preview test", exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("table")).toContainText("devyy");
  await expect(preview.getByRole("checkbox").first()).toBeChecked();
  await expect(
    preview.locator(".markdown-code-block .tok-keyword").first(),
  ).toBeVisible();
  await expect(preview).toContainText("Live edit marker");
  await expect(
    page.locator(".tab.is-split .split-tab-indicator"),
  ).toBeVisible();
  await expect(page.locator(".editor-pane-heading .pane-number")).toHaveText([
    "1",
    "2",
  ]);
  await source.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText(" another edit");
  await expect(preview).toContainText("another edit");
  await preview.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "package main",
  );
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Code copied",
  );
  expect(await page.evaluate(() => "markdownInjected" in window)).toBe(false);
  await preview
    .getByRole("link", { name: "Jump to details", exact: true })
    .click();
  await expect(preview.locator("#details")).toBeInViewport();
  await page
    .getByRole("button", { name: "Markdown preview", exact: true })
    .click();
  await expect(source).not.toBeVisible();
  await expect(preview).toBeVisible();
  await page
    .getByRole("button", { name: "Markdown source", exact: true })
    .click();
  await expect(source).toBeVisible();
  await source.click();
  await page.keyboard.press(`${mod}+z`);
  await expect(source).not.toContainText("another edit");
  await page.keyboard.press(`${mod}+Shift+v`);
  await expect(preview).toBeVisible();
  await page
    .getByRole("tab", { name: "README.md", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Split editor", exact: true })
    .click();
  await expect(source).toBeVisible();
  await expect(preview).toBeVisible();
  await preview.getByRole("link", { name: "Open guide", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "guide.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
test("compact search and Settings retain the workbench and remove decorative labels", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press(`${mod}+p`);
  const palette = page.getByRole("dialog", { name: "Go to file", exact: true });
  expect((await palette.boundingBox())!.width).toBeLessThanOrEqual(560);
  await expect(palette).not.toContainText("YOUR WORKSPACE");
  expect(
    (await palette.getByRole("option").first().boundingBox())!.height,
  ).toBeLessThan(43);
  await page.screenshot({ path: "artifacts/devyy-search.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+,`);
  await expect(page.locator(".editor-document.visible")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(
    page.locator(".settings-eyebrow,.settings-nav-label"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Preferences", exact: true }),
  ).not.toContainText("YOUR DEVELOPER WORKSPACE");
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.locator(".menu-check:empty")).toHaveCount(0);
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
test("native About reports metadata and handles available, failed and current update checks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let callback = 0,
      calls = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++callback,
        unregisterCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "plugin:event|listen") return ++callback;
          if (cmd === "set_appearance") return { material: "vibrancy" };
          if (cmd === "terminal_profiles") return [];
          if (cmd === "build_info")
            return {
              version: "0.1.0",
              builtAt: "1794300000",
              revision: "test-build",
              os: "macOS",
              osBuild: "26.1 (25B78)",
              arch: "aarch64",
            };
          if (cmd === "check_updates") {
            calls++;
            if (calls === 1)
              return {
                status: "available",
                version: "0.2.0",
                url: "https://github.com/trydevyy/devyy/releases/tag/v0.2.0",
              };
            if (calls === 2) throw new Error("Offline");
            return { status: "current", version: "0.1.0", url: null };
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
  });
  await page.goto("/");
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: "About devyy", exact: true }).click();
  const about = page.getByRole("region", { name: "About devyy", exact: true });
  await expect(about).toContainText("26.1 (25B78)");
  await expect(about).toContainText("test-build · aarch64");
  await expect(about.getByRole("status")).toContainText("0.2.0 is available");
  await expect(
    about.getByRole("button", { name: "View release", exact: true }),
  ).toBeVisible();
  await about
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(about.getByRole("status")).toContainText(
    "Could not check for updates",
  );
  await about
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(about.getByRole("status")).toContainText("Up to date");
  await expect(
    about.getByRole("button", { name: "View release", exact: true }),
  ).toHaveCount(0);
});
