import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
test("extension icons, native views, trees, commands and sandboxed webviews use the editor bridge", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let serial = 0;
    const callbacks = new Map<number, (value: unknown) => void>();
    const handlers = new Map<string, number>();
    const completed: number[] = [];
    const requests: { method: string; params: Record<string, unknown> }[] = [];
    const emit = (event: string, payload: unknown) =>
      callbacks.get(handlers.get(event)!)?.({ event, id: 1, payload });
    const hostEvent = (event: string, payload: unknown) =>
      emit("extension-host", { event, payload });
    const extension = {
      id: "fixture.runtime",
      name: "Runtime fixture",
      publisher: "fixture",
      version: "1.0.0",
      description: "A working extension runtime",
      hasRuntime: true,
      enabled: true,
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==",
      contributes: {
        viewsContainers: {
          activitybar: [{ id: "fixture", title: "Fixture tools" }],
        },
        views: { fixture: [{ id: "fixture.tree", name: "Fixture tree" }] },
        commands: [{ command: "fixture.open", title: "Open fixture panel" }],
      },
    };
    Object.assign(window, {
      isTauri: true,
      runtimeRequests: requests,
      runtimeCompleted: completed,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: (fn: (value: unknown) => void) => {
          callbacks.set(++serial, fn);
          return serial;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "plugin:event|listen") {
            handlers.set(String(args.event), Number(args.handler));
            return ++serial;
          }
          if (command === "list_extensions") return [extension];
          if (
            command === "list_language_servers" ||
            command === "terminal_profiles"
          )
            return [];
          if (command === "set_appearance") return { material: "solid" };
          if (command === "extension_host_request") {
            const method = String(args.method),
              params = (args.params ?? {}) as Record<string, unknown>;
            requests.push({ method, params });
            if (method === "restart") {
              setTimeout(
                () =>
                  hostEvent("nativeView", {
                    id: "fixture.native",
                    title: "Native controls",
                    extension: extension.id,
                    body: [
                      { type: "text", text: "Drawn with Devyy components" },
                      {
                        type: "button",
                        text: "Open native panel",
                        command: "fixture.open",
                      },
                    ],
                  }),
                20,
              );
              return [{ id: extension.id, status: "idle" }];
            }
            if (method === "tree")
              return params.parent
                ? [
                    {
                      key: "child",
                      label: "Tree child",
                      collapsibleState: 0,
                      command: { command: "fixture.open" },
                    },
                  ]
                : [{ key: "root", label: "Tree root", collapsibleState: 1 }];
            if (method === "command" || method === "treeCommand") {
              hostEvent("webview", {
                id: "fixture.panel",
                title: "Fixture panel",
                extension: extension.id,
                enableScripts: true,
                html: `<body><h2>Fixture panel</h2><input aria-label="Keep state" value="Initial"><button id="ping">Send message</button><button id="burst">Send burst</button><button id="binary">Send binary</button><button id="prompt">Ask for input</button><output id="reply">Ready</output><script>const api=acquireVsCodeApi();document.querySelector('#ping').onclick=()=>api.postMessage({ping:'hello'});document.querySelector('#burst').onclick=()=>{for(let order=0;order<3;order++)api.postMessage({order})};document.querySelector('#binary').onclick=()=>api.postMessage({binary:new Uint8Array([7,9])});document.querySelector('#prompt').onclick=()=>api.postMessage({prompt:true});window.addEventListener('message',event=>{if(event.data?.reply)document.querySelector('#reply').textContent=event.data.reply;if(event.data?.binary)document.body.dataset.binary=String(event.data.binary instanceof Uint8Array&&event.data.binary[1]===9)});try{parent.document.body;document.body.dataset.isolation='unsafe'}catch{document.body.dataset.isolation='sandboxed'}</script></body>`,
              });
              return null;
            }
            if (method === "webviewMessage") {
              const message = params.message as {
                order?: number;
                binary?: unknown;
                prompt?: boolean;
              };
              if (message.order !== undefined) {
                if (message.order === 0)
                  await new Promise((resolve) => setTimeout(resolve, 80));
                completed.push(message.order);
                return null;
              }
              if (message.binary) {
                hostEvent("webviewMessage", {
                  id: "fixture.panel",
                  message: { binary: message.binary },
                });
                return null;
              }
              if (message.prompt) {
                hostEvent("workbenchRequest", {
                  id: "fixture.input",
                  extension: extension.id,
                  method: "inputBox",
                  params: {
                    options: {
                      title: "Choose session name",
                      prompt: "Name your session",
                    },
                  },
                });
                return null;
              }
              hostEvent("webviewMessage", {
                id: "fixture.panel",
                message: { reply: "Message received" },
              });
              return null;
            }
            if (method === "closeWebview") {
              hostEvent("webviewClosed", { id: params.id });
              return null;
            }
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.keyboard.press(`${mod}+Shift+x`);
  const settings = page.getByRole("dialog", {
    name: "Preferences",
    exact: true,
  });
  await settings.getByRole("tab", { name: "Installed 1", exact: true }).click();
  await expect(
    settings.getByRole("img", { name: "Runtime fixture icon" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { runtimeRequests: { method: string }[] }
        ).runtimeRequests.filter((request) => request.method === "restart")
          .length,
    ),
  ).toBe(1);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Fixture tools", exact: true })
    .click();
  await page.getByRole("treeitem", { name: "Tree root" }).click();
  await page.getByRole("treeitem", { name: "Tree child" }).click();
  const panel = page.getByRole("region", {
    name: "Extension panel",
    exact: true,
  });
  await expect(panel).toBeVisible();
  const frame = page.frameLocator('iframe[title="Fixture panel"]');
  await expect(
    frame.getByRole("heading", { name: "Fixture panel" }),
  ).toBeVisible();
  await expect(frame.locator("body")).toHaveAttribute(
    "data-isolation",
    "sandboxed",
  );
  await frame
    .getByRole("textbox", { name: "Keep state", exact: true })
    .fill("Preserved across shortcuts");
  await frame
    .getByRole("textbox", { name: "Keep state", exact: true })
    .press(`${mod}+p`);
  await expect(
    page.getByRole("dialog", { name: "Go to file", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    frame.getByRole("textbox", { name: "Keep state", exact: true }),
  ).toHaveValue("Preserved across shortcuts");
  await frame.getByRole("button", { name: "Send message" }).click();
  await expect(frame.locator("#reply")).toHaveText("Message received");
  await frame.getByRole("button", { name: "Send burst" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { runtimeCompleted: number[] })
            .runtimeCompleted,
      ),
    )
    .toEqual([0, 1, 2]);
  await frame.getByRole("button", { name: "Send binary" }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-binary", "true");
  await frame.getByRole("button", { name: "Ask for input" }).click();
  const inputPrompt = page.getByRole("dialog", { name: "Choose session name" });
  await inputPrompt
    .getByRole("textbox", { name: "Choose session name" })
    .fill("My session");
  await inputPrompt
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              runtimeRequests: {
                method: string;
                params: { result: unknown };
              }[];
            }
          ).runtimeRequests
            .filter((r) => r.method === "workbenchResponse")
            .at(-1)?.params.result,
      ),
    )
    .toBe("My session");

  await frame
    .getByRole("textbox", { name: "Keep state" })
    .fill("Preserved state");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "paper";
  });
  await expect(frame.locator("body")).toHaveClass(/vscode-light/);
  await expect(frame.getByRole("textbox", { name: "Keep state" })).toHaveValue(
    "Preserved state",
  );
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe(
    "allow-scripts",
  );
  await page.getByRole("button", { name: "Close Fixture panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press(`${mod}+Shift+p`);
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Open fixture panel");
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});
test("chrome suppresses selection and overscroll while documents, output and controls remain usable", async ({
  page,
}) => {
  await page.goto("/");
  const selection = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).userSelect);
  expect(await selection(".sidebar")).toBe("none");
  expect(await selection(".cm-content")).toBe("text");
  await page.keyboard.press(`${mod}+,`);
  expect(await selection(".settings-modal")).toBe("none");
  const input = page.getByRole("searchbox", { name: "Search settings" });
  await input.fill("font");
  expect(
    await input.evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
  await page.keyboard.press("Escape");
  await page.locator(".tab").first().click({ button: "right" });
  expect(await selection(".context-menu")).toBe("none");
  await page.keyboard.press("Escape");
  const documentBounds = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: innerHeight,
    overflow: getComputedStyle(document.body).overflow,
    overscroll: getComputedStyle(document.body).overscrollBehavior,
  }));
  expect(documentBounds.height).toBe(documentBounds.viewport);
  expect(documentBounds.overflow).toBe("hidden");
  expect(documentBounds.overscroll).toBe("none");
});
