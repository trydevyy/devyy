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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
const hostPath = path.resolve("src-tauri/extension-host/host.cjs");
async function fixture(t, workbench) {
  const root = await mkdtemp(path.join(tmpdir(), "devyy-host-"));
  const child = spawn(process.execPath, [hostPath], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      CODEX_HOME: path.join(root, "codex"),
      CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    },
  });
  const pending = new Map(),
    events = [];
  const secrets = new Map();
  let serial = 0;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const value = JSON.parse(line);
    if (value.id) {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    } else {
      events.push(value);
      if (
        value.event === "workbenchRequest" &&
        ["languageClientStart", "languageClientStop"].includes(
          value.payload.method,
        )
      )
        child.stdin.write(
          JSON.stringify({
            id: ++serial,
            method: "workbenchResponse",
            params: { id: value.payload.id, result: true },
          }) + "\n",
        );
      if (
        value.event === "workbenchRequest" &&
        value.payload.method === "languageClientRequest" &&
        workbench
      ) {
        Promise.resolve(workbench(value.payload)).then((result) =>
          child.stdin.write(
            JSON.stringify({
              id: ++serial,
              method: "workbenchResponse",
              params: { id: value.payload.id, result },
            }) + "\n",
          ),
        );
      }
      if (
        value.event === "workbenchRequest" &&
        ["secretGet", "secretStore", "secretDelete"].includes(
          value.payload.method,
        )
      ) {
        const { method, extension, params } = value.payload,
          key = extension + ":" + params.key;
        if (method === "secretStore") secrets.set(key, params.value);
        if (method === "secretDelete") secrets.delete(key);
        child.stdin.write(
          JSON.stringify({
            id: ++serial,
            method: "workbenchResponse",
            params: {
              id: value.payload.id,
              result:
                method === "secretGet" ? (secrets.get(key) ?? null) : null,
            },
          }) + "\n",
        );
      }
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    } else child.kill();
    await rm(root, { recursive: true, force: true });
    assert.equal(stderr, "");
  });
  const request = async (method, params = {}) => {
    const id = ++serial;
    const response = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    const value = await response;
    if (value.error) throw new Error(value.error);
    return value.result;
  };
  const extension = async (name, manifest, source) => {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        publisher: "test",
        name,
        version: "1.0.0",
        main: "extension.cjs",
        ...manifest,
      }),
    );
    await writeFile(path.join(directory, "extension.cjs"), source);
    return { id: "test." + name, installPath: directory };
  };
  return { root, request, events, extension };
}
async function waitForHostEvent(f, predicate, after = 0) {
  for (let i = 0; i < 400; i++) {
    const event = f.events.slice(after).find(predicate);
    if (event) return event.payload;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Expected extension-host event did not arrive");
}
test(
  "live QuickPick preserves identities, events, sessions and changing item lists",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "live-picker",
      { activationEvents: ["onStartupFinished"] },
      `
    const v = require('vscode'); let q, seen = [], first, second, action;
    exports.activate = () => {
      v.commands.registerCommand('pick.open', () => {
        q = v.window.createQuickPick();
        action = { iconPath: new v.ThemeIcon('trash'), tooltip: 'Remove entry' };
        first = { label: 'One', payload: { number: 1 }, buttons: [action] }; second = { label: 'Two' };
        q.title = 'Select repositories'; q.step = 1; q.totalSteps = 2;
        q.canSelectMany = true; q.items = [{ label: 'Recent', kind: v.QuickPickItemKind.Separator }, first, second];
        q.buttons = [v.QuickInputButtons.Back];
        q.onDidChangeValue(value => { seen.push(['value', value]); q.placeholder = 'Search ' + value; });
        q.onDidChangeActive(items => seen.push(['active', items[0] === second]));
        q.onDidChangeSelection(items => seen.push(['selection', items[0] === first]));
        q.onDidTriggerButton(button => seen.push(['back', button === v.QuickInputButtons.Back]));
        q.onDidTriggerItemButton(e => seen.push(['itemButton', e.item === first, e.button === action]));
        q.onDidAccept(() => { seen.push(['accept', q.selectedItems[0] === first]); q.title = 'Still open'; });
        q.onDidHide(() => seen.push(['hide'])); q.show();
      });
      v.commands.registerCommand('pick.inspect', () => ({ seen, selected: q.selectedItems.map(i => i.label), active: q.activeItems.map(i => i.label), value: q.value }));
      v.commands.registerCommand('pick.replace', () => { q.items = [second]; });
      v.commands.registerCommand('pick.lock', () => { q.enabled = false; });
      v.commands.registerCommand('pick.show', () => { q.enabled = true; q.show(); });
      v.commands.registerCommand('pick.dispose', () => { q.dispose(); q.dispose(); });
    };
  `,
    );
    await f.request("initialize", { storageRoot: f.root, extensions: [ext] });
    await f.request("command", { id: "pick.open" });
    const state = await waitForHostEvent(f, (e) => e.event === "quickInput");
    assert.equal(state.title, "Select repositories");
    assert.equal(state.buttons[0].back, true);
    const send = (kind, extra = {}, snapshot = state) =>
      f.request("quickInputEvent", { ...snapshot, kind, ...extra });
    await send("value", { value: "repo" });
    await send("active", { indices: [2] });
    await send("selection", { indices: [1, 1, 0] });
    await send("button", { index: 0 });
    await send("itemButton", { index: 1, button: 0 });
    await send("accept");
    const inspection = await f.request("command", { id: "pick.inspect" });
    assert.deepEqual(inspection.selected, ["One"]);
    assert.equal(inspection.value, "repo");
    for (const expected of [
      ["value", "repo"],
      ["active", true],
      ["selection", true],
      ["back", true],
      ["itemButton", true, true],
      ["accept", true],
    ])
      assert.ok(
        inspection.seen.some(
          (event) => JSON.stringify(event) === JSON.stringify(expected),
        ),
        JSON.stringify(expected),
      );
    assert.ok(!f.events.some((e) => e.event === "quickInputHidden"));
    let after = f.events.length;
    await f.request("command", { id: "pick.replace" });
    const replaced = await waitForHostEvent(
      f,
      (e) => e.event === "quickInput",
      after,
    );
    assert.deepEqual(replaced.selectedItems, []);
    assert.deepEqual(replaced.activeItems, [0]);
    assert.equal(
      await send("selection", { indices: [1] }),
      false,
      "old item indexes are rejected",
    );
    assert.equal(await send("accept"), false);
    await f.request("command", { id: "pick.lock" });
    assert.equal(await send("accept", {}, replaced), false);
    assert.equal(await send("value", { value: "ignored" }, replaced), false);
    await send("hide", {}, replaced);
    after = f.events.length;
    await f.request("command", { id: "pick.show" });
    const reopened = await waitForHostEvent(
      f,
      (e) => e.event === "quickInput",
      after,
    );
    assert.ok(reopened.session > state.session);
    assert.equal(
      await send("hide"),
      false,
      "old session cannot dismiss a reopened input",
    );
    await f.request("command", { id: "pick.dispose" });
    assert.equal(await send("accept", {}, reopened), false);
    const final = await f.request("command", { id: "pick.inspect" });
    assert.equal(final.seen.filter((e) => e[0] === "hide").length, 2);
  },
);
test(
  "InputBox objects support validation, Back, replacement and one-time disposal",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "live-input",
      { activationEvents: ["onStartupFinished"] },
      `
    const v = require('vscode'); let input, seen = [];
    exports.activate = () => {
      v.commands.registerCommand('input.open', () => {
        input = v.window.createInputBox(); input.title = 'Access token'; input.password = true; input.value = 'initial'; input.valueSelection = [1, 4];
        input.buttons = [v.QuickInputButtons.Back];
        input.validationMessage = { message: 'Invalid token', severity: v.InputBoxValidationSeverity.Error };
        input.onDidChangeValue(value => seen.push(value));
        input.onDidAccept(() => seen.push('accepted:' + input.value));
        input.onDidHide(() => seen.push('hidden'));
        input.onDidTriggerButton(button => { if (button === v.QuickInputButtons.Back) input.hide(); });
        input.show();
      });
      v.commands.registerCommand('input.warning', () => { input.validationMessage = { message: 'Check token', severity: v.InputBoxValidationSeverity.Warning }; });
      v.commands.registerCommand('input.assign', () => { input.value = 'assigned'; });
      v.commands.registerCommand('input.replace', () => { const q = v.window.createQuickPick(); q.title = 'Next step'; q.show(); });
      v.commands.registerCommand('input.inspect', () => seen);
    };
  `,
    );
    await f.request("initialize", { storageRoot: f.root, extensions: [ext] });
    await f.request("command", { id: "input.open" });
    const state = await waitForHostEvent(f, (e) => e.event === "quickInput");
    assert.equal(state.password, true);
    assert.deepEqual(state.valueSelection, [1, 4]);
    assert.equal(
      await f.request("quickInputEvent", { ...state, kind: "accept" }),
      false,
    );
    await f.request("command", { id: "input.warning" });
    await f.request("quickInputEvent", {
      ...state,
      kind: "value",
      value: "new",
    });
    await f.request("quickInputEvent", { ...state, kind: "accept" });
    const after = f.events.length;
    await f.request("command", { id: "input.assign" });
    const assigned = await waitForHostEvent(
      f,
      (e) => e.event === "quickInput",
      after,
    );
    assert.equal(
      await f.request("quickInputEvent", {
        ...state,
        kind: "value",
        value: "stale",
      }),
      false,
    );
    assert.equal(assigned.value, "assigned");
    await f.request("command", { id: "input.replace" });
    assert.deepEqual(await f.request("command", { id: "input.inspect" }), [
      "new",
      "accepted:new",
      "assigned",
      "hidden",
    ]);
    assert.equal(
      await f.request("quickInputEvent", {
        ...assigned,
        kind: "button",
        index: 0,
      }),
      false,
    );
  },
);
test(
  "convenience prompts preserve results and validate in place without stale async errors",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "prompt-validation",
      { activationEvents: ["onStartupFinished"] },
      `
    const v = require('vscode'); let release, cancel, seen = [];
    exports.activate = () => {
      v.commands.registerCommand('prompt.input', () => v.window.showInputBox({ title: 'Project name', value: 'initial', validateInput: value => value === 'slow' ? new Promise(resolve => release = () => resolve('Old error')) : value === 'bad' ? 'Choose another name' : { message: 'Available', severity: v.InputBoxValidationSeverity.Info } }));
      v.commands.registerCommand('prompt.release', () => release());
      v.commands.registerCommand('prompt.pick', async () => { const a = { label: 'One', picked: true }, b = { label: 'Two' }; const result = await v.window.showQuickPick(Promise.resolve([a, b]), { canPickMany: true, onDidSelectItem: item => seen.push(item === b) }); return { identity: result?.[0] === a, seen }; });
      v.commands.registerCommand('prompt.pending', () => { cancel = new v.CancellationTokenSource(); return v.window.showQuickPick(new Promise(() => {}), {}, cancel.token).then(value => value === undefined); });
      v.commands.registerCommand('prompt.cancel', () => cancel.cancel());
      v.commands.registerCommand('prompt.failure', () => v.window.showQuickPick(Promise.reject(Error('Cannot load choices'))));
      v.commands.registerCommand('prompt.validationFailure', () => v.window.showInputBox({ validateInput: () => Promise.reject(Error('Cannot validate')) }));
    };
  `,
    );
    await f.request("initialize", { storageRoot: f.root, extensions: [ext] });
    const job = f.request("command", { id: "prompt.input" });
    const state = await waitForHostEvent(
      f,
      (e) =>
        e.event === "quickInput" &&
        e.payload.title === "Project name" &&
        !e.payload.busy,
    );
    let after = f.events.length;
    await f.request("quickInputEvent", {
      ...state,
      kind: "value",
      value: "bad",
    });
    await waitForHostEvent(
      f,
      (e) =>
        e.event === "quickInput" &&
        e.payload.validationMessage === "Choose another name",
      after,
    );
    assert.equal(
      await f.request("quickInputEvent", { ...state, kind: "accept" }),
      false,
    );
    await f.request("quickInputEvent", {
      ...state,
      kind: "value",
      value: "slow",
    });
    after = f.events.length;
    await f.request("quickInputEvent", {
      ...state,
      kind: "value",
      value: "good",
    });
    await waitForHostEvent(
      f,
      (e) =>
        e.event === "quickInput" &&
        e.payload.value === "good" &&
        !e.payload.busy,
      after,
    );
    await f.request("command", { id: "prompt.release" });
    assert.ok(
      !f.events.some(
        (e) =>
          e.event === "quickInput" &&
          e.payload.validationMessage === "Old error",
      ),
    );
    await f.request("quickInputEvent", { ...state, kind: "accept" });
    assert.equal(await job, "good");
    after = f.events.length;
    const pick = f.request("command", { id: "prompt.pick" });
    const picker = await waitForHostEvent(
      f,
      (e) =>
        e.event === "quickInput" &&
        e.payload.kind === "pick" &&
        !e.payload.busy,
      after,
    );
    await f.request("quickInputEvent", {
      ...picker,
      kind: "active",
      indices: [1],
    });
    await f.request("quickInputEvent", { ...picker, kind: "accept" });
    assert.deepEqual(await pick, { identity: true, seen: [false, true] });
    after = f.events.length;
    const pending = f.request("command", { id: "prompt.pending" });
    const loading = await waitForHostEvent(
      f,
      (e) => e.event === "quickInput" && e.payload.busy,
      after,
    );
    await f.request("command", { id: "prompt.cancel" });
    assert.equal(
      await pending,
      true,
      "cancellation does not wait for promised items",
    );
    assert.ok(
      f.events.some(
        (e) => e.event === "quickInputHidden" && e.payload.id === loading.id,
      ),
    );
    await assert.rejects(
      f.request("command", { id: "prompt.failure" }),
      /Cannot load choices/,
    );
    await assert.rejects(
      f.request("command", { id: "prompt.validationFailure" }),
      /Cannot validate/,
    );
  },
);
test(
  "extension progress reports, cancellation closes pending prompts, and cleanup preserves results and errors",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "progress",
      { activationEvents: ["onStartupFinished"] },
      `
    const v = require('vscode'); let release;
    exports.activate = () => {
      v.commands.registerCommand('progress.cancel', () => v.window.withProgress({ title: 'Index project', location: v.ProgressLocation.Notification, cancellable: true }, async (progress, token) => {
        let count = 0; token.onCancellationRequested(() => count++);
        progress.report({ message: 'Reading files', increment: 25 });
        const value = await v.window.showInputBox({ title: 'Index options' }, token);
        return { cancelled: token.isCancellationRequested, dismissed: value === undefined, count };
      }));
      v.commands.registerCommand('progress.fixed', () => v.window.withProgress({ title: 'Window task', location: v.ProgressLocation.Window, cancellable: true }, () => new Promise(resolve => release = resolve)));
      v.commands.registerCommand('progress.release', () => release('complete'));
      v.commands.registerCommand('progress.error', () => v.window.withProgress({ title: 'Fails', location: v.ProgressLocation.Notification }, () => { throw Error('task failed'); }));
      v.commands.registerCommand('progress.tokens', () => { const parent = new v.CancellationTokenSource(); const child = new v.CancellationTokenSource(parent.token); let count = 0; child.token.onCancellationRequested(() => count++); parent.cancel(); parent.cancel(); child.dispose(true); parent.dispose(); return { count, cancelled: child.token.isCancellationRequested }; });
    };
  `,
    );
    await f.request("initialize", { storageRoot: f.root, extensions: [ext] });
    const waitFor = async (predicate) => {
      for (let i = 0; i < 200; i++) {
        const event = f.events.find(predicate);
        if (event) return event.payload;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error("No expected progress event");
    };
    const job = f.request("command", { id: "progress.cancel" });
    const task = await waitFor((event) => event.event === "progressStart");
    const prompt = await waitFor(
      (event) => event.event === "quickInput" && event.payload.kind === "input",
    );
    assert.equal(task.cancellable, true);
    assert.equal(await f.request("cancelProgress", { id: task.id }), true);
    assert.deepEqual(await job, { cancelled: true, dismissed: true, count: 1 });
    assert.ok(
      f.events.some(
        (event) =>
          event.event === "quickInputHidden" && event.payload.id === prompt.id,
      ),
    );
    assert.ok(
      f.events.some(
        (event) =>
          event.event === "progressReport" && event.payload.increment === 25,
      ),
    );
    assert.ok(
      f.events.some(
        (event) =>
          event.event === "progressEnd" && event.payload.id === task.id,
      ),
    );
    assert.equal(await f.request("cancelProgress", { id: task.id }), false);
    await f.request("workbenchResponse", {
      id: prompt.id,
      result: "late response",
    });
    const fixed = f.request("command", { id: "progress.fixed" });
    const windowTask = await waitFor(
      (event) =>
        event.event === "progressStart" &&
        event.payload.title === "Window task",
    );
    assert.equal(windowTask.cancellable, false);
    assert.equal(
      await f.request("cancelProgress", { id: windowTask.id }),
      false,
    );
    await f.request("command", { id: "progress.release" });
    assert.equal(await fixed, "complete");
    await assert.rejects(
      f.request("command", { id: "progress.error" }),
      /task failed/,
    );
    const failure = f.events.find(
      (event) =>
        event.event === "progressStart" && event.payload.title === "Fails",
    );
    assert.ok(
      f.events.some(
        (event) =>
          event.event === "progressEnd" &&
          event.payload.id === failure.payload.id,
      ),
    );
    assert.deepEqual(await f.request("command", { id: "progress.tokens" }), {
      count: 1,
      cancelled: true,
    });
  },
);
test(
  "workspaceContains activates matching projects once and isolates failures",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      project = path.join(f.root, "project");
    await mkdir(path.join(project, "packages", "core"), { recursive: true });
    await mkdir(path.join(project, "node_modules", "local"), {
      recursive: true,
    });
    await writeFile(path.join(project, "package.json"), "{}");
    await writeFile(path.join(project, "packages", "core", "build.gradle"), "");
    await writeFile(path.join(project, "packages", "core", "Readme.md"), "");
    await writeFile(
      path.join(project, "packages", "core", "project,notes.txt"),
      "",
    );
    await writeFile(
      path.join(project, "node_modules", "local", "tool.config"),
      "",
    );
    const source = `const v = require('vscode'); let count = 0; exports.activate = () => { count++; v.commands.registerCommand('project.count', () => count); };`;
    const exact = await f.extension(
      "exact-project",
      {
        activationEvents: [
          "workspaceContains:package.json",
          "workspaceContains:**/package.json",
        ],
      },
      source,
    );
    const nested = await f.extension(
      "nested-project",
      { activationEvents: ["workspaceContains:**/{pom.xml,build.gradle}"] },
      "exports.activate = () => {};",
    );
    const chars = await f.extension(
      "class-project",
      { activationEvents: ["workspaceContains:**/[Rr]eadme.md"] },
      "exports.activate = () => {};",
    );
    const comma = await f.extension(
      "comma-project",
      { activationEvents: ["workspaceContains:**/project,notes.txt"] },
      "exports.activate = () => {};",
    );
    const ignored = await f.extension(
      "ignored-project",
      { activationEvents: ["workspaceContains:**/tool.config"] },
      "exports.activate = () => {};",
    );
    const absent = await f.extension(
      "absent-project",
      { activationEvents: ["workspaceContains:**/missing.toml"] },
      "exports.activate = () => { throw new Error('must stay idle'); };",
    );
    const broken = await f.extension(
      "broken-project",
      { activationEvents: ["workspaceContains:package.json"] },
      "exports.activate = () => { throw new Error('project activation failed'); };",
    );
    const state = await f.request("initialize", {
      workspaceRoot: project,
      storageRoot: f.root,
      extensions: [exact, nested, chars, comma, ignored, absent, broken],
    });
    for (const ext of [exact, nested, chars, comma, ignored])
      assert.equal(state.find((entry) => entry.id === ext.id).status, "active");
    assert.equal(state.find((entry) => entry.id === absent.id).status, "idle");
    assert.match(
      state.find((entry) => entry.id === broken.id).error,
      /project activation failed/,
    );
    assert.equal(await f.request("command", { id: "project.count" }), 1);
  },
);
test(
  "workspaceContains stays idle without a folder and rejects escaping paths",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      project = path.join(f.root, "project");
    await mkdir(project);
    await writeFile(path.join(f.root, "outside.json"), "{}");
    if (process.platform !== "win32")
      await symlink(
        path.join(f.root, "outside.json"),
        path.join(project, "linked.json"),
      );
    const ext = await f.extension(
      "escaping-project",
      {
        activationEvents: [
          "workspaceContains:../outside.json",
          "workspaceContains:linked.json",
          "workspaceContains:/outside.json",
        ],
      },
      "exports.activate = () => { throw new Error('must stay idle'); };",
    );
    const noFolder = await f.request("initialize", {
      storageRoot: f.root,
      extensions: [ext],
    });
    assert.equal(noFolder[0].status, "idle");
    const state = await f.request("initialize", {
      workspaceRoot: project,
      storageRoot: f.root,
      extensions: [ext],
    });
    assert.equal(state[0].status, "idle");
    assert.ok(
      f.events.some(
        (event) =>
          event.event === "output" &&
          event.payload.text.includes("Invalid workspaceContains pattern"),
      ),
    );
  },
);
test(
  "real host activates on demand, registers LSP, expands trees, routes commands, isolates API failures and supports webview messages",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "sample",
      {
        contributes: {
          languages: [{ id: "sample" }],
          commands: [{ command: "sample.open", title: "Open sample" }],
          views: { sample: [{ id: "sample.tree", name: "Sample tree" }] },
        },
      },
      `
    const vscode = require('vscode');
    const devyy = require('devyy');
    const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
    exports.activate = async context => {
      console.log('extension logging preserves protocol');
      const client = new LanguageClient('sample', 'Sample', { module: context.asAbsolutePath('server.cjs'), transport: TransportKind.stdio }, { documentSelector: [{ language: 'sample' }], initializationOptions: { fixture: true } });
      client.start();
      vscode.window.registerTreeDataProvider('sample.tree', { getChildren: parent => parent ? [{ label: 'Child' }] : [{ label: 'Root', collapsibleState: 1 }], getTreeItem: element => ({ ...element, command: { command: 'sample.open', title: 'Open', arguments: [element.label] } }) });
      vscode.commands.registerCommand('sample.open', value => {
        const panel = vscode.window.createWebviewPanel('sample.panel', 'Sample panel', 1, { enableScripts: true });
        panel.webview.onDidReceiveMessage(message => panel.webview.postMessage({ received: message }));
        panel.webview.html = '<h1>' + (value || 'Sample') + '</h1>';
      });
      devyy.ui.registerView('sample.native', { title: 'Native view', body: [{ type: 'text', text: 'Uses Devyy controls' }] });
      await context.globalState.update('active', true);
    };`,
    );
    const broken = await f.extension(
      "broken",
      {
        contributes: { commands: [{ command: "broken.go", title: "Broken" }] },
      },
      `const vscode = require('vscode'); exports.activate = () => vscode.commands.executeCommand("devyy.unsupported.fixture");`,
    );
    let status = await f.request("initialize", {
      extensions: [ext, broken],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });
    assert.ok(status.every((s) => s.status === "idle"));
    await f.request("activateLanguage", { language: "sample" });
    const server = f.events.find((e) => e.event === "languageServer").payload;
    assert.equal(server.language, "sample");
    assert.equal(server.command, process.execPath);
    assert.ok(server.args[0].endsWith("server.cjs"));
    assert.equal(server.initializationOptions.fixture, true);
    const roots = await f.request("tree", { id: "sample.tree" });
    assert.equal(roots[0].label, "Root");
    const children = await f.request("tree", {
      id: "sample.tree",
      parent: roots[0].key,
    });
    assert.equal(children[0].label, "Child");
    await f.request("treeCommand", { id: "sample.tree", key: children[0].key });
    const view = f.events.find((e) => e.event === "webview").payload;
    assert.equal(view.title, "Sample panel");
    assert.equal(view.html, "<h1>Child</h1>");
    await f.request("webviewMessage", { id: view.id, message: "hello" });
    assert.equal(
      f.events.find((e) => e.event === "webviewMessage").payload.message
        .received,
      "hello",
    );
    assert.ok(
      f.events.some(
        (e) => e.event === "nativeView" && e.payload.title === "Native view",
      ),
    );
    await assert.rejects(
      f.request("command", { id: "broken.go" }),
      /No extension registered command/,
    );
    status = await f.request("status");
    assert.equal(status.find((s) => s.id === broken.id).status, "error");
    assert.equal(status.find((s) => s.id === ext.id).status, "active");
    await f.request("command", { id: "sample.open" });
    await f.request("closeWebview", { id: view.id });
    assert.ok(
      f.events.some(
        (e) => e.event === "webviewClosed" && e.payload.id === view.id,
      ),
    );
    await f.request("shutdown");
  },
);
test(
  "dependencies activate first, cycles fail and package resources cannot escape",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const dependency = await f.extension(
      "dependency",
      {},
      `exports.activate = () => ({ ready: true });`,
    );
    const main = await f.extension(
      "main",
      {
        activationEvents: ["onStartupFinished"],
        extensionDependencies: ["test.dependency"],
      },
      `const v = require('vscode'); exports.activate = context => { if (!v.extensions.getExtension('test.dependency').exports.ready) throw Error('Dependency not ready'); const panel=v.window.createWebviewPanel('test','Test',1,{}); let rejected=false; try { panel.webview.asWebviewUri(v.Uri.file(context.extensionPath + '/../dependency/package.json')); } catch { rejected=true; } if(!rejected)throw Error('Escaping resource was accepted'); };`,
    );
    const a = await f.extension(
      "a",
      {
        activationEvents: ["onStartupFinished"],
        extensionDependencies: ["test.b"],
      },
      "exports.activate=()=>{};",
    );
    const b = await f.extension(
      "b",
      { extensionDependencies: ["test.a"] },
      "exports.activate=()=>{};",
    );
    const status = await f.request("initialize", {
      extensions: [dependency, main, a, b],
      storageRoot: path.join(f.root, "state"),
    });
    assert.equal(status.find((s) => s.id === main.id).status, "active");
    assert.match(
      status.find((s) => s.id === a.id).error,
      /Circular extension dependency/,
    );
  },
);

