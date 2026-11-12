import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
const hostPath = path.resolve("src-tauri/extension-host/host.cjs");
async function fixture(t) {
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
  let serial = 0;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const value = JSON.parse(line);
    if (value.id) {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    } else events.push(value);
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
      /not supported/,
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
    await f.request("command", { id: "fixture.inspect" });
    const view = f.events.find((e) => e.event === "webview").payload;
    assert.match(
      view.html,
      /devyy-extension:\/\/localhost\/resource\/[\w-]+\/0\/assets\|/,
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
    const prompt = (await waitForEvent("workbenchRequest")).payload;
    assert.equal(prompt.method, "quickPick");
    await f.request("workbenchResponse", { id: prompt.id, result: 1 });
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
