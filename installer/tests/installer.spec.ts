import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
async function fixture(page: Page, uninstall = false, platform = "windows") {
  await page.addInitScript(
    ({ uninstall, platform, version }) => {
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
                version,
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
    { uninstall, platform, version },
  );
  await page.goto("/");
}
test("installer passes location and shortcut choices, shows real progress and closes after success", async ({
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
  const steps = page.getByRole("progressbar", { name: "Setup steps" });
  await expect(steps).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(steps).toHaveAttribute("aria-valuenow", "2");
  await page.getByRole("switch", { name: /Desktop shortcut/ }).uncheck();
  const explorer = page.getByRole("switch", { name: /Open in Devyy/ });
  await expect(explorer).toBeChecked();
  await explorer.uncheck();
  await expect(page.getByText("Licenses", { exact: true })).toHaveCount(0);
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
    page.getByRole("button", { name: "Close setup", exact: true }),
  ).toBeVisible();
  await expect(steps).toHaveAttribute("aria-valuenow", "3");
  await expect(
    page.getByRole("heading", { name: "Devyy is installed" }),
  ).toBeVisible();
  await expect(page.locator(".done")).toHaveText("Devyy is installed");
  await expect(
    page.locator(".desktop-page :is(.page-mark, .progress-mark)"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Close setup", exact: true }).click();
});
test("uninstall sends optional feedback only after an explicit request", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("button", { name: "Uninstall Devyy", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Uninstall progress" }),
  ).toHaveAttribute("value", "38");
  await page.evaluate(() => (window as any).installerFixture.finish());
  await expect(
    page.getByRole("heading", { name: "Devyy was removed" }),
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
test("macOS license dialog restores focus and handles keyboard dismissal", async ({
  page,
}) => {
  await fixture(page, false, "macos");
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
    page.getByRole("button", { name: "Close setup", exact: true }),
  ).toBeVisible();
});
test("Linux validates the location before showing feature choices", async ({
  page,
}) => {
  await fixture(page, false, "linux");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("switch", { name: /Application menu/ }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /Open in Devyy/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Install Devyy", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Install progress" }),
  ).toBeVisible();
  const commands = await page.evaluate(() =>
    (window as any).installerFixture.calls.map((call: any) => call.command),
  );
  expect(commands.indexOf("installer_validate_directory")).toBeGreaterThan(-1);
  expect(commands.indexOf("installer_validate_directory")).toBeLessThan(
    commands.indexOf("installer_install"),
  );
  await page.evaluate(() => (window as any).installerFixture.finish());
});
test("invalid destinations stay on the location page without starting installation", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).installerFixture.validationError =
      "This folder contains other files. Choose an empty folder.";
  });
  const install = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await install.click();
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
  await install.click();
  await page
    .getByRole("button", { name: "Install Devyy", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Install progress" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).installerFixture.finish());
});

for (const platform of ["windows", "linux"]) {
  for (const uninstall of [false, true]) {
    const flow = uninstall ? "uninstall" : "install";
    test(`${platform} ${flow} gallery`, async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 580 });
      await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await fixture(page, uninstall, platform);
      const save = (step: string) =>
        page.screenshot({
          path: fileURLToPath(
            new URL(
              `../../artifacts/installer-review/${platform}-${flow}-${step}.png`,
              import.meta.url,
            ),
          ),
        });
      const progress = page.getByRole("progressbar", {
        name: uninstall ? "Removal steps" : "Setup steps",
      });
      const heading = (name: string) =>
        page.getByRole("heading", { name, exact: true });
      await expect(
        heading(uninstall ? "Installation to remove" : "Install Devyy"),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator(".installer")).toHaveCSS(
        "background-color",
        "rgb(0, 0, 0)",
      );
      await expect(progress).toHaveAttribute("aria-valuenow", "1");
      await save("location");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(
        heading(uninstall ? "Review removal" : "Choose features"),
      ).toBeVisible();
      await expect(progress).toHaveAttribute("aria-valuenow", "2");
      await save("options");
      await page
        .getByRole("button", {
          name: uninstall ? "Uninstall Devyy" : "Install Devyy",
          exact: true,
        })
        .click();
      await expect(
        heading(uninstall ? "Removing Devyy" : "Installing Devyy"),
      ).toBeVisible();
      await expect(progress).toHaveAttribute("aria-valuenow", "3");
      await save("progress");
      await page.evaluate(() => (window as any).installerFixture.finish());
      await expect(
        heading(uninstall ? "Devyy was removed" : "Devyy is installed"),
      ).toBeVisible();
      await expect(progress).toHaveAttribute("aria-valuenow", "3");
      await save("done");
    });
  }
}