test(
  "workbench requests remain interactive and documents, configuration, providers, URI handlers and resource URLs have real behavior",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "workbench",
      {
        activationEvents: ["onStartupFinished"],
        contributes: {
          configuration: {
            properties: {
              "fixture.enabled": { type: "boolean", default: true },
            },
          },
        },
      },
      `
    const v=require('vscode');let panel,seen=[];
    exports.activate=context=>{
      context.environmentVariableCollection.prepend('PATH','/fixture:');
      v.window.onDidChangeTextEditorSelection(e=>seen.push(e.selections[0].active.character));
      v.workspace.onDidChangeTextDocument(e=>seen.push(e.document.getText()));
      v.window.registerUriHandler({handleUri:uri=>seen.push(uri.query)});
      v.languages.registerHoverProvider('javascript',{provideHover:doc=>new v.Hover(doc.getText())});
      v.commands.registerCommand('fixture.inspect',()=>{panel=v.window.createWebviewPanel('fixture','Fixture',1,{enableScripts:true,localResourceRoots:[context.extensionUri]});const dir=panel.webview.asWebviewUri(v.Uri.joinPath(context.extensionUri,'assets'));const file=panel.webview.asWebviewUri(v.Uri.joinPath(context.extensionUri,'assets','entry.js'));panel.webview.html='<div>'+dir.toString()+'|'+file.toString()+'</div>';});
      v.commands.registerCommand('fixture.pick',async()=>{const choice=await v.window.showQuickPick([{label:'One'},{label:'Two'}]);panel.webview.postMessage(choice);});
      v.commands.registerCommand('fixture.check',async()=>{const d=await v.workspace.openTextDocument(v.Uri.file(context.asAbsolutePath('source.js')));await v.workspace.getConfiguration('fixture').update('enabled',false);panel.webview.postMessage({text:d.getText(),line:d.lineAt(1).text,offset:d.offsetAt(new v.Position(1,2)),position:d.positionAt(5),enabled:v.workspace.getConfiguration('fixture').enabled,seen});});
    };
  `,
    );
    await mkdir(path.join(ext.installPath, "assets"));
    await writeFile(
      path.join(ext.installPath, "assets/entry.js"),
      "export default 1",
    );
    await writeFile(
      path.join(ext.installPath, "source.js"),
      "let x=1;\nhello\n",
    );
    const status = await f.request("initialize", {
      extensions: [ext],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });
    assert.equal(status[0].status, "active");
    assert.equal(
      (await f.request("readConfiguration"))["fixture.enabled"],
      true,
    );
    await f.request("updateConfiguration", {
      key: "fixture.enabled",
      value: false,
    });
    assert.equal(
      (await f.request("readConfiguration"))["fixture.enabled"],
      false,
    );
    await f.request("updateConfiguration", {
      key: "fixture.enabled",
      reset: true,
    });
    assert.equal(
      (await f.request("readConfiguration"))["fixture.enabled"],
      true,
    );
    await assert.rejects(
      f.request("updateConfiguration", {
        key: "unregistered.setting",
        value: true,
      }),
      /Unknown extension setting/,
    );
    await f.request("command", { id: "fixture.inspect" });
    const view = f.events.find((e) => e.event === "webview").payload;
    assert.match(
      view.html,
      process.platform === "win32"
        ? /http:\/\/devyy-extension\.localhost\/resource\/[\w-]+\/0\/assets\|/
        : /devyy-extension:\/\/localhost\/resource\/[\w-]+\/0\/assets\|/,
    );
    assert.match(view.html, /\/assets\/entry.js/);
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "webviewResources" &&
          e.payload.roots[0] === ext.installPath,
      ),
    );
    const pick = f.request("command", { id: "fixture.pick" });
    const waitForEvent = async (type) => {
      for (let i = 0; i < 200; i++) {
        const e = f.events.find((e) => e.event === type);
        if (e) return e;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error("No " + type);
    };
    const prompt = (await waitForEvent("quickInput")).payload;
    assert.equal(prompt.kind, "pick");
    await f.request("quickInputEvent", {
      ...prompt,
      kind: "selection",
      indices: [1],
    });
    await f.request("quickInputEvent", { ...prompt, kind: "accept" });
    await pick;
    assert.equal(
      f.events.filter((e) => e.event === "webviewMessage").at(-1).payload
        .message.label,
      "Two",
    );
    const uri = new URL("file://" + path.join(ext.installPath, "source.js"))
      .href;
    await f.request("editorState", {
      documents: [
        {
          uri,
          text: "unsaved\nhello\n",
          languageId: "javascript",
          isDirty: true,
        },
      ],
      activeUri: uri,
      selections: [
        {
          anchor: { line: 0, character: 0 },
          active: { line: 0, character: 3 },
        },
      ],
    });
    await f.request("editorState", {
      documents: [
        {
          uri,
          text: "edited\nhello\n",
          languageId: "javascript",
          isDirty: true,
        },
      ],
      activeUri: uri,
    });
    const hover = await f.request("languageFeature", {
      method: "provideHover",
      uri,
      position: { line: 0, character: 0 },
    });
    assert.equal(hover[0].contents, "edited\nhello\n");
    await f.request("handleUri", {
      uri: "devyy://test.workbench/callback?code=fixture",
    });
    await f.request("command", { id: "fixture.check" });
    const result = f.events.filter((e) => e.event === "webviewMessage").at(-1)
      .payload.message;
    assert.equal(result.text, "edited\nhello\n");
    assert.equal(result.enabled, false);
    assert.equal(result.line, "hello");
    assert.equal(result.offset, 9);
    assert.deepEqual(result.seen, [3, "edited\nhello\n", "code=fixture"]);
  },
);

