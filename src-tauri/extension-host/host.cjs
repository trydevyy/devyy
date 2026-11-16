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

/* Devyy's process-isolated, deliberately bounded VS Code API adapter.
 * stdout is exclusively the bridge protocol. Extensions retain Node permissions.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const readline = require("node:readline");
const util = require("node:util");
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
  static isUri(value) {
    return value instanceof Uri;
  }
  static revive(value) {
    if (!value || value instanceof Uri) return value;
    return value.external ? Uri.parse(value.external) : Uri.from(value);
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
      $mid: 1,
      scheme: this.scheme,
      authority: this.authority,
      query: this.query,
      fragment: this.fragment,
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
  constructor(value = "", supportThemeIcons = false) {
    this.value = value;
    this.isTrusted = false;
    this.supportThemeIcons = supportThemeIcons;
    this.supportHtml = false;
    this.baseUri = undefined;
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
  constructor(parent) {
    this.emitter = new EventEmitter();
    this.token = {
      isCancellationRequested: false,
      onCancellationRequested: this.emitter.event,
    };
    if (parent?.isCancellationRequested) this.cancel();
    else this.parent = parent?.onCancellationRequested(() => this.cancel());
  }
  cancel() {
    if (this.token.isCancellationRequested) return;
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
  dispose(cancel = false) {
    if (cancel) this.cancel();
    this.parent?.dispose();
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
function configuration(section = "", scope) {
  const prefix = section ? section + "." : "";
  const get = (key, fallback) =>
    overrides.has(prefix + key)
      ? overrides.get(prefix + key)
      : (defaults()[prefix + key] ?? fallback);
  return new Proxy(
    {
      get,
      has: (key) => get(key) !== undefined,
      inspect: (key) => {
        const fullKey = prefix + key;
        const def = defaults()[fullKey];
        const glob = overrides.get(fullKey);
        if (def === undefined && glob === undefined) return undefined;
        return {
          key: fullKey,
          defaultValue: def,
          globalValue: glob,
          workspaceValue: undefined,
          workspaceFolderValue: undefined,
        };
      },
      update: async (key, value, configurationTarget, overrideInLanguage) => {
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
  const errors = await activateEvent("onView:" + id);
  const tree = trees.get(id);
  if (!tree && errors.length)
    throw Error("Could not load this view: " + errors.join("; "));
  if (!tree) return [];
  return scope.run(tree.ext, async () => {
    const children =
      (await tree.provider.getChildren(
        parent ? tree.nodes.get(parent) : undefined,
      )) || [];
    if (!parent) tree.nodes.clear();
    return Promise.all(
      children.slice(0, 2000).map(async (element) => {
        const item = await tree.provider.getTreeItem(element);
        const key = item.id ? "item:" + item.id : "auto:" + ++tree.serial;
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
          contextValue: item.contextValue,
          icon: item.iconPath?.id,
          command: item.command
            ? { title: item.command.title, command: item.command.command }
            : undefined,
        };
      }),
    );
  });
}
function makeWebview(
  id,
  title,
  options,
  ext = own(),
  viewKind = "panel",
  placement = {},
) {
  if (typeof placement === "number") placement = { viewColumn: placement };
  placement ??= {};
  const received = new EventEmitter(),
    disposed = new EventEmitter(),
    changed = new EventEmitter(),
    visibility = new EventEmitter();
  const record = {
    id,
    title,
    html: "",
    visible: true,
    active: true,
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
      viewKind,
      viewColumn: panel.viewColumn,
      preserveFocus: !!placement.preserveFocus,
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
    viewColumn: placement.viewColumn ?? 1,
    iconPath: undefined,
    description: undefined,
    badge: undefined,
    get options() {
      return record.options || {};
    },
    get title() {
      return record.title;
    },
    set title(value) {
      record.title = value;
      publish();
    },
    get visible() {
      return record.visible;
    },
    get active() {
      return record.active;
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: changed.event,
    onDidChangeVisibility: visibility.event,
    reveal(viewColumn, preserveFocus = false) {
      if (viewColumn !== undefined) panel.viewColumn = viewColumn;
      publish();
      emit("focusWebview", { id, preserveFocus });
    },
    show(preserveFocus = false) {
      panel.reveal(undefined, preserveFocus);
    },
    dispose() {
      disposed.fire();
      received.dispose();
      webviews.delete(id);
      emit("webviewClosed", { id });
    },
  };
  record.panel = panel;
  record.setState = (visible, active) => {
    const wasVisible = record.visible,
      wasActive = record.active;
    record.visible = visible;
    record.active = active;
    if (wasVisible !== visible) visibility.fire();
    if (wasVisible !== visible || wasActive !== active)
      changed.fire({ webviewPanel: panel });
  };
  webviews.set(id, record);
  return panel;
}
function outputChannel(name, options) {
  emit("outputChannelCreated", { name });
  let logLevel = 3;
  const onDidChangeLogLevelEmitter = new EventEmitter();
  const formatMsg = (msg, ...args) => {
    if (args.length === 0) {
      if (typeof msg === "string") return msg;
      if (msg instanceof Error) return msg.stack || msg.message;
      return util.inspect(msg);
    }
    return util.format(msg, ...args);
  };
  const append = (text) => emit("output", { name, text: String(text) });
  const appendLine = (text = "") =>
    emit("output", { name, text: String(text) });
  return {
    name,
    get logLevel() {
      return logLevel;
    },
    set logLevel(level) {
      const num = Number(level);
      if (!Number.isNaN(num) && logLevel !== num) {
        logLevel = num;
        onDidChangeLogLevelEmitter.fire(num);
      }
    },
    onDidChangeLogLevel: onDidChangeLogLevelEmitter.event,
    append,
    appendLine,
    trace: (msg, ...args) => {
      if (logLevel <= 1)
        emit("output", { name, text: formatMsg(msg, ...args), level: "trace" });
    },
    debug: (msg, ...args) => {
      if (logLevel <= 2)
        emit("output", { name, text: formatMsg(msg, ...args), level: "debug" });
    },
    info: (msg, ...args) => {
      if (logLevel <= 3)
        emit("output", { name, text: formatMsg(msg, ...args), level: "info" });
    },
    warn: (msg, ...args) => {
      if (logLevel <= 4)
        emit("output", { name, text: formatMsg(msg, ...args), level: "warn" });
    },
    error: (msg, ...args) => {
      if (logLevel <= 5)
        emit("output", { name, text: formatMsg(msg, ...args), level: "error" });
    },
    clear() {
      emit("outputClear", { name });
    },
    show(preserveFocus) {
      emit("outputShow", { name, preserveFocus: Boolean(preserveFocus) });
    },
    hide() {},
    replace(text) {
      emit("outputReplace", { name, text: String(text) });
    },
    dispose() {
      onDidChangeLogLevelEmitter.listeners.clear();
    },
  };
}
function registerServer(languages, launch, clientOptions = {}, clientId) {
  const registered = [];
  const ext = own();
  for (const selector of languages || []) {
    const language =
      typeof selector === "string" ? selector : selector.language;
    if (!language || language === "*") continue;
    registered.push(language);
    emit("languageServer", {
      language,
      clientId,
      clientCapabilities: clientOptions.capabilities || null,
      env: launch.options?.env || {},
      cwd: launch.options?.cwd?.fsPath || launch.options?.cwd,
      command: launch.command,
      args: launch.args || [],
      initializationOptions: clientOptions.initializationOptions || null,
      settings: clientOptions.settings || null,
      enabled: true,
      custom: false,
      source: ext.id,
    });
  }
  return registered;
}
const languageClients = new Map();
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
    this.notifications = new Map();
    this.requests = new Map();
    this.started = undefined;
    this.features = [];
    this.code2ProtocolConverter = {
      asUri: (uri) => uri.toString(),
      asPosition: (p) => ({ line: p.line, character: p.character }),
      asRange: (r) => ({
        start: { line: r.start.line, character: r.start.character },
        end: { line: r.end.line, character: r.end.character },
      }),
      asTextDocumentIdentifier: (doc) => ({ uri: doc.uri.toString() }),
      asVersionedTextDocumentIdentifier: (doc) => ({
        uri: doc.uri.toString(),
        version: doc.version,
      }),
      asTextDocumentItem: (doc) => ({
        uri: doc.uri.toString(),
        languageId: doc.languageId,
        version: doc.version,
        text: doc.getText(),
      }),
      asTextDocumentPositionParams: (doc, position) => ({
        textDocument: { uri: doc.uri.toString() },
        position: { line: position.line, character: position.character },
      }),
      asTextEdit: (edit) => ({ range: edit.range, newText: edit.newText }),
      asDiagnostic: (d) => ({
        ...d,
        severity: d.severity === undefined ? undefined : d.severity + 1,
      }),
    };
    const toRange = (r) =>
      r
        ? new Range(
            new Position(r.start.line, r.start.character),
            new Position(r.end.line, r.end.character),
          )
        : undefined;
    const toLocation = (l) =>
      l ? { uri: Uri.parse(l.uri), range: toRange(l.range) } : undefined;
    this.protocol2CodeConverter = {
      asUri: (uri) => Uri.parse(uri),
      asPosition: (p) => (p ? new Position(p.line, p.character) : undefined),
      asRange: toRange,
      asLocation: toLocation,
      asLocations: (values) => values?.map(toLocation),
      asTextEdit: (edit) =>
        edit ? new api.TextEdit(toRange(edit.range), edit.newText) : undefined,
      asTextEdits: (edits) =>
        edits?.map(
          (edit) => new api.TextEdit(toRange(edit.range), edit.newText),
        ),
      asDiagnostic: (d) =>
        d
          ? {
              ...d,
              range: toRange(d.range),
              severity: d.severity === undefined ? undefined : d.severity - 1,
            }
          : undefined,
      asDiagnostics: (ds) =>
        ds?.map((d) => ({
          ...d,
          range: toRange(d.range),
          severity: d.severity === undefined ? undefined : d.severity - 1,
        })),
      asHover: (h) =>
        h
          ? {
              ...h,
              range: toRange(h.range),
              contents: Array.isArray(h.contents) ? h.contents : [h.contents],
            }
          : undefined,
      asWorkspaceEdit: (value) => {
        if (!value) return;
        const edit = new api.WorkspaceEdit();
        for (const [uri, edits] of Object.entries(value.changes || {}))
          edit.set(
            Uri.parse(uri),
            edits.map((e) => new api.TextEdit(toRange(e.range), e.newText)),
          );
        if (value.documentChanges?.length)
          throw Error(
            "Document-change WorkspaceEdit conversion is not implemented",
          );
        return edit;
      },
    };
    this.changed = new EventEmitter();
    this.onDidChangeState = this.changed.event;
  }
  start() {
    if (this.started) return this.started;
    const pending = scope.run(this.ext, async () => {
      let launch =
        typeof this.serverOptions === "function"
          ? await this.serverOptions()
          : this.serverOptions;
      launch = launch?.run || launch;
      if (!launch)
        throw new Error("Language server did not provide launch options");
      if (launch.module) {
        const transport =
          typeof launch.transport === "object"
            ? launch.transport.kind
            : (launch.transport ?? 0);
        if (![0, 1, 2, 3].includes(transport))
          throw new Error("Unknown language-server transport");
        launch = {
          command: process.execPath,
          args: [
            ...(launch.options?.execArgv || []),
            ...(transport === 0
              ? [launch.module, ...(launch.args || []), "--stdio"]
              : [
                  path.join(__dirname, "lsp-transport.cjs"),
                  String(transport),
                  launch.module,
                  ...(launch.args || []),
                ]),
          ],
          options: launch.options,
        };
      }
      if (!launch.command)
        throw new Error(
          "Language server requires a stream transport; Devyy currently supports stdio servers",
        );
      if (launch.transport !== undefined && launch.transport !== 0)
        throw new Error("Only stdio language servers are currently supported");
      const options = { ...this.clientOptions, capabilities: {} };
      for (const feature of this.features)
        feature.fillClientCapabilities?.(options.capabilities);
      if (typeof options.initializationOptions === "function")
        options.initializationOptions = await options.initializationOptions();
      const languages = registerServer(
        options.documentSelector,
        launch,
        options,
        this.id,
      );
      if (!languages.length)
        throw new Error(
          "LanguageClient requires at least one concrete language selector",
        );
      this.language = languages[0];
      for (const language of languages) languageClients.set(language, this);
      this.initializeResult = await runtime.request("languageClientStart", {
        language: this.language,
      });
      for (const feature of this.features)
        await feature.initialize?.(
          this.initializeResult?.capabilities || {},
          options.documentSelector,
        );
      this.state = 2;
      this.changed.fire({ oldState: 1, newState: 2 });
    });
    this.started = pending;
    (this.ext.pendingStarts ??= new Set()).add(pending);
    pending.then(
      () => this.ext.pendingStarts.delete(pending),
      (error) => {
        this.ext.pendingStarts.delete(pending);
        this.started = undefined;
        this.state = 1;
        emit("output", {
          name: this.id,
          text: `Language server failed: ${error.message}`,
        });
      },
    );
    return pending;
  }
  onReady() {
    return this.started || this.start();
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
  registerFeature(feature) {
    if (!feature || typeof feature !== "object")
      throw new TypeError("Expected a language client feature");
    this.features.push(feature);
  }
  getFeature(method) {
    return this.features.find(
      (feature) => feature.registrationType?.method === method,
    );
  }
  async sendRequest(method, params, token) {
    await this.onReady();
    if (token?.isCancellationRequested)
      throw new Error("Language server request cancelled");
    return scope.run(this.ext, () =>
      runtime.request("languageClientRequest", {
        language: this.language,
        method: typeof method === "string" ? method : method.method,
        params: params ?? null,
        notification: false,
      }),
    );
  }
  async sendNotification(method, params) {
    await this.onReady();
    return scope.run(this.ext, () =>
      runtime.request("languageClientRequest", {
        language: this.language,
        method: typeof method === "string" ? method : method.method,
        params: params ?? null,
        notification: true,
      }),
    );
  }
  onNotification(method, handler) {
    return this.listen(this.notifications, method, handler);
  }
  onRequest(method, handler) {
    return this.listen(this.requests, method, handler);
  }
  listen(map, method, handler) {
    const name = typeof method === "string" ? method : method.method;
    const entry = scoped(handler, this.ext);
    map.set(name, entry);
    return new Disposable(() => {
      if (map.get(name) === entry) map.delete(name);
    });
  }
  async stop() {
    if (!this.language) return;
    await scope.run(this.ext, () =>
      runtime.request("languageClientStop", { language: this.language }),
    );
    for (const [language, client] of languageClients)
      if (client === this) languageClients.delete(language);
    const oldState = this.state;
    this.state = 1;
    this.started = undefined;
    this.changed.fire({ oldState, newState: 1 });
  }
  dispose() {
    void this.stop().catch((error) => console.error(error.message));
    for (const feature of this.features) feature.dispose?.();
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
      return new Disposable(() => {
        if (commands.get(id) === entry) commands.delete(id);
      });
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
      let errors = [];
      if (!commands.has(id)) errors = await activateEvent("onCommand:" + id);
      const command = commands.get(id);
      if (!command)
        throw new Error(
          errors.length
            ? `Could not activate command ${id}: ${errors.join("; ")}`
            : `No extension registered command: ${id}`,
        );
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
        let s;
        try {
          s = await fs.promises.lstat(uri.fsPath);
        } catch {
          s = await fs.promises.stat(uri.fsPath);
        }
        return {
          type: s.isSymbolicLink()
            ? 64
            : s.isDirectory()
              ? 2
              : s.isFile()
                ? 1
                : 0,
          ctime: s.ctimeMs,
          mtime: s.mtimeMs,
          size: s.size,
        };
      },
      readDirectory: async (uri) =>
        (await fs.promises.readdir(uri.fsPath, { withFileTypes: true })).map(
          (e) => [
            e.name,
            e.isSymbolicLink() ? 64 : e.isDirectory() ? 2 : e.isFile() ? 1 : 0,
          ],
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
      makeWebview(
        type + ":" + ++counter,
        title,
        options,
        own(),
        "panel",
        _column,
      ),
    registerWebviewViewProvider(id, provider, options) {
      const ext = own();
      providers.set(id, { provider, ext, options });
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
        secrets: runtime.secrets(ext),
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
      .filter((ext) => !ext.active && ext !== current() && matches(ext, event))
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
  async languageServerMessage({ language, method, params, request }) {
    const client = languageClients.get(language);
    const callback = (request ? client?.requests : client?.notifications)?.get(
      method,
    );
    if (method === "experimental/serverStatus" && params?.quiescent === true) {
      for (const tree of trees.values())
        if (tree.ext === client?.ext) emit("treeChanged", { id: tree.id });
    }
    if (callback) return callback(params);
    if (request) {
      if (
        method === "workspace/diagnostic/refresh" ||
        method === "workspace/codeLens/refresh" ||
        method === "workspace/inlayHint/refresh" ||
        method === "workspace/semanticTokens/refresh" ||
        method === "workspace/inlineValue/refresh" ||
        method === "workspace/foldingRange/refresh"
      ) {
        emit("lspRefresh", { language, method, params });
        return null;
      }
      if (
        method === "client/registerCapability" ||
        method === "client/unregisterCapability" ||
        method === "window/workDoneProgress/create"
      ) {
        return null;
      }
      throw new Error("No extension handler for " + method);
    }
    return null;
  },
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
        extensionKind: manifest.extensionKind?.includes?.("workspace") ? 2 : 1,
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
    await require("./workspace-activation.cjs")({
      root: workspaceRoot,
      extensions: [...extensions.values()],
      findFiles: api.workspace.findFiles,
      activate,
      report: (text) => emit("output", { name: "Extension activation", text }),
    });
    return snapshot();
  },
  status: snapshot,
  activateLanguage: async ({ language }) => {
    await activateEvent("onLanguage:" + language);
    return snapshot();
  },
  readConfiguration: () => ({
    ...defaults(),
    ...Object.fromEntries(overrides),
  }),
  async updateConfiguration({ key, value, reset }) {
    if (!Object.prototype.hasOwnProperty.call(defaults(), key))
      throw Error("Unknown extension setting: " + key);
    await configuration().update(key, reset ? undefined : value);
    return null;
  },
  command: async ({ id, args = [] }) => {
    const revive = (value) => {
      if (Array.isArray(value)) return value.map(revive);
      if (value && typeof value === "object") {
        if (value.$mid === 1 || (value.scheme && value.external))
          return Uri.revive(value);
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, revive(v)]),
        );
      }
      return value;
    };
    return api.commands.executeCommand(id, ...revive(args));
  },
  tree: ({ id, parent }) => treeItems(id, parent),
  treeMenuCommand: async ({ id, key, command }) => {
    const tree = trees.get(id);
    if (!tree || !tree.nodes.has(key))
      throw new Error("Tree item is no longer available");
    return scope.run(tree.ext, () =>
      api.commands.executeCommand(command, tree.nodes.get(key)),
    );
  },
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
        const definition = Object.values(
          entry.ext.manifest.contributes?.views || {},
        )
          .flat()
          .find((view) => view.id === id);
        const panel = makeWebview(
          id,
          definition?.name || id,
          {},
          entry.ext,
          "view",
        );
        await entry.provider.resolveWebviewView(
          panel,
          {},
          new CancellationTokenSource().token,
        );
      });
    return null;
  },
  webviewState: ({ id, visible, active }) => {
    const record = webviews.get(id);
    if (record)
      scope.run(record.ext, () => record.setState(!!visible, !!active));
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
