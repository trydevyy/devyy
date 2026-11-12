import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
test("edit, save, switch tabs, and restore playground changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".terminal-welcome strong")).toBeVisible();
  await expect
    .poll(() => page.locator(".cm-line span").count())
    .toBeGreaterThan(10);
  await page.screenshot({ path: "artifacts/devyy-dark.png" });
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await editor.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type("\n// saved through devyy");
  await expect(page.getByText("1 unsaved", { exact: true })).toBeVisible();
  await page.keyboard.press(`${mod}+s`);
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "lib.rs", exact: true }).click();
  await page.getByRole("tab", { name: "main.rs" }).click();
  await expect(
    page.locator(".editor-document.visible .cm-content").first(),
  ).toContainText("saved through devyy");
  await page.reload();
  await expect(
    page.locator(".editor-document.visible .cm-content").first(),
  ).toContainText("saved through devyy");
  expect(errors).toEqual([]);
});
test("file palette, workspace search, split, preferences and keyboard flow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  await page.keyboard.press(`${mod}+p`);
  const palette = page.getByRole("dialog", { name: "Go to file" });
  await expect(palette).toBeVisible();
  expect((await palette.boundingBox())!.width).toBeGreaterThanOrEqual(660);
  const result = palette
    .getByRole("option")
    .filter({ hasText: "main.rs" })
    .first();
  const icon = (await result.locator(".material-file-icon").boundingBox())!;
  const text = (await result.locator("strong").boundingBox())!;
  expect(icon.width).toBe(18);
  expect(text.x - icon.x - icon.width).toBeGreaterThanOrEqual(8);
  expect(text.x - icon.x - icon.width).toBeLessThanOrEqual(12);
  await page.screenshot({ path: testInfo.outputPath("file-search.png") });
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("lib.rs");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "lib.rs" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("#workspace-search").fill("greet");
  await expect(page.getByText(/\d+ results/)).toBeVisible();
  await expect(page.locator(".search-line mark").first()).toBeVisible();
  const group = page.locator(".search-file-heading").first();
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press(`${mod}+\\`);
  await expect(page.locator(".editors")).toHaveClass(/split/);
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.getByRole("tab", { name: "Editor", exact: true }).click();
  await page.getByRole("switch", { name: "Wrap long lines" }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page
    .getByRole("button", { name: "Toggle focus mode", exact: true })
    .click();
  await expect(page.locator(".devyy")).toHaveClass(/focus-mode/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".devyy")).not.toHaveClass(/focus-mode/);
});
test("create and rename files, add breakpoints, and expose desktop features honestly", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Value" }).fill("src/idea.rs");
  await page.getByRole("button", { name: "Create file", exact: true }).click();
  await expect(page.getByRole("tab", { name: "idea.rs" })).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for src/idea.rs" })
    .click({ force: true });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Value" }).fill("src/next.rs");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("tab", { name: "next.rs" })).toBeVisible();
  await page.getByRole("button", { name: "main.rs", exact: true }).click();
  await page
    .locator(".editor-document.visible .cm-breakpoint-gutter .cm-gutterElement")
    .nth(4)
    .click();
  await expect(
    page.locator(".editor-document.visible .breakpoint-dot"),
  ).toHaveCount(2); // marker + invisible sizing spacer
  await page.getByRole("button", { name: "Run & build", exact: true }).click();
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "desktop app",
  );
});

test("vibrancy and motion preferences persist, and the workspace fits compact windows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "on");
  await page
    .getByRole("button", { name: "Toggle vibrancy", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "off");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "off");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page
    .getByRole("switch", { name: "Window vibrancy", exact: true })
    .click();
  await page.getByRole("tab", { name: "Accessibility", exact: true }).click();
  await page
    .getByRole("switch", { name: "Reduce motion", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".terminal-welcome strong")).toBeVisible();
  await expect
    .poll(() => page.locator(".cm-line span").count())
    .toBeGreaterThan(10);
  await page.screenshot({ path: "artifacts/devyy-light.png" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "on");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.setViewportSize({ width: 900, height: 680 });
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const main = await page.locator(".main-workspace").boundingBox();
  expect(main?.width).toBeGreaterThan(600);
});

