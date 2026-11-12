import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function menuLayout(page: Page, label: string) {
  await page
    .getByRole("button", { name: "Workspace layout", exact: true })
    .click();
  await page
    .getByRole("menuitemcheckbox", { name: label, exact: true })
    .click();
}
async function drag(page: Page, label: string, dx: number, dy: number) {
  const box = (await page
    .getByRole("separator", { name: label, exact: true })
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
    { steps: 12 },
  );
  await page.mouse.up();
}
test("focus fills the editor and header layout controls remain independent", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Toggle focus mode", exact: true })
    .click();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
  const box = (await page.locator(".editors").boundingBox())!,
    surface = (await page.locator(".editor-surface").boundingBox())!;
  expect(box.width).toBeGreaterThan(surface.width - 3);
  expect(Math.abs(box.x - surface.x)).toBeLessThan(2);
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Toggle bottom panel", exact: true })
    .click();
  await expect(page.locator(".bottom-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await menuLayout(page, "Sidebar and terminal");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".bottom-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle focus mode", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".bottom-panel")).toBeVisible();
  await menuLayout(page, "Terminal only");
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".bottom-panel")).toBeVisible();
  await menuLayout(page, "Sidebar only");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
  await menuLayout(page, "Editor only");
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".bottom-panel")).not.toBeVisible();
});
test("pane resizing follows drag, persists, clamps and supports keyboard reset", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("separator", { name: "Resize sidebar" }),
  ).toBeVisible();
  const width = (await page.locator(".sidebar").boundingBox())!.width;
  await drag(page, "Resize sidebar", 90, 0);
  await expect
    .poll(async () => (await page.locator(".sidebar").boundingBox())!.width)
    .toBeCloseTo(width + 90, 0);
  const height = (await page.locator(".bottom-panel").boundingBox())!.height;
  await drag(page, "Resize developer panel", 0, -70);
  await expect
    .poll(
      async () => (await page.locator(".bottom-panel").boundingBox())!.height,
    )
    .toBeCloseTo(height + 70, 0);
  await page.getByRole("button", { name: "Split editor", exact: true }).click();
  await drag(page, "Resize editor split", -110, 0);
  const sizes = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("devyy.layout")!),
  );
  expect(sizes.split).toBeLessThan(50);
  await page.reload();
  await expect
    .poll(async () => (await page.locator(".sidebar").boundingBox())!.width)
    .toBeCloseTo(width + 90, 0);
  await page.setViewportSize({ width: 900, height: 680 });
  expect(
    (await page.locator(".main-workspace").boundingBox())!.width,
  ).toBeGreaterThan(450);
  await page.getByRole("separator", { name: "Resize sidebar" }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("separator", { name: "Resize sidebar" }),
  ).toHaveAttribute("aria-valuenow", "236");
  await page
    .getByRole("button", { name: "Maximize panel", exact: true })
    .click();
  await expect(page.locator(".editors")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Restore panel", exact: true })
    .click();
  await expect(page.locator(".editors")).toBeVisible();
});
test("independent transparency persists and solid mode overrides both surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page
    .getByRole("slider", { name: "Window transparency", exact: true })
    .press("End");
  await page
    .getByRole("slider", { name: "Editor transparency", exact: true })
    .press("End");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--editor-opacity",
          ),
        ),
      ),
    )
    .toBeCloseTo(0.1, 3);
  await page
    .getByRole("slider", { name: "Window transparency", exact: true })
    .press("Home");
  await page.getByRole("button", { name: "Close preferences" }).click();
  expect(
    await page
      .locator(".devyy")
      .evaluate((el) => getComputedStyle(el, "::before").clipPath),
  ).toContain("path(");
  await page.reload();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("devyy.settings")!),
    ),
  ).toMatchObject({ windowTransparency: 0, editorTransparency: 90 });
  await page
    .getByRole("button", { name: "Toggle vibrancy", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".editor-surface")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(34, 35, 37)");
});
test("custom shortcuts record, resolve conflicts, dispatch and survive restart", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${mod}+,`);
  await page
    .getByRole("tab", { name: "Keyboard shortcuts", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Change shortcut for Toggle sidebar",
      exact: true,
    })
    .click();
  await page.keyboard.press(`${mod}+p`);
  await expect(page.getByRole("status")).toContainText("Go to file");
  await page
    .getByRole("button", { name: "Reassign shortcut", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+p`);
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${mod}+p`);
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await page.keyboard.press(`${mod}+,`);
  await page
    .getByRole("tab", { name: "Keyboard shortcuts", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Change shortcut for Toggle sidebar",
      exact: true,
    })
    .click();
  await page.keyboard.press("a");
  await expect(
    page.getByRole("button", { name: "Use shortcut", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preferences" })).toBeVisible();
  await page
    .getByRole("button", { name: "Reset preferences", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+p`);
  await expect(page.getByRole("dialog", { name: "Go to file" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("smrs");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
test("custom context menus handle keyboard navigation, tab actions and viewport edges", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "main.rs", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close other tabs", exact: true })
    .click();
  await expect(page.locator('.tabs [role="tab"]')).toHaveCount(1);
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await editor.click();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Format document", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.click({ button: "right", position: { x: 10, y: 10 } });
  const rect = (await page.getByRole("menu").boundingBox())!;
  expect(rect.x + rect.width).toBeLessThanOrEqual(1440);
  expect(rect.y + rect.height).toBeLessThanOrEqual(940);
});

test("browser context menus are suppressed across chrome and inputs without blocking custom menus", async ({
  page,
}) => {
  await page.goto("/");
  const isCancelled = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
  for (const selector of [
    ".titlebar",
    ".sidebar-heading",
    ".activity-bar",
    ".sidebar-foot",
    "body",
  ]) {
    expect(await isCancelled(selector)).toBe(true);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  await page.keyboard.press(`${mod}+,`);
  expect(await isCancelled(".settings-modal")).toBe(true);
  expect(await isCancelled(".settings-search input")).toBe(true);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "main.rs", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close other tabs", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await editor.click();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Format document", exact: true }),
  ).toBeVisible();
});

