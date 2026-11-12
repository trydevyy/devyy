import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function fixture(page: Page) {
  await page.addInitScript(() => {
    let serial = 0,
      requestId = "",
      resolve: ((value: unknown) => void) | undefined,
      reject: ((value: unknown) => void) | undefined;
    const callbacks = new Map<number, (value: unknown) => void>(),
      handlers = new Map<string, number>();
    const extension = {
      id: "fixture.large",
      name: "Large extension",
      publisher: "fixture",
      version: "0.9.0",
      enabled: true,
      hasRuntime: false,
      description: "A large bundled extension",
      contributes: {},
    };
    const controls = {
      calls: 0,
      get requestId() {
        return requestId;
      },
      progress(
        phase: string,
        downloaded: number,
        total: number | null,
        previousRequestId?: string,
      ) {
        callbacks.get(handlers.get("extension-install-progress")!)?.({
          event: "extension-install-progress",
          id: 1,
          payload: {
            id: "fixture.large",
            requestId: previousRequestId ?? requestId,
            phase,
            downloaded,
            total,
          },
        });
      },
      finish() {
        extension.version = "1.0.0";
        resolve?.(extension);
      },
      fail() {
        reject?.("Download connection interrupted");
      },
    };
    Object.assign(window, {
      isTauri: true,
      downloadControls: controls,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn: (value: unknown) => void) {
          callbacks.set(++serial, fn);
          return serial;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, unknown> = {}) {
          if (command === "plugin:event|listen") {
            handlers.set(String(args.event), Number(args.handler));
            return ++serial;
          }
          if (command === "set_appearance") return { material: "solid" };
          if (
            command === "terminal_profiles" ||
            command === "list_language_servers"
          )
            return [];
          if (command === "list_extensions") return [{ ...extension }];
          if (command === "search_extensions")
            return {
              totalSize: 2,
              extensions: [
                {
                  namespace: "fixture",
                  name: "large",
                  displayName: "Large extension",
                  version: "1.0.0",
                },
                {
                  namespace: "fixture",
                  name: "other",
                  displayName: "Other extension",
                  version: "1.0.0",
                },
              ],
            };
          if (command === "install_extension") {
            controls.calls++;
            requestId = String(args.requestId);
            return new Promise((yes, no) => {
              resolve = yes;
              reject = no;
            });
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  });
  await page.goto("/");
  await page.keyboard.press(`${mod}+Shift+x`);
}
interface Controls {
  calls: number;
  requestId: string;
  progress(
    phase: string,
    downloaded: number,
    total: number | null,
    requestId?: string,
  ): void;
  finish(): void;
  fail(): void;
}
const controls = (
  page: Page,
  action: "progress" | "finish" | "fail",
  args: [string, number, number | null, string?] = ["", 0, null],
) =>
  page.evaluate(
    ({ action, args }) => {
      const control = (window as unknown as { downloadControls: Controls })
        .downloadControls;
      if (action === "progress") control.progress(...args);
      else control[action]();
    },
    { action, args },
  );
const mib = 1024 * 1024;
test("download progress stays on its row, updates smoothly, survives Settings closing, and finishes after installation", async ({
  page,
}) => {
  await fixture(page);
  let row = page
    .locator(".extension-row")
    .filter({ hasText: "Large extension" });
  await row.getByRole("button", { name: "Update", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { downloadControls: Controls }).downloadControls
            .calls,
      ),
    )
    .toBe(1);
  await controls(page, "progress", ["downloading", 25 * mib, 100 * mib]);
  let bar = row.getByRole("progressbar", { name: "Large extension download" });
  await expect(bar).toHaveAttribute("aria-valuenow", "25");
  await expect(row).toContainText("25 MiB / 100 MiB");
  await expect(row.locator(".extension-progress-percent")).toHaveText("25%");
  expect(
    await row
      .locator(".extension-progress-fill")
      .evaluate((element) => getComputedStyle(element).transitionProperty),
  ).toBe("transform");
  await expect(
    page
      .locator(".extension-row")
      .filter({ hasText: "Other extension" })
      .getByRole("progressbar"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await controls(page, "progress", ["downloading", 60 * mib, 100 * mib]);
  await page.keyboard.press(`${mod}+Shift+x`);
  row = page.locator(".extension-row").filter({ hasText: "Large extension" });
  bar = row.getByRole("progressbar", { name: "Large extension download" });
  await expect(bar).toHaveAttribute("aria-valuenow", "60");
  await page.getByRole("tab", { name: "Installed 1", exact: true }).click();
  await expect(bar).toHaveAttribute("aria-valuenow", "60");
  await controls(page, "progress", ["installing", 100 * mib, 100 * mib]);
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
  await expect(row).toContainText("Installing…");
  await controls(page, "progress", ["downloading", 70 * mib, 100 * mib]);
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
  await controls(page, "finish");
  await expect(bar).toHaveCount(0);
  await expect(row).toContainText("v1.0.0");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { downloadControls: Controls }).downloadControls
          .calls,
    ),
  ).toBe(1);
});
test("unknown-size progress respects reduced motion, clears on failure, and ignores stale events after retry", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  const row = page
    .locator(".extension-row")
    .filter({ hasText: "Large extension" });
  await row.getByRole("button", { name: "Update", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { downloadControls: Controls }).downloadControls
            .calls,
      ),
    )
    .toBe(1);
  const first = await page.evaluate(
    () =>
      (window as unknown as { downloadControls: Controls }).downloadControls
        .requestId,
  );
  await controls(page, "progress", ["downloading", 5 * mib, null]);
  const bar = row.getByRole("progressbar");
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await expect(row).toContainText("5 MiB downloaded");
  await expect(row.locator(".extension-progress-fill")).toHaveCSS(
    "animation-name",
    "none",
  );
  await controls(page, "fail");
  await expect(bar).toHaveCount(0);
  await expect(
    page.getByText("Download connection interrupted", { exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Update", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { downloadControls: Controls }).downloadControls
            .calls,
      ),
    )
    .toBe(2);
  await controls(page, "progress", ["installing", 100 * mib, 100 * mib, first]);
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await controls(page, "progress", ["downloading", 2 * mib, 10 * mib]);
  await expect(bar).toHaveAttribute("aria-valuenow", "20");
  await controls(page, "finish");
  await expect(bar).toHaveCount(0);
});