for (const [name, key] of [
  ["Codex", "DEVYY_CODEX_EXTENSION"],
  ["Claude", "DEVYY_CLAUDE_EXTENSION"],
])
  test(
    `real ${name} bundle activates and resolves its webview`,
    { skip: !process.env[key], timeout: 20000 },
    async (t) => {
      const f = await fixture(t);
      const installPath = process.env[key];
      const fs = await import("node:fs/promises");
      const m = JSON.parse(
        await fs.readFile(path.join(installPath, "package.json"), "utf8"),
      );
      const id = m.publisher + "." + m.name;
      const status = await f.request("initialize", {
        extensions: [{ id, installPath }],
        workspaceRoot: f.root,
        storageRoot: path.join(f.root, "state"),
      });
      assert.equal(status[0].status, "active", status[0].error);
      const view = Object.values(m.contributes.views)
        .flat()
        .find((v) => v.type === "webview");
      await f.request("resolveView", { id: view.id });
      const html = f.events.filter((e) => e.event === "webview").at(-1)
        ?.payload.html;
      assert.ok(html?.length > 100);
      assert.match(html, /devyy-extension:\/\/localhost\/resource\//);
    },
  );

test(
  "real bundled language client activates and registers its providers",
  { skip: !process.env.DEVYY_LEX_EXTENSION, timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    const installPath = process.env.DEVYY_LEX_EXTENSION;
    await f.request("initialize", {
      extensions: [{ id: "lex.lex-vscode", installPath }],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });
    const status = await f.request("activateLanguage", { language: "lex" });
    assert.equal(status[0].status, "active", status[0].error);
    assert.ok(f.events.some((e) => e.event === "languageProvider"));
  },
);

test(
  "VS Code provider commands and workbench command replies have real behavior",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "command-api",
      { activationEvents: ["onStartupFinished"] },
      `
    const v=require('vscode');
    exports.activate=context=>{
      v.languages.registerHoverProvider('javascript',{provideHover:doc=>new v.Hover(doc.getText())});
      v.languages.registerCompletionItemProvider('javascript',{provideCompletionItems:()=>[new v.CompletionItem('fixtureCompletion')]});
      const old=v.commands.registerCommand('fixture.replaced',()=>{throw Error('Old command');});
      v.commands.registerCommand('fixture.replaced',()=>42);old.dispose();
      v.commands.registerCommand('fixture.providers',async()=>{
        const uri=v.Uri.file(context.asAbsolutePath('file.js'));
        const hover=await v.commands.executeCommand('vscode.executeHoverProvider',uri,new v.Position(0,1));
        const completion=await v.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new v.Position(0,1));
        if(hover.length!==1||completion.items[0].label!=='fixtureCompletion')throw Error('Providers were not executed');
        if(await v.commands.executeCommand('fixture.replaced')!==42)throw Error('Replacement disposed');
        if(!(await v.commands.getCommands(true)).includes('workbench.action.quickOpen'))throw Error('Missing built-ins');
      });
      v.commands.registerCommand('fixture.workbench',()=>v.commands.executeCommand('workbench.action.quickOpen'));
    };`,
    );
    await writeFile(path.join(ext.installPath, "file.js"), "let value=1;\n");
    await f.request("initialize", {
      extensions: [ext],
      storageRoot: path.join(f.root, "state"),
    });
    await f.request("command", { id: "fixture.providers" });
    const work = f.request("command", { id: "fixture.workbench" });
    let event;
    for (let i = 0; i < 200 && !event; i++) {
      event = f.events.find(
        (item) =>
          item.event === "workbenchRequest" &&
          item.payload.method === "executeBuiltin",
      );
      if (!event) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(event?.payload.params.command, "files");
    await f.request("workbenchResponse", { id: event.payload.id });
    await work;
  },
);

