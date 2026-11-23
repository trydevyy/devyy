import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
async function fixture(page: Page, uninstall = false, platform = "windows") {
  await page.addInitScript(
    ({ uninstall, platform }) => {
      const handlers = new Map<string, Set<number>>(),
        callbacks = new Map<number, (event: unknown) => void>();
      let serial = 0;
      const calls: { command: string; args: any }[] = [];
      const emit = (payload: unknown) => {
        for (const id of handlers.get("installer-progress") ?? [])
          callbacks.get(id)?.({ payload });
      };
      Object.assign(window, {
        isTauri: true,
        installerFixture: { calls, finish: () => {}, emit },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback(fn: (event: unknown) => void) {
            callbacks.set(++serial, fn);
            return serial;
          },
          unregisterCallback(id: number) {
            callbacks.delete(id);
          },
          async invoke(command: string, args: any = {}) {
            calls.push({ command, args });
            if (command === "plugin:event|listen") {
              const ids = handlers.get(args.event) ?? new Set();
              ids.add(args.handler);
              handlers.set(args.event, ids);
              return ++serial;
            }
            if (command === "installer_info")
              return {
                platform,
                macSource:
                  platform === "macos"
                    ? "/Volumes/Devyy/.payload/Devyy.app"
                    : undefined,
                version: "0.1.0",
                directory:
                  platform === "linux"
                    ? "/home/alex/.local/opt/devyy"
                    : "C:\\Users\\Alex\\AppData\\Local\\Programs\\Devyy",
                uninstall,
                installed: uninstall,
                hasPayload: true,
                feedbackAvailable: uninstall,
              };
            if (
              command === "installer_validate_directory" &&
              (window as any).installerFixture.validationError
            ) {
              throw new Error((window as any).installerFixture.validationError);
            }
            if (command === "plugin:dialog|open") return "D:\\Apps\\Devyy";
            if (
              command === "installer_macos_install" ||
              command === "installer_install" ||
              command === "installer_uninstall"
            ) {
              emit({
                phase: "copy",
                detail: uninstall ? "Removing Devyy" : "Copying Devyy",
                percent: 38,
              });
              return new Promise<void>((resolve) => {
                (window as any).installerFixture.finish = resolve;
              });
            }
            return null;
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      });
    },
    { uninstall, platform },
  );
  await page.goto("/");
}
test("installer passes location and shortcut choices, shows real progress and launches after success", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: /Install Devyy/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Choose folder/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Installation folder" }),
  ).toHaveValue("D:\\Apps\\Devyy");
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../artifacts/devyy-installer-windows-location.png",
        import.meta.url,
      ),
    ),
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shortcuts" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Desktop shortcut/ }).uncheck();
  const explorer = page.getByRole("checkbox", { name: /Open in Devyy/ });
  await expect(explorer).toBeChecked();
  await explorer.uncheck();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Install Devyy" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Installation folder" }),
  ).toHaveValue("D:\\Apps\\Devyy");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Desktop shortcut/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Licenses" })).toBeVisible();
  await expect(page.locator(".wizard-licenses")).toContainText(
    "GNU GENERAL PUBLIC LICENSE",
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../artifacts/devyy-installer.png", import.meta.url),
    ),
  });
  await page
    .getByRole("button", { name: "Install Devyy", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Install progress" }),
  ).toHaveAttribute("value", "38");
  await expect(
    page.getByRole("button", { name: "Close installer" }),
  ).toBeDisabled();
  const options = await page.evaluate(
    () =>
      (window as any).installerFixture.calls.find(
        (c: any) => c.command === "installer_install",
      ).args.options,
  );
  expect(options).toMatchObject({
    directory: "D:\\Apps\\Devyy",
    desktop: false,
    menu: true,
    explorerContextMenu: false,
  });
  await page.evaluate(() => (window as any).installerFixture.finish());
  await expect(
    page.getByRole("button", { name: "Launch Devyy", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Launch Devyy", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).installerFixture.calls.some(
        (c: any) => c.command === "installer_launch",
      ),
    ),
  ).toBe(true);
});
test("uninstall sends optional feedback only after an explicit request", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Uninstall progress" }),
  ).toHaveAttribute("value", "38");
  await page.evaluate(() => (window as any).installerFixture.finish());
  await expect(
    page.getByRole("heading", { name: /Thanks for giving/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await page
    .getByRole("textbox", { name: "How can we improve Devyy?" })
    .fill("Faster indexing would help.");
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../artifacts/devyy-uninstaller.png", import.meta.url),
    ),
  });
  expect(
    await page.evaluate(() =>
      (window as any).installerFixture.calls.some(
        (c: any) => c.command === "installer_send_feedback",
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).installerFixture.calls.find(
            (c: any) => c.command === "installer_send_feedback",
          )?.args,
      ),
    )
    .toMatchObject({
      reason: "Performance",
      feedback: "Faster indexing would help.",
    });
});
test("license dialog restores focus and handles keyboard dismissal", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Licenses", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Devyy license" });
  await expect(dialog).toContainText("GNU GENERAL PUBLIC LICENSE");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Licenses", exact: true }),
  ).toBeFocused();
});

