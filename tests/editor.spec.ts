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
test("edit, save, switch tabs, and restore playground changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?playground=1");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page
      .locator("#panel-terminal")
      .getByRole("heading", { name: "No folder opened" }),
  ).toBeVisible();
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
test("the light file tree keeps Material language icons", async ({ page }) => {
  await page.goto("/?playground=1");
  const icon = page
    .getByRole("button", { name: "lib.rs", exact: true })
    .locator(".compact-file-icon img:visible");
  await expect(icon).toHaveAttribute("src", /file-icons\/rust\.svg/);
  await expect(icon).toHaveAttribute("loading", "eager");
  await expect(icon).toHaveJSProperty("complete", true);
  const image = await icon.elementHandle();
  await page.getByRole("button", { name: "lib.rs", exact: true }).click();
  await expect(page.getByRole("tab", { name: "lib.rs" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    await icon.evaluate((node, original) => node === original, image),
  ).toBe(true);
  await page.getByRole("button", { name: "Close lib.rs", exact: true }).click();
  await expect(page.getByRole("tab", { name: "lib.rs" })).toHaveCount(0);
  expect(
    await icon.evaluate((node, original) => node === original, image),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "paper";
  });
  await expect(icon).toHaveAttribute("src", /file-icons\/rust\.svg/);
});

test("file palette, workspace search, split, preferences and keyboard flow", async ({
  page,
}, testInfo) => {
  await page.goto("/?playground=1");
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
  const zoom = await page
    .locator("html")
    .evaluate((element) => Number(getComputedStyle(element).zoom));
  expect(icon.width / zoom).toBeCloseTo(18, 0);
  const gap = (text.x - icon.x - icon.width) / zoom;
  expect(gap).toBeGreaterThanOrEqual(7.9);
  expect(gap).toBeLessThanOrEqual(12.1);
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
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("button", { name: "Preview Light", exact: true }),
    })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("button", { name: "Preview Dark", exact: true }),
    })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
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
  await page.goto("/?playground=1");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Value" })
    .fill("src/app/app/idea.rs");
  await page.getByRole("button", { name: "Create file", exact: true }).click();
  await expect(page.getByRole("tab", { name: "idea.rs" })).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for src/app/app/idea.rs" })
    .click({ force: true });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Value" })
    .fill("src/app/app/next.rs");
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
  await expect(
    page.getByRole("button", { name: /^Run cargo run$/ }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Debugger", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Call stack", { exact: false })).toBeVisible();
});

test("vibrancy and motion preferences persist, and the workspace fits compact windows", async ({
  page,
}) => {
  await page.goto("/?playground=1");
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
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("button", { name: "Preview Light", exact: true }),
    })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator("#panel-terminal")
      .getByRole("heading", { name: "No folder opened" }),
  ).toBeVisible();
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