test("system accessibility preferences override decorative effects", async ({
  page,
  context,
}) => {
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
    ],
  });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "off");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Window vibrancy", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Accessibility", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Reduce motion", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
});

test("settings categories, global search, keyboard navigation and reset", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await expect(search).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Appearance", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await search.fill("font");
  await expect(
    page.getByRole("heading", { name: "Search results" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Increase font size" }).click();
  await expect(page.getByRole("group", { name: "Font size" })).toContainText(
    "15",
  );
  await search.fill("auto save");
  await page.getByRole("switch", { name: "Auto save", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Auto save", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await search.fill("nonexistent setting");
  await expect(
    page.getByText("No matching settings", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Editor", exact: true }).click();
  await expect(search).toHaveValue("");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("tab", { name: "Files & saving", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("switch", { name: "Auto save", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Reset preferences" }).click();
  await expect(
    page.getByRole("switch", { name: "Auto save", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/devyy-settings.png" });
  await page.getByRole("button", { name: "Close preferences" }).click();
  await expect(
    page.getByRole("button", { name: "Preferences", exact: true }),
  ).toBeFocused();
});

test("island tabs and the files footer hold their position with a long explorer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 150; i++) files[`file-${i}.txt`] = "test";
    localStorage.setItem("devyy.playground", JSON.stringify(files));
  });
  await page.goto("/");
  const sidebar = await page.locator(".sidebar").boundingBox();
  const footer = await page.locator(".sidebar-foot").boundingBox();
  expect(
    Math.abs(footer!.y + footer!.height - sidebar!.y - sidebar!.height),
  ).toBeLessThan(1);
  await expect(page.locator(".sidebar-foot")).toContainText("devyy");
  const tab = await page.locator(".tab.active").boundingBox();
  const surface = await page.locator(".editor-surface").boundingBox();
  expect(surface!.y - tab!.y - tab!.height).toBeGreaterThanOrEqual(6);
  await page
    .locator(".file-tree")
    .evaluate((tree) => (tree.scrollTop = tree.scrollHeight));
  await expect(page.locator(".sidebar-foot")).toBeVisible();
  expect(await page.locator(".sidebar-foot").boundingBox()).toEqual(footer);
});

test("the rename preserves existing preferences and saved playground files", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "devvy.settings",
      JSON.stringify({ theme: "paper", fontSize: 17, vibrancy: false }),
    );
    localStorage.setItem(
      "devvy.playground",
      JSON.stringify({ "src/main.rs": "// preserved user code" }),
    );
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "off");
  await expect(
    page.locator(".editor-document.visible .cm-content"),
  ).toContainText("preserved user code");
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("devyy.settings")!).fontSize,
      ),
    )
    .toBe(17);
});

test("project logos load, refresh, and fall back to the workspace initial", async ({
  page,
}) => {
  // Exercise the UI's native bridge contract; filesystem detection is covered by Rust IPC tests.
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __testLogo: string | null };
    testWindow.__testLogo =
      "data:image/svg+xml;base64," +
      btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="purple"/></svg>',
      );
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "set_appearance") return { material: "vibrancy" };
          if (cmd === "plugin:dialog|open") return "/work/project";
          if (cmd === "open_workspace" || cmd === "refresh_workspace")
            return {
              root: "/work/project",
              name: "Project",
              files: [],
              logo: testWindow.__testLogo,
            };
          if (cmd === "git_status") return { branch: "main", changes: [] };
          if (cmd === "terminal_create" || cmd === "plugin:event|listen")
            return 1;
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
  });
  await page.goto("/");
  await page.locator(".project-title").click();
  const logo = page.getByRole("img", { name: "Project logo" });
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(20);
  await page.evaluate(() =>
    Object.assign(window, { __testLogo: "data:image/png;base64,AAAA" }),
  );
  await page.getByRole("button", { name: "Refresh files" }).click();
  await expect(logo).toHaveCount(0);
  await expect(page.locator(".project-monogram")).toHaveText("P");
  await page.evaluate(() => Object.assign(window, { __testLogo: null }));
  await page.getByRole("button", { name: "Refresh files" }).click();
  await expect(page.locator(".project-monogram")).toHaveText("P");
});