test(
  "custom filesystems, content updates, CRLF positions and hidden tab inventory match document APIs",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "documents",
      { activationEvents: ["onStartupFinished"] },
      `
    const v=require('vscode');let emitter=new v.EventEmitter(),text='first',held;
    exports.activate=context=>{
      v.workspace.registerFileSystemProvider('memory',{
        readFile:()=>Buffer.from('a\\r\\nb\\nend'),
        writeFile:(uri,data,options)=>{if(!options.create||!options.overwrite)throw Error('Missing write options');},
      });
      v.workspace.registerFileSystemProvider('readonly',{readFile:()=>Buffer.from('read only'),writeFile:()=>{throw Error('Must not write')}},{isReadonly:true});
      const old=v.workspace.registerTextDocumentContentProvider('live',{provideTextDocumentContent:()=> 'old'});
      v.workspace.registerTextDocumentContentProvider('live',{onDidChange:emitter.event,provideTextDocumentContent:async uri=>text});old.dispose();
      v.commands.registerCommand('documents.check',async()=>{
        const doc=await v.workspace.openTextDocument(v.Uri.parse('memory:/code.ts'));
        if(doc.positionAt(2).line!==0||doc.positionAt(2).character!==1||doc.positionAt(3).line!==1||doc.offsetAt(new v.Position(100,0))!==doc.getText().length)throw Error('CRLF positions are incorrect');
        if(v.workspace.fs.isWritableFileSystem('memory')!==true||v.workspace.fs.isWritableFileSystem('readonly')!==false)throw Error('Writability must be synchronous');
        await v.workspace.fs.writeFile(doc.uri,Buffer.from('value'));
        let refused=false;try{await v.workspace.fs.writeFile(v.Uri.parse('readonly:/a'),Buffer.from('x'));}catch(error){refused=error.code==='NoPermissions';}if(!refused)throw Error('Read-only provider was written or error code was wrong');
        refused=false;try{await v.workspace.openTextDocument(v.Uri.parse('unknown:'+context.asAbsolutePath('exists.txt')));}catch(error){refused=error.code==='Unavailable';}if(!refused)throw Error('Unknown URI used local filesystem');
        refused=false;try{await v.workspace.fs.readFile(v.Uri.file(context.asAbsolutePath('missing-file.txt')));}catch(error){refused=error.code==='FileNotFound';}if(!refused)throw Error('Local filesystem error was not translated');
        const live=await v.workspace.openTextDocument(v.Uri.parse('live:/overview.md'));if(live.getText()!=='first')throw Error('Replacement provider disposed by old registration');
      });
      v.commands.registerCommand('documents.change',()=>{text='latest';emitter.fire(v.Uri.parse('live:/overview.md'));});
      v.commands.registerCommand('documents.tabs',()=>{
        if(v.window.visibleTextEditors.length!==2||v.window.tabGroups.all[0].tabs.length!==3)throw Error('Incorrect visible editors/open tabs');
        if(v.window.activeTextEditor.viewColumn!==2)throw Error('Missing view column');
        if(held&&held!==v.window.activeTextEditor)throw Error('Editor identity changed');held=v.window.activeTextEditor;
      });
      v.commands.registerCommand('documents.select',()=>{held.selection=new v.Selection(0,0,0,1);});
    };
  `,
    );
    await writeFile(
      path.join(ext.installPath, "exists.txt"),
      "Must not read through unknown scheme",
    );
    await f.request("initialize", {
      extensions: [ext],
      storageRoot: path.join(f.root, "state"),
    });
    await f.request("command", { id: "documents.check" });
    assert.equal(
      (await f.request("readDocument", { uri: "live:/overview.md" })).readOnly,
      true,
    );
    await f.request("command", { id: "documents.change" });
    for (
      let i = 0;
      i < 200 && !f.events.some((event) => event.event === "documentContent");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      f.events.find((event) => event.event === "documentContent").payload.text,
      "latest",
    );
    const documents = [
      { uri: "memory:/one.ts", text: "one", visible: true, viewColumn: 1 },
      { uri: "memory:/two.ts", text: "two", visible: true, viewColumn: 2 },
      { uri: "memory:/three.ts", text: "three", visible: false },
    ];
    await f.request("editorState", { documents, activeUri: "memory:/two.ts" });
    await f.request("command", { id: "documents.tabs" });
    await f.request("editorState", { documents, activeUri: "memory:/two.ts" });
    await f.request("command", { id: "documents.tabs" });
    await f.request("command", { id: "documents.select" });
    const selection = f.events.find(
      (event) =>
        event.event === "workbenchRequest" &&
        event.payload.method === "setSelections",
    ).payload;
    assert.equal(selection.params.selections[0].active.character, 1);
    await f.request("workbenchResponse", { id: selection.id, result: true });
  },
);

test(
  "extension pseudoterminals open once, stream input/output and close with correct lifetime",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "pseudo",
      { activationEvents: ["onStartupFinished"] },
      `
    const v=require('vscode');let terminal,other,writer=new v.EventEmitter(),closed=new v.EventEmitter(),names=new v.EventEmitter(),opens=0,closes=0,closeEvents=0,dimensions;
    exports.activate=()=>{
      v.window.onDidCloseTerminal(()=>closeEvents++);
      terminal=v.window.createTerminal({name:'Pseudo',pty:{onDidWrite:writer.event,onDidClose:closed.event,onDidChangeName:names.event,open:size=>{opens++;dimensions=size;writer.fire('hello\\r\\n');},handleInput:async text=>{writer.fire('echo:'+text);},setDimensions:size=>{dimensions=size;},close:()=>{closes++;closed.fire(0);}}});
      writer.fire('early\\r\\n');terminal.sendText('queued',false);names.fire('Custom console');
      other=v.window.createTerminal({name:'Other'});terminal.show();other.show();if(v.window.activeTerminal!==other)throw Error('Wrong active terminal');terminal.show();if(v.window.activeTerminal!==terminal)throw Error('Cannot change active terminal');
      v.commands.registerCommand('pseudo.check',async()=>{if(opens!==1||dimensions.columns!==100||await terminal.processId!==undefined)throw Error('Incorrect pseudoterminal open/size/process');});
      v.commands.registerCommand('pseudo.closed',()=>{if(closes!==1||closeEvents!==1||terminal.exitStatus.code!==0||terminal.exitStatus.reason!==3)throw Error('Pseudoterminal disposed more than once');other.dispose();if(v.window.terminals.length!==0||v.window.activeTerminal)throw Error('Closed terminals remain active');});
    };
  `,
    );
    await f.request("initialize", {
      extensions: [ext],
      storageRoot: path.join(f.root, "state"),
    });
    const created = f.events.find(
      (event) =>
        event.event === "terminalCreate" &&
        event.payload.options.pseudoterminal,
    ).payload;
    assert.equal(created.options.pty, undefined);
    assert.equal(
      f.events.find((event) => event.event === "terminalName").payload.name,
      "Custom console",
    );
    await f.request("pseudoTerminalOpen", {
      id: created.id,
      dimensions: { columns: 80, rows: 24 },
    });
    await f.request("pseudoTerminalOpen", {
      id: created.id,
      dimensions: { columns: 90, rows: 30 },
    });
    await f.request("pseudoTerminalInput", { id: created.id, text: "typed" });
    await f.request("pseudoTerminalResize", {
      id: created.id,
      dimensions: { columns: 100, rows: 32 },
    });
    await f.request("command", { id: "pseudo.check" });
    assert.deepEqual(
      f.events
        .filter((event) => event.event === "pseudoTerminalOutput")
        .map((event) => event.payload.text),
      ["early\r\n", "hello\r\n", "echo:queued", "echo:typed"],
    );
    await f.request("terminalState", {
      id: created.id,
      closed: true,
      exitCode: 0,
      reason: 3,
    });
    await f.request("terminalState", {
      id: created.id,
      closed: true,
      exitCode: 0,
      reason: 3,
    });
    await f.request("command", { id: "pseudo.closed" });
  },
);

test(
  "commands called during activation do not deadlock, return values, and revive URI arguments",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "command-cycle",
      {
        activationEvents: ["*"],
        contributes: {
          commands: [{ command: "cycle.inspect", title: "Inspect" }],
        },
      },
      `
    const v = require('vscode');
    exports.activate = async () => {
      v.commands.registerCommand('cycle.inner', value => value + 1);
      const n = await v.commands.executeCommand('cycle.inner', 3);
      await v.commands.executeCommand('setContext', 'cycle.ready', n === 4);
      v.commands.registerCommand('cycle.inspect', uri => ({ path: uri.fsPath, joined: v.Uri.joinPath(uri, 'child').toString(), isUri: v.Uri.isUri(uri) }));
    };
  `,
    );
    await f.request("initialize", {
      extensions: [ext],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });
    const result = await f.request("command", {
      id: "cycle.inspect",
      args: [{ $mid: 1, scheme: "file", path: f.root }],
    });
    assert.equal(result.path, f.root);
    assert.equal(result.isUri, true);
    assert.ok(result.joined.endsWith("/child"));
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "context" &&
          e.payload.key === "cycle.ready" &&
          e.payload.value === true,
      ),
    );
  },
);

