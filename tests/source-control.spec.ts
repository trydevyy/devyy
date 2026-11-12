import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function repository(page: Page) {
  await page.addInitScript(() => {
    let callback = 0;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    let branch = "main";
    let changes = [
      { path: "main.rs", index: "M", worktree: "M" },
      { path: "new.txt", index: "?", worktree: "?" },
    ];
    const workspace = {
      root: "/work/project",
      name: "Project",
      files: [
        { path: "main.rs", name: "main.rs", directory: false },
        { path: "new.txt", name: "new.txt", directory: false },
      ],
    };
    Object.assign(window, {
      isTauri: true,
      gitCalls: calls,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++callback,
        unregisterCallback() {},
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push({ command, args });
          if (command === "plugin:event|listen") return ++callback;
          if (command === "plugin:dialog|open") return workspace.root;
          if (command === "plugin:dialog|confirm") return true;
          if (command === "plugin:dialog|message") return "Ok";
          if (command === "set_appearance") return { material: "solid" };
          if (
            [
              "list_extensions",
              "list_language_servers",
              "terminal_profiles",
            ].includes(command)
          )
            return [];
          if (["open_workspace", "refresh_workspace"].includes(command))
            return workspace;
          if (command === "read_file")
            return { content: "fn saved_working() {}\n", modified: "1" };
          if (command === "git_status")
            return {
              branch,
              changes,
              upstream: "origin/main",
              ahead: 2,
              behind: 1,
            };
          if (command === "git_branches") return ["main", "feature"];
          if (command === "git_history")
            return [
              {
                hash: "a".repeat(40),
                short: "aaaaaaa",
                author: "Developer",
                date: "2026-11-11T12:00:00Z",
                subject: "Build the workbench",
              },
            ];
          if (command === "git_diff_files")
            return {
              original: args.staged
                ? "fn committed() {}\n"
                : "fn staged() {}\n",
              modified: args.staged
                ? "fn staged() {}\n"
                : "fn saved_working() {}\n",
              binary: false,
            };
          if (command === "git_stage") {
            changes = changes.map((change) =>
              change.path !== args.path
                ? change
                : {
                    ...change,
                    index: args.staged ? " " : "M",
                    worktree: args.staged ? "M" : " ",
                  },
            );
            return;
          }
          if (command === "git_stage_all") {
            changes = changes.map((change) => ({
              ...change,
              index: args.staged ? " " : "A",
              worktree: args.staged ? "M" : " ",
            }));
            return;
          }
          if (command === "git_switch_branch") {
            branch = String(args.branch);
            return;
          }
          if (command === "git_discard") {
            changes = changes.map((change) =>
              change.path === args.path ? { ...change, worktree: " " } : change,
            );
            return;
          }
          if (command === "git_commit") {
            changes = [];
            return "Committed";
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  });
  await page.goto("/");
  await page.locator(".project-title").click();
  await page
    .getByRole("button", { name: "Source control", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Current Git branch", exact: true }),
  ).toHaveValue("main");
}

test("source control opens highlighted visual diffs and preserves editor buffers", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await repository(page);
  const content = page.locator(
    '.editor-document[data-path="main.rs"] .cm-content',
  );
  await content.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText("// unsaved buffer\n");
  const working = page.getByRole("region", {
    name: "Working tree changes",
    exact: true,
  });
  // Semantic sections without an explicit role are exposed as named regions.
  await working.getByTitle("main.rs", { exact: true }).click();
  const diff = page.getByRole("region", {
    name: "Diff: main.rs (Working tree)",
    exact: true,
  });
  await expect(diff).toBeVisible();
  await expect(diff.locator(".cm-merge-a")).toContainText("fn staged()");
  await expect(diff.locator(".cm-merge-b")).toContainText("fn saved_working()");
  await expect(diff.locator(".cm-changedLine").first()).toBeVisible();
  await page.keyboard.press(`${mod}+f`);
  await expect(diff.locator(".cm-search")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(content).not.toBeVisible();
  await expect(
    diff.getByRole("button", { name: "Next change", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("git-visual-diff.png") });
  await diff
    .getByRole("button", { name: "Show inline diff", exact: true })
    .click();
  await expect(diff.locator(".cm-deletedChunk")).toContainText("staged");
  await diff
    .getByRole("button", { name: "Open working file", exact: true })
    .click();
  await expect(content).toContainText("unsaved buffer");
  await page
    .getByRole("tab", { name: "main.rs (Working tree)", exact: true })
    .click();
  await page.keyboard.press(`${mod}+w`);
  await expect(
    page.getByRole("tab", { name: "main.rs (Working tree)", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "main.rs", exact: true }),
  ).toBeVisible();
  await expect(content).toContainText("unsaved buffer");
  expect(errors).toEqual([]);
});

test("staged and working changes have independent actions, history, and branch controls", async ({
  page,
}) => {
  await repository(page);
  const staged = page.getByRole("region", {
    name: "Staged changes",
    exact: true,
  });
  const working = page.getByRole("region", {
    name: "Working tree changes",
    exact: true,
  });
  await expect(staged.getByTitle("main.rs", { exact: true })).toBeVisible();
  await expect(working.getByTitle("main.rs", { exact: true })).toBeVisible();
  await staged.getByTitle("main.rs", { exact: true }).click();
  const diff = page.getByRole("region", {
    name: "Diff: main.rs (Staged)",
    exact: true,
  });
  await expect(diff.locator(".cm-merge-a")).toContainText("committed");
  await expect(diff.locator(".cm-merge-b")).toContainText("staged");
  await diff.getByRole("button", { name: "Unstage file", exact: true }).click();
  await expect(staged.getByTitle("main.rs", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stage all changes", exact: true })
    .click();
  await expect(staged.locator(".change-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Unstage all changes", exact: true })
    .click();
  await expect(working.locator(".change-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Commit history", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Commit history", exact: true }),
  ).toContainText("Build the workbench");
  await page
    .getByRole("combobox", { name: "Current Git branch", exact: true })
    .selectOption("feature");
  await expect(
    page.getByRole("combobox", { name: "Current Git branch", exact: true }),
  ).toHaveValue("feature");
  await page
    .getByRole("button", { name: "Discard changes to main.rs", exact: true })
    .click();
  await expect(working.getByTitle("main.rs", { exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as unknown as { gitCalls: { command: string }[] }).gitCalls.map(
      (call) => call.command,
    ),
  );
  expect(calls).toContain("git_stage_all");
  expect(calls).toContain("git_switch_branch");
  expect(calls).toContain("git_discard");
});
