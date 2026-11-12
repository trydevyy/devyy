import { test, expect } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";

test("first-run setup applies appearance and editor choices, completes once, and can reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("setup-test-started")) {
      localStorage.removeItem("devyy.setupCompleted");
      localStorage.removeItem("devyy.settings");
      sessionStorage.setItem("setup-test-started", "true");
    }
  });
  await page.goto("/");
  const setup = page.getByRole("dialog", { name: "Set up devyy", exact: true });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Blue accent", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#a7bcff");
  await setup.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.screenshot({ path: "artifacts/devyy-setup-light.png" });
  await setup.getByRole("button", { name: "Dark", exact: true }).click();
  await setup
    .getByRole("button", { name: "Neutral accent", exact: true })
    .click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#f2f2f2");
  await page.screenshot({ path: "artifacts/devyy-setup.png" });
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup
    .getByRole("slider", { name: "Setup editor font size", exact: true })
    .fill("17");
  await setup.getByRole("button", { name: "2 spaces", exact: true }).click();
  await setup
    .getByRole("switch", { name: "Setup word wrap", exact: true })
    .click();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(setup).toContainText("Available in the desktop app");
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup
    .getByRole("button", { name: "Start coding", exact: true })
    .click();
  await expect(setup).toHaveCount(0);
  await page.reload();
  await expect(setup).toHaveCount(0);
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("devyy.settings")!),
  );
  expect(settings).toMatchObject({
    fontSize: 17,
    tabSize: 2,
    wordWrap: true,
    accent: "neutral",
  });
  await page.keyboard.press(`${mod}+Shift+p`);
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Set up devyy");
  await page.keyboard.press("Enter");
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip setup", exact: true }).click();
  expect(errors).toEqual([]);
});

async function nativeFixture(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    let callback = 0;
    let installed = false;
    const config = {
      language: "fixture",
      command: "fixture-lsp",
      args: ["--stdio"],
      initializationOptions: null,
      settings: null,
      enabled: true,
      custom: false,
    };
    const extension = {
      id: "fixture.language",
      name: "Fixture language",
      publisher: "fixture",
      version: "1.0.0",
      description: "Syntax, snippets, and theme for the fixture language.",
      enabled: true,
      hasRuntime: false,
      contributes: {
        languages: [{ id: "fixture", extensions: [".devtest"] }],
        grammars: [
          {
            language: "fixture",
            scopeName: "source.fixture",
            path: "syntaxes/fixture.json",
          },
        ],
        snippets: [{ language: "fixture", path: "snippets/fixture.json" }],
        themes: [
          {
            label: "Fixture Dark",
            uiTheme: "vs-dark",
            path: "themes/fixture.json",
          },
        ],
      },
    };
    const assets: Record<string, string> = {
      "syntaxes/fixture.json": JSON.stringify({
        scopeName: "source.fixture",
        patterns: [{ match: "\\bmagic\\b", name: "keyword.control.fixture" }],
      }),
      "snippets/fixture.json": JSON.stringify({
        Greeting: {
          prefix: "hello",
          body: "hello ${1:name}",
          description: "Fixture greeting",
        },
      }),
      "themes/fixture.json": JSON.stringify({
        name: "Fixture Dark",
        tokenColors: [
          { scope: "keyword", settings: { foreground: "#ff3355" } },
        ],
      }),
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++callback,
        unregisterCallback: () => {},
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          if (cmd === "plugin:event|listen") return ++callback;
          if (cmd === "set_appearance") return { material: "vibrancy" };
          if (cmd === "terminal_profiles") return [];
          if (cmd === "list_extensions") return installed ? [extension] : [];
          if (cmd === "search_extensions")
            return {
              extensions: [
                {
                  namespace: "fixture",
                  name: "language",
                  displayName: "Fixture language",
                  version: "1.0.0",
                  description: extension.description,
                  downloadCount: 100,
                },
              ],
              totalSize: 1,
            };
          if (cmd === "install_extension") {
            installed = true;
            return extension;
          }
          if (cmd === "set_extension_enabled") {
            extension.enabled = Boolean(args.enabled);
            return null;
          }
          if (cmd === "uninstall_extension") {
            installed = false;
            return null;
          }
          if (cmd === "extension_asset") return assets[String(args.path)];
          if (cmd === "list_language_servers") return [config];
          if (cmd === "save_language_server") {
            Object.assign(config, args.config);
            (window as unknown as { savedServer: unknown }).savedServer =
              args.config;
            return null;
          }
          if (cmd === "detect_ide_settings")
            return [
              {
                id: "vscode",
                name: "Visual Studio Code",
                path: "/config/Code/User/settings.json",
                kind: "vscode",
              },
            ];
          if (cmd === "read_ide_settings")
            return {
              name: "Visual Studio Code",
              settings: {
                "editor.fontSize": 18,
                "editor.tabSize": 2,
                "editor.wordWrap": "on",
                "workbench.colorTheme": "Default Light+",
              },
              keybindings: [],
              extensions: ["fixture.language"],
            };
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
    localStorage.setItem(
      "devyy.playground",
      JSON.stringify({
        "src/main.rs": "fn main() {}",
        "sample.devtest": "magic value\n",
      }),
    );
  });
}

