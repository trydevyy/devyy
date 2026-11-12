import { test, expect, type Page } from "@playwright/test";
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function repository(page: Page, includeSubmodules = false) {
  await page.addInitScript((includeSubmodules) => {
    let callback = 0;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    let branch = "main",
      moduleBranch = "main";
    let branchNames = ["main", "feature"];
    let moduleChanges = [
      { path: "packages/shared/lib.rs", index: " ", worktree: "M" },
    ];
    const modules = includeSubmodules
      ? [
          {
            path: "packages/shared",
            parent: "",
            expected: "a".repeat(40),
            head: "a".repeat(40),
            branch: "main",
            initialized: true,
            dirty: true,
            conflict: false,
          },
          {
            path: "packages/lazy",
            parent: "",
            expected: "b".repeat(40),
            initialized: false,
            dirty: false,
            conflict: false,
          },
        ]
      : [];
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
              branch: args.repository ? moduleBranch : branch,
              changes: args.repository ? moduleChanges : changes,
              upstream: "origin/main",
              ahead: 2,
              behind: 1,
            };
          if (command === "git_branches") return branchNames;
          if (command === "git_branch_details")
            return [
              ...branchNames.map((name) => ({
                name,
                reference: `refs/heads/${name}`,
                current: name === (args.repository ? moduleBranch : branch),
                remote: false,
                commit: "aaaaaaa",
                subject: "Local branch",
                worktree: null,
              })),
              {
                name: "origin/release",
                reference: "refs/remotes/origin/release",
                current: false,
                remote: true,
                commit: "bbbbbbb",
                subject: "Release",
              },
            ];
          if (command === "git_submodules") return modules;
          if (command === "git_submodule_action") {
            if (args.action === "update")
              for (const item of modules)
                if (!args.path || item.path === args.path) {
                  item.initialized = true;
                  item.head = item.expected;
                }
            if (args.action === "add")
              modules.push({
                path: String(args.path),
                parent: String(args.repository ?? ""),
                expected: "c".repeat(40),
                head: "c".repeat(40),
                branch: "main",
                initialized: true,
                dirty: false,
                conflict: false,
              });
            return "Submodule updated";
          }
          if (command === "git_branch_action") {
            const name = String(args.branch).replace("refs/heads/", "");
            if (args.action === "rename") {
              branchNames = branchNames.map((old) =>
                old === name ? String(args.name) : old,
              );
              if (branch === name) branch = String(args.name);
            }
            if (args.action === "delete")
              branchNames = branchNames.filter((old) => old !== name);
            return "Done";
          }
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
          if (command === "git_stage" && args.repository) {
            moduleChanges = moduleChanges.map((change) => ({
              ...change,
              index: args.staged ? " " : "M",
              worktree: args.staged ? "M" : " ",
            }));
            return;
          }
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
            const next = String(args.branch).replace(
              "refs/remotes/origin/",
              "",
            );
            if (args.repository) moduleBranch = next;
            else branch = next;
            if (!branchNames.includes(next)) branchNames.push(next);
            return;
          }
          if (command === "git_discard") {
            changes = changes.map((change) =>
              change.path === args.path ? { ...change, worktree: " " } : change,
            );
            return;
          }
          if (command === "git_commit") {
            if (args.repository) moduleChanges = [];
            else changes = [];
            return "Committed";
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  }, includeSubmodules);
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

test("branch manager lists remote branches, creates from a ref, renames, fetches and safely deletes", async ({
  page,
}, testInfo) => {
  await repository(page);
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  const panel = page.getByRole("region", { name: "Branches", exact: true });
  await expect(
    panel.getByRole("group", { name: "Remote branches" }),
  ).toContainText("origin/release");
  await panel.getByRole("textbox", { name: "Search branches" }).fill("release");
  await expect(
    panel.getByRole("button", { name: "Switch to feature", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Actions for branch origin/release" })
    .click();
  await page
    .getByRole("menuitem", { name: "Create branch from here", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Create branch",
    exact: true,
  });
  await create.getByRole("textbox").fill("release-work");
  await create
    .getByRole("button", { name: "Branch name", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Current Git branch" }),
  ).toHaveValue("release-work");
  await panel.getByRole("textbox", { name: "Search branches" }).fill("");
  await panel
    .getByRole("button", { name: "Actions for branch release-work" })
    .click();
  await page
    .getByRole("menuitem", { name: "Rename branch", exact: true })
    .click();
  const rename = page.getByRole("dialog", {
    name: "Rename branch",
    exact: true,
  });
  await rename.getByRole("textbox").fill("release-renamed");
  await rename
    .getByRole("button", { name: "Branch name", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Current Git branch" }),
  ).toHaveValue("release-renamed");
  await page
    .getByRole("button", { name: "Fetch all remotes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Fetch all remotes", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Current Git branch" })
    .selectOption("main");
  await panel
    .getByRole("button", { name: "Actions for branch release-renamed" })
    .click();
  await page
    .getByRole("menuitem", { name: "Delete branch", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Switch to release-renamed",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("branches.png") });
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitCalls,
  );
  expect(calls).toContainEqual({
    command: "git_switch_branch",
    args: expect.objectContaining({
      branch: "release-work",
      create: true,
      startPoint: "refs/remotes/origin/release",
      repository: "",
    }),
  });
  expect(
    calls.some(
      (call) =>
        call.command === "git_branch_action" && call.args.action === "fetch",
    ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: "Current Git branch" })
    .selectOption("refs/remotes/origin/release");
  await expect(
    page.getByRole("combobox", { name: "Current Git branch" }),
  ).toHaveValue("release");
});

test("submodule repositories isolate changes and commit drafts, initialize and accept new modules", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await repository(page, true);
  const selector = page.getByRole("combobox", {
    name: "Source Control repository",
    exact: true,
  });
  await expect(selector).toBeVisible();
  await page
    .getByRole("textbox", { name: "Commit message" })
    .fill("Parent draft");
  await selector.selectOption("packages/shared");
  await expect(selector).toHaveValue("packages/shared");
  const working = page.getByRole("region", {
    name: "Working tree changes",
    exact: true,
  });
  await expect(
    working.getByTitle("packages/shared/lib.rs", { exact: true }),
  ).toBeVisible();
  await expect(working.getByTitle("main.rs", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Commit message" })
    .fill("Module commit");
  await page
    .getByRole("button", { name: "Stage packages/shared/lib.rs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Commit staged changes", exact: true })
    .click();
  await expect(
    page.getByText("Working tree clean", { exact: true }),
  ).toBeVisible();
  await selector.selectOption("");
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("Parent draft");
  await expect(working.getByTitle("main.rs", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Initialize submodule packages/lazy",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open submodule packages/lazy",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Add submodule", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Submodule repository URL" })
    .fill("https://example.com/shared.git");
  await page
    .getByRole("textbox", { name: "Submodule local path" })
    .fill("packages/new");
  await page
    .locator(".scm-submodule-form")
    .getByRole("button", { name: "Add submodule", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open submodule packages/new",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("submodules.png") });
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitCalls,
  );
  expect(calls).toContainEqual({
    command: "git_stage",
    args: expect.objectContaining({
      repository: "packages/shared",
      path: "packages/shared/lib.rs",
    }),
  });
  expect(calls).toContainEqual({
    command: "git_commit",
    args: { repository: "packages/shared", message: "Module commit" },
  });
  expect(
    calls.some(
      (call) =>
        call.command === "git_submodule_action" &&
        call.args.action === "update" &&
        call.args.path === "packages/lazy",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