test("macOS follows system appearance and supports dragging the bare mark to Applications", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ colorScheme: "light" });
  await fixture(page, false, "macos");
  await expect(
    page.getByRole("heading", { name: /Install Devyy/ }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".mac-source img")).toHaveCount(0);
  await expect(page.locator(".mac-source svg")).toBeVisible();
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../artifacts/devyy-installer-macos-light.png",
        import.meta.url,
      ),
    ),
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).installerFixture.calls
            .filter((c: any) => c.command === "installer_appearance")
            .at(-1)?.args.theme,
      ),
    )
    .toBe("dark");
  await expect(page.locator(".mac-destination > button")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../artifacts/devyy-installer-macos-dark.png",
        import.meta.url,
      ),
    ),
  });
  await page
    .getByRole("button", { name: "Install Devyy in Applications" })
    .evaluate((element) => {
      const data = new DataTransfer();
      data.setData("application/x-devyy-app", "devyy");
      element.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: data }),
      );
    });
  await expect(
    page.getByRole("progressbar", { name: "Install progress" }),
  ).toHaveAttribute("value", "38");
  await page.evaluate(() => (window as any).installerFixture.finish());
  await expect(
    page.getByRole("button", { name: "Launch Devyy", exact: true }),
  ).toBeVisible();
});
test("Linux shows application-menu options and validates the folder before continuing", async ({
  page,
}) => {
  await fixture(page, false, "linux");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Application menu/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).installerFixture.calls.some(
        (c: any) => c.command === "installer_validate_directory",
      ),
    ),
  ).toBe(true);
});

test("invalid destinations stay on the location page without starting installation", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).installerFixture.validationError =
      "This folder contains other files. Choose an empty folder.";
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This folder contains other files",
  );
  await expect(
    page.getByRole("heading", { name: "Install Devyy" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).installerFixture.calls.some(
        (c: any) => c.command === "installer_install",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).installerFixture.validationError = undefined;
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shortcuts" })).toBeVisible();
});

for (const platform of ["windows", "linux"]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${platform} ${theme} setup gallery`, async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 580 });
      await page.emulateMedia({ colorScheme: theme });
      await fixture(page, false, platform);
      await expect(
        page.getByRole("heading", { name: "Install Devyy" }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const save = (step: string) =>
        page.screenshot({
          path: fileURLToPath(
            new URL(
              `../../artifacts/devyy-installer-${platform}-${theme}-${step}.png`,
              import.meta.url,
            ),
          ),
        });
      await save("location");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Shortcuts", exact: true }),
      ).toBeVisible();
      await page.locator("main").evaluate(async (e) => {
        await Promise.all(
          e
            .getAnimations({ subtree: true })
            .map((a) => a.finished.catch(() => {})),
        );
      });
      await save("shortcuts");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Licenses", exact: true }),
      ).toBeVisible();
      await page.locator("main").evaluate(async (e) => {
        await Promise.all(
          e
            .getAnimations({ subtree: true })
            .map((a) => a.finished.catch(() => {})),
        );
      });
      await save("licenses");
    });
  }
}