test(
  "extension secret storage awaits native operations and isolates extension namespaces",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.extension(
      "secrets-one",
      { activationEvents: ["*"] },
      `const v=require('vscode');exports.activate=async context=>{const changes=[];context.secrets.onDidChange(e=>changes.push(e.key));await context.secrets.store('token','synthetic-test-secret');const saved=await context.secrets.get('token');await context.secrets.delete('token');await v.commands.executeCommand('setContext','secret.one',{saved,missing:await context.secrets.get('token')===undefined,changes});};`,
    );
    const second = await f.extension(
      "secrets-two",
      { activationEvents: ["*"] },
      `const v=require('vscode');exports.activate=async context=>v.commands.executeCommand('setContext','secret.two',await context.secrets.get('token')===undefined);`,
    );
    await f.request("initialize", {
      extensions: [first, second],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });
    const one = f.events.find(
      (e) => e.event === "context" && e.payload.key === "secret.one",
    ).payload.value;
    assert.equal(one.saved, "synthetic-test-secret");
    assert.equal(one.missing, true);
    assert.deepEqual(one.changes, ["token", "token"]);
    assert.equal(
      f.events.find(
        (e) => e.event === "context" && e.payload.key === "secret.two",
      ).payload.value,
      true,
    );
  },
);
test(
  "output channels support log levels, event listeners, clear, replace, show and multi-arg formatting",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "output-test",
      { activationEvents: ["*"] },
      `const v = require("vscode");
exports.activate = async () => {
  const channel = v.window.createOutputChannel("TestChannel", { log: true });
  channel.append("hello ");
  channel.appendLine("world");
  channel.replace("replaced output");
  channel.clear();
  channel.show(true);

  channel.trace("trace should be ignored");
  channel.debug("debug should be ignored");
  channel.info("info formatted: %s has %d points", "alpha", 100);
  channel.warn("warn text");
  channel.error("error text");

  const changes = [];
  channel.onDidChangeLogLevel(lvl => changes.push(lvl));
  channel.logLevel = v.LogLevel.Trace;
  channel.trace("trace now allowed");

  await v.commands.executeCommand("setContext", "output.done", { changes, logLevel: channel.logLevel });
};`,
    );
    await f.request("initialize", {
      extensions: [ext],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });

    const done = f.events.find(
      (e) => e.event === "context" && e.payload.key === "output.done",
    )?.payload?.value;
    assert.ok(done, "Context output.done should be set");
    assert.deepEqual(done.changes, [1]);
    assert.equal(done.logLevel, 1);

    assert.ok(
      f.events.some(
        (e) =>
          e.event === "outputChannelCreated" &&
          e.payload.name === "TestChannel",
      ),
      "channel created event emitted",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "output" &&
          e.payload.name === "TestChannel" &&
          e.payload.text === "hello ",
      ),
      "append emitted",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "output" &&
          e.payload.name === "TestChannel" &&
          e.payload.text === "world",
      ),
      "appendLine emitted",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "outputReplace" &&
          e.payload.name === "TestChannel" &&
          e.payload.text === "replaced output",
      ),
      "replace emitted",
    );
    assert.ok(
      f.events.some(
        (e) => e.event === "outputClear" && e.payload.name === "TestChannel",
      ),
      "clear emitted",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "outputShow" &&
          e.payload.name === "TestChannel" &&
          e.payload.preserveFocus === true,
      ),
      "show emitted",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "output" &&
          e.payload.text === "info formatted: alpha has 100 points" &&
          e.payload.level === "info",
      ),
      "info formatted emitted",
    );
    assert.ok(
      !f.events.some(
        (e) =>
          e.event === "output" && e.payload.text === "trace should be ignored",
      ),
      "trace was ignored at info level",
    );
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "output" &&
          e.payload.text === "trace now allowed" &&
          e.payload.level === "trace",
      ),
      "trace emitted after log level change",
    );
  },
);
test(
  "VSX extension APIs: debug, tasks, scm, comments, tests, auth, language status, and workspace folder updates",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "vsx-apis-test",
      { activationEvents: ["*"] },
      `const v = require("vscode");
exports.activate = async () => {
  const bp = new v.SourceBreakpoint(new v.Location(v.Uri.file("/app/main.rs"), new v.Position(10, 0)));
  v.debug.addBreakpoints([bp]);
  const debugReg = v.debug.registerDebugConfigurationProvider("lldb", {
    resolveDebugConfiguration: (f, c) => c,
  });
  const adapterReg = v.debug.registerDebugAdapterDescriptorFactory("lldb", {
    createDebugAdapterDescriptor: () => new v.DebugAdapterExecutable("lldb-dap", ["--arg"]),
  });

  const trackerEvents = [];
  const trackerReg = v.debug.registerDebugAdapterTrackerFactory("lldb", {
    createDebugAdapterTracker: () => ({
      onWillStartSession: () => trackerEvents.push("willStart"),
      onWillReceiveMessage: (msg) => trackerEvents.push("recv:" + msg.command),
      onDidSendMessage: (msg) => trackerEvents.push("send:" + msg.command),
      onWillStopSession: () => trackerEvents.push("willStop"),
      onExit: () => trackerEvents.push("exit"),
    }),
  });

  const debugEvents = [];
  v.debug.onDidStartDebugSession(s => debugEvents.push("start:" + s.name));
  v.debug.onDidChangeActiveDebugSession(s => debugEvents.push("active:" + (s ? s.name : "none")));
  v.debug.onDidTerminateDebugSession(s => debugEvents.push("term:" + s.name));
  await v.debug.startDebugging(undefined, { type: "lldb", name: "Test Session" });
  const activeSessionBefore = v.debug.activeDebugSession;
  const protoBp = await activeSessionBefore?.getDebugProtocolBreakpoint(v.debug.breakpoints[0]);
  await activeSessionBefore?.customRequest("evaluate", { expression: "1+1" });
  await v.debug.stopDebugging(activeSessionBefore);
  const activeSessionAfter = v.debug.activeDebugSession;

  const taskReg = v.tasks.registerTaskProvider("cargo", {
    provideTasks: () => [
      new v.Task(
        { type: "cargo", task: "build" },
        v.TaskScope.Workspace,
        "build",
        "cargo",
        new v.ShellExecution("cargo build")
      ),
    ],
  });
  const tasks = await v.tasks.fetchTasks({ type: "cargo" });

  const taskEvents = [];
  v.tasks.onDidStartTask(e => taskEvents.push("startTask"));
  v.tasks.onDidStartTaskProcess(e => taskEvents.push("startProc"));
  v.tasks.onDidEndTaskProcess(e => taskEvents.push("endProc"));
  v.tasks.onDidEndTask(e => taskEvents.push("endTask"));
  const execution = await v.tasks.executeTask(tasks[0]);
  const taskExecsBefore = v.tasks.taskExecutions.length;
  execution.terminate();
  const taskExecsAfter = v.tasks.taskExecutions.length;
  const inCustomExec = v.tasks.inCustomExecution();
  const buildGroup = v.TaskGroup.Build;

  let customPtyCalled = false;
  const customTask = new v.Task(
    { type: "custom" },
    v.TaskScope.Workspace,
    "custom-task",
    "custom",
    new v.CustomExecution(async () => {
      customPtyCalled = true;
      return {
        onDidWrite: new v.EventEmitter().event,
        onDidClose: (fn) => fn(0),
        open: () => {},
        close: () => {},
      };
    })
  );
  const customExec = await v.tasks.executeTask(customTask);
  customExec.terminate();

  const scm = v.scm.createSourceControl("git-test", "Git Test", v.Uri.file("/app"));
  const group = scm.createResourceGroup("staged", "Staged Changes");
  const scmDecorations = new v.SourceControlResourceDecorations({ faded: true, tooltip: "Ignored" });
  const scmInputChanges = [];
  scm.inputBox.onDidChange(val => scmInputChanges.push(val));
  scm.inputBox.value = "feat: initial commit";
  const isResGroup = group instanceof v.SourceControlResourceGroup;
  scm.quickDiffProvider = {
    provideOriginalResource: (uri) => v.Uri.file("/app/original/main.rs"),
  };
  const originalUri = await v.commands.executeCommand("vscode.executeQuickDiffProvider", v.Uri.file("/app/main.rs"));

  const comments = v.comments.createCommentController("review", "Code Review");
  comments.reactionHandler = async (comment, reaction) => {};
  const thread = comments.createCommentThread(v.Uri.file("/app/main.rs"), new v.Range(0, 0, 1, 0), []);
  thread.comments = [{ author: { name: "Reviewer" }, body: new v.MarkdownString("Looks good!"), mode: v.CommentMode.Preview }];
  const threadHasUpdatedComments = thread.comments.length === 1 && thread.comments[0].author.name === "Reviewer";

  const testCtrl = v.tests.createTestController("runner", "Rust Tests");
  const testItem = testCtrl.createTestItem("test-1", "test_addition", v.Uri.file("/app/main.rs"));
  const parentTest = testCtrl.createTestItem("parent-1", "TestSuite", v.Uri.file("/app/main.rs"));
  parentTest.children.add(testItem);
  const childParentMatches = testItem.parent === parentTest;
  let iteratedChildId = "";
  for (const [id, child] of parentTest.children) {
    iteratedChildId = id;
  }
  testCtrl.items.add(parentTest);
  const testRunProfile = testCtrl.createRunProfile("Coverage", v.TestRunProfileKind.Coverage, () => {});
  const testRun = testCtrl.createTestRun(new v.TestRunRequest([parentTest], [], testRunProfile), "Coverage Run");
  let testRunDisposed = false;
  testRun.onDidDispose(() => { testRunDisposed = true; });
  const fileCoverage = new v.FileCoverage(v.Uri.file("/app/main.rs"), new v.StatementCoverage(1, new v.Range(0, 0, 0, 10)));
  testRun.addCoverage(fileCoverage);
  testRun.end();
  const diffMsg = v.TestMessage.diff("Values differ", "expected", "actual");

  v.authentication.registerAuthenticationProvider("mock-auth", "Mock", {
    getSessions: async (scopes) => scopes.includes("write") ? [] : [{ id: "s1", accessToken: "token123", account: { id: "u1", label: "Developer" }, scopes: ["repo"] }],
    createSession: async (scopes) => ({ id: "s2", accessToken: "token456", account: { id: "u1", label: "Developer" }, scopes }),
  });
  const session = await v.authentication.getSession("mock-auth", ["repo"]);
  const sessionCreated = await v.authentication.getSession("mock-auth", ["write"], { createIfNone: true });

  const langStatus = v.languages.createLanguageStatusItem("status-1", "rust");
  const codeActionReg = v.languages.registerCodeActionProvider("rust", { provideCodeActions: () => [] });
  const colorReg = v.languages.registerDocumentColorProvider("css", { provideDocumentColors: () => [] });

  const folderChanges = [];
  v.workspace.onDidChangeWorkspaceFolders(e => folderChanges.push(e));
  v.workspace.updateWorkspaceFolders(1, 0, { uri: v.Uri.file("/extra"), name: "extra" });

  const envLevelChanges = [];
  v.env.onDidChangeLogLevel(lvl => envLevelChanges.push(lvl));
  v.env.logLevel = v.LogLevel.Debug;

  const l10nFormatted = v.l10n.t("Hello {name}!", { name: "Devyy" });
  const nbCtrl = v.notebooks.createNotebookController("nb-1", "jupyter", "Jupyter");
  const nbData = new v.NotebookData([
    new v.NotebookCellData(v.NotebookCellKind.Code, "1 + 1", "python"),
  ]);
  const nbOutput = new v.NotebookCellOutput([v.NotebookCellOutputItem.text("hello")]);
  const nbSummary = new v.NotebookCellExecutionSummary(1, true);

  const cellEvents = [];
  v.notebooks.onDidChangeNotebookCellExecutionState(e => cellEvents.push(e.state));
  const cell = nbData.cells[0];
  const cellExec = nbCtrl.createNotebookCellExecution(cell);
  cellExec.executionOrder = 42;
  cellExec.start();
  cellExec.replaceOutput(nbOutput);
  cellExec.end(true);
  const nbStatusBarItem = new v.NotebookCellStatusBarItem("Python 3.11", v.NotebookCellStatusBarAlignment.Right);

  const snippet = new v.SnippetString("console.log(")
    .appendPlaceholder("val")
    .appendChoice(["1", "2"])
    .appendVariable("CLIPBOARD", "default")
    .value;
  const snippetEdit = new v.SnippetTextEdit(new v.Range(0, 0, 0, 0), new v.SnippetString("hi"));
  const editMetadata = new v.WorkspaceEditMetadata({ needsConfirmation: true, label: "Refactor" });

  const decoReg = v.window.registerFileDecorationProvider({
    provideFileDecoration: (uri) => ({ badge: "M", tooltip: "Modified" }),
  });
  const termProfReg = v.window.registerTerminalProfileProvider("custom-term", {
    provideTerminalProfile: () => new v.TerminalProfile({ name: "Custom" }),
  });
  const linkReg = v.window.registerTerminalLinkProvider({
    provideTerminalLinks: () => [],
    handleTerminalLink: () => {},
  });
  const timelineReg = v.workspace.registerTimelineProvider("git", {
    provideTimeline: () => ({ items: [] }),
  });
  const sbItem = v.window.createStatusBarItem(v.StatusBarAlignment.Right, 100);
  sbItem.accessibilityInformation = { label: "Status info", role: "status" };
  const testDecoType = v.window.createTextEditorDecorationType({
    backgroundColor: "red",
    isWholeLine: true,
  });
  const hasDecoType = Boolean(testDecoType && testDecoType.key);
  const allCmds = await v.commands.getCommands(true);
  const hasOpenWorkspaceSettings = allCmds.includes("workbench.action.openWorkspaceSettings");
  const hasReloadWindow = allCmds.includes("workbench.action.reloadWindow");
  const testPanel = v.window.createWebviewPanel("test-view", "Test Title", v.ViewColumn.One, { retainContextWhenHidden: true });
  const untitledDoc = await v.workspace.openUntitledTextDocument({ language: "rust", content: "// untitled test" });
  const formatReg = v.languages.registerDocumentFormattingProvider("rust", {
    provideDocumentFormattingEdits: () => [],
  });
  const nbMatchScore = v.languages.match({ notebookType: "jupyter-notebook" }, { uri: v.Uri.file("/app/nb.ipynb"), notebookType: "jupyter-notebook" });
  let fsOverwriteThrows = false;
  const testFileUri = v.Uri.file(v.workspace.workspaceFolders[0].uri.fsPath + "/overwrite-test.txt");
  try {
    await v.workspace.fs.writeFile(testFileUri, Buffer.from("hello"));
    await v.workspace.fs.writeFile(testFileUri, Buffer.from("world"), { overwrite: false });
  } catch (err) {
    fsOverwriteThrows = err && (err.name === "FileSystemError" || err.code === "FileExists");
  }

  const tabNb = new v.TabInputNotebook(v.Uri.file("/app/nb.ipynb"), "jupyter-notebook");
  const tabNbDiff = new v.TabInputNotebookDiff(v.Uri.file("/app/a.ipynb"), v.Uri.file("/app/b.ipynb"), "jupyter-notebook");
  const tabTerm = new v.TabInputTerminal();
  const tabMerge = new v.TabInputTextMerge(v.Uri.file("/app/base"), v.Uri.file("/app/1"), v.Uri.file("/app/2"), v.Uri.file("/app/res"));

  const dropEdit = new v.DocumentDropEdit("dropped text");
  const pasteKind = new v.DocumentDropOrPasteEditKind("text.plain");
  const pasteEdit = new v.DocumentPasteEdit("pasted text", "Paste Text", pasteKind);
  const langConfigReg = v.languages.setLanguageConfiguration("rust", { comments: { lineComment: "//" } });
  const dropReg = v.languages.registerDocumentDropEditProvider("rust", { provideDocumentDropEdits: () => dropEdit });
  const pasteReg = v.languages.registerDocumentPasteEditProvider("rust", { provideDocumentPasteEdits: () => [pasteEdit] });
  const evalReg = v.languages.registerEvaluatableExpressionProvider("rust", {
    provideEvaluatableExpression: () => new v.EvaluatableExpression(new v.Range(0, 0, 0, 5), "x"),
  });

  const nbSerReg = v.workspace.registerNotebookSerializer("jupyter-notebook", {
    deserializeNotebook: async (content) => new v.NotebookData([]),
    serializeNotebook: async (data) => Buffer.from("{}"),
  });
  const openedNb = await v.workspace.openNotebookDocument(v.Uri.file("/app/test.ipynb"), nbData);
  const nbEditor = await v.window.showNotebookDocument(openedNb);
  nbCtrl.updateNotebookAffinity(openedNb, v.NotebookControllerAffinity.Preferred);
  const nbAffinityPreferred = nbCtrl.affinities?.get(openedNb) === v.NotebookControllerAffinity.Preferred;

  const models = await v.lm.selectChatModels({ vendor: "copilot" });
  const tokenCount = await models[0]?.countTokens("hello world");
  const chatPart = v.chat.createChatParticipant("devyy.assistant", async (req, ctx, resp) => {});
  const chatVarReg = v.chat.registerChatVariableResolver("file", "Current file", "Current open file", () => []);
  const chatSessionReg = v.chat.registerChatSessionItemProvider("codex-session", {
    provideChatSessionItems: () => [],
  });
  const chatResponseReg = v.chat.registerChatResponseProvider("codex-response", {});
  const interactiveReg = v.interactive.registerInteractiveEditorSessionProvider({});

  const refReg = v.languages.registerReferenceProvider("rust", {
    provideReferences: (doc, pos, ctx) => [new v.Location(doc.uri, new v.Range(pos, pos))],
  });
  const codeLensReg = v.languages.registerCodeLensProvider("rust", {
    provideCodeLenses: (doc) => [new v.CodeLens(new v.Range(0, 0, 0, 0), { title: "Run", command: "test.run" })],
  });
  const inlayReg = v.languages.registerInlayHintsProvider("rust", {
    provideInlayHints: (doc, range) => [new v.InlayHint(new v.Position(0, 0), ": i32", v.InlayHintKind.Type)],
  });
  const wsSymbolReg = v.languages.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols: (query) => [new v.SymbolInformation("mainSymbol", v.SymbolKind.Function, "main", new v.Location(v.Uri.file("/app/main.rs"), new v.Range(0, 0, 0, 10)))],
  });

  const testDoc = await v.workspace.openTextDocument({ language: "rust", content: "fn main() {}" });
  const refResults = await v.commands.executeCommand("vscode.executeReferenceProvider", testDoc.uri, new v.Position(0, 3));
  const lensResults = await v.commands.executeCommand("vscode.executeCodeLensProvider", testDoc.uri);
  const inlayResults = await v.commands.executeCommand("vscode.executeInlayHintProvider", testDoc.uri, new v.Range(0, 0, 1, 0));
  const wsSymbolResults = await v.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", "main");

  const callItem = new v.CallHierarchyItem(v.SymbolKind.Function, "main", "fn main()", testDoc.uri, new v.Range(0, 0, 0, 14), new v.Range(0, 3, 0, 7));
  const incomingCall = new v.CallHierarchyIncomingCall(callItem, [new v.Range(1, 0, 1, 6)]);
  const callReg = v.languages.registerCallHierarchyProvider("rust", {
    prepareCallHierarchy: () => [callItem],
    provideCallHierarchyIncomingCalls: () => [incomingCall],
    provideCallHierarchyOutgoingCalls: () => [],
  });
  const foldReg = v.languages.registerFoldingRangeProvider("rust", {
    provideFoldingRanges: () => [new v.FoldingRange(0, 1)],
  });
  const renameReg = v.languages.registerRenameProvider("rust", {
    provideRenameEdits: (doc, pos, newName) => {
      const we = new v.WorkspaceEdit();
      we.replace(doc.uri, new v.Range(pos, pos), newName);
      return we;
    },
  });

  const prepCallResults = await v.commands.executeCommand("vscode.prepareCallHierarchy", testDoc.uri, new v.Position(0, 3));
  const foldResults = await v.commands.executeCommand("vscode.executeFoldingRangeProvider", testDoc.uri);
  const renameResults = await v.commands.executeCommand("vscode.executeDocumentRenameProvider", testDoc.uri, new v.Position(0, 3), "new_main");
  const trustGranted = await v.workspace.requestWorkspaceTrust();
  const chatResponse = await models[0]?.sendRequest([new v.LanguageModelChatMessage(1, "hi")]);
  const langMatchScore = v.languages.match("rust", testDoc);

  const cfg = v.workspace.getConfiguration("testconfig");
  const inspectedMissing = cfg.inspect("missingKey") === undefined;
  await cfg.update("settingA", "valueA");
  const inspectedSettingA = cfg.inspect("settingA");
  const hasInspectedSettingA = inspectedSettingA?.key === "testconfig.settingA" && inspectedSettingA?.globalValue === "valueA";

  const parentSessionObj = new v.DebugSession("parent-session-1", "lldb", "Parent", {}, undefined);
  const childSessionObj = new v.DebugSession("child-session-1", "lldb", "Child", {}, undefined);
  childSessionObj.parentSession = parentSessionObj;
  const childHasParentSession = childSessionObj.parentSession === parentSessionObj;

  const semEdit = new v.SemanticTokensEdit(0, 5, new Uint32Array([1, 2, 3]));
  const semEdits = new v.SemanticTokensEdits([semEdit], "res-1");
  const md = new v.MarkdownString("info", true);
  const diag = new v.Diagnostic(new v.Range(0, 0, 0, 1), "warn", v.DiagnosticSeverity.Warning);
  diag.source = "rustc";
  diag.code = "E0001";

  const extSelf = v.extensions.getExtension("test.vsx-apis-test");

  await v.commands.executeCommand("setContext", "vsx.apis.done", {
    hasBreakpoints: v.debug.breakpoints.length === 1,
    langMatchScore,
    fileTypeSymlink: v.FileType.SymbolicLink,
    filePermissionReadonly: v.FilePermission.Readonly,
    taskCount: tasks.length,
    debugEvents,
    activeSessionBeforeName: activeSessionBefore?.name,
    activeSessionAfterUndefined: activeSessionAfter === undefined,
    taskEvents,
    taskExecsBefore,
    taskExecsAfter,
    childParentMatches,
    iteratedChildId,
    threadState: thread.state,
    threadCanReply: thread.canReply,
    threadIsTemplate: thread.isTemplate,
    commentApplicabilityCurrent: v.CommentThreadApplicability.Current,
    commentStatePublished: v.CommentState.Published,
    scmId: scm.id,
    hasThread: !!thread,
    hasTestItem: !!testCtrl.items.get("parent-1"),
    sessionToken: session?.accessToken,
    hasLangStatus: !!langStatus,
    folderCount: v.workspace.workspaceFolders?.length,
    folderChangesCount: folderChanges.length,
    workspaceName: v.workspace.name,
    relPath: v.workspace.asRelativePath("/extra/sub/file.txt", true),
    envLogLevel: v.env.logLevel,
    envLevelChanges,
    l10nResult: l10nFormatted,
    hasNbCtrl: !!nbCtrl,
    nbCellCount: nbData.cells.length,
    hasNbOutput: !!nbOutput.id && nbOutput.items.length === 1,
    nbSummarySuccess: nbSummary.success,
    viewColThree: v.ViewColumn.Three,
    codeActionTrigger: v.CodeActionTriggerKind.Invoke,
    sigHelpTrigger: v.SignatureHelpTriggerKind.TriggerCharacter,
    terminalExitReason: v.TerminalExitReason.Process,
    inlineTrigger: v.InlineCompletionTriggerKind.Automatic,
    snippetValue: snippet,
    hasSnippetEdit: !!snippetEdit.snippet,
    extKind: extSelf?.extensionKind,
    hasTabNb: tabNb.notebookType === "jupyter-notebook",
    hasTabNbDiff: tabNbDiff.notebookType === "jupyter-notebook",
    hasTabTerm: tabTerm instanceof v.TabInputTerminal,
    hasTabMerge: tabMerge.base.fsPath === ${JSON.stringify(path.resolve("/app/base"))},
    hasDropEdit: dropEdit.insertText === "dropped text",
    hasPasteEdit: pasteEdit.title === "Paste Text",
    hasOpenedNb: openedNb.notebookType === "jupyter-notebook" && openedNb.cellCount === 1,
    hasNbEditor: !!nbEditor.notebook,
    chatModelCount: models.length,
    tokenCount: tokenCount,
    hasChatPart: chatPart.id === "devyy.assistant",
    pasteTriggerAutomatic: v.DocumentPasteTriggerKind.Automatic,
    lmRoleUser: v.LanguageModelChatMessageRole.User,
    hasRefs: refResults.length === 1,
    hasCodeLenses: lensResults.length === 1 && lensResults[0].command.title === "Run",
    hasInlayHints: inlayResults.length === 1 && inlayResults[0].label === ": i32",
    hasCallHierarchy: prepCallResults.length === 1 && prepCallResults[0].name === "main",
    hasFolding: foldResults.length === 1 && foldResults[0].start === 0,
    hasRename: !!renameResults,
    isWorkspaceTrusted: v.workspace.isTrusted,
    trustGranted: trustGranted,
    hasChatResponseText: chatResponse instanceof v.LanguageModelChatResponse && !!chatResponse.text,
    hasSemEdits: semEdits.edits.length === 1 && semEdits.resultId === "res-1",
    hasMdThemeIcons: md.supportThemeIcons === true,
    diagSource: diag.source === "rustc",
    hasProtoBp: protoBp?.verified === true && protoBp?.id === bp.id,
    hasCoverage: fileCoverage?.uri?.fsPath === ${JSON.stringify(path.resolve("/app/main.rs"))} && fileCoverage?.statementCoverage?.executed === 1,
    cellExecutionStates: cellEvents,
    cellExecutionOrder: cell.executionSummary?.executionOrder,
    hasNbStatusBarItem: nbStatusBarItem.alignment === v.NotebookCellStatusBarAlignment.Right,
    inCustomExec: inCustomExec === false,
    buildGroupIsDefault: buildGroup.isDefault === false,
    scmInputChanges: scmInputChanges,
    isResGroup: isResGroup,
    customPtyCalled: customPtyCalled,
    sessionCreatedToken: sessionCreated?.accessToken,
    hasReactionHandler: typeof comments.reactionHandler === "function",
    trackerEvents,
    diffMsgHasExpected: diffMsg.expectedOutput === "expected",
    editMetadataNeedsConf: editMetadata.needsConfirmation === true,
    scmDecorationsFaded: scmDecorations.faded === true,
    hasOriginalUri: originalUri?.fsPath === ${JSON.stringify(path.resolve("/app/original/main.rs"))},
    hasUntitledDoc: untitledDoc?.languageId === "rust" && untitledDoc?.isUntitled === true,
    hasPanelRetainContext: testPanel.options?.retainContextWhenHidden === true,
    hasSbItemA11y: sbItem.accessibilityInformation?.label === "Status info",
    nbMatchScore,
    fsOverwriteThrows,
    threadHasUpdatedComments,
    testRunDisposed,
    nbAffinityPreferred,
    inspectedMissing,
    hasInspectedSettingA,
    childHasParentSession,
    indentActionNone: v.IndentAction.None,
    indentActionIndent: v.IndentAction.Indent,
    hasChatSessionReg: typeof chatSessionReg?.dispose === "function",
    hasChatResponseReg: typeof chatResponseReg?.dispose === "function",
    hasDecoType,
    hasOpenWorkspaceSettings,
    hasReloadWindow,
    hasCodeLensesAlias: typeof v.languages.registerCodeLensesProvider === "function",
    hasRefProvidersAlias: typeof v.languages.registerReferenceProviders === "function",
    hasWsSymbols: wsSymbolResults?.length === 1 && wsSymbolResults[0].name === "mainSymbol",
  });

  wsSymbolReg.dispose();
  testDecoType.dispose();
  chatSessionReg.dispose();
  chatResponseReg.dispose();
  testPanel.dispose();
  sbItem.dispose();
  formatReg.dispose();
  debugReg.dispose();
  adapterReg.dispose();
  trackerReg.dispose();
  taskReg.dispose();
  group.dispose();
  scm.dispose();
  thread.dispose();
  comments.dispose();
  testCtrl.dispose();
  langStatus.dispose();
  codeActionReg.dispose();
  colorReg.dispose();
  nbCtrl.dispose();
  decoReg.dispose();
  termProfReg.dispose();
  linkReg.dispose();
  timelineReg.dispose();
  langConfigReg.dispose();
  dropReg.dispose();
  pasteReg.dispose();
  evalReg.dispose();
  nbSerReg.dispose();
  chatPart.dispose();
  chatVarReg.dispose();
  interactiveReg.dispose();
  refReg.dispose();
  codeLensReg.dispose();
  inlayReg.dispose();
  callReg.dispose();
  foldReg.dispose();
  renameReg.dispose();
};`,
    );
    await f.request("initialize", {
      extensions: [ext],
      workspaceRoot: f.root,
      storageRoot: path.join(f.root, "state"),
    });

    const done = f.events.find(
      (e) => e.event === "context" && e.payload.key === "vsx.apis.done",
    )?.payload?.value;
    assert.ok(done, "Context vsx.apis.done should be set");
    assert.equal(
      done.hasBreakpoints,
      true,
      "Breakpoints added to debug namespace",
    );
    assert.equal(
      done.langMatchScore,
      10,
      "languages.match returns positive score for matching selector",
    );
    assert.equal(done.fileTypeSymlink, 64, "FileType.SymbolicLink is 64");
    assert.equal(
      done.filePermissionReadonly,
      1,
      "FilePermission.Readonly is 1",
    );
    assert.deepEqual(
      done.debugEvents,
      [
        "start:Test Session",
        "active:Test Session",
        "active:none",
        "term:Test Session",
      ],
      "Debug session lifecycle events fired in order",
    );
    assert.equal(
      done.activeSessionBeforeName,
      "Test Session",
      "Active debug session matches started session",
    );
    assert.equal(
      done.activeSessionAfterUndefined,
      true,
      "Active debug session cleared after stopDebugging",
    );
    assert.equal(
      done.taskCount,
      1,
      "Task provider registered and fetchTasks worked",
    );
    assert.deepEqual(
      done.taskEvents,
      [
        "startTask",
        "startProc",
        "endProc",
        "endTask",
        "startTask",
        "startProc",
        "endProc",
        "endTask",
      ],
      "Task execution lifecycle events fired in order",
    );
    assert.equal(
      done.taskExecsBefore,
      1,
      "tasks.taskExecutions tracks active execution",
    );
    assert.equal(
      done.taskExecsAfter,
      0,
      "execution.terminate() cleans up tasks.taskExecutions",
    );
    assert.equal(
      done.childParentMatches,
      true,
      "Hierarchical child TestItem has parent correctly set",
    );
    assert.equal(
      done.iteratedChildId,
      "test-1",
      "parent.children iterates [id, childItem]",
    );
    assert.equal(done.threadState, 0, "CommentThreadState.Unresolved is 0");
    assert.equal(done.threadCanReply, true, "CommentThread canReply is true");
    assert.equal(
      done.threadIsTemplate,
      false,
      "CommentThread isTemplate is false",
    );
    assert.equal(
      done.commentApplicabilityCurrent,
      0,
      "CommentThreadApplicability.Current is 0",
    );
    assert.equal(done.commentStatePublished, 0, "CommentState.Published is 0");
    assert.equal(done.scmId, "git-test", "Source control created");
    assert.equal(done.hasThread, true, "Comment thread created");
    assert.equal(
      done.hasTestItem,
      true,
      "Test item created and added to TestController",
    );
    assert.equal(
      done.sessionToken,
      "token123",
      "Authentication provider and getSession worked",
    );
    assert.equal(done.hasLangStatus, true, "createLanguageStatusItem worked");
    assert.equal(
      done.folderCount,
      2,
      "Workspace folder added via updateWorkspaceFolders",
    );
    assert.equal(
      done.folderChangesCount,
      1,
      "onDidChangeWorkspaceFolders event fired",
    );
    assert.equal(
      done.workspaceName,
      path.basename(f.root),
      "workspace.name matches active root",
    );
    assert.equal(
      done.relPath,
      path.join("extra", "sub", "file.txt"),
      "asRelativePath multi-root resolution",
    );
    assert.equal(done.envLogLevel, 2, "env.logLevel updated to Debug");
    assert.deepEqual(
      done.envLevelChanges,
      [2],
      "env.onDidChangeLogLevel event fired",
    );
    assert.equal(done.l10nResult, "Hello Devyy!", "l10n.t template formatting");
    assert.equal(
      done.hasNbCtrl,
      true,
      "notebooks.createNotebookController worked",
    );
    assert.equal(done.nbCellCount, 1, "NotebookData contains cells");
    assert.equal(done.hasNbOutput, true, "NotebookCellOutput constructed");
    assert.equal(
      done.nbSummarySuccess,
      true,
      "NotebookCellExecutionSummary constructed",
    );
    assert.equal(done.viewColThree, 3, "ViewColumn.Three is 3");
    assert.equal(
      done.codeActionTrigger,
      1,
      "CodeActionTriggerKind.Invoke is 1",
    );
    assert.equal(
      done.sigHelpTrigger,
      2,
      "SignatureHelpTriggerKind.TriggerCharacter is 2",
    );
    assert.equal(done.terminalExitReason, 2, "TerminalExitReason.Process is 2");
    assert.equal(
      done.inlineTrigger,
      1,
      "InlineCompletionTriggerKind.Automatic is 1",
    );
    assert.equal(
      done.snippetValue,
      "console.log(${1:val}${2|1,2|}${CLIPBOARD:default}",
      "SnippetString format",
    );
    assert.equal(done.hasSnippetEdit, true, "SnippetTextEdit initialized");
    assert.equal(done.extKind, 1, "Extension kind defaults to 1 (UI)");
    assert.equal(done.hasTabNb, true, "TabInputNotebook initialized");
    assert.equal(done.hasTabNbDiff, true, "TabInputNotebookDiff initialized");
    assert.equal(done.hasTabTerm, true, "TabInputTerminal initialized");
    assert.equal(done.hasTabMerge, true, "TabInputTextMerge initialized");
    assert.equal(done.hasDropEdit, true, "DocumentDropEdit initialized");
    assert.equal(done.hasPasteEdit, true, "DocumentPasteEdit initialized");
    assert.equal(done.hasOpenedNb, true, "openNotebookDocument succeeded");
    assert.equal(done.hasNbEditor, true, "showNotebookDocument succeeded");
    assert.equal(
      done.chatModelCount,
      1,
      "selectChatModels matched copilot vendor",
    );
    assert.equal(
      done.tokenCount,
      3,
      "countTokens computed ~3 tokens for 'hello world'",
    );
    assert.equal(done.hasChatPart, true, "createChatParticipant registered");
    assert.equal(
      done.pasteTriggerAutomatic,
      0,
      "DocumentPasteTriggerKind.Automatic is 0",
    );
    assert.equal(done.lmRoleUser, 1, "LanguageModelChatMessageRole.User is 1");
    assert.equal(
      done.hasRefs,
      true,
      "vscode.executeReferenceProvider executed",
    );
    assert.equal(
      done.hasCodeLenses,
      true,
      "vscode.executeCodeLensProvider executed",
    );
    assert.equal(
      done.hasInlayHints,
      true,
      "vscode.executeInlayHintProvider executed",
    );
    assert.equal(
      done.hasCallHierarchy,
      true,
      "vscode.prepareCallHierarchy executed",
    );
    assert.equal(
      done.hasFolding,
      true,
      "vscode.executeFoldingRangeProvider executed",
    );
    assert.equal(
      done.hasRename,
      true,
      "vscode.executeDocumentRenameProvider executed",
    );
    assert.equal(done.isWorkspaceTrusted, true, "workspace.isTrusted is true");
    assert.equal(
      done.trustGranted,
      true,
      "workspace.requestWorkspaceTrust resolved true",
    );
    assert.equal(
      done.hasChatResponseText,
      true,
      "LanguageModelChatResponse instantiated with stream/text",
    );
    assert.equal(done.hasSemEdits, true, "SemanticTokensEdits constructed");
    assert.equal(
      done.hasMdThemeIcons,
      true,
      "MarkdownString supportThemeIcons is true",
    );
    assert.equal(done.diagSource, true, "Diagnostic source field populated");
    assert.equal(
      done.hasProtoBp,
      true,
      "DebugProtocolBreakpoint verified from session",
    );
    assert.equal(
      done.hasCoverage,
      true,
      "FileCoverage and StatementCoverage constructed and added",
    );
    assert.deepEqual(
      done.cellExecutionStates,
      [3, 1],
      "Notebook cell execution state transitions Executing -> Idle",
    );
    assert.equal(
      done.cellExecutionOrder,
      42,
      "Notebook cell executionSummary contains executionOrder",
    );
    assert.equal(
      done.hasNbStatusBarItem,
      true,
      "NotebookCellStatusBarItem initialized with alignment",
    );
    assert.equal(
      done.inCustomExec,
      true,
      "tasks.inCustomExecution returns false",
    );
    assert.equal(
      done.buildGroupIsDefault,
      true,
      "TaskGroup.Build isDefault is false",
    );
    assert.deepEqual(
      done.scmInputChanges,
      ["feat: initial commit"],
      "SCM inputBox onDidChange fired on value assignment",
    );
    assert.equal(
      done.isResGroup,
      true,
      "SCM resource group is an instance of SourceControlResourceGroup",
    );
    assert.equal(
      done.customPtyCalled,
      true,
      "CustomExecution invokes callback with definition",
    );
    assert.equal(
      done.sessionCreatedToken,
      "token456",
      "getSession with createIfNone creates and returns new session",
    );
    assert.equal(
      done.hasReactionHandler,
      true,
      "CommentController supports reactionHandler",
    );
    assert.deepEqual(
      done.trackerEvents,
      ["willStart", "recv:evaluate", "send:evaluate", "willStop", "exit"],
      "DebugAdapterTracker lifecycle and message events captured",
    );
    assert.equal(
      done.diffMsgHasExpected,
      true,
      "TestMessage.diff constructs diff with expected and actual outputs",
    );
    assert.equal(
      done.editMetadataNeedsConf,
      true,
      "WorkspaceEditMetadata initialized with confirmation options",
    );
    assert.equal(
      done.scmDecorationsFaded,
      true,
      "SourceControlResourceDecorations supports faded and tooltip",
    );
    assert.equal(
      done.hasOriginalUri,
      true,
      "vscode.executeQuickDiffProvider resolves original resource URI from SCM provider",
    );
    assert.equal(
      done.hasUntitledDoc,
      true,
      "workspace.openUntitledTextDocument creates untitled document with specified language",
    );
    assert.equal(
      done.hasPanelRetainContext,
      true,
      "WebviewPanel options correctly retainContextWhenHidden",
    );
    assert.equal(
      done.hasSbItemA11y,
      true,
      "StatusBarItem supports accessibilityInformation",
    );
    assert.equal(
      done.nbMatchScore,
      10,
      "languages.match matches selector with notebookType",
    );
    assert.equal(
      done.fsOverwriteThrows,
      true,
      "workspace.fs.writeFile throws FileExists error when overwrite is false",
    );
    assert.equal(
      done.threadHasUpdatedComments,
      true,
      "thread.comments assignment and retrieval works",
    );
    assert.equal(
      done.testRunDisposed,
      true,
      "testRun.onDidDispose fires when test run ends",
    );
    assert.equal(
      done.nbAffinityPreferred,
      true,
      "NotebookController.updateNotebookAffinity records affinity",
    );
    assert.equal(
      done.inspectedMissing,
      true,
      "workspace.getConfiguration().inspect returns undefined for missing key",
    );
    assert.equal(
      done.hasInspectedSettingA,
      true,
      "workspace.getConfiguration().inspect returns key and global values",
    );
    assert.equal(
      done.childHasParentSession,
      true,
      "DebugSession supports parentSession hierarchy",
    );
    assert.equal(done.indentActionNone, 0, "vscode.IndentAction.None is 0");
    assert.equal(done.indentActionIndent, 1, "vscode.IndentAction.Indent is 1");
    assert.equal(
      done.hasChatSessionReg,
      true,
      "chat.registerChatSessionItemProvider is a function and returns Disposable",
    );
    assert.equal(
      done.hasChatResponseReg,
      true,
      "chat.registerChatResponseProvider is a function and returns Disposable",
    );
    assert.equal(
      done.hasDecoType,
      true,
      "window.createTextEditorDecorationType creates decoration type with key",
    );
    assert.equal(
      done.hasOpenWorkspaceSettings,
      true,
      "commands includes workbench.action.openWorkspaceSettings",
    );
    assert.equal(
      done.hasReloadWindow,
      true,
      "commands includes workbench.action.reloadWindow",
    );
    assert.equal(
      done.hasCodeLensesAlias,
      true,
      "languages.registerCodeLensesProvider is an alias",
    );
    assert.equal(
      done.hasRefProvidersAlias,
      true,
      "languages.registerReferenceProviders is an alias",
    );
    assert.equal(
      done.hasWsSymbols,
      true,
      "vscode.executeWorkspaceSymbolProvider queries registered WorkspaceSymbolProvider",
    );
  },
);