test("terminal sessions keep their processes through switching, splits, resizing and panel toggles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  await page.addInitScript(() => {
    let next = 0,
      cbid = 0,
      listenerId = 0;
    const callbacks = new Map<number, (event: unknown) => void>(),
      listeners = new Map<number, { event: string; handler: number }>();
    const bridge = {
      created: [] as number[],
      profiles: [] as string[],
      closed: [] as number[],
      writes: [] as { id: number; data: string }[],
      root: "/work/project",
      emit: (event: string, payload: unknown) => {
        for (const [id, l] of listeners)
          if (l.event === event)
            callbacks.get(l.handler)?.({ event, id, payload });
      },
    };
    Object.assign(window, {
      __bridge: bridge,
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: (cb: (event: unknown) => void) => {
          callbacks.set(++cbid, cb);
          return cbid;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          if (cmd === "plugin:event|listen") {
            listeners.set(++listenerId, {
              event: args.event as string,
              handler: args.handler as number,
            });
            return listenerId;
          }
          if (cmd === "plugin:event|unlisten") {
            listeners.delete(args.eventId as number);
            return;
          }
          if (cmd === "set_appearance") return { material: "vibrancy" };
          if (cmd === "plugin:dialog|open") return bridge.root;
          if (cmd === "open_workspace" || cmd === "refresh_workspace")
            return {
              root: bridge.root,
              name: "Project",
              files: [
                { path: "README.md", name: "README.md", directory: false },
              ],
              logo: null,
            };
          if (cmd === "read_file")
            return {
              content: "# Project\n\n![Project logo](assets/logo.png)\n",
              modified: "1",
            };
          if (cmd === "read_preview_image")
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
          if (cmd === "git_status") return { branch: "main", changes: [] };
          if (cmd === "terminal_profiles")
            return [
              {
                id: "/bin/zsh",
                name: "zsh",
                path: "/bin/zsh",
                args: ["-l"],
                isDefault: true,
              },
              {
                id: "/bin/bash",
                name: "Bash",
                path: "/bin/bash",
                args: ["-l"],
                isDefault: false,
              },
            ];
          if (cmd === "terminal_create") {
            bridge.profiles.push(args.profile as string);
            bridge.created.push(++next);
            return next;
          }
          if (cmd === "terminal_close") {
            bridge.closed.push(args.id as number);
            return;
          }
          if (cmd === "terminal_write") {
            bridge.writes.push(args as { id: number; data: string });
            bridge.emit("terminal-output", {
              id: args.id,
              data: Array.from(new TextEncoder().encode(args.data as string)),
            });
            return;
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (event: string, id: number) => {
          void event;
          listeners.delete(id);
        },
      },
    });
  });
  await page.goto("/");
  await page.locator(".project-title").click();
  const state = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __bridge: {
              created: number[];
              profiles: string[];
              closed: number[];
              writes: { id: number; data: string }[];
            };
          }
        ).__bridge,
    );
  await expect.poll(async () => (await state()).created.length).toBe(1);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect.poll(async () => (await state()).created.length).toBe(2);
  await page
    .locator(".terminal-instance.visible .xterm")
    .click({ position: { x: 20, y: 20 } });
  await page.locator(".terminal-instance.visible textarea").press("h");
  await expect
    .poll(async () =>
      (await state()).writes.some((w) => w.id === 2 && w.data === "h"),
    )
    .toBe(true);
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await page.locator(".terminal-instance.visible textarea").press("a");
  await expect
    .poll(async () =>
      (await state()).writes.some((w) => w.id === 1 && w.data === "a"),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Split terminal", exact: true })
    .click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await expect(
    page
      .getByRole("group", { name: "Split terminal group", exact: true })
      .getByRole("tab"),
  ).toHaveCount(2);
  await expect(page.locator(".terminal-pane-heading .pane-number")).toHaveText([
    "1",
    "2",
  ]);
  await expect.poll(async () => (await state()).created.length).toBe(3);
  // Selecting a standalone terminal must preserve the inactive pair and both processes.
  await page.getByRole("tab", { name: "Terminal 2", exact: true }).click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(1);
  await expect(
    page.getByRole("group", { name: "Split terminal group", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Terminal 3", exact: true }).click();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  expect((await state()).created).toEqual([1, 2, 3]);
  expect((await state()).closed).toEqual([]);
  await page
    .getByRole("tab", { name: "Terminal 2", exact: true })
    .dragTo(page.getByRole("tab", { name: "Terminal 1", exact: true }));
  await page
    .getByRole("tab", { name: "Terminal 3", exact: true })
    .dragTo(page.getByRole("tab", { name: "Terminal 2", exact: true }));
  expect((await state()).created).toEqual([1, 2, 3]);
  expect((await state()).closed).toEqual([]);
  await page
    .locator(".terminal-instance.visible")
    .first()
    .locator("textarea")
    .focus();
  await expect(page.locator(".terminal-instance.visible")).toHaveCount(2);
  await drag(page, "Resize terminal split", 80, 0);
  await drag(page, "Resize developer panel", 0, -80);
  await page
    .getByRole("button", { name: "Toggle bottom panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle bottom panel", exact: true })
    .click();
  expect((await state()).created).toEqual([1, 2, 3]);
  expect((await state()).closed).toEqual([]);
  await page
    .getByRole("button", { name: "Close Terminal 3", exact: true })
    .click();
  await expect.poll(async () => (await state()).closed).toContain(3);
  await page
    .getByRole("tab", { name: "Terminal 1", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rename terminal", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Terminal name" }).fill("Build");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Build", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Build", exact: true }).click();
  await page
    .getByRole("button", { name: "Close Terminal 2", exact: true })
    .click();
  await expect(
    page.getByText("No active terminals", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run & build", exact: true }).click();
  await page.locator("#run-command").fill("echo session");
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect.poll(async () => (await state()).created.length).toBe(4);
  await expect
    .poll(async () =>
      (await state()).writes.some(
        (w) => w.id === 4 && w.data === "echo session\r",
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const b = (
      window as unknown as {
        __bridge: { emit: (event: string, payload: string) => void };
      }
    ).__bridge;
    b.emit("devyy-command", "sidebar");
  });
  await expect(page.locator(".sidebar")).not.toBeVisible();
  // A one-off profile launches the selected shell without replacing an existing process.
  await page
    .getByRole("button", { name: "Choose terminal profile", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Bash", exact: true }).click();
  await expect.poll(async () => (await state()).created.length).toBe(5);
  expect((await state()).profiles.at(-1)).toBe("/bin/bash");
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Default shell", exact: true })
    .selectOption("/bin/zsh");
  await page
    .getByRole("slider", { name: "Terminal line height", exact: true })
    .press("End");
  await page.keyboard.press("Escape");
  expect((await state()).created).toEqual([1, 2, 3, 4, 5]);
  expect((await state()).closed).not.toContain(4);
  expect((await state()).closed).not.toContain(5);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect.poll(async () => (await state()).created.length).toBe(6);
  expect((await state()).profiles.at(-1)).toBe("/bin/zsh");
  // View tabs and session tabs share a single toolbar at full and compact widths.
  const views = page.getByRole("tablist", {
    name: "Developer views",
    exact: true,
  });
  const sessions = page.getByRole("tablist", {
    name: "Terminal sessions",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 940 });
    const a = (await views.boundingBox())!,
      b = (await sessions.boundingBox())!;
    expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
    const last = page.getByRole("tab", { name: "Terminal 6", exact: true });
    await last.focus();
    await last.press("ArrowLeft");
    await expect(
      page.getByRole("tab", { name: "Terminal 5", exact: true }),
    ).toBeFocused();
  }
  await views.getByRole("tab", { name: "problems", exact: true }).click();
  await expect(
    page.getByRole("tablist", { name: "Terminal sessions", exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    views.getByRole("tab", { name: "output", exact: true }),
  ).toBeFocused();
  await views.getByRole("tab", { name: "terminal", exact: true }).click();
  expect((await state()).created.length).toBe(6);
  await page.setViewportSize({ width: 1440, height: 940 });
  await page
    .getByRole("button", { name: "Markdown preview", exact: true })
    .click();
  const preview = page.getByRole("article", {
    name: "Markdown preview: README.md",
    exact: true,
  });
  await expect(
    preview.getByRole("img", { name: "Project logo", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      preview
        .getByRole("img", { name: "Project logo", exact: true })
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(1);
  await preview.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Edit Markdown", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/devyy-workbench.png" });
  expect(errors).toEqual([]);
});
