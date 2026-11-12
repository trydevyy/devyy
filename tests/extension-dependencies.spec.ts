import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
test("bundle installation waits for dependencies, shows their progress, and repairs without reinstalling the parent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let serial = 0,
      finishCore: (() => void) | undefined;
    const callbacks = new Map<number, (value: unknown) => void>(),
      handlers = new Map<string, number>();
    const calls: { method: string; id?: string; count?: number }[] = [];
    const metadata = (id: string) => ({
      id,
      name: id === "fixture.bundle" ? "Bundle fixture" : id,
      publisher: "fixture",
      version: "1.0.0",
      description: "Dependency bundle",
      enabled: true,
      hasRuntime: id === "fixture.bundle",
      contributes: {},
      extensionDependencies:
        id === "fixture.bundle"
          ? ["fixture.core"]
          : id === "fixture.member"
            ? ["fixture.core"]
            : [],
      extensionPack: id === "fixture.bundle" ? ["fixture.member"] : [],
    });
    const installed: ReturnType<typeof metadata>[] = [];
    Object.assign(window, {
      isTauri: true,
      dependencyCalls: calls,
      finishDependency: () => finishCore?.(),
      removeCore: () => {
        const index = installed.findIndex(
          (extension) => extension.id === "fixture.core",
        );
        if (index >= 0) installed.splice(index, 1);
      },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn: (value: unknown) => void) {
          callbacks.set(++serial, fn);
          return serial;
        },
        unregisterCallback() {},
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "plugin:event|listen") {
            handlers.set(String(args.event), Number(args.handler));
            return ++serial;
          }
          if (command === "set_appearance") return { material: "solid" };
          if (["terminal_profiles", "list_language_servers"].includes(command))
            return [];
          if (command === "list_extensions")
            return installed.map((extension) => ({ ...extension }));
          if (command === "search_extensions")
            return {
              totalSize: 1,
              extensions: [
                {
                  namespace: "fixture",
                  name: "bundle",
                  displayName: "Bundle fixture",
                  version: "1.0.0",
                },
              ],
            };
          if (command === "install_extension") {
            const id = String(args.id);
            calls.push({ method: "install", id });
            if (id === "fixture.core" && !finishCore)
              await new Promise<void>((resolve) => {
                finishCore = resolve;
                callbacks.get(handlers.get("extension-install-progress")!)?.({
                  event: "extension-install-progress",
                  id: 1,
                  payload: {
                    id,
                    requestId: args.requestId,
                    phase: "downloading",
                    downloaded: 5,
                    total: 10,
                  },
                });
              });
            const extension = metadata(id);
            installed.push(extension);
            return extension;
          }
          if (command === "extension_host_request") {
            if (args.method === "restart") {
              calls.push({ method: "restart", count: installed.length });
              return installed
                .filter((extension) => extension.hasRuntime)
                .map((extension) => ({ id: extension.id, status: "active" }));
            }
            return null;
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  });
  await page.goto("/");
  await page.keyboard.press(`${mod}+Shift+x`);
  const row = page
    .locator(".extension-row")
    .filter({ hasText: "Bundle fixture" });
  await row.getByRole("button", { name: "Install", exact: true }).click();
  await expect(row.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(row).toContainText("fixture.core");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { dependencyCalls: { method: string }[] }
      ).dependencyCalls.filter((call) => call.method === "restart"),
    ),
  ).toEqual([]);
  await page.evaluate(() =>
    (window as unknown as { finishDependency: () => void }).finishDependency(),
  );
  await page.getByRole("tab", { name: "Installed 3", exact: true }).click();
  await expect(row).toContainText("Running in the Devyy extension host");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            dependencyCalls: { method: string; id?: string; count?: number }[];
          }
        ).dependencyCalls,
    ),
  ).toEqual([
    { method: "install", id: "fixture.bundle" },
    { method: "install", id: "fixture.core" },
    { method: "install", id: "fixture.member" },
    { method: "restart", count: 3 },
  ]);
  await page.evaluate(() =>
    (window as unknown as { removeCore: () => void }).removeCore(),
  );
  await row
    .getByRole("button", { name: "Repair dependencies", exact: true })
    .click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Dependencies repaired" }),
  ).toBeVisible();
  const ids = await page.evaluate(() =>
    (
      window as unknown as {
        dependencyCalls: { method: string; id?: string }[];
      }
    ).dependencyCalls
      .filter((call) => call.method === "install")
      .map((call) => call.id),
  );
  expect(ids).toEqual([
    "fixture.bundle",
    "fixture.core",
    "fixture.member",
    "fixture.core",
  ]);
  await row
    .getByRole("button", { name: "Repair dependencies", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { dependencyCalls: { method: string }[] }
          ).dependencyCalls.filter((call) => call.method === "restart").length,
      ),
    )
    .toBe(3);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { dependencyCalls: { method: string }[] }
        ).dependencyCalls.filter((call) => call.method === "install").length,
    ),
  ).toBe(4);
});