test(
  "extension editor panels retain placement and Claude-style settings commands reach the workbench",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const ext = await f.extension(
      "placement",
      { activationEvents: ["onStartupFinished"] },
      `
    const v = require('vscode'); let panel;
    exports.activate = () => {
      v.commands.registerCommand('placement.panel', () => {
        panel = v.window.createWebviewPanel('preview', 'Preview', { viewColumn: 2, preserveFocus: true }, { enableScripts: true });
        panel.webview.html = '<h1>Preview</h1>';
        return { column: panel.viewColumn, visible: panel.visible };
      });
      v.commands.registerCommand('placement.reveal', () => panel.reveal(1, false));
      v.commands.registerCommand('placement.settings', async () => {
        await v.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        await v.commands.executeCommand('workbench.action.openSettings', 'claudeCode.useTerminal');
        return true;
      });
    };
  `,
    );
    await f.request("initialize", {
      extensions: [ext],
      storageRoot: path.join(f.root, "state"),
    });
    assert.deepEqual(await f.request("command", { id: "placement.panel" }), {
      column: 2,
      visible: true,
    });
    const panel = f.events.find(
      (e) => e.event === "webview" && e.payload.title === "Preview",
    ).payload;
    assert.equal(panel.viewKind, "panel");
    assert.equal(panel.viewColumn, 2);
    assert.equal(panel.preserveFocus, true);
    await f.request("command", { id: "placement.reveal" });
    assert.ok(
      f.events.some(
        (e) =>
          e.event === "focusWebview" &&
          e.payload.id === panel.id &&
          e.payload.preserveFocus === false,
      ),
    );
    const settings = f.request("command", { id: "placement.settings" });
    const nextRequest = async (method) => {
      for (let i = 0; i < 200; i++) {
        const event = f.events.find(
          (e) => e.event === "workbenchRequest" && e.payload.method === method,
        );
        if (event) return event.payload;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error("Missing workbench request: " + method);
    };
    const focus = await nextRequest("executeBuiltin");
    assert.equal(focus.params.command, "focus-editor");
    await f.request("workbenchResponse", { id: focus.id, result: null });
    const open = await nextRequest("openSettings");
    assert.equal(open.params.query, "claudeCode.useTerminal");
    await f.request("workbenchResponse", { id: open.id, result: null });
    assert.equal(await settings, true);
  },
);

