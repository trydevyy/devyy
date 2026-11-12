/* Devyy's process-isolated, deliberately bounded VS Code API adapter.
 * stdout is exclusively the bridge protocol. Extensions retain Node permissions.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const readline = require("node:readline");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { AsyncLocalStorage } = require("node:async_hooks");
const scope = new AsyncLocalStorage();
const messages = (() => {
  const bundled = path.join(__dirname, "messages.cjs");
  if (fs.existsSync(bundled)) return require(bundled);
  const module = new Module(bundled);
  module._compile(
    fs.readFileSync(
      path.join(__dirname, "../../public/extension-messages.js"),
      "utf8",
    ),
    bundled,
  );
  return module.exports;
})();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const emit = (type, payload) => send({ event: type, payload });
for (const key of ["log", "info", "warn", "error", "debug"])
  console[key] = (...args) =>
    emit("output", { text: args.map(String).join(" ") });
class Disposable {
  constructor(fn = () => {}) {
    this.dispose = fn;
  }
  static from(...items) {
    return new Disposable(() => items.forEach((x) => x?.dispose()));
  }
}
class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (fn, self, disposables) => {
      const owner = scope.getStore();
      const bound = (...args) => scope.run(owner, () => fn.apply(self, args));
      this.listeners.add(bound);
      const d = new Disposable(() => this.listeners.delete(bound));
      disposables?.push(d);
      return d;
    };
  }
  fire(value) {
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch (e) {
        console.error(e);
      }
    }
  }
  dispose() {
    this.listeners.clear();
  }
}
class Uri {
  constructor(value) {
    this.value = String(value);
    const u = new URL(this.value);
    this.scheme = u.protocol.slice(0, -1);
    this.authority = u.host;
    this.path = decodeURIComponent(u.pathname);
    this.query = u.search.slice(1);
    this.fragment = u.hash.slice(1);
  }
  static file(value) {
    return new Uri(pathToFileURL(value).href);
  }
  static parse(value) {
    return new Uri(value);
  }
  static joinPath(base, ...parts) {
    const u = new URL(base.toString());
    u.pathname = path.posix.join(u.pathname, ...parts);
    return new Uri(u.href);
  }
  static from(parts) {
    return new Uri(
      `${parts.scheme}://${parts.authority || ""}${parts.path || ""}${parts.query ? "?" + parts.query : ""}${parts.fragment ? "#" + parts.fragment : ""}`,
    );
  }
  with(parts) {
    return Uri.from({
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
      ...parts,
    });
  }
  get fsPath() {
    return this.scheme === "file" ? fileURLToPath(this.value) : this.path;
  }
  toString() {
    return this.value;
  }
  toJSON() {
    return {
      scheme: this.scheme,
      path: this.path,
      fsPath: this.fsPath,
      external: this.value,
    };
  }
}
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  isBefore(other) {
    return (
      this.line < other.line ||
      (this.line === other.line && this.character < other.character)
    );
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  translate(line = 0, character = 0) {
    return new Position(this.line + line, this.character + character);
  }
}
class Range {
  constructor(a, b, c, d) {
    this.start = typeof a === "number" ? new Position(a, b) : a;
    this.end = typeof a === "number" ? new Position(c, d) : b;
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
}
class TreeItem {
  constructor(label, collapsibleState = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
class MarkdownString {
  constructor(value = "") {
    this.value = value;
  }
  appendText(text) {
    this.value += text;
    return this;
  }
  appendMarkdown(text) {
    return this.appendText(text);
  }
  appendCodeblock(code, language = "") {
    return this.appendText("\n```" + language + "\n" + code + "\n```\n");
  }
}
class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
  static File = new ThemeIcon("file");
  static Folder = new ThemeIcon("folder");
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}
class CancellationTokenSource {
  constructor() {
    this.emitter = new EventEmitter();
    this.token = {
      isCancellationRequested: false,
      onCancellationRequested: this.emitter.event,
    };
  }
  cancel() {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
  dispose() {
    this.emitter.dispose();
  }
}
const extensions = new Map(),
  commands = new Map(),
  trees = new Map(),
  webviews = new Map(),
  providers = new Map();
const configurationChanged = new EventEmitter();
const documentOpened = new EventEmitter(),
  documentChanged = new EventEmitter(),
  documentClosed = new EventEmitter();
let workspaceRoot,
  storageRoot,
  counter = 0;
let webviewOrigin =
  process.platform === "win32"
    ? "http://devyy-extension.localhost"
    : "devyy-extension://localhost";
const documents = new Map();
const current = () => scope.getStore();
const own = () => {
  const ext = current();
  if (!ext)
    throw new Error("Extension API called outside its activation context");
  return ext;
};
const unsupported = (name) => {
  throw new Error(`Devyy does not yet implement vscode.${name}`);
};
const within = (root, candidate) => {
  const relative = path.relative(
    fs.realpathSync(root),
    fs.realpathSync(candidate),
  );
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
function scoped(fn, ext = own()) {
  return (...args) => scope.run(ext, () => fn(...args));
}
function state(ext, name) {
  const file = path.join(storageRoot, ext.id, name + ".json");
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  return {
    get: (key, fallback) =>
      Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback,
    keys: () => Object.keys(data),
    setKeysForSync() {},
    update: async (key, value) => {
      if (value === undefined) delete data[key];
      else data[key] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(data));
      fs.renameSync(temp, file);
    },
  };
}
function defaults() {
  const all = {};
  for (const ext of extensions.values())
    for (const config of [ext.manifest.contributes?.configuration]
      .flat()
      .filter(Boolean))
      for (const [key, item] of Object.entries(config.properties || {}))
        all[key] = item.default;
  return all;
}
const overrides = new Map();
function configuration(section = "") {
  const prefix = section ? section + "." : "";
  const get = (key, fallback) =>
    overrides.has(prefix + key)
      ? overrides.get(prefix + key)
      : (defaults()[prefix + key] ?? fallback);
  return new Proxy(
    {
      get,
      has: (key) => get(key) !== undefined,
      inspect: (key) => ({
        key: prefix + key,
        defaultValue: defaults()[prefix + key],
        globalValue: overrides.get(prefix + key),
      }),
      update: async (key, value) => {
        if (value === undefined) overrides.delete(prefix + key);
        else overrides.set(prefix + key, value);
        fs.mkdirSync(storageRoot, { recursive: true });
        const file = path.join(storageRoot, "configuration.json");
        fs.writeFileSync(
          file + ".tmp",
          JSON.stringify(Object.fromEntries(overrides)),
        );
        fs.renameSync(file + ".tmp", file);
        emit("context", { key: "config." + prefix + key, value });
        configurationChanged.fire({
          affectsConfiguration: (query) =>
            prefix + key === query ||
            (prefix + key).startsWith(query + ".") ||
            query.startsWith(prefix + key + "."),
        });
      },
    },
    {
      get: (object, key) =>
        key in object
          ? object[key]
          : typeof key === "string"
            ? get(key)
            : undefined,
    },
  );
}
function registerTree(id, provider) {
  const ext = own();
  const change = new EventEmitter();
  const view = { id, ext, provider, nodes: new Map(), serial: 0 };
  trees.set(id, view);
  const subscription = provider.onDidChangeTreeData?.(
    scoped(() => emit("treeChanged", { id })),
  );
  emit("treeChanged", { id });
  return Object.assign(
    new Disposable(() => {
      subscription?.dispose();
      trees.delete(id);
      change.dispose();
    }),
    {
      onDidChangeSelection: change.event,
      onDidChangeVisibility: change.event,
      onDidExpandElement: change.event,
      onDidCollapseElement: change.event,
      visible: true,
      selection: [],
      reveal: async () => {},
    },
  );
}
async function treeItems(id, parent) {
  await activateEvent("onView:" + id);
  const tree = trees.get(id);
  if (!tree) return [];
  return scope.run(tree.ext, async () => {
    const children =
      (await tree.provider.getChildren(
        parent ? tree.nodes.get(parent) : undefined,
      )) || [];
    if (!parent) {
      tree.nodes.clear();
      tree.serial = 0;
    }
    return Promise.all(
      children.slice(0, 2000).map(async (element) => {
        const item = await tree.provider.getTreeItem(element);
        const key = String(++tree.serial);
        tree.nodes.set(key, element);
        return {
          key,
          label:
            typeof item.label === "string"
              ? item.label
              : item.label?.label || "",
          description:
            typeof item.description === "string" ? item.description : "",
          tooltip:
            typeof item.tooltip === "string"
              ? item.tooltip
              : item.tooltip?.value,
          collapsibleState: item.collapsibleState || 0,
          icon: item.iconPath?.id,
          command: item.command
            ? { title: item.command.title, command: item.command.command }
            : undefined,
        };
      }),
    );
  });
}
function makeWebview(id, title, options, ext = own()) {
  const received = new EventEmitter(),
    disposed = new EventEmitter(),
    changed = new EventEmitter();
  const record = {
    id,
    title,
    html: "",
    options: options || {},
    ext,
    received,
    disposed,
  };
  const publish = () =>
    emit("webview", {
      id,
      title: record.title,
      html: record.html,
      enableScripts: !!record.options.enableScripts,
      extension: ext.id,
    });
  const resourceToken = require("node:crypto").randomUUID();
  const resourceRoots = () =>
    (
      record.options.localResourceRoots ?? [
        Uri.file(ext.path),
        ...(workspaceRoot ? [Uri.file(workspaceRoot)] : []),
      ]
    ).map((root) => root.fsPath);
  const publishRoots = () =>
    emit("webviewResources", {
      id,
      token: resourceToken,
      roots: resourceRoots(),
    });
  publishRoots();
  const webview = {
    get html() {
      return record.html;
    },
    set html(value) {
      if (typeof value !== "string" || value.length > 8_000_000)
        throw new Error("Invalid webview HTML");
      record.html = value;
      publish();
    },
    get options() {
      return record.options;
    },
    set options(value) {
      record.options = value || {};
      publishRoots();
    },
    get cspSource() {
      return webviewOrigin;
    },
    asWebviewUri(uri) {
      if (uri.scheme !== "file")
        throw new Error("Webview resources must use file URIs");
      const file = path.resolve(uri.fsPath);
      const roots = resourceRoots();
      const index = roots.findIndex((root) => {
        const relative = path.relative(path.resolve(root), file);
        return (
          relative === "" ||
          (relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative))
        );
      });
      if (index < 0)
        throw new Error("Webview resource is outside localResourceRoots");
      publishRoots();
      const relative = path
        .relative(roots[index], file)
        .split(path.sep)
        .map(encodeURIComponent)
        .join("/");
      return Uri.parse(
        `${webviewOrigin}/resource/${resourceToken}/${index}${relative ? "/" + relative : ""}${uri.query ? "?" + uri.query : ""}${uri.fragment ? "#" + uri.fragment : ""}`,
      );
    },
    onDidReceiveMessage: received.event,
    postMessage: async (message) => {
      emit("webviewMessage", { id, message: messages.encode(message) });
      return true;
    },
  };
  const panel = {
    webview,
    viewType: id,
    viewColumn: 1,
    get title() {
      return record.title;
    },
    set title(value) {
      record.title = value;
      publish();
    },
    visible: true,
    active: true,
    onDidDispose: disposed.event,
    onDidChangeViewState: changed.event,
    onDidChangeVisibility: changed.event,
    reveal() {
      publish();
    },
    show() {
      publish();
    },
    dispose() {
      disposed.fire();
      received.dispose();
      webviews.delete(id);
      emit("webviewClosed", { id });
    },
  };
  record.panel = panel;
  webviews.set(id, record);
  return panel;
}
function outputChannel(name) {
  const append = (text) => emit("output", { name, text: String(text) });
  return {
    name,
    append,
    appendLine: append,
    trace: append,
    debug: append,
    info: append,
    warn: append,
    error: append,
    clear() {},
    show() {},
    hide() {},
    replace: append,
    dispose() {},
  };
}
function registerServer(languages, launch, clientOptions = {}) {
  const ext = own();
  for (const selector of languages || []) {
    const language =
      typeof selector === "string" ? selector : selector.language;
    if (!language || language === "*") continue;
    emit("languageServer", {
      language,
      command: launch.command,
      args: launch.args || [],
      initializationOptions: clientOptions.initializationOptions || null,
      settings: clientOptions.settings || null,
      enabled: true,
      custom: false,
      source: ext.id,
    });
  }
}
class LanguageClient {
  constructor(id, name, serverOptions, clientOptions) {
    if (typeof name !== "string") {
      clientOptions = serverOptions;
      serverOptions = name;
    }
    this.id = id;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions || {};
    this.ext = own();
    this.outputChannel = outputChannel(id);
    this.state = 1;
    this.changed = new EventEmitter();
    this.onDidChangeState = this.changed.event;
  }
  start() {
    const pending = scope.run(this.ext, async () => {
      let launch =
        typeof this.serverOptions === "function"
          ? await this.serverOptions()
          : this.serverOptions;
      launch = launch?.run || launch;
      if (!launch)
        throw new Error("Language server did not provide launch options");
      if (launch.module) {
        if (launch.transport !== undefined && launch.transport !== 0)
          throw new Error(
            "This language server uses a transport other than stdio",
          );
        launch = {
          command: process.execPath,
          args: [
            ...(launch.options?.execArgv || []),
            launch.module,
            ...(launch.args || []),
            "--stdio",
          ],
        };
      }
      if (!launch.command)
        throw new Error(
          "Language server requires a stream transport; Devyy currently supports stdio servers",
        );
      if (launch.transport !== undefined && launch.transport !== 0)
        throw new Error("Only stdio language servers are currently supported");
      if (launch.options?.env || launch.options?.cwd)
        throw new Error("Custom server environment/cwd is not implemented");
      const options = { ...this.clientOptions };
      if (typeof options.initializationOptions === "function")
        options.initializationOptions = await options.initializationOptions();
      registerServer(options.documentSelector, launch, options);
      this.state = 2;
      this.changed.fire({ oldState: 1, newState: 2 });
    });
    (this.ext.pendingStarts ??= []).push(pending);
    return pending;
  }
  onReady() {
    return Promise.resolve();
  }
  needsStart() {
    return this.state !== 2;
  }
  needsStop() {
    return this.state === 2;
  }
  isRunning() {
    return this.state === 2;
  }
  registerProposedFeatures() {}
  registerFeature() {
    unsupported("LanguageClient.registerFeature");
  }
  sendRequest() {
    return Promise.reject(
      new Error("Custom LanguageClient requests are not implemented"),
    );
  }
  sendNotification() {
    return Promise.reject(
      new Error("Custom LanguageClient notifications are not implemented"),
    );
  }
  onNotification() {
    return new Disposable();
  }
  onRequest() {
    return new Disposable();
  }
  async stop() {
    this.state = 1;
  }
  dispose() {
    this.changed.dispose();
  }
}
const api = {
  l10n: {
    t: (value, ...args) =>
      String(typeof value === "string" ? value : value.message).replace(
        /\{(\d+)\}/g,
        (_, i) => args[i] ?? "",
      ),
  },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  version: "1.96.2",
  Disposable,
  EventEmitter,
  Uri,
  Position,
  Range,
  TreeItem,
  MarkdownString,
  ThemeIcon,
  ThemeColor,
  CancellationTokenSource,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  UIKind: { Desktop: 1, Web: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  commands: {
    registerCommand(id, fn, self) {
      const ext = own();
      const entry = { fn: scoped(fn.bind(self), ext), ext };
      commands.set(id, entry);
      return new Disposable(() => { if (commands.get(id) === entry) commands.delete(id); });
    },
    registerTextEditorCommand() {
      unsupported("commands.registerTextEditorCommand");
    },
    async executeCommand(id, ...args) {
      if (id === "setContext") return;
      if (id === "vscode.open") {
        emit("openFile", { uri: args[0]?.toString() });
        return;
      }
      await activateEvent("onCommand:" + id);
      const command = commands.get(id);
      if (!command) throw new Error(`Command is not supported: ${id}`);
      const result = await command.fn(...args);
      await Promise.all(command.ext.pendingStarts || []);
      return result;
    },
    getCommands: async () => [...commands.keys()],
  },
  workspace: {
    get name() {
      return workspaceRoot ? path.basename(workspaceRoot) : undefined;
    },
    get rootPath() {
      return workspaceRoot;
    },
    get workspaceFolders() {
      return workspaceRoot
        ? [
            {
              uri: Uri.file(workspaceRoot),
              name: path.basename(workspaceRoot),
              index: 0,
            },
          ]
        : undefined;
    },
    get textDocuments() {
      return [...documents.values()];
    },
    getConfiguration: configuration,
    onDidChangeConfiguration: configurationChanged.event,
    onDidOpenTextDocument: documentOpened.event,
    onDidChangeTextDocument: documentChanged.event,
    onDidCloseTextDocument: documentClosed.event,
    getWorkspaceFolder: (uri) =>
      workspaceRoot && within(workspaceRoot, uri.fsPath)
        ? api.workspace.workspaceFolders[0]
        : undefined,
    asRelativePath: (value) =>
      workspaceRoot
        ? path.relative(
            workspaceRoot,
            typeof value === "string" ? value : value.fsPath,
          )
        : String(value),
    fs: {
      readFile: async (uri) => fs.promises.readFile(uri.fsPath),
      writeFile: async (uri, bytes) => fs.promises.writeFile(uri.fsPath, bytes),
      stat: async (uri) => {
        const s = await fs.promises.stat(uri.fsPath);
        return {
          type: s.isDirectory() ? 2 : 1,
          ctime: s.ctimeMs,
          mtime: s.mtimeMs,
          size: s.size,
        };
      },
      readDirectory: async (uri) =>
        (await fs.promises.readdir(uri.fsPath, { withFileTypes: true })).map(
          (e) => [e.name, e.isDirectory() ? 2 : 1],
        ),
      createDirectory: async (uri) =>
        fs.promises.mkdir(uri.fsPath, { recursive: true }),
    },
    createFileSystemWatcher() {
      unsupported("workspace.createFileSystemWatcher");
    },
    findFiles() {
      unsupported("workspace.findFiles");
    },
  },
  window: {
    createOutputChannel: outputChannel,
    registerTreeDataProvider: registerTree,
    createTreeView: (id, options) => registerTree(id, options.treeDataProvider),
    createWebviewPanel: (type, title, _column, options) =>
      makeWebview(type + ":" + ++counter, title, options),
    registerWebviewViewProvider(id, provider) {
      const ext = own();
      providers.set(id, { provider, ext });
      return new Disposable(() => providers.delete(id));
    },
    showInformationMessage: async (message) => {
      emit("notification", { message, kind: "info" });
    },
    showWarningMessage: async (message) => {
      emit("notification", { message, kind: "warning" });
    },
    showErrorMessage: async (message) => {
      emit("notification", { message, kind: "error" });
    },
    withProgress: async (_options, task) =>
      task(
        { report: (value) => emit("output", { text: value.message || "" }) },
        new CancellationTokenSource().token,
      ),
    showTextDocument: async (uri) => {
      emit("openFile", { uri: uri.toString() });
    },
    showQuickPick() {
      unsupported("window.showQuickPick");
    },
    showInputBox() {
      unsupported("window.showInputBox");
    },
    createStatusBarItem() {
      unsupported("window.createStatusBarItem");
    },
  },
  env: {
    appName: "Devyy",
    appHost: "desktop",
    language: "en",
    uriScheme: "devyy",
    uiKind: 1,
    shell: process.env.SHELL || process.env.COMSPEC || "",
    openExternal: async () => unsupported("env.openExternal"),
  },
  extensions: {
    getExtension: (id) => extensions.get(id.toLowerCase())?.public,
    get all() {
      return [...extensions.values()].map((e) => e.public);
    },
  },
  devyy: {
    ui: {
      registerView(id, definition) {
        const ext = own();
        emit("nativeView", {
          id,
          extension: ext.id,
          title: definition.title || id,
          body: definition.body,
        });
        return new Disposable(() => emit("nativeViewClosed", { id }));
      },
      updateView(id, body) {
        emit("nativeView", { id, extension: own().id, body });
      },
    },
    languages: {
      registerServer(languages, options) {
        registerServer(languages, options, options);
        return new Disposable();
      },
    },
  },
};
require("./types.cjs")(api);
const runtime = require("./runtime.cjs")(api, {
  emit,
  own,
  scoped,
  scope,
  documents,
  documentOpened,
  documentChanged,
  documentClosed,
  webviews,
  providers,
  extensions,
  root: () => workspaceRoot,
  storage: () => storageRoot || "",
  activateEvent,
  makeWebview,
  resolveView: (id) => methods.resolveView({ id }),
});
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === "vscode") return api;
  if (id === "devyy") return api.devyy;
  if (/^vscode-languageclient(?:\/node(?:\.js)?)?$/.test(id))
    return {
      LanguageClient,
      TransportKind: { stdio: 0, ipc: 1, pipe: 2, socket: 3 },
      State: { Stopped: 1, Running: 2, Starting: 3 },
      RevealOutputChannelOn: { Info: 1, Warn: 2, Error: 3, Never: 4 },
    };
  return originalLoad.call(this, id, parent, isMain);
};
async function activate(ext, chain = new Set()) {
  if (chain.has(ext.id))
    throw new Error("Circular extension dependency: " + ext.id);
  if (ext.activation) return ext.activation;
  const next = new Set(chain);
  next.add(ext.id);
  ext.activation = scope.run(ext, async () => {
    try {
      for (const id of ext.manifest.extensionDependencies || []) {
        const dependency = extensions.get(id.toLowerCase());
        if (!dependency) throw new Error("Missing extension dependency: " + id);
        await activate(dependency, next);
      }
      const entry = ext.manifest.main;
      if (!entry) {
        if (ext.manifest.browser)
          throw new Error(
            "Browser-only extension entrypoints are not implemented",
          );
        return;
      }
      const file = require.resolve(path.resolve(ext.path, entry));
      if (!within(ext.path, file))
        throw new Error("Extension entrypoint escapes its package");
      const storageUri = Uri.file(path.join(storageRoot, ext.id));
      fs.mkdirSync(storageUri.fsPath, { recursive: true });
      const context = {
        subscriptions: [],
        extensionPath: ext.path,
        extensionUri: Uri.file(ext.path),
        extension: ext.public,
        extensionMode: 1,
        globalStorageUri: storageUri,
        storageUri,
        logUri: storageUri,
        extensionRuntime: "node",
        globalStoragePath: storageUri.fsPath,
        storagePath: storageUri.fsPath,
        logPath: storageUri.fsPath,
        globalState: state(ext, "global"),
        workspaceState: state(
          ext,
          Buffer.from(workspaceRoot || "")
            .toString("hex")
            .slice(0, 180) || "workspace",
        ),
        asAbsolutePath: (relative) => path.join(ext.path, relative),
        environmentVariableCollection: runtime.environment(ext),
      };
      ext.context = context;
      ext.module = require(file);
      ext.exports = await ext.module.activate?.(context);
      await Promise.all(ext.pendingStarts || []);
      ext.active = true;
      emit("extensionStatus", { id: ext.id, status: "active" });
    } catch (error) {
      ext.error = String(error.message || error);
      emit("output", { name: ext.id, text: error.stack || ext.error });
      emit("extensionStatus", {
        id: ext.id,
        status: "error",
        error: ext.error,
      });
      throw error;
    }
  });
  return ext.activation;
}
function matches(ext, event) {
  const c = ext.manifest.contributes || {};
  return (
    ext.manifest.activationEvents?.some((e) => e === "*" || e === event) ||
    (event.startsWith("onLanguage:") &&
      c.languages?.some((l) => "onLanguage:" + l.id === event)) ||
    (event.startsWith("onCommand:") &&
      c.commands?.some((c) => "onCommand:" + c.command === event)) ||
    (event.startsWith("onView:") &&
      Object.values(c.views || {})
        .flat()
        .some((v) => "onView:" + v.id === event))
  );
}
async function activateEvent(event) {
  const result = await Promise.allSettled(
    [...extensions.values()]
      .filter((ext) => matches(ext, event))
      .map((ext) => activate(ext)),
  );
  return result
    .filter((r) => r.status === "rejected")
    .map((r) => String(r.reason));
}
function snapshot() {
  return [...extensions.values()].map((ext) => ({
    id: ext.id,
    status: ext.error ? "error" : ext.active ? "active" : "idle",
    error: ext.error,
  }));
}
const methods = {
  ...runtime.methods,
  async initialize(params) {
    workspaceRoot = params.workspaceRoot || undefined;
    webviewOrigin = params.webviewOrigin || webviewOrigin;
    storageRoot = params.storageRoot;
    try {
      for (const [key, value] of Object.entries(
        JSON.parse(
          fs.readFileSync(path.join(storageRoot, "configuration.json"), "utf8"),
        ),
      ))
        overrides.set(key, value);
    } catch {}
    for (const item of params.extensions) {
      let manifest;
      try {
        manifest = JSON.parse(
          fs
            .readFileSync(path.join(item.installPath, "package.json"), "utf8")
            .replace(/^\uFEFF/, ""),
        );
      } catch (error) {
        extensions.set(item.id, {
          id: item.id,
          manifest: {},
          error: "Invalid package manifest: " + error.message,
        });
        continue;
      }
      const ext = {
        id: item.id.toLowerCase(),
        path: item.installPath,
        manifest,
        active: false,
      };
      ext.public = {
        id: ext.id,
        extensionPath: ext.path,
        extensionUri: Uri.file(ext.path),
        packageJSON: manifest,
        get isActive() {
          return ext.active;
        },
        get exports() {
          return ext.exports;
        },
        activate: () => activate(ext).then(() => ext.exports),
      };
      extensions.set(ext.id, ext);
    }
    for (const [key, value] of Object.entries(defaults()))
      emit("context", {
        key: "config." + key,
        value: overrides.has(key) ? overrides.get(key) : value,
      });
    await activateEvent("onStartupFinished");
    return snapshot();
  },
  status: snapshot,
  activateLanguage: async ({ language }) => {
    await activateEvent("onLanguage:" + language);
    return snapshot();
  },
  command: async ({ id, args = [] }) => {
    await api.commands.executeCommand(id, ...args);
    return null;
  },
  tree: ({ id, parent }) => treeItems(id, parent),
  treeCommand: async ({ id, key }) => {
    const tree = trees.get(id);
    if (!tree) return;
    await scope.run(tree.ext, async () => {
      const item = await tree.provider.getTreeItem(tree.nodes.get(key));
      if (item.command)
        await api.commands.executeCommand(
          item.command.command,
          ...(item.command.arguments || []),
        );
    });
  },
  async resolveView({ id }) {
    await activateEvent("onView:" + id);
    const entry = providers.get(id);
    if (!entry) throw new Error(`No webview provider registered for ${id}`);
    if (!webviews.has(id))
      await scope.run(entry.ext, async () => {
        const panel = makeWebview(id, id, {}, entry.ext);
        await entry.provider.resolveWebviewView(
          panel,
          {},
          new CancellationTokenSource().token,
        );
      });
    return null;
  },
  webviewMessage: ({ id, message }) => {
    const view = webviews.get(id);
    if (view)
      scope.run(view.ext, () => view.received.fire(messages.decode(message)));
    return null;
  },
  closeWebview: ({ id }) => {
    webviews.get(id)?.panel.dispose();
    return null;
  },
  async shutdown() {
    runtime.shutdown();
    for (const ext of extensions.values())
      if (ext.active)
        await scope.run(ext, async () => {
          await ext.module.deactivate?.();
          for (const d of ext.context.subscriptions) d?.dispose?.();
        });
    return null;
  },
};
readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", async (line) => {
    if (line.length > 16_000_000) return;
    let message;
    try {
      message = JSON.parse(line);
      const method = methods[message.method];
      if (!method) throw new Error("Unknown extension host method");
      const result = await method(message.params || {});
      send({ id: message.id, result: result ?? null });
    } catch (error) {
      emit("output", {
        name: "Extension host",
        text: error.stack || String(error),
      });
      send({ id: message?.id, error: String(error.message || error) });
    }
  })
  .on("close", () => process.exit(0));
process.on("uncaughtException", (error) =>
  emit("hostError", { error: error.message }),
);
process.on("unhandledRejection", (error) =>
  emit("hostError", { error: String(error) }),
);