test("the Linux desktop uses opaque surfaces with saved vibrancy enabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Linux x86_64" });
    localStorage.setItem(
      "devyy.settings",
      JSON.stringify({
        vibrancy: true,
        windowTransparency: 90,
        editorTransparency: 90,
      }),
    );
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        invoke: async (cmd: string, args?: { vibrancy?: boolean }) =>
          cmd === "set_appearance"
            ? { material: args?.vibrancy ? "translucent" : "solid" }
            : null,
      },
    });
  });
  await page.goto("/?playground=1");
  await expect(page.locator("html")).toHaveAttribute("data-vibrancy", "off");
  await expect(page.locator("html")).toHaveAttribute("data-material", "solid");
  await expect(page.locator(".editor-surface")).toHaveCSS(
    "background-color",
    "rgb(34, 35, 37)",
  );
  await expect(page.locator(".devyy")).toHaveCSS(
    "background-color",
    "rgb(27, 28, 30)",
  );
  await expect
    .poll(() =>
      page
        .locator(".devyy")
        .evaluate((element) => getComputedStyle(element, "::before").display),
    )
    .toBe("none");

  await expect(
    page.getByRole("button", { name: "Toggle vibrancy" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.locator(".preferences-backdrop")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  const vibrancy = page.getByRole("switch", {
    name: "Window vibrancy",
    exact: true,
  });
  await expect(vibrancy).toBeDisabled();
  await expect(vibrancy).not.toBeChecked();
  await expect(
    page.getByRole("slider", { name: "Window transparency" }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "Interface motion" }).click();
  const dropdown = page.locator(".devyy-select-popup");
  await expect(dropdown).toHaveCSS("animation-name", "none");
  await expect(dropdown).toHaveCSS("backdrop-filter", "none");
  await page.keyboard.press("Escape");

  const transition = await page.evaluate(async () => {
    document.getElementById("settings-tab-editor")!.click();
    const end = performance.now() + 400;
    let blurred = false;
    let browserAnimations = false;
    while (performance.now() < end) {
      await new Promise(requestAnimationFrame);
      for (const panel of document.querySelectorAll(".settings-inner")) {
        const blur = Number.parseFloat(getComputedStyle(panel).filter.slice(5));
        blurred ||= blur > 0;
        browserAnimations ||= panel.getAnimations().length > 0;
      }
    }
    return { blurred, browserAnimations };
  });
  expect(transition).toEqual({ blurred: true, browserAnimations: false });
  await expect(page.locator(".settings-inner")).toHaveCSS("filter", "none");
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
  await page.goto("/?playground=1");
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
  await page.goto("/?playground=1");
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
  await page.goto("/?playground=1");
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
  await page.goto("/?playground=1");
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
  await page.goto("/?playground=1");
  await page.locator(".project-title").click();
  await page
    .getByRole("button", { name: "Open another folder…", exact: true })
    .click();
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

test("folder rows stay highlighted while hovered or open", async ({ page }) => {
  await page.goto("/?playground=1");
  const button = page.locator(".tree-row[data-folder] .tree-file").first();
  const row = page.locator(".tree-row[data-folder]").first();
  if ((await button.getAttribute("aria-expanded")) === "true") {
    await button.click();
    await page.mouse.move(0, 0);
  }
  const background = () =>
    row.evaluate((element) => getComputedStyle(element).backgroundColor);
  const transparent = "rgba(0, 0, 0, 0)";

  await expect.poll(background).toBe(transparent);
  await button.hover();
  await expect.poll(background).not.toBe(transparent);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(0, 0);
  await expect.poll(background).not.toBe(transparent);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect.poll(background).not.toBe(transparent);
  await page.mouse.move(0, 0);
  await expect.poll(background).toBe(transparent);
});

test("file list supports Cmd+A select all and shift multi-selection", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  const tree = page.locator(".file-tree");
  await expect(tree).toBeVisible();
  await tree.focus();
  await page.keyboard.press(`${mod}+a`);
  const selectedRows = page.locator(".tree-row.selected");
  await expect(selectedRows).toHaveCount(
    await page.locator(".tree-row").count(),
  );

  const firstFile = page.locator(".tree-file").first();
  await firstFile.click();
  await expect(page.locator(".tree-row.selected")).toHaveCount(1);

  const thirdFile = page.locator(".tree-file").nth(2);
  await thirdFile.click({ modifiers: ["Shift"] });
  await expect(page.locator(".tree-row.selected")).toHaveCount(3);
});

test("cursor is visible when editor is clicked", async ({ page }) => {
  await page.goto("/?playground=1");
  await expect(page.getByRole("tab", { name: "main.rs" })).toBeVisible();
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await editor.click();
  const info = await page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor");
    const cursorLayer = document.querySelector(".cm-cursorLayer");
    return {
      hasCursor: !!cursor,
      cursorDisplay: cursor ? getComputedStyle(cursor).display : null,
      cursorVisibility: cursor ? getComputedStyle(cursor).visibility : null,
      cursorOpacity: cursor ? getComputedStyle(cursor).opacity : null,
      cursorLayerClip: cursorLayer
        ? (cursorLayer as HTMLElement).style.clipPath
        : "",
      cursorRect: cursor ? cursor.getBoundingClientRect() : null,
    };
  });
  expect(info.hasCursor).toBe(true);
  expect(info.cursorDisplay).toBe("block");
  expect(info.cursorVisibility).toBe("visible");
  expect(Number(info.cursorOpacity)).toBeGreaterThan(0);
  expect(info.cursorLayerClip).toBe("");
  expect(info.cursorRect?.height).toBeGreaterThan(0);
});

test("dotenv privacy masks individual values by default and can be switched off", async ({
  page,
}) => {
  await page.goto("/?playground=1");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Value" }).fill(".env.local");
  await page.getByRole("button", { name: "Create file", exact: true }).click();
  await page
    .locator(".editor-document.visible .cm-content")
    .fill("API_KEY=example-one\nDB_PASSWORD=example-two\nPORT=3000");
  const editor = page.locator(".editor-document.visible");
  const secrets = editor.locator(".cm-env-value");
  await expect(secrets).toHaveText(["example-one", "example-two", "3000"]);
  await expect(secrets.first()).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await secrets.first().click();
  await expect(secrets.first()).toHaveClass(/cm-env-value-revealed/);
  await expect(secrets.nth(1)).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await secrets.first().click();
  await expect(secrets.first()).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await expect(secrets.first()).toHaveCSS("filter", "blur(4px)");
  await expect(secrets.first()).toHaveCSS("text-shadow", "none");
  await expect(secrets.first()).not.toHaveCSS("background-image", "none");
  const revealAll = page.getByRole("button", {
    name: "Reveal all .env values",
  });
  await revealAll.click();
  await expect(secrets).toHaveCount(0);
  await page.getByRole("button", { name: "Hide all .env values" }).click();
  await expect(secrets).toHaveCount(3);
  await editor
    .locator(".cm-content")
    .fill(
      Array.from({ length: 600 }, (_, i) => `VAR_${i}=value-${i}`).join("\n"),
    );
  const scroller = editor.locator(".cm-scroller");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(secrets.first()).toHaveText("value-0");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(secrets.last()).toHaveText("value-599");
  await expect(secrets.last()).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByRole("tab", { name: "Editor", exact: true }).click();
  await page.getByRole("switch", { name: "Blur .env values" }).click();
  await expect(secrets).toHaveCount(0);
  await expect(editor.locator(".cm-content")).toContainText("value-599");
});
