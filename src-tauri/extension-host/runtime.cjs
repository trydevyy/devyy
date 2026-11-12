"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

module.exports = function installRuntime(api, host) {
  const {
    emit,
    own,
    scoped,
    documents,
    documentOpened,
    documentChanged,
    documentClosed,
    webviews,
    providers,
    extensions,
  } = host;
  const { EventEmitter, Disposable, Uri, Position, Range, Selection } = api;
  const events = new Map();
  function event(name) {
    if (!events.has(name)) events.set(name, new EventEmitter());
    return events.get(name);
  }
  const pending = new Map();
  let serial = 0,
    activeEditor,
    editors = [],
    theme = { kind: 2 },
    focused = true;
  function request(method, params = {}) {
    const id = String(++serial);
    const ext = own();
    return new Promise((resolve, reject) => {
      // Interactive requests may remain open until dismissed; do not time them out.
      pending.set(id, { resolve, reject, owner: ext.id });
      emit("workbenchRequest", { id, method, params, extension: ext.id });
    });
  }
  async function applyEdits(params) {
    const before = new Map(
      params.documents.map((change) => [
        change.uri,
        documents.get(change.uri)?.getText(),
      ]),
    );
    const applied = await request("applyEdit", params);
    if (applied)
      for (const change of params.documents) {
        const doc = documents.get(change.uri),
          text = before.get(change.uri);
        if (!doc || text === undefined || doc.getText() !== text) continue;
        const edits = change.edits
          .filter((edit) => edit.range)
          .map((edit) => ({
            from: doc.offsetAt(edit.range.start),
            to: doc.offsetAt(edit.range.end),
            text: edit.newText,
          }))
          .sort((a, b) => b.from - a.from || b.to - a.to);
        let next = text;
        for (const edit of edits)
          next = next.slice(0, edit.from) + edit.text + next.slice(edit.to);
        const eol = change.edits.find((edit) => edit.newEol)?.newEol;
        if (eol) next = next.replace(/\r?\n/g, eol === 2 ? "\r\n" : "\n");
        updateDocument({
          uri: change.uri,
          text: next,
          languageId: doc.languageId,
          isDirty: true,
        });
      }
    return applied;
  }
  function register(map, key, value) {
    map.set(key, value);
    return new Disposable(() => { if (map.get(key) === value) map.delete(key); });
  }
  const diagnosticCollections = new Map(),
    languageProviders = new Map(),
    contentProviders = new Map(),
    fileProviders = new Map(),
    uriHandlers = new Map(),
    customEditors = new Map(),
    serializers = new Map(),
    terminals = [];
  const watcherDisposables = new Set();
  const editorModels = new Map();
  let managedUris = new Set();
  const environments = new Map();
  function position(value) {
    return new Position(value.line, value.character);
  }
  function range(value) {
    return new Range(position(value.start), position(value.end));
  }
  function updateDocument(value, reason = "change") {
    const uri = Uri.parse(value.uri),
      key = uri.toString();
    let doc = documents.get(key);
    const opened = !doc;
    if (!doc) {
      let text = "";
      let lines = [""], lineStarts = [0];
      doc = {
        uri,
        fileName: uri.fsPath,
        isUntitled: uri.scheme === "untitled",
        isClosed: false,
        isDirty: false,
        version: 0,
        languageId: "plaintext",
        eol: 1,
        get lineCount() {
          return lines.length;
        },
        _set(value) {
          text = value;
          lines = value.split(/\r?\n/);
          lineStarts = [0];
          for (const match of value.matchAll(/\r?\n/g)) lineStarts.push(match.index + match[0].length);
        },
        getText(r) {
          return r
            ? text.slice(this.offsetAt(r.start), this.offsetAt(r.end))
            : text;
        },
        lineAt(value) {
          const line = typeof value === "number" ? value : value.line;
          if (line < 0 || line >= lines.length)
            throw new RangeError("Invalid line");
          const t = lines[line],
            r = new Range(line, 0, line, t.length);
          return {
            lineNumber: line,
            text: t,
            range: r,
            rangeIncludingLineBreak: new Range(
              r.start,
              line + 1 < lines.length ? new Position(line + 1, 0) : r.end,
            ),
            firstNonWhitespaceCharacterIndex:
              t.search(/\S/) < 0 ? t.length : t.search(/\S/),
            isEmptyOrWhitespace: !t.trim(),
          };
        },
        offsetAt(p) {
          if (p.line < 0) return 0;
          if (p.line >= lines.length) return text.length;
          return lineStarts[p.line] + Math.max(0, Math.min(p.character, lines[p.line].length));
        },
        positionAt(offset) {
          const n = Math.max(0, Math.min(offset, text.length));
          let low = 0, high = lineStarts.length;
          while (low + 1 < high) { const mid = (low + high) >> 1; if (lineStarts[mid] <= n) low = mid; else high = mid; }
          return new Position(low, Math.min(n - lineStarts[low], lines[low].length));
        },
        validatePosition(p) {
          return this.positionAt(this.offsetAt(p));
        },
        validateRange(r) {
          return new Range(
            this.validatePosition(r.start),
            this.validatePosition(r.end),
          );
        },
        getWordRangeAtPosition(p, regex = /[\p{L}\p{N}_$]+/gu) {
          const text = lines[p.line];
          if (text === undefined) return;
          const re = new RegExp(
            regex.source,
            regex.flags.includes("g") ? regex.flags : regex.flags + "g",
          );
          for (const m of text.matchAll(re)) {
            if (
              m[0].length &&
              m.index <= p.character &&
              m.index + m[0].length >= p.character
            )
              return new Range(p.line, m.index, p.line, m.index + m[0].length);
          }
        },
        save: () => request("saveDocument", { uri: key }),
      };
      documents.set(key, doc);
    }
    const old = doc.getText(),
      oldRange = new Range(new Position(0, 0), doc.positionAt(old.length));
    if (value.text !== undefined) doc._set(value.text);
    doc.languageId = value.languageId || doc.languageId;
    if (opened || old !== doc.getText()) doc.version++;
    doc.eol = doc.getText().includes("\r\n") ? 2 : 1;
    doc.isDirty = !!value.isDirty;
    if (opened) documentOpened.fire(doc);
    else if (old !== doc.getText())
      documentChanged.fire({
        document: doc,
        contentChanges: [
          {
            range: oldRange,
            rangeOffset: 0,
            rangeLength: old.length,
            text: doc.getText(),
          },
        ],
        reason: undefined,
      });
    if (reason === "save") event("workspace.onDidSaveTextDocument").fire(doc);
    return doc;
  }
  async function openDocument(value) {
    if (typeof value === "string") value = Uri.file(value);
    if (!value?.scheme) {
      const uri = Uri.parse("untitled:Untitled-" + ++serial);
      return updateDocument({
        uri: uri.toString(),
        text: value?.content || "",
        languageId: value?.language || "plaintext",
      });
    }
    if (documents.has(value.toString())) return documents.get(value.toString());
    const provider = contentProviders.get(value.scheme);
    const text = provider
      ? await provider.provideTextDocumentContent(
          value,
          new api.CancellationTokenSource().token,
        )
      : value.scheme === "untitled" ? "" : Buffer.from(await api.workspace.fs.readFile(value)).toString("utf8");
    return updateDocument({
      uri: value.toString(),
      text,
      languageId: languageFor(value.fsPath),
    });
  }
  function languageFor(file) {
    const ext = path.extname(file);
    for (const e of extensions.values())
      for (const l of e.manifest.contributes?.languages || [])
        if (
          l.extensions?.includes(ext) ||
          l.filenames?.includes(path.basename(file))
        )
          return l.id;
    return (
      {
        ".ts": "typescript",
        ".tsx": "typescriptreact",
        ".js": "javascript",
        ".jsx": "javascriptreact",
        ".rs": "rust",
        ".py": "python",
        ".json": "json",
        ".md": "markdown",
        ".css": "css",
        ".html": "html",
      }[ext] || "plaintext"
    );
  }
  function makeEditor(doc, value = {}) {
    const key = doc.uri.toString();
    const previous = editorModels.get(key);
    const selections = (
      value.selections || previous?._selections || [
        {
          anchor: { line: 0, character: 0 },
          active: { line: 0, character: 0 },
        },
      ]
    ).map(
      (s) =>
        new Selection(
          position(s.anchor || s.start),
          position(s.active || s.end),
        ),
    );
    if (previous?.document === doc) {
      previous._selections = selections;
      previous.viewColumn = value.viewColumn ?? previous.viewColumn;
      if (value.visibleRanges) previous.visibleRanges = value.visibleRanges.map(range);
      if (value.options) previous.options = value.options;
      return previous;
    }
    const editor = {
      document: doc,
      _selections: selections,
      get selection() { return this._selections[0]; },
      set selection(value) { this.selections = [value]; },
      get selections() { return this._selections; },
      set selections(values) {
        if (!Array.isArray(values) || !values.length) throw new Error("An editor must have at least one selection");
        this._selections = values.map((value) => new Selection(position(value.anchor ?? value.start), position(value.active ?? value.end)));
        void request("setSelections", { uri: key, selections: this._selections.map(({ anchor, active }) => ({ anchor, active })) }).catch((error) => emit("output", { text: `Editor selection: ${error.message}` }));
      },
      visibleRanges: value.visibleRanges?.map(range) || [
        new Range(
          0,
          0,
          Math.max(0, doc.lineCount - 1),
          doc.lineAt(doc.lineCount - 1).text.length,
        ),
      ],
      options: value.options || {},
      viewColumn: value.viewColumn ?? 1,
      edit: async (callback, options) => {
        const edits = [];
        callback({
          replace: (r, t) => edits.push(api.TextEdit.replace(r, t)),
          insert: (p, t) => edits.push(api.TextEdit.insert(p, t)),
          delete: (r) => edits.push(api.TextEdit.delete(r)),
          setEndOfLine: (eol) => edits.push(api.TextEdit.setEndOfLine(eol)),
        });
        return applyEdits({
          documents: [
            {
              uri: doc.uri.toString(),
              version: doc.version,
              textBefore: doc.getText(),
              edits,
            },
          ],
          options,
        });
      },
      revealRange: (r, revealType) =>
        request("revealRange", {
          uri: doc.uri.toString(),
          range: r,
          revealType,
        }),
      setDecorations: (type, ranges) =>
        emit("decorations", { key: type.key, uri: doc.uri.toString(), ranges }),
      show: () => request("showDocument", { uri: doc.uri.toString() }),
      hide: () => request("closeDocument", { uri: doc.uri.toString() }),
    };
    editorModels.set(key, editor);
    return editor;
  }
  function matches(selector, doc) {
    if (!selector) return 0;
    if (Array.isArray(selector))
      return Math.max(0, ...selector.map((s) => matches(s, doc)));
    if (typeof selector === "string")
      return selector === "*" ? 5 : selector === doc.languageId ? 10 : 0;
    if (
      selector.language &&
      selector.language !== "*" &&
      selector.language !== doc.languageId
    )
      return 0;
    if (
      selector.scheme &&
      selector.scheme !== "*" &&
      selector.scheme !== doc.uri.scheme
    )
      return 0;
    if (selector.pattern && !globMatch(selector.pattern, doc.uri.fsPath))
      return 0;
    return 10;
  }
  function globExpression(pattern) {
    let s = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          s += "(?:.*/)?";
        } else s += ".*";
      } else if (c === "*") s += "[^/]*";
      else if (c === "?") s += "[^/]";
      else if (c === "{") s += "(?:";
      else if (c === "}") s += ")";
      else if (c === ",") s += "|";
      else s += c.replace(/[.()[\]\\+^$|]/g, "\\$&");
    }
    return new RegExp("^" + s + "$");
  }
  function globMatch(pattern, file) {
    const base =
      typeof pattern === "string"
        ? host.root()
        : pattern.baseUri?.fsPath || pattern.base || host.root();
    const glob = typeof pattern === "string" ? pattern : pattern.pattern;
    return globExpression(glob).test(
      (base ? path.relative(base, file) : file).split(path.sep).join("/"),
    );
  }
  async function findFiles(include, exclude, max = 10000, token) {
    const root =
      typeof include === "object"
        ? include.baseUri?.fsPath || include.base
        : host.root();
    if (!root) return [];
    const found = [];
    async function walk(dir) {
      if (token?.isCancellationRequested || found.length >= max) return;
      let children;
      try {
        children = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const c of children) {
        if (found.length >= max || token?.isCancellationRequested) break;
        const file = path.join(dir, c.name);
        if (
          (exclude && globMatch(exclude, file)) ||
          (exclude === undefined &&
            [".git", "node_modules", "target"].includes(c.name))
        )
          continue;
        if (c.isDirectory()) await walk(file);
        else if (c.isFile() && globMatch(include, file))
          found.push(Uri.file(file));
      }
    }
    await walk(root);
    return found;
  }
  function watchFiles(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
    const created = new EventEmitter(),
      changed = new EventEmitter(),
      deleted = new EventEmitter();
    const root =
      typeof pattern === "object"
        ? pattern.baseUri?.fsPath || pattern.base
        : host.root();
    const listeners = [];
    let stopped = false,
      known = new Set();
    const ext = own();
    let chain = Promise.resolve();
    const ready = root
      ? findFiles(pattern, null, 100000).then((files) => {
          known = new Set(files.map((u) => u.fsPath));
        })
      : Promise.resolve();
    if (root && fs.existsSync(root)) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (_kind, name) => {
          if (!name || stopped) return;
          const file = path.join(root, String(name));
          if (!globMatch(pattern, file)) return;
          chain = chain
            .then(() => ready)
            .then(async () => {
              const exists = await fs.promises.stat(file).then(
                (s) => s.isFile(),
                () => false,
              );
              if (stopped) return;
              const previous = known.has(file);
              if (exists) known.add(file);
              else known.delete(file);
              const uri = Uri.file(file);
              host.scope.run(ext, () => {
                if (!previous && exists && !ignoreCreate) created.fire(uri);
                else if (previous && !exists && !ignoreDelete)
                  deleted.fire(uri);
                else if (exists && !ignoreChange) changed.fire(uri);
              });
            })
            .catch((e) => console.error(e));
        });
        listeners.push(watcher);
      } catch (error) {
        console.warn("File watcher:", error.message);
      }
    }
    const dispose = () => {
      stopped = true;
      listeners.forEach((w) => w.close());
      created.dispose();
      changed.dispose();
      deleted.dispose();
      watcherDisposables.delete(dispose);
    };
    watcherDisposables.add(dispose);
    return {
      onDidCreate: created.event,
      onDidChange: changed.event,
      onDidDelete: deleted.event,
      ignoreCreateEvents: !!ignoreCreate,
      ignoreChangeEvents: !!ignoreChange,
      ignoreDeleteEvents: !!ignoreDelete,
      dispose,
    };
  }
  Object.defineProperties(api.workspace, {
    isTrusted: { get: () => true },
    workspaceFile: { get: () => undefined },
    notebookDocuments: { get: () => [] },
  });
  Object.assign(api.workspace, {
    openTextDocument: openDocument,
    findFiles,
    createFileSystemWatcher: watchFiles,
    getWorkspaceFolder(uri) {
      const root = host.root();
      if (!root || uri.scheme !== "file") return;
      const relative = path.relative(root, uri.fsPath);
      return relative !== ".." &&
        !relative.startsWith(".." + path.sep) &&
        !path.isAbsolute(relative)
        ? api.workspace.workspaceFolders?.[0]
        : undefined;
    },
    registerTextDocumentContentProvider(scheme, provider) {
      const entry = { provideTextDocumentContent: scoped(provider.provideTextDocumentContent.bind(provider)) };
      const subscription = register(contentProviders, scheme, entry);
      const revisions = new Map();
      const change = provider.onDidChange?.(async (uri) => {
        const key = uri.toString(), revision = (revisions.get(key) ?? 0) + 1;
        revisions.set(key, revision);
        if (!documents.has(key) || uri.scheme !== scheme) return;
        try {
          const text = await entry.provideTextDocumentContent(uri, new api.CancellationTokenSource().token);
          if (contentProviders.get(scheme) !== entry || revisions.get(key) !== revision || !documents.has(key)) return;
          const doc = updateDocument({ uri: key, text, languageId: documents.get(key).languageId });
          emit("documentContent", { uri: key, text: doc.getText(), readOnly: true });
        } catch (error) { emit("output", { text: `Content provider ${scheme}: ${error.message}` }); }
      });
      return new Disposable(() => { subscription.dispose(); change?.dispose(); revisions.clear(); });
    },
    registerFileSystemProvider(scheme, provider, options = {}) {
      if (scheme === "file") throw new Error("The built-in file provider cannot be replaced");
      return register(fileProviders, scheme, { provider, options, ext: own() });
    },
    applyEdit: (edit) =>
      applyEdits({
        documents: edit
          .entries()
          .map(([uri, edits]) => ({ uri: uri.toString(), edits })),
        files: edit.fileOperations,
      }),
    saveAll: () => request("saveAll"),
  });
  for (const name of [
    "onDidSaveTextDocument",
    "onWillSaveTextDocument",
    "onDidChangeWorkspaceFolders",
    "onDidCreateFiles",
    "onDidDeleteFiles",
    "onDidRenameFiles",
    "onWillCreateFiles",
    "onWillDeleteFiles",
    "onWillRenameFiles",
    "onDidGrantWorkspaceTrust",
    "onDidOpenNotebookDocument",
    "onDidChangeNotebookDocument",
    "onDidCloseNotebookDocument",
    "onDidSaveNotebookDocument",
  ])
    api.workspace[name] = event("workspace." + name).event;
  const localFs = api.workspace.fs;
  Object.assign(localFs, {
    delete: (uri, options) =>
      fs.promises.rm(uri.fsPath, {
        recursive: !!options?.recursive,
        force: false,
      }),
    rename: (a, b, options) => {
      if (!options?.overwrite && fs.existsSync(b.fsPath))
        throw api.FileSystemError.FileExists(b);
      return fs.promises.rename(a.fsPath, b.fsPath);
    },
    copy: (a, b, options) =>
      fs.promises.cp(a.fsPath, b.fsPath, {
        recursive: true,
        force: !!options?.overwrite,
        errorOnExist: !options?.overwrite,
      }),
    isWritableFileSystem: (scheme) =>
      scheme === "file" ? true : fileProviders.has(scheme) ? !fileProviders.get(scheme).options.isReadonly : undefined,
  });
  api.workspace.fs = new Proxy(localFs, {
    get: (target, key) => {
      const fn = target[key];
      if (typeof fn !== "function" || key === "isWritableFileSystem") return fn;
      return async (...args) => {
        const scheme = args[0]?.scheme;
        if (scheme === "file") {
          if ((key === "copy" || key === "rename") && args[1]?.scheme !== "file") throw api.FileSystemError.Unavailable("Cross-filesystem operations are not supported");
          try { return await fn(...args); }
          catch (error) {
            const translated = { ENOENT: "FileNotFound", EEXIST: "FileExists", EACCES: "NoPermissions", EPERM: "NoPermissions", EISDIR: "FileIsADirectory", ENOTDIR: "FileNotADirectory" }[error.code];
            if (translated) throw api.FileSystemError[translated](args[0]);
            throw error;
          }
        }
        const entry = fileProviders.get(scheme);
        if (!entry || typeof entry.provider[key] !== "function") throw api.FileSystemError.Unavailable(`No filesystem provider for ${scheme}`);
        if (entry.options.isReadonly && ["writeFile", "delete", "rename", "copy", "createDirectory"].includes(key)) throw api.FileSystemError.NoPermissions("Filesystem is read-only");
        if ((key === "copy" || key === "rename") && args[1]?.scheme !== scheme) throw api.FileSystemError.Unavailable("Cross-filesystem operations are not supported");
        const method = key === "createDirectory" ? "createDirectory" : key;
        return host.scope.run(entry.ext, () => entry.provider[method](...args, ...(key === "writeFile" ? [{ create: true, overwrite: true }] : [])));
      };
    },
  });
  function readOnlyDocument(uri) {
    return contentProviders.has(uri.scheme) || (uri.scheme !== "file" && uri.scheme !== "untitled" && api.workspace.fs.isWritableFileSystem(uri.scheme) !== true);
  }
  for (const name of [
    "onDidChangeActiveTextEditor",
    "onDidChangeVisibleTextEditors",
    "onDidChangeTextEditorSelection",
    "onDidChangeTextEditorVisibleRanges",
    "onDidChangeTextEditorOptions",
    "onDidChangeActiveColorTheme",
    "onDidChangeWindowState",
    "onDidOpenTerminal",
    "onDidCloseTerminal",
    "onDidChangeActiveTerminal",
    "onDidChangeTerminalState",
    "onDidChangeTerminalShellIntegration",
    "onDidStartTerminalShellExecution",
    "onDidEndTerminalShellExecution",
  ])
    api.window[name] = event("window." + name).event;
  const tabChanged = event("tabs"),
    groupChanged = event("tabGroups");
  const tabGroup = {
    isActive: true,
    viewColumn: 1,
    tabs: [],
    activeTab: undefined,
  };
  Object.defineProperties(api.window, {
    activeTextEditor: { get: () => activeEditor },
    visibleTextEditors: { get: () => editors },
    activeColorTheme: { get: () => theme },
    state: { get: () => ({ focused, active: focused }) },
    terminals: { get: () => terminals },
    activeTerminal: { get: () => terminals.find((t) => t._active) },
    activeNotebookEditor: { get: () => undefined },
    visibleNotebookEditors: { get: () => [] },
  });
  Object.assign(api.window, {
    tabGroups: {
      all: [tabGroup],
      activeTabGroup: tabGroup,
      onDidChangeTabs: tabChanged.event,
      onDidChangeTabGroups: groupChanged.event,
      close: (tabs) =>
        request("closeTabs", {
          tabs: (Array.isArray(tabs) ? tabs : [tabs])
            .map((t) => t.input?.uri?.toString())
            .filter(Boolean),
        }),
    },
    createTextEditorDecorationType(options) {
      const key = "decoration-" + ++serial;
      emit("decorationType", { key, options });
      return { key, dispose: () => emit("decorationTypeRemoved", { key }) };
    },
    showTextDocument: async (value, options, preserveFocus) => {
      if (typeof options === "number") options = { viewColumn: options, preserveFocus: !!preserveFocus };
      const doc = await openDocument(value);
      const shown = await request("showDocument", {
        uri: doc.uri.toString(),
        text: doc.getText(),
        readOnly: readOnlyDocument(doc.uri),
        languageId: doc.languageId,
        options,
      });
      if (shown === false) throw new Error(`Could not show document ${doc.uri}`);
      return activeEditor?.document === doc ? activeEditor : makeEditor(doc, { viewColumn: options?.viewColumn === -2 ? 2 : options?.viewColumn ?? 1 });
    },
    registerUriHandler: (handler) =>
      register(uriHandlers, own().id, {
        handleUri: scoped(handler.handleUri.bind(handler)),
      }),
    registerCustomEditorProvider: (id, provider) =>
      register(customEditors, id, { provider, ext: own() }),
    registerWebviewPanelSerializer: (id, serializer) =>
      register(serializers, id, { serializer, ext: own() }),
    showQuickPick: async (items, options = {}, token) => {
      if (token?.isCancellationRequested) return;
      items = await items;
      const answer = await request("quickPick", {
        items: items.map((item, index) =>
          typeof item === "string"
            ? { label: item, index }
            : { ...item, index },
        ),
        options,
      });
      return Array.isArray(answer)
        ? answer.map((index) => items[index])
        : answer === null
          ? undefined
          : items[answer];
    },
    showInputBox: async (options = {}, token) => {
      if (token?.isCancellationRequested) return;
      while (true) {
        const value = await request("inputBox", {
          options: { ...options, validateInput: undefined },
        });
        if (value === null) return;
        const error = await options.validateInput?.(value);
        if (!error || (typeof error === "object" && error.severity !== 3))
          return value;
        options = {
          ...options,
          value,
          prompt: typeof error === "string" ? error : error.message,
        };
      }
    },
    showOpenDialog: async (options) => {
      const values = await request("openDialog", { options });
      return values?.map(Uri.parse);
    },
    showSaveDialog: async (options) => {
      const value = await request("saveDialog", { options });
      return value ? Uri.parse(value) : undefined;
    },
    createStatusBarItem(id, alignment, priority) {
      if (typeof id !== "string") {
        priority = alignment;
        alignment = id;
        id = "status-" + ++serial;
      }
      const key = own().id + ":" + id;
      const item = {
        id,
        alignment,
        priority,
        text: "",
        tooltip: "",
        command: undefined,
        color: undefined,
        backgroundColor: undefined,
        name: id,
        _visible: false,
        show() {
          this._visible = true;
          emit("statusBar", { ...this, key, visible: true });
        },
        hide() {
          this._visible = false;
          emit("statusBar", { key, visible: false });
        },
        dispose() {
          emit("statusBar", { key, visible: false });
        },
      };
      return new Proxy(item, {
        set(target, property, value) {
          target[property] = value;
          if (target._visible)
            emit("statusBar", { ...target, key, visible: true });
          return true;
        },
      });
    },
    setStatusBarMessage(text, timeout) {
      emit("statusMessage", { text });
      const d = new Disposable(() => emit("statusMessage", { text: "" }));
      if (typeof timeout === "number")
        setTimeout(() => d.dispose(), timeout).unref();
      else timeout?.finally(() => d.dispose());
      return d;
    },
  });
  for (const [method, kind] of [
    ["showInformationMessage", "info"],
    ["showWarningMessage", "warning"],
    ["showErrorMessage", "error"],
  ])
    api.window[method] = async (message, ...items) => {
      const options =
        typeof items[0] === "object" && !("title" in items[0])
          ? items.shift()
          : {};
      if (!items.length && !options.modal) {
        emit("notification", { message, kind });
        return;
      }
      const answer = await request("message", {
        message,
        kind,
        options,
        items: items.map((i) => (typeof i === "string" ? { title: i } : i)),
      });
      return items[answer];
    };
  function activateTerminal(terminal) {
    const previous = terminals.find((item) => item._active);
    for (const item of terminals) item._active = item === terminal;
    if (previous !== terminal) event("window.onDidChangeActiveTerminal").fire(terminal);
  }
  function closeTerminal(terminal, exitCode, reason = 2, closePty = true) {
    if (terminal._closed) return;
    terminal._closed = true;
    if (terminal._active) activateTerminal(undefined);
    terminal._resolvePid(undefined);
    terminal.exitStatus = { code: exitCode, reason };
    const index = terminals.indexOf(terminal);
    if (index >= 0) terminals.splice(index, 1);
    if (closePty && terminal._pty) {
      try { host.scope.run(terminal._ext, () => terminal._pty.close()); }
      catch (error) { emit("output", { text: `Pseudoterminal close: ${error.message}` }); }
    }
    for (const subscription of terminal._ptySubscriptions ?? []) subscription?.dispose();
    event("window.onDidCloseTerminal").fire(terminal);
  }
  function pseudoInput(terminal, text) {
    if (terminal._closed || !terminal._pty) return Promise.resolve();
    if (!terminal.state.isInteractedWith) {
      terminal.state = { isInteractedWith: true };
      event("window.onDidChangeTerminalState").fire(terminal);
    }
    if (!terminal._ptyReady) {
      if (terminal._inputBytes + text.length > 1024 * 1024) return Promise.reject(new Error("Pseudoterminal input queue is full"));
      terminal._pendingInput.push(text); terminal._inputBytes += text.length;
      return Promise.resolve();
    }
    const work = terminal._inputTail.catch(() => {}).then(() => {
      if (!terminal._closed) return host.scope.run(terminal._ext, () => terminal._pty.handleInput?.(text));
    });
    terminal._inputTail = work;
    return work;
  }
  api.window.createTerminal = function (name, shellPath, shellArgs) {
    const options = typeof name === "object" ? { ...name } : { name, shellPath, shellArgs };
    const ext = own();
    options.env = { ...options.env };
    for (const collection of environments.values())
      for (const [key, mutation] of collection) {
        const before = options.env[key] ?? process.env[key] ?? "";
        options.env[key] = mutation.type === 1 ? mutation.value : mutation.type === 2 ? before + mutation.value : mutation.value + before;
      }
    const id = "extension-terminal-" + ++serial;
    let resolvePid;
    const terminal = {
      name: options.name || "Extension terminal", creationOptions: options,
      exitStatus: undefined, state: { isInteractedWith: false }, _active: false, _closed: false,
      _ext: ext, _pty: options.pty, _ptyOpened: false, _ptyReady: false, _pendingInput: [], _inputBytes: 0, _pendingOutput: [], _outputBytes: 0, _inputTail: Promise.resolve(),
      processId: new Promise((resolve) => (resolvePid = resolve)),
      sendText(text, addNewLine = true) {
        const data = text + (addNewLine ? "\r" : "");
        if (terminal._closed) return;
        if (terminal._pty) void pseudoInput(terminal, data).catch((error) => emit("output", { text: error.message }));
        else emit("terminalInput", { id, text: data });
      },
      show(preserveFocus) { if (terminal._closed) return; activateTerminal(terminal); emit("terminalShow", { id, preserveFocus }); },
      hide() { if (terminal._active) activateTerminal(undefined); emit("terminalHide", { id }); },
      dispose() { closeTerminal(terminal, undefined, 4); emit("terminalClose", { id }); },
    };
    Object.defineProperty(terminal, "_id", { value: id });
    Object.defineProperty(terminal, "_resolvePid", { value: resolvePid });
    terminals.push(terminal);
    if (options.pty) {
      resolvePid(undefined);
      terminal._ptySubscriptions = [
        options.pty.onDidWrite?.((value) => {
          if (terminal._closed) return;
          const text = String(value);
          if (terminal._ptyOpened) emit("pseudoTerminalOutput", { id, text });
          else { terminal._pendingOutput.push(text); terminal._outputBytes += text.length; while (terminal._outputBytes > 1024 * 1024 && terminal._pendingOutput.length) terminal._outputBytes -= terminal._pendingOutput.shift().length; }
        }),
        options.pty.onDidClose?.((code) => { closeTerminal(terminal, typeof code === "number" ? code : undefined, 2, false); emit("terminalClose", { id, exitCode: code }); }),
        options.pty.onDidChangeName?.((value) => { if (!terminal._closed) { terminal.name = String(value); emit("terminalName", { id, name: terminal.name }); } }),
      ];
    }
    const { pty, ...publicOptions } = options;
    emit("terminalCreate", { id, options: { ...publicOptions, pseudoterminal: !!pty } });
    event("window.onDidOpenTerminal").fire(terminal);
    return terminal;
  };
  const workbenchCommands = {
    "workbench.action.quickOpen": "files", "workbench.action.showCommands": "commands",
    "workbench.action.toggleSidebarVisibility": "sidebar", "workbench.action.togglePanel": "terminal",
    "workbench.action.toggleZenMode": "focus", "workbench.action.focusActiveEditorGroup": "focus-editor",
    "workbench.action.terminal.focus": "focus-terminal", "workbench.action.terminal.toggleTerminal": "focus-terminal",
    "workbench.action.terminal.new": "new-terminal", "workbench.action.terminal.split": "split-terminal",
    "workbench.action.terminal.kill": "close-terminal", "workbench.action.files.saveAll": "save-all",
    "workbench.action.files.newUntitledFile": "new", "workbench.action.files.openFolder": "open",
    "workbench.action.splitEditorRight": "split", "workbench.action.nextEditor": "next-tab",
    "workbench.action.previousEditor": "previous-tab", "workbench.action.closeAllEditors": "close-all",
    "workbench.action.findInFiles": "global", "workbench.action.gotoLine": "goto",
    "editor.action.formatDocument": "format", "editor.action.revealDefinition": "definition",
    "editor.action.toggleWordWrap": "wrap", "actions.find": "find"
  };
  const providerCommands = {
    "vscode.executeHoverProvider": "provideHover", "vscode.executeDefinitionProvider": "provideDefinition",
    "vscode.executeDeclarationProvider": "provideDeclaration", "vscode.executeTypeDefinitionProvider": "provideTypeDefinition",
    "vscode.executeImplementationProvider": "provideImplementation", "vscode.executeDocumentSymbolProvider": "provideDocumentSymbols",
    "vscode.executeCompletionItemProvider": "provideCompletionItems", "vscode.executeCodeActionProvider": "provideCodeActions",
    "vscode.executeFormatDocumentProvider": "provideDocumentFormattingEdits"
  };
  const getCommands = api.commands.getCommands;
  api.commands.getCommands = async (filterInternal = false) => [...new Set([
    ...await getCommands(), ...[...extensions.values()].flatMap((extension) => (extension.manifest?.contributes?.commands ?? []).map((command) => command.command)), ...Object.keys(workbenchCommands), ...Object.keys(providerCommands),
    "setContext", "vscode.open", "vscode.openWith", "vscode.diff", "workbench.action.files.save", "workbench.action.closeActiveEditor", "workbench.action.openSettings", "workbench.action.openGlobalSettings"
  ])].filter((id) => !filterInternal || !id.startsWith("_"));
  const execute = api.commands.executeCommand;
  api.commands.executeCommand = async (id, ...args) => {
    if (workbenchCommands[id]) return request("executeBuiltin", { command: workbenchCommands[id], args });
    if (providerCommands[id]) {
      const doc = await openDocument(args[0]);
      const method = providerCommands[id];
      const values = await runtime.methods.languageFeature({ method, uri: doc.uri.toString(),
        position: method !== "provideDocumentFormattingEdits" && method !== "provideDocumentSymbols" && method !== "provideCodeActions" ? args[1] : undefined,
        range: method === "provideCodeActions" ? args[1] : undefined,
        context: method === "provideDocumentFormattingEdits" ? args[1] : method === "provideCompletionItems" ? { triggerKind: args[2] ? 1 : 0, triggerCharacter: args[2] } : method === "provideCodeActions" ? { diagnostics: api.languages.getDiagnostics(doc.uri), only: args[2] ? new api.CodeActionKind(String(args[2])) : undefined, triggerKind: 1 } : args[2],
      });
      if (method === "provideCompletionItems") return { items: values.flatMap((value) => Array.isArray(value) ? value : value.items ?? []), isIncomplete: values.some((value) => value.isIncomplete) };
      return values.flat();
    }
    if (id === "setContext") {
      emit("context", { key: args[0], value: args[1] });
      return;
    }
    if (id.endsWith(".focus")) {
      const viewId = id.slice(0, -6);
      await host.activateEvent("onView:" + viewId);
      if (providers.has(viewId)) {
        await host.resolveView(viewId);
        emit("focusWebview", { id: viewId });
        return;
      }
    }
    if (id === "vscode.open" || id === "vscode.openWith") {
      const uri = args[0];
      if (id === "vscode.openWith" && customEditors.has(args[1])) {
        const entry = customEditors.get(args[1]);
        return host.scope.run(entry.ext, async () => {
          const doc =
            (await entry.provider.openCustomDocument?.(
              uri,
              {},
              new api.CancellationTokenSource().token,
            )) || (await openDocument(uri));
          const panel = host.makeWebview(
            args[1] + ":" + ++serial,
            path.basename(uri.path),
            {},
            entry.ext,
          );
          await (
            entry.provider.resolveCustomEditor ||
            entry.provider.resolveCustomTextEditor
          ).call(
            entry.provider,
            doc,
            panel,
            new api.CancellationTokenSource().token,
          );
        });
      }
      return api.window.showTextDocument(uri, args[1]);
    }
    if (id === "vscode.diff") {
      const original = await openDocument(args[0]),
        modified = await openDocument(args[1]);
      return request("diff", {
        original: { uri: original.uri.toString(), text: original.getText() },
        modified: { uri: modified.uri.toString(), text: modified.getText() },
        title: args[2],
        options: args[3],
      });
    }
    if (
      id === "workbench.action.openSettings" ||
      id === "workbench.action.openGlobalSettings"
    )
      return request("openSettings", { query: args[0] });
    if (id === "workbench.action.files.save")
      return request("saveDocument", {
        uri: activeEditor?.document.uri.toString(),
      });
    if (id === "workbench.action.closeActiveEditor")
      return request("closeDocument", {
        uri: activeEditor?.document.uri.toString(),
      });
    return execute(id, ...args);
  };
  api.commands.registerTextEditorCommand = (id, fn, self) =>
    api.commands.registerCommand(id, (...args) => {
      if (!activeEditor) return;
      return activeEditor.edit((edit) =>
        fn.call(self, activeEditor, edit, ...args),
      );
    });
  api.languages = {
    match: matches,
    onDidChangeDiagnostics: event("diagnostics").event,
    getDiagnostics(uri) {
      if (uri)
        return [...diagnosticCollections.values()].flatMap(
          (c) => c.get(uri) || [],
        );
      const all = new Map();
      for (const c of diagnosticCollections.values())
        for (const [u, d] of c) {
          const key = u.toString();
          if (!all.has(key)) all.set(key, [u, []]);
          all.get(key)[1].push(...d);
        }
      return [...all.values()];
    },
    createDiagnosticCollection(name = "collection-" + ++serial) {
      const values = new Map(),
        key = own().id + ":" + name;
      const collection = {
        name,
        set(uri, diagnostics) {
          if (Array.isArray(uri)) {
            for (const [u, d] of uri) this.set(u, d);
            return;
          }
          if (diagnostics) values.set(uri.toString(), [uri, diagnostics]);
          else values.delete(uri.toString());
          emit("diagnostics", {
            collection: key,
            uri: uri.toString(),
            diagnostics: diagnostics || [],
          });
          event("diagnostics").fire({ uris: [uri] });
        },
        get: (uri) => values.get(uri.toString())?.[1],
        has: (uri) => values.has(uri.toString()),
        delete(uri) {
          this.set(uri, undefined);
        },
        clear() {
          for (const [uri] of values.values()) this.delete(uri);
        },
        dispose() {
          this.clear();
          diagnosticCollections.delete(key);
        },
        forEach(fn, self) {
          for (const [uri, d] of values.values()) fn.call(self, uri, d, this);
        },
        [Symbol.iterator]: () => values.values(),
      };
      diagnosticCollections.set(key, collection);
      return collection;
    },
    getLanguages: async () => [
      ...new Set(
        [...documents.values()]
          .map((d) => d.languageId)
          .concat(
            [...extensions.values()].flatMap((e) =>
              (e.manifest.contributes?.languages || []).map((l) => l.id),
            ),
          ),
      ),
    ],
    setTextDocumentLanguage: async (doc, languageId) => {
      doc.languageId = languageId;
      documentClosed.fire(doc);
      documentOpened.fire(doc);
      return doc;
    },
  };
  for (const method of [
    "CompletionItem",
    "Hover",
    "Definition",
    "Declaration",
    "TypeDefinition",
    "Implementation",
    "Reference",
    "DocumentSymbol",
    "WorkspaceSymbol",
    "CodeActions",
    "CodeLens",
    "DocumentFormattingEdit",
    "DocumentRangeFormattingEdit",
    "DocumentHighlight",
    "DocumentLink",
    "FoldingRange",
    "SelectionRange",
    "Rename",
    "SignatureHelp",
    "InlineCompletionItem",
    "InlayHints",
    "DocumentSemanticTokens",
    "DocumentRangeSemanticTokens",
    "OnTypeFormattingEdit",
    "Color",
    "LinkedEditingRange",
    "CallHierarchy",
    "TypeHierarchy",
    "InlineValues",
  ]) {
    api.languages["register" + method + "Provider"] = (
      selector,
      provider,
      ...options
    ) => {
      const id = "provider-" + ++serial;
      const ext = own();
      languageProviders.set(id, { method, selector, provider, options, ext });
      emit("languageProvider", { id, method, selector });
      const subscription = provider.onDidChangeCodeLenses?.(
        scoped(() => emit("languageProviderChanged", { id })),
      );
      return new Disposable(() => {
        subscription?.dispose();
        languageProviders.delete(id);
        emit("languageProviderRemoved", { id });
      });
    };
  }
  Object.assign(api.env, {
    appRoot: path.dirname(process.execPath),
    remoteName: undefined,
    isTelemetryEnabled: false,
    isNewAppInstall: false,
    machineId: crypto
      .createHash("sha256")
      .update(os.hostname() + host.storage())
      .digest("hex"),
    sessionId: crypto.randomUUID(),
    onDidChangeTelemetryEnabled: event("telemetry").event,
    clipboard: {
      readText: () => request("clipboardRead"),
      writeText: (text) => request("clipboardWrite", { text }),
    },
    openExternal: (uri) => request("openExternal", { uri: uri.toString() }),
    asExternalUri: async (uri) => uri,
    createTelemetryLogger(sender) {
      return {
        isUsageEnabled: false,
        isErrorsEnabled: false,
        onDidChangeEnableStates: event("telemetry").event,
        logUsage() {},
        logError() {},
        dispose() {
          sender.flush?.();
        },
      };
    },
  });
  api.lm = {
    isModelProxyAvailable: false,
    onDidChangeModelProxyAvailability: event("modelProxy").event,
  };
  api.notebooks = {
    onDidChangeNotebookCellStatusBarItems: event("notebooks").event,
  };
  api.extensions.onDidChange = event("extensions").event;
  class NotebookCellOutputItem {
    constructor(data, mime) {
      this.data = data;
      this.mime = mime;
    }
    static text(value, mime = "text/plain") {
      return new this(Buffer.from(value), mime);
    }
    static json(value, mime = "application/json") {
      return this.text(JSON.stringify(value), mime);
    }
    static error(e) {
      return this.json(
        { name: e.name, message: e.message, stack: e.stack },
        "application/vnd.code.notebook.error",
      );
    }
  }
  class TabInputCustom {
    constructor(uri, viewType) {
      Object.assign(this, { uri, viewType });
    }
  }
  Object.assign(api, { NotebookCellOutputItem, TabInputCustom });
  const runtime = {
    request,
    updateDocument,
    environment(ext) {
      const file = path.join(host.storage(), ext.id, "environment.json");
      let initial = [];
      try {
        initial = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
      const values = new Map(initial);
      const persist = () => {
        if (collection.persistent) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify([...values]));
        } else fs.rmSync(file, { force: true });
      };
      const collection = {
        persistent: true,
        description: undefined,
        get: (key) => values.get(key),
        getScoped: () => collection,
        replace: (key, value) => {
          values.set(key, { value, type: 1 });
          persist();
        },
        append: (key, value) => {
          values.set(key, { value, type: 2 });
          persist();
        },
        prepend: (key, value) => {
          values.set(key, { value, type: 3 });
          persist();
        },
        delete: (key) => {
          values.delete(key);
          persist();
        },
        clear: () => {
          values.clear();
          persist();
        },
        forEach: (fn, self) =>
          values.forEach((value, key) => fn.call(self, key, value, collection)),
        [Symbol.iterator]: () => values.entries(),
      };
      environments.set(ext.id, collection);
      return collection;
    },
    methods: {
      async readDocument({ uri }) {
        const doc = await openDocument(Uri.parse(uri));
        return { text: doc.getText(), languageId: doc.languageId, readOnly: readOnlyDocument(doc.uri) };
      },
      async saveVirtualDocument({ uri, text }) {
        const parsed = Uri.parse(uri);
        await api.workspace.fs.writeFile(parsed, Buffer.from(text));
        const doc = documents.get(uri);
        if (doc) updateDocument({ uri, text, isDirty: false, languageId: doc.languageId }, "save");
        return true;
      },
      async fileOperations({ files = [] }) {
        for (const op of files) {
          const revive = (u) => Uri.parse(u.external || u);
          if (op.kind === "create") {
            const u = revive(op.uri);
            if (op.options?.ignoreIfExists && fs.existsSync(u.fsPath)) continue;
            if (!op.options?.overwrite && fs.existsSync(u.fsPath))
              throw api.FileSystemError.FileExists(u);
            await api.workspace.fs.writeFile(u, Buffer.alloc(0));
            event("workspace.onDidCreateFiles").fire({ files: [u] });
          } else if (op.kind === "delete") {
            const u = revive(op.uri);
            await api.workspace.fs.delete(u, op.options);
            event("workspace.onDidDeleteFiles").fire({ files: [u] });
          } else if (op.kind === "rename") {
            const oldUri = revive(op.oldUri),
              newUri = revive(op.newUri);
            await api.workspace.fs.rename(oldUri, newUri, op.options);
            event("workspace.onDidRenameFiles").fire({
              files: [{ oldUri, newUri }],
            });
          }
        }
        return true;
      },
      workbenchResponse({ id, result, error }) {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (error) entry.reject(new Error(error));
        else entry.resolve(result);
      },
      editorState({
        documents: values = [],
        activeUri,
        selections,
        themeKind,
        focused: focus,
      }) {
        const old = activeEditor;
        const open = new Set();
        for (const value of values) {
          open.add(value.uri);
          updateDocument(value, value.reason);
        }
        for (const [uri, doc] of documents)
          if (managedUris.has(uri) && !open.has(uri)) {
            doc.isClosed = true;
            documents.delete(uri);
            editorModels.delete(uri);
            documentClosed.fire(doc);
          }
        managedUris = open;
        const previous = editors;
        editors = values
          .filter((v) => v.visible !== false)
          .map((v) => makeEditor(documents.get(v.uri), v));
        activeEditor = editors.find(
          (e) => e.document.uri.toString() === activeUri,
        );
        if (selections && activeEditor) {
          activeEditor._selections = selections.map(
            (s) => new Selection(position(s.anchor), position(s.active)),
          );
          event("window.onDidChangeTextEditorSelection").fire({
            textEditor: activeEditor,
            selections: activeEditor.selections,
            kind: 3,
          });
        }
        if (old?.document !== activeEditor?.document)
          event("window.onDidChangeActiveTextEditor").fire(activeEditor);
        if (
          previous.map((e) => e.document.uri.toString()).join() !==
          editors.map((e) => e.document.uri.toString()).join()
        )
          event("window.onDidChangeVisibleTextEditors").fire(editors);
        if (themeKind && theme.kind !== themeKind) {
          theme = { kind: themeKind };
          event("window.onDidChangeActiveColorTheme").fire(theme);
        }
        if (focus !== undefined && focus !== focused) {
          focused = focus;
          event("window.onDidChangeWindowState").fire({
            focused,
            active: focused,
          });
        }
        const oldTabs = tabGroup.tabs;
        tabGroup.tabs = values.map((value) => ({
          input: new api.TabInputText(documents.get(value.uri).uri),
          label: path.basename(documents.get(value.uri).fileName),
          isActive: value.uri === activeUri,
          isDirty: documents.get(value.uri).isDirty,
          isPinned: true,
          isPreview: false,
          group: tabGroup,
        }));
        tabGroup.activeTab = tabGroup.tabs.find((t) => t.isActive);
        tabChanged.fire({
          opened: tabGroup.tabs.filter(
            (t) =>
              !oldTabs.some(
                (o) => o.input.uri.toString() === t.input.uri.toString(),
              ),
          ),
          closed: oldTabs.filter(
            (o) =>
              !tabGroup.tabs.some(
                (t) => t.input.uri.toString() === o.input.uri.toString(),
              ),
          ),
          changed: tabGroup.tabs,
        });
        return null;
      },
      async documentSaved({ uri, text }) {
        const doc = documents.get(uri);
        if (doc) updateDocument({ uri, text, isDirty: false, languageId: doc.languageId }, "save");
      },
      async handleUri({ uri }) {
        const value = Uri.parse(uri);
        await host.activateEvent("onUri");
        const handler = uriHandlers.get(value.authority.toLowerCase());
        if (!handler)
          throw new Error("No extension URI handler for " + value.authority);
        await handler.handleUri(value);
      },
      terminalState({ id, pid, closed, exitCode, active, reason }) {
        const terminal = terminals.find((t) => t._id === id);
        if (active) activateTerminal(terminal);
        if (!terminal) return;
        if (pid !== undefined) terminal._resolvePid(pid);
        if (closed) closeTerminal(terminal, exitCode, reason ?? 2);
      },
      async pseudoTerminalOpen({ id, dimensions }) {
        const terminal = terminals.find((t) => t._id === id);
        if (!terminal?._pty || terminal._closed) return;
        if (terminal._openPromise) return terminal._openPromise;
        terminal._openPromise = host.scope.run(terminal._ext, async () => {
          terminal._ptyOpened = true;
          for (const text of terminal._pendingOutput.splice(0)) emit("pseudoTerminalOutput", { id, text });
          terminal._outputBytes = 0;
          await terminal._pty.open(dimensions);
          if (terminal._closed) return;
          terminal._ptyReady = true;
          for (const text of terminal._pendingInput.splice(0)) await pseudoInput(terminal, text);
          terminal._inputBytes = 0;
        });
        try { await terminal._openPromise; }
        catch (error) { emit("notification", { kind: "error", message: `Pseudoterminal failed: ${error.message}` }); closeTerminal(terminal, undefined, 2); emit("terminalClose", { id }); throw error; }
      },
      pseudoTerminalInput({ id, text }) {
        const terminal = terminals.find((t) => t._id === id);
        return terminal?._pty ? pseudoInput(terminal, String(text)) : undefined;
      },
      async pseudoTerminalResize({ id, dimensions }) {
        const terminal = terminals.find((t) => t._id === id);
        if (!terminal?._ptyOpened || terminal._closed) return;
        return host.scope.run(terminal._ext, () => terminal._pty.setDimensions?.(dimensions));
      },
      async languageFeature({ method, uri, position: pos, range: r, context }) {
        const doc = documents.get(uri);
        if (!doc) return [];
        const result = [];
        for (const entry of languageProviders.values()) {
          if (!matches(entry.selector, doc)) continue;
          const fn = entry.provider[method];
          if (!fn) continue;
          const token = new api.CancellationTokenSource().token;
          let args = [
            doc,
            ...(pos ? [position(pos)] : r ? [range(r)] : []),
            token,
          ];
          if (
            method === "provideCompletionItems" ||
            method === "provideInlineCompletionItems"
          )
            args.push(context || { triggerKind: 0 });
          else if (method === "provideCodeActions")
            args = [doc, range(r), context || { diagnostics: [] }, token];
          else if (method === "provideDocumentFormattingEdits")
            args = [doc, context || { tabSize: 2, insertSpaces: true }, token];
          const value = await host.scope.run(entry.ext, () =>
            fn.call(entry.provider, ...args),
          );
          if (value) result.push(value);
        }
        return result;
      },
    },
    shutdown() {
      for (const terminal of [...terminals]) { closeTerminal(terminal, undefined, 1); emit("terminalClose", { id: terminal._id }); }
      for (const dispose of watcherDisposables) dispose();
      for (const p of pending.values())
        p.reject(new Error("Extension host shutting down"));
      pending.clear();
    },
  };
  return runtime;
};