test("Open VSX install activates grammar, snippets and theme and can disable the extension", async ({
  page,
}) => {
  await nativeFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.keyboard.press(`${mod}+Shift+x`);
  const settings = page.getByRole("dialog", {
    name: "Preferences",
    exact: true,
  });
  await expect(settings).toContainText("Fixture language");
  await settings.getByRole("button", { name: "Install", exact: true }).click();
  await expect(
    settings.getByRole("button", { name: "Installed", exact: true }),
  ).toBeVisible();
  await settings.getByRole("tab", { name: "Installed 1", exact: true }).click();
  await expect(settings).toContainText("Syntax");
  await page.screenshot({ path: "artifacts/devyy-extensions.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+p`);
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("sample.devtest");
  await page.keyboard.press("Enter");
  const editor = page.locator(".editor-document.visible .cm-content").first();
  await expect(editor.locator(".tm-keyword")).toHaveText("magic");
  await editor.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("hel");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("hello");
  await page
    .locator(".cm-tooltip-autocomplete")
    .getByRole("option")
    .filter({ hasText: "hello" })
    .click();
  await expect(editor).toContainText("hello name");
  await page.keyboard.press(`${mod}+,`);
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click();
  await settings
    .getByRole("combobox", { name: "Extension color theme", exact: true })
    .selectOption({ label: "Fixture Dark" });
  await expect(page.locator("html")).toHaveCSS("--syntax-keyword", "#ff3355");
  await settings.getByRole("tab", { name: "Extensions", exact: true }).click();
  await settings.getByRole("tab", { name: "Installed 1", exact: true }).click();
  await settings.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(settings).toContainText("Disabled");
  await page.keyboard.press("Escape");
  await expect(editor.locator(".tm-keyword")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("native settings import previews changes and custom LSP configuration preserves arguments", async ({
  page,
}) => {
  await nativeFixture(page);
  await page.goto("/");
  await page.keyboard.press(`${mod}+,`);
  const settings = page.getByRole("dialog", {
    name: "Preferences",
    exact: true,
  });
  await settings
    .getByRole("tab", { name: "Setup & import", exact: true })
    .click();
  await settings.getByRole("button", { name: /Visual Studio Code/ }).click();
  const preview = settings.getByRole("region", {
    name: "Import preview",
    exact: true,
  });
  await expect(preview).toContainText("18");
  await expect(preview).toContainText("paper");
  await preview.getByRole("button", { name: /Import \d+ preferences/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await settings.getByRole("tab", { name: "Editor", exact: true }).click();
  await expect(
    settings.getByRole("group", { name: "Font size", exact: true }),
  ).toContainText("18");
  await settings
    .getByRole("tab", { name: "Language servers", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  await settings.getByLabel("Executable", { exact: true }).fill("node");
  await settings
    .getByLabel("Arguments JSON array")
    .fill('["/a path/server.js","--stdio"]');
  await settings
    .getByRole("button", { name: "Save server", exact: true })
    .click();
  await expect(settings).toContainText("node /a path/server.js --stdio");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedServer: { args: string[] } }).savedServer
          .args,
    ),
  ).toEqual(["/a path/server.js", "--stdio"]);
});
