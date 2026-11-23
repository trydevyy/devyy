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
  await page.goto("/?playground=1");
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
  await expect(preview.locator("#user-content-details")).toBeInViewport();
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
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+p`);
  const palette = page.getByRole("dialog", { name: "Go to file", exact: true });
  expect((await palette.boundingBox())!.width).toBeGreaterThanOrEqual(680);
  expect((await palette.boundingBox())!.width).toBeLessThanOrEqual(740);
  await expect(palette).not.toContainText("YOUR WORKSPACE");
  expect(
    (await palette.getByRole("option").first().boundingBox())!.height,
  ).toBeLessThanOrEqual(48);
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
  await page.goto("/?playground=1");
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole("tab", { name: "About devyy", exact: true }).click();
  const about = page.getByRole("region", { name: "About devyy", exact: true });
  await expect(about).toContainText("26.1 (25B78)");
  await expect(about).toContainText("test-build (aarch64)");
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

test("Markdown renders embedded HTML with working details and safe links and images", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "devyy.playground",
      JSON.stringify({
        "README.md": `# HTML preview

<p align="center"><strong>Embedded HTML</strong><br><kbd>npm run build</kbd></p>

<details><summary>Build instructions</summary><p>Build the <em>desktop app</em>.</p><table><tbody><tr><td>Target</td><td>Desktop</td></tr></tbody></table></details>

<a href="#example">Jump to HTML</a>
<h2 id="example">HTML section</h2>
<img src="https://example.test/badge.svg" alt="Build badge" width="64" height="24" onload="window.markdownInjected = true">
<a href="docs/guide.md">HTML guide</a>
<script>window.markdownInjected = true</script>
<style>body { display: none; }</style>
<iframe srcdoc="<script>parent.markdownInjected = true</script>"></iframe>
<a href="javascript:window.markdownInjected=true">Unsafe HTML link</a>`,
        "docs/guide.md": "# Guide",
      }),
    ),
  );
  await page.route("https://example.test/badge.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24"><rect width="64" height="24" fill="gray"/></svg>',
    }),
  );
  await page.goto("/?playground=1");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page
    .getByRole("button", { name: "Markdown preview", exact: true })
    .click();
  const preview = page.getByRole("article", {
    name: "Markdown preview: README.md",
    exact: true,
  });
  await expect(preview.locator('p[align="center"] > strong')).toHaveText(
    "Embedded HTML",
  );
  await expect(preview.locator("kbd")).toHaveText("npm run build");
  await expect(preview.locator("details > p")).not.toBeVisible();
  await preview.locator("summary").click();
  await expect(preview.locator("details > p")).toHaveText(
    "Build the desktop app.",
  );
  await expect(preview.getByRole("table")).toContainText("Desktop");
  const image = preview.getByRole("img", { name: "Build badge", exact: true });
  await expect(image).toHaveAttribute("width", "64");
  await expect(image).not.toHaveAttribute("onload");
  await expect(preview.locator("script, style, iframe")).toHaveCount(0);
  await expect(
    preview.getByRole("link", { name: "Unsafe HTML link" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "markdownInjected" in window)).toBe(false);
  await preview
    .getByRole("link", { name: "Jump to HTML", exact: true })
    .click();
  await expect(preview.locator("#user-content-example")).toBeInViewport();
  await preview.getByRole("link", { name: "HTML guide", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "guide.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