test("language features resolve lazy lenses and retain each semantic provider's legend", async (t) => {
  const f = await fixture(t);
  const ext = await f.extension(
    "language-rendering",
    { activationEvents: ["onStartupFinished"] },
    `
    const v = require('vscode');
    exports.activate = () => {
      v.languages.registerCodeLensProvider('rust', {
        provideCodeLenses: () => [new v.CodeLens(new v.Range(0,0,0,1))],
        resolveCodeLens: lens => { lens.command = { title: 'Run resolved', command: 'fixture.run' }; return lens; }
      });
      v.languages.registerDocumentSemanticTokensProvider('rust', {
        provideDocumentSemanticTokens: () => ({ data: new Uint32Array([0,0,1,0,0]) })
      }, { tokenTypes: ['function'], tokenModifiers: ['readonly'] });
    };
  `,
  );
  await f.request("initialize", {
    extensions: [ext],
    storageRoot: path.join(f.root, "state"),
  });
  const uri = pathToFileURL(path.join(f.root, "main.rs")).href;
  await f.request("editorState", {
    documents: [
      { uri, text: "fn main() {}", languageId: "rust", visible: true },
    ],
    activeUri: uri,
  });
  const unresolved = await f.request("languageFeature", {
    method: "provideCodeLenses",
    uri,
  });
  assert.equal(unresolved[0][0].command, undefined);
  const lenses = await f.request("languageFeature", {
    method: "provideCodeLenses",
    uri,
    context: { resolve: true },
  });
  assert.equal(lenses[0][0].command.title, "Run resolved");
  const tokens = await f.request("languageFeature", {
    method: "provideDocumentSemanticTokens",
    uri,
  });
  assert.deepEqual(tokens[0].data, [0, 0, 1, 0, 0]);
  assert.deepEqual(tokens[0].legend, {
    tokenTypes: ["function"],
    tokenModifiers: ["readonly"],
  });
});

test(
  "language-server trees reload when indexing settles and keep valid child handles",
  { timeout: 15000 },
  async (t) => {
    let ready = false;
    const f = await fixture(t, (request) => {
      assert.equal(request.params.method, "rust-analyzer/fetchDependencyList");
      return {
        crates: ready
          ? [{ name: "serde", version: "1.0", path: "file:///registry/serde" }]
          : [],
      };
    });
    const ext = await f.extension(
      "dependency-tree",
      {
        activationEvents: ["onStartupFinished"],
        contributes: {
          views: {
            explorer: [{ id: "rustDependencies", name: "Rust Dependencies" }],
          },
        },
      },
      `
    const v = require('vscode');
    const { LanguageClient } = require('vscode-languageclient/node');
    exports.activate = async () => {
      const client = new LanguageClient('rust-analyzer', 'Rust', { command: 'fixture-lsp' }, { documentSelector: ['rust'] });
      await client.start();
      v.window.createTreeView('rustDependencies', { treeDataProvider: {
        getChildren: async parent => parent ? [{ name: 'lib.rs' }] : (await client.sendRequest('rust-analyzer/fetchDependencyList', {})).crates,
        getTreeItem: element => ({ label: element.name, description: element.version, collapsibleState: element.version ? 1 : 0 }),
      }});
    };
  `,
    );
    await f.request("initialize", {
      workspaceRoot: f.root,
      storageRoot: f.root,
      extensions: [ext],
    });
    assert.deepEqual(await f.request("tree", { id: "rustDependencies" }), []);
    const before = f.events.length;
    ready = true;
    await f.request("languageServerMessage", {
      language: "rust",
      method: "experimental/serverStatus",
      params: { health: "ok", quiescent: true },
    });
    await waitForHostEvent(
      f,
      (e) => e.event === "treeChanged" && e.payload.id === "rustDependencies",
      before,
    );
    const roots = await f.request("tree", { id: "rustDependencies" });
    assert.equal(roots[0].label, "serde");
    assert.equal(roots[0].description, "1.0");
    const children = await f.request("tree", {
      id: "rustDependencies",
      parent: roots[0].key,
    });
    assert.equal(children[0].label, "lib.rs");
    const refreshed = await f.request("tree", { id: "rustDependencies" });
    assert.notEqual(refreshed[0].key, roots[0].key);
  },
);
