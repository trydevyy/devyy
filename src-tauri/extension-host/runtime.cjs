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
  const quickInput = require("./quick-input.cjs")(api, host);
  const events = new Map();
  function event(name) {
    if (!events.has(name)) events.set(name, new EventEmitter());
    return events.get(name);
  }
  const pending = new Map();
  const progressTasks = new Map();
  let serial = 0,
    activeEditor,
    editors = [],
    theme = { kind: 2 },
    focused = true;
  function request(method, params = {}, token) {
    if (token?.isCancellationRequested) return Promise.resolve(null);
    const id = String(++serial);
    const ext = own();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, owner: ext.id };
      pending.set(id, entry);
      entry.cancel = token?.onCancellationRequested(() => {
        if (!pending.delete(id)) return;
        entry.cancel?.dispose();
        emit("cancelRequest", { id, extension: ext.id });
        resolve(null);
      });
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
            text:
              edit.newText !== undefined
                ? edit.newText
                : edit.snippet
                  ? typeof edit.snippet === "string"
                    ? edit.snippet
                    : edit.snippet.value
                  : "",
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
    return new Disposable(() => {
      if (map.get(key) === value) map.delete(key);
    });
  }
  const diagnosticCollections = new Map(),
    languageProviders = new Map(),
    contentProviders = new Map(),
    fileProviders = new Map(),
    uriHandlers = new Map(),
    customEditors = new Map(),
    serializers = new Map(),
    fileDecorationProviders = new Map(),
    terminalProfileProviders = new Map(),
    terminalLinkProviders = new Set(),
    timelineProviders = new Map(),
    notebookSerializers = new Map(),
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
      let lines = [""],
        lineStarts = [0];
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
          for (const match of value.matchAll(/\r?\n/g))
            lineStarts.push(match.index + match[0].length);
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
          return (
            lineStarts[p.line] +
            Math.max(0, Math.min(p.character, lines[p.line].length))
          );
        },
        positionAt(offset) {
          const n = Math.max(0, Math.min(offset, text.length));
          let low = 0,
            high = lineStarts.length;
          while (low + 1 < high) {
            const mid = (low + high) >> 1;
            if (lineStarts[mid] <= n) low = mid;
            else high = mid;
          }
          return new Position(
            low,
            Math.min(n - lineStarts[low], lines[low].length),
          );
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
    doc.isClosed = false;
    doc.isUntitled = doc.uri.scheme === "untitled";
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
      : value.scheme === "untitled"
        ? ""
        : Buffer.from(await api.workspace.fs.readFile(value)).toString("utf8");
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
      value.selections ||
      previous?._selections || [
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
      if (value.visibleRanges)
        previous.visibleRanges = value.visibleRanges.map(range);
      if (value.options) previous.options = value.options;
      return previous;
    }
    const editor = {
      document: doc,
      _selections: selections,
      get selection() {
        return this._selections[0];
      },
      set selection(value) {
        this.selections = [value];
      },
      get selections() {
        return this._selections;
      },
      set selections(values) {
        if (!Array.isArray(values) || !values.length)
          throw new Error("An editor must have at least one selection");
        this._selections = values.map(
          (value) =>
            new Selection(
              position(value.anchor ?? value.start),
              position(value.active ?? value.end),
            ),
        );
        void request("setSelections", {
          uri: key,
          selections: this._selections.map(({ anchor, active }) => ({
            anchor,
            active,
          })),
        }).catch((error) =>
          emit("output", { text: `Editor selection: ${error.message}` }),
        );
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
      insertSnippet: async (snippet, location, options) => {
        const raw =
          typeof snippet === "string" ? snippet : (snippet?.value ?? "");
        const text = raw
          .replace(/\$\{\d+\|([^,|]+)[^}]*\|\}/g, "$1")
          .replace(/\$\{\d+:([^}]*)\}/g, "$1")
          .replace(/\$\d+|\$\{\d+\}/g, "")
          .replace(/\$\{TM_SELECTED_TEXT(:[^}]*)?\}/g, "");
        const loc = location
          ? location instanceof Position
            ? new Range(location, location)
            : location
          : editor.selection || new Range(0, 0, 0, 0);
        return editor.edit((edit) => {
          edit.replace(loc, text);
        }, options);
      },
      revealRange: (r, revealType) =>
        request("revealRange", {
          uri: doc.uri.toString(),
          range: r,
          revealType,
        }),
      setDecorations: (type, rangesOrOptions) => {
        const list = Array.isArray(rangesOrOptions) ? rangesOrOptions : [];
        const ranges = list.map((item) => {
          if (item && item.range) {
            return {
              range: item.range,
              hoverMessage: item.hoverMessage,
              renderOptions: item.renderOptions,
            };
          }
          return item;
        });
        emit("decorations", {
          key: type?.key || String(type),
          uri: doc.uri.toString(),
          ranges,
        });
      },
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
    if (
      selector.notebookType &&
      selector.notebookType !== "*" &&
      selector.notebookType !== doc.notebookType
    )
      return 0;
    if (selector.pattern && !globMatch(selector.pattern, doc.uri.fsPath))
      return 0;
    return 10;
  }
  function globExpression(pattern) {
    let s = "";
    let braces = 0;
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
      else if (c === "{") {
        s += "(?:";
        braces++;
      } else if (c === "}" && braces) {
        s += ")";
        braces--;
      } else if (c === "," && braces) s += "|";
      else if (c === "[" && pattern.indexOf("]", i + 1) > i + 1) {
        const end = pattern.indexOf("]", i + 1);
        const chars = pattern.slice(i + 1, end);
        s += chars.startsWith("!")
          ? "[^/" + chars.slice(1).replace(/\\/g, "\\\\") + "]"
          : "[" + chars.replace(/^\^/, "\\^").replace(/\\/g, "\\\\") + "]";
        i = end;
      } else s += c.replace(/[.()[\]\\+^$|]/g, "\\$&");
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
    const glob = typeof include === "string" ? include : include?.pattern;
    const recursive = !glob || glob.includes("**");
    const maxDepth =
      !recursive && typeof glob === "string"
        ? glob.split("/").length - 1
        : Infinity;
    const found = [];
    async function walk(dir, depth = 0) {
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
        if (c.isDirectory()) {
          if (depth < maxDepth) await walk(file, depth + 1);
        } else if (c.isFile() && (!include || globMatch(include, file)))
          found.push(Uri.file(file));
      }
    }
    await walk(root, 0);
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
  let workspaceFoldersOverride = undefined;
  const onDidGrantWorkspaceTrustEmitter = event("workspace.trust");
  Object.defineProperties(api.workspace, {
    isTrusted: { get: () => true },
    workspaceFile: { get: () => undefined },
    name: {
      get: () => api.workspace.workspaceFolders?.[0]?.name,
      configurable: true,
      enumerable: true,
    },
    notebookDocuments: { get: () => [] },
    workspaceFolders: {
      get: () => {
        if (workspaceFoldersOverride !== undefined)
          return workspaceFoldersOverride;
        const root = host.root();
        return root
          ? [
              {
                uri: Uri.file(root),
                name: path.basename(root),
                index: 0,
              },
            ]
          : undefined;
      },
      configurable: true,
      enumerable: true,
    },
  });
  Object.assign(api.workspace, {
    onDidGrantWorkspaceTrust: onDidGrantWorkspaceTrustEmitter.event,
    async requestWorkspaceTrust(options) {
      return true;
    },
    openTextDocument: openDocument,
    openUntitledTextDocument: (options) => openDocument(options),
    findFiles,
    createFileSystemWatcher: watchFiles,
    getWorkspaceFolder(uri) {
      if (!uri) return undefined;
      const fsPath = uri.fsPath || (typeof uri === "string" ? uri : "");
      if (!fsPath) return undefined;
      const folders = api.workspace.workspaceFolders;
      if (!folders || !folders.length) return undefined;
      let bestMatch = undefined;
      let longestLen = -1;
      for (const folder of folders) {
        const root = folder.uri?.fsPath;
        if (!root) continue;
        const relative = path.relative(root, fsPath);
        if (
          relative !== ".." &&
          !relative.startsWith(".." + path.sep) &&
          !path.isAbsolute(relative)
        ) {
          if (root.length > longestLen) {
            longestLen = root.length;
            bestMatch = folder;
          }
        }
      }
      return bestMatch;
    },
    asRelativePath(value, includeWorkspaceFolder) {
      const fsPath = typeof value === "string" ? value : value?.fsPath;
      if (!fsPath) return String(value ?? "");
      const folder = api.workspace.getWorkspaceFolder(
        typeof value === "string" ? Uri.file(value) : value,
      );
      if (folder?.uri?.fsPath) {
        const rel = path.relative(folder.uri.fsPath, fsPath);
        if (
          includeWorkspaceFolder &&
          api.workspace.workspaceFolders &&
          api.workspace.workspaceFolders.length > 1
        ) {
          return path.join(folder.name, rel);
        }
        return rel;
      }
      const root = host.root();
      return root ? path.relative(root, fsPath) : String(fsPath);
    },
    updateWorkspaceFolders(start, deleteCount, ...workspaceFoldersToAdd) {
      start = Math.max(0, Number(start) || 0);
      deleteCount =
        deleteCount === undefined || deleteCount === null
          ? 0
          : Math.max(0, Number(deleteCount) || 0);
      const current = api.workspace.workspaceFolders
        ? [...api.workspace.workspaceFolders]
        : [];
      const removed = current.slice(start, start + deleteCount);
      const added = (workspaceFoldersToAdd || []).map((f, i) => ({
        uri: f.uri,
        name: f.name || path.basename(f.uri.fsPath),
        index: start + i,
      }));
      current.splice(start, deleteCount, ...added);
      current.forEach((f, idx) => {
        f.index = idx;
      });
      workspaceFoldersOverride = current.length > 0 ? current : undefined;
      event("workspace.onDidChangeWorkspaceFolders").fire({ added, removed });
      return true;
    },
    registerTextDocumentContentProvider(scheme, provider) {
      const entry = {
        provideTextDocumentContent: scoped(
          provider.provideTextDocumentContent.bind(provider),
        ),
      };
      const subscription = register(contentProviders, scheme, entry);
      const revisions = new Map();
      const change = provider.onDidChange?.(async (uri) => {
        const key = uri.toString(),
          revision = (revisions.get(key) ?? 0) + 1;
        revisions.set(key, revision);
        if (!documents.has(key) || uri.scheme !== scheme) return;
        try {
          const text = await entry.provideTextDocumentContent(
            uri,
            new api.CancellationTokenSource().token,
          );
          if (
            contentProviders.get(scheme) !== entry ||
            revisions.get(key) !== revision ||
            !documents.has(key)
          )
            return;
          const doc = updateDocument({
            uri: key,
            text,
            languageId: documents.get(key).languageId,
          });
          emit("documentContent", {
            uri: key,
            text: doc.getText(),
            readOnly: true,
          });
        } catch (error) {
          emit("output", {
            text: `Content provider ${scheme}: ${error.message}`,
          });
        }
      });
      return new Disposable(() => {
        subscription.dispose();
        change?.dispose();
        revisions.clear();
      });
    },
    registerFileSystemProvider(scheme, provider, options = {}) {
      if (scheme === "file")
        throw new Error("The built-in file provider cannot be replaced");
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
    save: (uri) => request("saveDocument", { uri: uri?.toString() }),
    saveAs: (uri) => request("saveDocumentAs", { uri: uri?.toString() }),
    registerTimelineProvider(scheme, provider) {
      const id = "timeline-" + ++serial;
      timelineProviders.set(id, { scheme, provider, ext: own() });
      const sub = provider.onDidChange?.(
        scoped((e) => emit("timelineChanged", { id, event: e })),
      );
      return new Disposable(() => {
        sub?.dispose();
        timelineProviders.delete(id);
      });
    },
    registerTaskProvider: (type, provider) =>
      api.tasks.registerTaskProvider(type, provider),
    registerNotebookSerializer(notebookType, serializer, options) {
      notebookSerializers.set(notebookType, {
        serializer,
        options,
        ext: own(),
      });
      return new Disposable(() => notebookSerializers.delete(notebookType));
    },
    async openNotebookDocument(uriOrType, data) {
      const uri =
        typeof uriOrType === "string"
          ? uriOrType.includes(":")
            ? Uri.parse(uriOrType)
            : Uri.file(uriOrType)
          : uriOrType?.scheme
            ? uriOrType
            : Uri.parse("untitled:notebook");
      const cells = data?.cells || [];
      return {
        uri,
        notebookType:
          typeof uriOrType === "string" && !uriOrType.includes(":")
            ? uriOrType
            : "jupyter-notebook",
        version: 1,
        isDirty: false,
        isUntitled: uri.scheme === "untitled",
        isClosed: false,
        metadata: data?.metadata || {},
        cellCount: cells.length,
        cellAt: (index) => cells[index],
        getCells: (range) =>
          range ? cells.slice(range.start, range.end) : cells,
        save: async () => true,
      };
    },
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
    writeFile: async (uri, content, options) => {
      if (options?.overwrite === false && fs.existsSync(uri.fsPath)) {
        throw api.FileSystemError.FileExists(uri);
      }
      return fs.promises.writeFile(uri.fsPath, content);
    },
    isWritableFileSystem: (scheme) =>
      scheme === "file"
        ? true
        : fileProviders.has(scheme)
          ? !fileProviders.get(scheme).options.isReadonly
          : undefined,
  });
  api.workspace.fs = new Proxy(localFs, {
    get: (target, key) => {
      const fn = target[key];
      if (typeof fn !== "function" || key === "isWritableFileSystem") return fn;
      return async (...args) => {
        const scheme = args[0]?.scheme;
        if (scheme === "file") {
          if (
            (key === "copy" || key === "rename") &&
            args[1]?.scheme !== "file"
          )
            throw api.FileSystemError.Unavailable(
              "Cross-filesystem operations are not supported",
            );
          try {
            return await fn(...args);
          } catch (error) {
            const translated = {
              ENOENT: "FileNotFound",
              EEXIST: "FileExists",
              EACCES: "NoPermissions",
              EPERM: "NoPermissions",
              EISDIR: "FileIsADirectory",
              ENOTDIR: "FileNotADirectory",
            }[error.code];
            if (translated) throw api.FileSystemError[translated](args[0]);
            throw error;
          }
        }
        const entry = fileProviders.get(scheme);
        if (!entry || typeof entry.provider[key] !== "function")
          throw api.FileSystemError.Unavailable(
            `No filesystem provider for ${scheme}`,
          );
        if (
          entry.options.isReadonly &&
          ["writeFile", "delete", "rename", "copy", "createDirectory"].includes(
            key,
          )
        )
          throw api.FileSystemError.NoPermissions("Filesystem is read-only");
        if ((key === "copy" || key === "rename") && args[1]?.scheme !== scheme)
          throw api.FileSystemError.Unavailable(
            "Cross-filesystem operations are not supported",
          );
        const method = key === "createDirectory" ? "createDirectory" : key;
        return host.scope.run(entry.ext, () =>
          entry.provider[method](
            ...args,
            ...(key === "writeFile" ? [{ create: true, overwrite: true }] : []),
          ),
        );
      };
    },
  });
  function readOnlyDocument(uri) {
    return (
      contentProviders.has(uri.scheme) ||
      (uri.scheme !== "file" &&
        uri.scheme !== "untitled" &&
        api.workspace.fs.isWritableFileSystem(uri.scheme) !== true)
    );
  }
  for (const name of [
    "onDidChangeActiveTextEditor",
    "onDidChangeVisibleTextEditors",
    "onDidChangeTextEditorSelection",
    "onDidChangeTextEditorVisibleRanges",
    "onDidChangeTextEditorOptions",
    "onDidChangeTextEditorViewColumn",
    "onDidChangeActiveColorTheme",
    "onDidChangeWindowState",
    "onDidOpenTerminal",
    "onDidCloseTerminal",
    "onDidChangeActiveTerminal",
    "onDidChangeTerminalState",
    "onDidChangeTerminalShellIntegration",
    "onDidStartTerminalShellExecution",
    "onDidEndTerminalShellExecution",
    "onDidChangeActiveNotebookEditor",
    "onDidChangeVisibleNotebookEditors",
    "onDidChangeNotebookEditorSelection",
    "onDidChangeNotebookEditorVisibleRanges",
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
      if (typeof options === "number")
        options = { viewColumn: options, preserveFocus: !!preserveFocus };
      const doc = await openDocument(value);
      const shown = await request("showDocument", {
        uri: doc.uri.toString(),
        text: doc.getText(),
        readOnly: readOnlyDocument(doc.uri),
        languageId: doc.languageId,
        options,
      });
      if (shown === false)
        throw new Error(`Could not show document ${doc.uri}`);
      return activeEditor?.document === doc
        ? activeEditor
        : makeEditor(doc, {
            viewColumn:
              options?.viewColumn === -2 ? 2 : (options?.viewColumn ?? 1),
          });
    },
    showNotebookDocument: async (notebook, options) => ({
      notebook,
      selection: undefined,
      selections: [],
      visibleRanges: [],
      revealRange() {},
      viewColumn: options?.viewColumn || 1,
    }),
    registerUriHandler: (handler) =>
      register(uriHandlers, own().id, {
        handleUri: scoped(handler.handleUri.bind(handler)),
      }),
    registerCustomEditorProvider: (id, provider) =>
      register(customEditors, id, { provider, ext: own() }),
    registerWebviewPanelSerializer: (id, serializer) =>
      register(serializers, id, { serializer, ext: own() }),
    registerFileDecorationProvider(provider) {
      const id = "decoration-provider-" + ++serial;
      fileDecorationProviders.set(id, provider);
      const sub = provider.onDidChangeFileDecorations?.(
        scoped((uris) => emit("fileDecorationsChanged", { uris })),
      );
      return new Disposable(() => {
        sub?.dispose();
        fileDecorationProviders.delete(id);
      });
    },
    registerTerminalProfileProvider(id, provider) {
      terminalProfileProviders.set(id, provider);
      return new Disposable(() => terminalProfileProviders.delete(id));
    },
    registerTerminalLinkProvider(provider) {
      terminalLinkProviders.add(provider);
      return new Disposable(() => terminalLinkProviders.delete(provider));
    },
    withProgress: async (options, task) => {
      const ext = own(),
        id = "progress-" + ++serial;
      const source = new api.CancellationTokenSource();
      const cancellable =
        options?.location === api.ProgressLocation.Notification &&
        options?.cancellable === true;
      progressTasks.set(id, { source, cancellable });
      emit("progressStart", {
        id,
        extension: ext.id,
        title: options?.title || ext.manifest.displayName || ext.id,
        location: options?.location,
        cancellable,
      });
      try {
        return await task(
          {
            report(value) {
              if (!progressTasks.has(id)) return;
              emit("progressReport", {
                id,
                message:
                  typeof value?.message === "string"
                    ? value.message
                    : undefined,
                increment: Number.isFinite(value?.increment)
                  ? value.increment
                  : undefined,
              });
            },
          },
          source.token,
        );
      } finally {
        progressTasks.delete(id);
        source.dispose();
        emit("progressEnd", { id });
      }
    },
    showQuickPick: quickInput.showQuickPick,
    showInputBox: quickInput.showInputBox,
    showOpenDialog: async (options) => {
      const values = await request("openDialog", { options });
      return values?.map(Uri.parse);
    },
    showSaveDialog: async (options) => {
      const value = await request("saveDialog", { options });
      return value ? Uri.parse(value) : undefined;
    },
    showWorkspaceFolderPick: async (options) => {
      const folders = api.workspace.workspaceFolders;
      if (!folders || folders.length === 0) return undefined;
      if (folders.length === 1 && !options?.ignoreFocusOut) return folders[0];
      const items = folders.map((f) => ({
        label: f.name,
        description: f.uri.fsPath,
        folder: f,
      }));
      const picked = await api.window.showQuickPick(items, {
        placeHolder: options?.placeHolder || "Select workspace folder",
        ignoreFocusOut: options?.ignoreFocusOut,
      });
      return picked ? picked.folder : undefined;
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
        accessibilityInformation: undefined,
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
    if (previous !== terminal)
      event("window.onDidChangeActiveTerminal").fire(terminal);
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
      try {
        host.scope.run(terminal._ext, () => terminal._pty.close());
      } catch (error) {
        emit("output", { text: `Pseudoterminal close: ${error.message}` });
      }
    }
    for (const subscription of terminal._ptySubscriptions ?? [])
      subscription?.dispose();
    event("window.onDidCloseTerminal").fire(terminal);
  }
  function pseudoInput(terminal, text) {
    if (terminal._closed || !terminal._pty) return Promise.resolve();
    if (!terminal.state.isInteractedWith) {
      terminal.state = { isInteractedWith: true };
      event("window.onDidChangeTerminalState").fire(terminal);
    }
    if (!terminal._ptyReady) {
      if (terminal._inputBytes + text.length > 1024 * 1024)
        return Promise.reject(new Error("Pseudoterminal input queue is full"));
      terminal._pendingInput.push(text);
      terminal._inputBytes += text.length;
      return Promise.resolve();
    }
    const work = terminal._inputTail
      .catch(() => {})
      .then(() => {
        if (!terminal._closed)
          return host.scope.run(terminal._ext, () =>
            terminal._pty.handleInput?.(text),
          );
      });
    terminal._inputTail = work;
    return work;
  }
  api.window.createTerminal = function (name, shellPath, shellArgs) {
    const options =
      typeof name === "object" ? { ...name } : { name, shellPath, shellArgs };
    const ext = own();
    options.env = { ...options.env };
    for (const collection of environments.values())
      for (const [key, mutation] of collection) {
        const before = options.env[key] ?? process.env[key] ?? "";
        options.env[key] =
          mutation.type === 1
            ? mutation.value
            : mutation.type === 2
              ? before + mutation.value
              : mutation.value + before;
      }
    const id = "extension-terminal-" + ++serial;
    let resolvePid;
    const terminal = {
      name: options.name || "Extension terminal",
      creationOptions: options,
      exitStatus: undefined,
      state: { isInteractedWith: false },
      _active: false,
      _closed: false,
      _ext: ext,
      _pty: options.pty,
      _ptyOpened: false,
      _ptyReady: false,
      _pendingInput: [],
      _inputBytes: 0,
      _pendingOutput: [],
      _outputBytes: 0,
      _inputTail: Promise.resolve(),
      processId: new Promise((resolve) => (resolvePid = resolve)),
      sendText(text, addNewLine = true) {
        const data = text + (addNewLine ? "\r" : "");
        if (terminal._closed) return;
        if (terminal._pty)
          void pseudoInput(terminal, data).catch((error) =>
            emit("output", { text: error.message }),
          );
        else emit("terminalInput", { id, text: data });
      },
      show(preserveFocus) {
        if (terminal._closed) return;
        activateTerminal(terminal);
        emit("terminalShow", { id, preserveFocus });
      },
      hide() {
        if (terminal._active) activateTerminal(undefined);
        emit("terminalHide", { id });
      },
      dispose() {
        closeTerminal(terminal, undefined, 4);
        emit("terminalClose", { id });
      },
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
          else {
            terminal._pendingOutput.push(text);
            terminal._outputBytes += text.length;
            while (
              terminal._outputBytes > 1024 * 1024 &&
              terminal._pendingOutput.length
            )
              terminal._outputBytes -= terminal._pendingOutput.shift().length;
          }
        }),
        options.pty.onDidClose?.((code) => {
          closeTerminal(
            terminal,
            typeof code === "number" ? code : undefined,
            2,
            false,
          );
          emit("terminalClose", { id, exitCode: code });
        }),
        options.pty.onDidChangeName?.((value) => {
          if (!terminal._closed) {
            terminal.name = String(value);
            emit("terminalName", { id, name: terminal.name });
          }
        }),
      ];
    }
    const { pty, ...publicOptions } = options;
    emit("terminalCreate", {
      id,
      options: { ...publicOptions, pseudoterminal: !!pty },
    });
    event("window.onDidOpenTerminal").fire(terminal);
    return terminal;
  };
  const activeSourceControls = new Map();
  const quickDiffProviders = new Map();
  const workbenchCommands = {
    "workbench.action.quickOpen": "files",
    "workbench.action.showCommands": "commands",
    "workbench.action.toggleSidebarVisibility": "sidebar",
    "workbench.action.togglePanel": "terminal",
    "workbench.action.toggleZenMode": "focus",
    "workbench.action.focusActiveEditorGroup": "focus-editor",
    "workbench.action.focusFirstEditorGroup": "focus-editor",
    "workbench.action.terminal.focus": "focus-terminal",
    "workbench.action.terminal.toggleTerminal": "focus-terminal",
    "workbench.action.terminal.new": "new-terminal",
    "workbench.action.terminal.split": "split-terminal",
    "workbench.action.terminal.kill": "close-terminal",
    "workbench.action.files.saveAll": "save-all",
    "workbench.action.files.newUntitledFile": "new",
    "workbench.action.files.openFolder": "open",
    "workbench.action.splitEditorRight": "split",
    "workbench.action.nextEditor": "next-tab",
    "workbench.action.previousEditor": "previous-tab",
    "workbench.action.closeAllEditors": "close-all",
    "workbench.action.findInFiles": "global",
    "workbench.action.gotoLine": "goto",
    "workbench.action.reloadWindow": "reload",
    "editor.action.formatDocument": "format",
    "editor.action.revealDefinition": "definition",
    "editor.action.referenceSearch.trigger": "references",
    "editor.action.findReferences": "references",
    "editor.action.rename": "rename",
    "editor.action.triggerParameterHints": "signature-help",
    "editor.action.toggleWordWrap": "wrap",
    "actions.find": "find",
  };
  const providerCommands = {
    "vscode.executeHoverProvider": "provideHover",
    "vscode.executeDefinitionProvider": "provideDefinition",
    "vscode.executeDeclarationProvider": "provideDeclaration",
    "vscode.executeTypeDefinitionProvider": "provideTypeDefinition",
    "vscode.executeImplementationProvider": "provideImplementation",
    "vscode.executeReferenceProvider": "provideReferences",
    "vscode.executeDocumentSymbolProvider": "provideDocumentSymbols",
    "vscode.executeWorkspaceSymbolProvider": "provideWorkspaceSymbols",
    "vscode.executeCompletionItemProvider": "provideCompletionItems",
    "vscode.executeCodeActionProvider": "provideCodeActions",
    "vscode.executeFormatDocumentProvider": "provideDocumentFormattingEdits",
    "vscode.executeFormatRangeProvider": "provideDocumentRangeFormattingEdits",
    "vscode.executeCodeLensProvider": "provideCodeLenses",
    "vscode.executeDocumentHighlights": "provideDocumentHighlights",
    "vscode.executeInlayHintProvider": "provideInlayHints",
    "vscode.executeSignatureHelpProvider": "provideSignatureHelp",
    "vscode.executeDocumentLinkProvider": "provideDocumentLinks",
    "vscode.executeSelectionRangeProvider": "provideSelectionRanges",
    "vscode.executeDocumentRenameProvider": "provideRenameEdits",
    "vscode.executeFoldingRangeProvider": "provideFoldingRanges",
    "vscode.executeDocumentColorProvider": "provideDocumentColors",
    "vscode.executeColorPresentationProvider": "provideColorPresentations",
    "vscode.prepareCallHierarchy": "prepareCallHierarchy",
    "vscode.provideIncomingCalls": "provideIncomingCalls",
    "vscode.provideOutgoingCalls": "provideOutgoingCalls",
    "vscode.prepareTypeHierarchy": "prepareTypeHierarchy",
    "vscode.provideSupertypes": "provideSupertypes",
    "vscode.provideSubtypes": "provideSubtypes",
  };
  const getCommands = api.commands.getCommands;
  api.commands.getCommands = async (filterInternal = false) =>
    [
      ...new Set([
        ...(await getCommands()),
        ...[...extensions.values()].flatMap((extension) =>
          (extension.manifest?.contributes?.commands ?? []).map(
            (command) => command.command,
          ),
        ),
        ...Object.keys(workbenchCommands),
        ...Object.keys(providerCommands),
        "setContext",
        "vscode.open",
        "vscode.openWith",
        "vscode.diff",
        "vscode.executeQuickDiffProvider",
        "workbench.action.files.save",
        "workbench.action.closeActiveEditor",
        "workbench.action.openSettings",
        "workbench.action.openGlobalKeybindings",
        "workbench.action.openGlobalSettings",
        "workbench.action.openWorkspaceSettings",
        "workbench.action.reloadWindow",
      ]),
    ].filter((id) => !filterInternal || !id.startsWith("_"));
  const execute = api.commands.executeCommand;
  api.commands.executeCommand = async (id, ...args) => {
    if (workbenchCommands[id])
      return request("executeBuiltin", {
        command: workbenchCommands[id],
        args,
      });
    if (providerCommands[id]) {
      const method = providerCommands[id];
      if (method === "provideWorkspaceSymbols") {
        const query = typeof args[0] === "string" ? args[0] : "";
        const token = new api.CancellationTokenSource().token;
        const results = [];
        for (const entry of languageProviders.values()) {
          if (
            entry.method === "WorkspaceSymbol" &&
            typeof entry.provider?.provideWorkspaceSymbols === "function"
          ) {
            const symbols = await host.scope.run(entry.ext, () =>
              entry.provider.provideWorkspaceSymbols(query, token),
            );
            if (Array.isArray(symbols)) results.push(...symbols);
          }
        }
        return results;
      }
      const isCallOrTypeItem =
        method === "provideIncomingCalls" ||
        method === "provideOutgoingCalls" ||
        method === "provideSupertypes" ||
        method === "provideSubtypes";
      const doc =
        isCallOrTypeItem && args[0]?.uri
          ? await openDocument(args[0].uri)
          : await openDocument(args[0]);
      const isPos =
        method !== "provideDocumentFormattingEdits" &&
        method !== "provideDocumentSymbols" &&
        method !== "provideCodeActions" &&
        method !== "provideCodeLenses" &&
        method !== "provideDocumentLinks" &&
        method !== "provideInlayHints" &&
        method !== "provideFoldingRanges" &&
        method !== "provideDocumentColors" &&
        method !== "provideIncomingCalls" &&
        method !== "provideOutgoingCalls" &&
        method !== "provideSupertypes" &&
        method !== "provideSubtypes" &&
        method !== "provideDocumentRangeFormattingEdits";
      const isRange =
        method === "provideCodeActions" ||
        method === "provideDocumentRangeFormattingEdits" ||
        method === "provideInlayHints" ||
        method === "provideColorPresentations";
      const values = await runtime.methods.languageFeature({
        method,
        uri: doc?.uri
          ? doc.uri.toString()
          : args[0]?.uri?.toString?.() || String(args[0]),
        position: isPos ? args[1] : undefined,
        range: isRange ? args[1] : undefined,
        context:
          method === "provideDocumentFormattingEdits" ||
          method === "provideDocumentRangeFormattingEdits"
            ? args[2] || { tabSize: 2, insertSpaces: true }
            : method === "provideCompletionItems"
              ? { triggerKind: args[2] ? 1 : 0, triggerCharacter: args[2] }
              : method === "provideCodeActions"
                ? {
                    diagnostics: doc?.uri
                      ? api.languages.getDiagnostics(doc.uri)
                      : [],
                    only: args[2]
                      ? new api.CodeActionKind(String(args[2]))
                      : undefined,
                    triggerKind: 1,
                  }
                : method === "provideReferences"
                  ? args[2] || { includeDeclaration: true }
                  : method === "provideRenameEdits"
                    ? { newName: args[2] }
                    : isCallOrTypeItem
                      ? { item: args[0] }
                      : method === "provideColorPresentations"
                        ? { color: args[2] }
                        : args[2],
      });
      if (method === "provideCompletionItems")
        return {
          items: values.flatMap((value) =>
            Array.isArray(value) ? value : (value.items ?? []),
          ),
          isIncomplete: values.some((value) => value.isIncomplete),
        };
      if (method === "provideRenameEdits") return values[0] || null;
      return values.flat();
    }
    if (id === "setContext") {
      emit("context", { key: args[0], value: args[1] });
      return;
    }
    for (const extension of extensions.values()) {
      const containers = Object.values(
        extension.manifest.contributes?.viewsContainers || {},
      ).flat();
      const container = containers.find(
        (c) => id === "workbench.view.extension." + c.id,
      );
      if (container) {
        emit("focusContainer", { id: container.id, extension: extension.id });
        return;
      }
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
      const uri = typeof args[0] === "string" ? Uri.parse(args[0]) : args[0];
      if (/^https?$/.test(uri?.scheme)) return api.env.openExternal(uri);
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
    if (id === "vscode.executeQuickDiffProvider") {
      const uri = typeof args[0] === "string" ? Uri.parse(args[0]) : args[0];
      for (const ctrl of activeSourceControls.values()) {
        if (ctrl.quickDiffProvider?.provideOriginalResource) {
          try {
            const res = await ctrl.quickDiffProvider.provideOriginalResource(
              uri,
              new api.CancellationTokenSource().token,
            );
            if (res) return res;
          } catch {}
        }
      }
      for (const entry of quickDiffProviders.values()) {
        if (entry.provider?.provideOriginalResource) {
          try {
            const res = await entry.provider.provideOriginalResource(
              uri,
              new api.CancellationTokenSource().token,
            );
            if (res) return res;
          } catch {}
        }
      }
      return undefined;
    }
    if (
      id === "workbench.action.openGlobalKeybindings" ||
      id === "workbench.action.openSettings" ||
      id === "workbench.action.openGlobalSettings" ||
      id === "workbench.action.openWorkspaceSettings"
    )
      return request("openSettings", {
        query: args[0],
        category:
          id === "workbench.action.openGlobalKeybindings"
            ? "keyboard"
            : undefined,
        target:
          id === "workbench.action.openWorkspaceSettings"
            ? "workspace"
            : "global",
      });
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
    createLanguageStatusItem(id, selector) {
      const key = own().id + ":lang-status:" + id;
      const item = {
        id,
        selector,
        severity: 0,
        text: "",
        detail: "",
        busy: false,
        command: undefined,
        accessibilityInformation: undefined,
        name: id,
        dispose() {
          emit("statusBar", { key, visible: false });
        },
      };
      return new Proxy(item, {
        set(target, property, value) {
          target[property] = value;
          emit("statusBar", {
            key,
            id: target.id,
            text: target.text,
            detail: target.detail,
            busy: target.busy,
            severity: target.severity,
            command: target.command,
            tooltip: target.detail || target.text,
            priority: 50,
            visible: Boolean(target.text || target.busy || target.detail),
          });
          return true;
        },
      });
    },
    setLanguageConfiguration(language, configuration) {
      const id = "lang-config-" + ++serial;
      emit("languageConfiguration", { id, language, configuration });
      return new Disposable(() => {
        emit("languageConfigurationRemoved", { id, language });
      });
    },
    match: (selector, document) => matches(selector, document),
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
    "DocumentDropEdit",
    "DocumentPasteEdit",
    "EvaluatableExpression",
  ]) {
    api.languages["register" + method + "Provider"] = (
      selector,
      provider,
      ...options
    ) => {
      if (provider === undefined) {
        provider = selector;
        selector = "*";
      }
      const id = "provider-" + ++serial;
      const ext = own();
      languageProviders.set(id, { method, selector, provider, options, ext });
      emit("languageProvider", { id, method, selector });
      const changeEmitter =
        provider?.onDidChangeCodeLenses ||
        provider?.onDidChangeWorkspaceSymbols ||
        provider?.onDidChangeInlayHints ||
        provider?.onDidChangeDocumentSemanticTokens ||
        provider?.onDidChangeDocumentRangeSemanticTokens ||
        provider?.onDidChangeInlineCompletions ||
        provider?.onDidChange;
      const subscription = changeEmitter?.call(
        provider,
        scoped(() => emit("languageProviderChanged", { id })),
      );
      return new Disposable(() => {
        subscription?.dispose?.();
        languageProviders.delete(id);
        emit("languageProviderRemoved", { id });
      });
    };
  }
  api.languages.registerCodeActionProvider =
    api.languages.registerCodeActionsProvider;
  api.languages.registerDocumentColorProvider =
    api.languages.registerColorProvider;
  api.languages.registerInlayHintProvider =
    api.languages.registerInlayHintsProvider;
  api.languages.registerInlineValueProvider =
    api.languages.registerInlineValuesProvider;
  api.languages.registerLinkedEditingRangesProvider =
    api.languages.registerLinkedEditingRangeProvider;
  api.languages.registerDocumentFormattingProvider =
    api.languages.registerDocumentFormattingEditProvider;
  api.languages.registerDocumentRangeFormattingProvider =
    api.languages.registerDocumentRangeFormattingEditProvider;
  api.languages.registerDocumentHighlightsProvider =
    api.languages.registerDocumentHighlightProvider;
  api.languages.registerFoldingRangesProvider =
    api.languages.registerFoldingRangeProvider;
  api.languages.registerSelectionRangesProvider =
    api.languages.registerSelectionRangeProvider;
  api.languages.registerCodeLensesProvider =
    api.languages.registerCodeLensProvider;
  api.languages.registerReferenceProviders =
    api.languages.registerReferenceProvider;
  api.languages.registerDefinitionProviders =
    api.languages.registerDefinitionProvider;
  api.languages.registerHoverProviders = api.languages.registerHoverProvider;
  api.languages.registerCompletionItemProviders =
    api.languages.registerCompletionItemProvider;
  api.languages.registerWorkspaceSymbolsProvider =
    api.languages.registerWorkspaceSymbolProvider;
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
  let envLogLevel = 3;
  const onDidChangeEnvLogLevelEmitter = event("env.logLevel");
  Object.defineProperty(api.env, "logLevel", {
    get: () => envLogLevel,
    set: (level) => {
      const num = Number(level);
      if (!Number.isNaN(num) && envLogLevel !== num) {
        envLogLevel = num;
        onDidChangeEnvLogLevelEmitter.fire(num);
      }
    },
    configurable: true,
    enumerable: true,
  });
  api.env.onDidChangeLogLevel = onDidChangeEnvLogLevelEmitter.event;

  const debugConfigurationProviders = new Map();
  const debugAdapterDescriptorFactories = new Map();
  const debugAdapterTrackerFactories = new Map();
  const activeDebugSessions = new Map();
  let debugSessionSerial = 0;
  const onDidChangeActiveDebugSessionEmitter = event("debug.activeSession");
  const onDidStartDebugSessionEmitter = event("debug.startSession");
  const onDidTerminateDebugSessionEmitter = event("debug.terminateSession");
  const onDidReceiveDebugSessionCustomEventEmitter = event("debug.customEvent");
  const onDidChangeBreakpointsEmitter = event("debug.breakpoints");
  const breakpointsList = [];
  let currentActiveDebugSession = undefined;

  api.debug = {
    get activeDebugSession() {
      return currentActiveDebugSession;
    },
    get activeDebugConsole() {
      return {
        append(value) {
          emit("output", { name: "Debug Console", text: String(value) });
        },
        appendLine(value) {
          emit("output", { name: "Debug Console", text: String(value) });
        },
      };
    },
    get breakpoints() {
      return breakpointsList;
    },
    activeStackItem: undefined,
    onDidChangeActiveStackItem: event("debug.activeStackItem").event,
    onDidChangeActiveDebugSession: onDidChangeActiveDebugSessionEmitter.event,
    onDidStartDebugSession: onDidStartDebugSessionEmitter.event,
    onDidTerminateDebugSession: onDidTerminateDebugSessionEmitter.event,
    onDidReceiveDebugSessionCustomEvent:
      onDidReceiveDebugSessionCustomEventEmitter.event,
    onDidChangeBreakpoints: onDidChangeBreakpointsEmitter.event,
    registerDebugConfigurationProvider(debugType, provider, triggerKind) {
      const key = `${debugType}:${triggerKind || 1}`;
      debugConfigurationProviders.set(key, provider);
      return new Disposable(() => debugConfigurationProviders.delete(key));
    },
    registerDebugAdapterDescriptorFactory(debugType, factory) {
      debugAdapterDescriptorFactories.set(debugType, factory);
      return new Disposable(() =>
        debugAdapterDescriptorFactories.delete(debugType),
      );
    },
    registerDebugAdapterTrackerFactory(debugType, factory) {
      debugAdapterTrackerFactories.set(debugType, factory);
      return new Disposable(() =>
        debugAdapterTrackerFactories.delete(debugType),
      );
    },
    async startDebugging(folder, nameOrConfiguration, parentSessionOrOptions) {
      let config =
        typeof nameOrConfiguration === "string"
          ? { name: nameOrConfiguration, type: "node", request: "launch" }
          : { ...(nameOrConfiguration || {}) };
      if (!config.name) config.name = "Debug";
      if (!config.type) config.type = "node";
      if (!config.request) config.request = "launch";

      const provKey = `${config.type}:1`;
      const provider =
        debugConfigurationProviders.get(provKey) ||
        debugConfigurationProviders.get(`${config.type}:2`);
      if (provider?.resolveDebugConfiguration) {
        try {
          const resolved = await provider.resolveDebugConfiguration(
            folder,
            config,
            new api.CancellationTokenSource().token,
          );
          if (resolved === null) return false;
          if (resolved) config = resolved;
        } catch {}
      }
      if (provider?.resolveDebugConfigurationWithSubstitutedVariables) {
        try {
          const substituted =
            await provider.resolveDebugConfigurationWithSubstitutedVariables(
              folder,
              config,
              new api.CancellationTokenSource().token,
            );
          if (substituted === null) return false;
          if (substituted) config = substituted;
        } catch {}
      }

      const sessionId = "debug-session-" + ++debugSessionSerial;
      const session = new api.DebugSession(
        sessionId,
        config.type,
        config.name,
        config,
        folder,
      );
      if (parentSessionOrOptions) {
        session.parentSession =
          parentSessionOrOptions instanceof api.DebugSession
            ? parentSessionOrOptions
            : parentSessionOrOptions.parentSession;
        if (parentSessionOrOptions.consoleMode !== undefined) {
          session.configuration.consoleMode =
            parentSessionOrOptions.consoleMode;
        }
      }
      const trackerFactory =
        debugAdapterTrackerFactories.get(config.type) ||
        debugAdapterTrackerFactories.get("*");
      let tracker;
      try {
        tracker = trackerFactory?.createDebugAdapterTracker?.(session);
        tracker?.onWillStartSession?.();
      } catch {}
      session._tracker = tracker;

      session.customRequest = async (command, args) => {
        try {
          tracker?.onWillReceiveMessage?.({
            type: "request",
            command,
            arguments: args,
          });
        } catch {}
        emit("debugCustomRequest", { sessionId, command, args });
        onDidReceiveDebugSessionCustomEventEmitter.fire({
          session,
          event: command,
          body: args,
        });
        try {
          tracker?.onDidSendMessage?.({
            type: "response",
            command,
            body: undefined,
            success: true,
          });
        } catch {}
        return undefined;
      };
      session.getDebugProtocolBreakpoint = async (breakpoint) => {
        if (!breakpoint) return undefined;
        return new api.DebugProtocolBreakpoint(true, breakpoint.id, undefined);
      };

      activeDebugSessions.set(sessionId, session);
      currentActiveDebugSession = session;

      emit("startDebugging", {
        sessionId,
        folder: folder?.uri?.toString(),
        nameOrConfiguration: config,
      });

      onDidStartDebugSessionEmitter.fire(session);
      onDidChangeActiveDebugSessionEmitter.fire(session);
      return true;
    },
    async stopDebugging(session) {
      const target = session || currentActiveDebugSession;
      if (target) {
        try {
          target._tracker?.onWillStopSession?.();
          target._tracker?.onExit?.(0, undefined);
        } catch {}
        activeDebugSessions.delete(target.id);
        if (currentActiveDebugSession?.id === target.id) {
          currentActiveDebugSession =
            activeDebugSessions.values().next().value || undefined;
          onDidChangeActiveDebugSessionEmitter.fire(currentActiveDebugSession);
        }
        emit("stopDebugging", { session: target.id });
        onDidTerminateDebugSessionEmitter.fire(target);
      }
    },
    addBreakpoints(bps) {
      breakpointsList.push(...bps);
      onDidChangeBreakpointsEmitter.fire({
        added: bps,
        removed: [],
        changed: [],
      });
    },
    removeBreakpoints(bps) {
      for (const bp of bps) {
        const idx = breakpointsList.indexOf(bp);
        if (idx >= 0) breakpointsList.splice(idx, 1);
      }
      onDidChangeBreakpointsEmitter.fire({
        added: [],
        removed: bps,
        changed: [],
      });
    },
    asDebugSourceUri(source) {
      return Uri.file(source.path || source.name);
    },
  };

  const taskProviders = new Map();
  const activeTaskExecutions = [];
  const onDidStartTaskEmitter = event("tasks.start");
  const onDidEndTaskEmitter = event("tasks.end");
  const onDidStartTaskProcessEmitter = event("tasks.processStart");
  const onDidEndTaskProcessEmitter = event("tasks.processEnd");

  api.tasks = {
    registerTaskProvider(type, provider) {
      taskProviders.set(type, provider);
      return new Disposable(() => taskProviders.delete(type));
    },
    async fetchTasks(filter) {
      const results = [];
      for (const [type, provider] of taskProviders.entries()) {
        if (!filter?.type || filter.type === type) {
          try {
            const tasks = await provider.provideTasks(
              new api.CancellationTokenSource().token,
            );
            if (tasks) results.push(...tasks);
          } catch {}
        }
      }
      return results;
    },
    async executeTask(task) {
      let isTerminated = false;
      const execution = new api.TaskExecution(task, () => {
        if (isTerminated) return;
        isTerminated = true;
        const idx = activeTaskExecutions.indexOf(execution);
        if (idx >= 0) activeTaskExecutions.splice(idx, 1);
        onDidEndTaskProcessEmitter.fire({ execution, exitCode: 0 });
        onDidEndTaskEmitter.fire({ execution });
      });
      activeTaskExecutions.push(execution);
      onDidStartTaskEmitter.fire({ execution });
      onDidStartTaskProcessEmitter.fire({
        execution,
        processId: 1000 + activeTaskExecutions.length,
      });
      if (
        task.execution instanceof api.CustomExecution &&
        typeof task.execution.callback === "function"
      ) {
        try {
          const pty = await task.execution.callback(task.definition);
          if (pty && typeof pty.onDidClose === "function") {
            pty.onDidClose(() => {
              execution.terminate();
            });
          }
        } catch {}
      }
      return execution;
    },
    get taskExecutions() {
      return [...activeTaskExecutions];
    },
    inCustomExecution: () => false,
    onDidStartTask: onDidStartTaskEmitter.event,
    onDidEndTask: onDidEndTaskEmitter.event,
    onDidStartTaskProcess: onDidStartTaskProcessEmitter.event,
    onDidEndTaskProcess: onDidEndTaskProcessEmitter.event,
  };

  api.scm = {
    inputBox: {
      value: "",
      placeholder: "",
      visible: true,
      enabled: true,
      onDidChange: event("scm.input.root").event,
    },
    registerQuickDiffProvider(selector, provider, label, rootUri) {
      const id = "quickdiff-" + ++serial;
      quickDiffProviders.set(id, { selector, provider, label, rootUri });
      return new Disposable(() => quickDiffProviders.delete(id));
    },
    createSourceControl(id, label, rootUri) {
      const onDidChangeInputEmitter = event("scm.input." + id);
      let inputValue = "";
      const control = {
        id,
        label,
        rootUri,
        inputBox: {
          get value() {
            return inputValue;
          },
          set value(v) {
            inputValue = String(v ?? "");
            onDidChangeInputEmitter.fire(inputValue);
          },
          placeholder: "",
          visible: true,
          enabled: true,
          onDidChange: onDidChangeInputEmitter.event,
          validateInput() {},
        },
        count: 0,
        quickDiffProvider: undefined,
        commitTemplate: "",
        acceptInputCommand: undefined,
        statusBarCommands: [],
        selected: false,
        createResourceGroup(groupId, groupLabel) {
          const group = new api.SourceControlResourceGroup(groupId, groupLabel);
          return group;
        },
        dispose() {
          activeSourceControls.delete(id);
        },
      };
      activeSourceControls.set(id, control);
      return control;
    },
  };

  const activeCommentControllers = new Set();
  api.comments = {
    createCommentController(id, label) {
      const threads = new Set();
      const controller = {
        id,
        label,
        commentingRangeProvider: undefined,
        reactionHandler: undefined,
        options: {},
        createCommentThread(uri, range, comments) {
          let currentComments = comments ? [...comments] : [];
          const thread = {
            uri,
            range,
            get comments() {
              return currentComments;
            },
            set comments(val) {
              currentComments = Array.isArray(val) ? [...val] : [];
            },
            collapsibleState: 0,
            canReply: true,
            label: undefined,
            contextValue: undefined,
            state: 0,
            isTemplate: false,
            dispose() {
              threads.delete(thread);
            },
          };
          threads.add(thread);
          return thread;
        },
        dispose() {
          for (const thread of [...threads]) {
            thread.dispose();
          }
          threads.clear();
          activeCommentControllers.delete(controller);
        },
      };
      activeCommentControllers.add(controller);
      return controller;
    },
  };

  function createTestItemCollection(parentItem) {
    const items = new Map();
    const collection = {
      get size() {
        return items.size;
      },
      add(item) {
        if (!item || !item.id) return;
        if (item.parent && item.parent !== parentItem && item.parent.children) {
          item.parent.children.delete(item.id);
        }
        item.parent = parentItem;
        items.set(item.id, item);
      },
      delete(itemId) {
        const existing = items.get(itemId);
        if (existing) {
          existing.parent = undefined;
          items.delete(itemId);
        }
      },
      get(itemId) {
        return items.get(itemId);
      },
      replace(newItems) {
        items.forEach((item) => {
          item.parent = undefined;
        });
        items.clear();
        for (const item of newItems) {
          collection.add(item);
        }
      },
      forEach(fn, thisArg) {
        items.forEach((item) => {
          fn.call(thisArg, item, collection);
        });
      },
      [Symbol.iterator]: function* () {
        for (const entry of items.entries()) {
          yield entry;
        }
      },
    };
    return collection;
  }

  api.tests = {
    createTestController(id, label) {
      function createItem(itemId, itemLabel, uri) {
        const item = {
          id: itemId,
          label: itemLabel,
          uri,
          parent: undefined,
          range: undefined,
          description: undefined,
          sortText: undefined,
          busy: false,
          error: undefined,
          tags: [],
          canResolveChildren: false,
        };
        item.children = createTestItemCollection(item);
        return item;
      }

      const rootItems = createTestItemCollection(undefined);
      const controller = {
        id,
        label,
        items: rootItems,
        createTestItem(itemId, itemLabel, uri) {
          return createItem(itemId, itemLabel, uri);
        },
        createRunProfile(
          profileLabel,
          kind,
          runHandler,
          isDefault,
          tag,
          supportsContinuousRun,
        ) {
          return new api.TestRunProfile(
            profileLabel,
            kind,
            runHandler,
            isDefault,
            tag,
            supportsContinuousRun,
          );
        },
        createTestRun(request, name, persist) {
          const onDidDisposeEmitter = new api.EventEmitter();
          let ended = false;
          return {
            name,
            token: new api.CancellationTokenSource().token,
            isPersisted: !!persist,
            enqueued(test) {},
            started(test) {},
            skipped(test) {},
            failed(test, message, duration) {},
            errored(test, message, duration) {},
            passed(test, duration) {},
            appendOutput(output, location, test) {
              emit("output", { name: "Test Output", text: String(output) });
            },
            addCoverage(fileCoverage) {
              emit("testCoverage", {
                runName: name,
                uri: fileCoverage?.uri?.toString(),
              });
            },
            end() {
              if (ended) return;
              ended = true;
              onDidDisposeEmitter.fire();
            },
            onDidDispose: onDidDisposeEmitter.event,
          };
        },
        resolveHandler: undefined,
        refreshHandler: undefined,
        dispose() {
          rootItems.replace([]);
        },
      };
      return controller;
    },
  };

  const authProviders = new Map();
  const onDidChangeSessionsEmitter = event("authentication.sessions");

  api.authentication = {
    async getSession(providerId, scopes, options = {}) {
      const provider = authProviders.get(providerId);
      if (!provider) return undefined;
      try {
        if (
          options?.forceNewSession &&
          typeof provider.createSession === "function"
        ) {
          const newSession = await provider.createSession(scopes);
          if (newSession) {
            onDidChangeSessionsEmitter.fire({
              provider: { id: providerId },
              added: [newSession],
              removed: [],
              changed: [],
            });
            return newSession;
          }
        }
        let sessions = await provider.getSessions(scopes);
        if (
          (!sessions || sessions.length === 0) &&
          options?.createIfNone &&
          typeof provider.createSession === "function"
        ) {
          const newSession = await provider.createSession(scopes);
          if (newSession) {
            onDidChangeSessionsEmitter.fire({
              provider: { id: providerId },
              added: [newSession],
              removed: [],
              changed: [],
            });
            return newSession;
          }
        }
        return sessions?.[0];
      } catch {
        return undefined;
      }
    },
    async getAccounts(providerId) {
      const provider = authProviders.get(providerId);
      if (!provider) return [];
      try {
        const sessions = await provider.getSessions([]);
        return sessions?.map((s) => s.account) || [];
      } catch {
        return [];
      }
    },
    registerAuthenticationProvider(id, label, provider) {
      authProviders.set(id, provider);
      onDidChangeSessionsEmitter.fire({
        provider: { id, label },
        added: [],
        removed: [],
        changed: [],
      });
      return new Disposable(() => authProviders.delete(id));
    },
    onDidChangeSessions: onDidChangeSessionsEmitter.event,
  };

  api.l10n = {
    t: (value, ...args) => {
      if (value === null || value === undefined) return "";
      const message =
        typeof value === "string" ? value : String(value.message ?? "");
      if (
        args.length === 1 &&
        typeof args[0] === "object" &&
        args[0] !== null &&
        !Array.isArray(args[0])
      ) {
        const obj = args[0];
        return message.replace(/\{(\w+)\}/g, (match, key) =>
          key in obj ? String(obj[key]) : match,
        );
      }
      return message.replace(/\{(\d+)\}/g, (match, idx) =>
        idx in args ? String(args[idx]) : match,
      );
    },
    bundleUri: undefined,
    uri: undefined,
  };

  const chatParticipants = new Map();
  const chatModelProviders = new Map();
  const chatVariableResolvers = new Map();
  const chatSessionItemProviders = new Map();
  const chatResponseProviders = new Map();

  class LanguageModelChat {
    constructor(id, vendor, family, version, maxInputTokens) {
      this.id = id;
      this.vendor = vendor;
      this.family = family;
      this.version = version;
      this.name = family || id;
      this.maxInputTokens = maxInputTokens || 128000;
    }
    async countTokens(text) {
      return Math.ceil(String(text).length / 4);
    }
    async sendRequest(messages, options = {}, token) {
      const chunks = [""];
      const textStream = (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
      return new api.LanguageModelChatResponse(textStream);
    }
  }

  api.lm = {
    isModelProxyAvailable: false,
    onDidChangeModelProxyAvailability: event("modelProxy").event,
    async selectChatModels(selector = {}) {
      const defaultModels = [
        new LanguageModelChat(
          "copilot-gpt-4o",
          "copilot",
          "gpt-4o",
          "1.0.0",
          128000,
        ),
        new LanguageModelChat(
          "claude-3-7-sonnet",
          "anthropic",
          "claude-3-7-sonnet",
          "1.0.0",
          200000,
        ),
        new LanguageModelChat(
          "gemini-2.0-flash",
          "google",
          "gemini-2.0-flash",
          "1.0.0",
          1048576,
        ),
      ];
      return defaultModels.filter((m) => {
        if (selector.vendor && m.vendor !== selector.vendor) return false;
        if (selector.family && m.family !== selector.family) return false;
        if (selector.id && m.id !== selector.id) return false;
        return true;
      });
    },
    registerChatModelProvider(id, provider) {
      chatModelProviders.set(id, { provider, ext: own() });
      return new Disposable(() => chatModelProviders.delete(id));
    },
  };

  api.chat = {
    createChatParticipant(id, handler) {
      const participant = {
        id,
        name: id,
        fullName: id,
        iconPath: undefined,
        description: "",
        isSticky: true,
        followupProvider: undefined,
        onDidReceiveFeedback: event("chat.feedback." + id).event,
        dispose() {
          chatParticipants.delete(id);
        },
      };
      chatParticipants.set(id, { participant, handler, ext: own() });
      return participant;
    },
    registerChatVariableResolver(id, name, description, resolver) {
      chatVariableResolvers.set(id, {
        name,
        description,
        resolver,
        ext: own(),
      });
      return new Disposable(() => chatVariableResolvers.delete(id));
    },
    registerChatFollowupProvider(id, provider) {
      return new Disposable();
    },
    registerChatSessionItemProvider(id, provider) {
      chatSessionItemProviders.set(id, { provider, ext: own() });
      return new Disposable(() => chatSessionItemProviders.delete(id));
    },
    registerChatResponseProvider(id, provider) {
      chatResponseProviders.set(id, { provider, ext: own() });
      return new Disposable(() => chatResponseProviders.delete(id));
    },
  };

  api.interactive = {
    registerInteractiveEditorSessionProvider(provider) {
      return new Disposable();
    },
  };
  const notebookControllers = new Map();
  const onDidChangeNotebookCellExecutionStateEmitter = event(
    "notebookCellExecution",
  );
  api.notebooks = {
    createNotebookController(id, notebookType, label, handler) {
      const controller = {
        id,
        notebookType,
        label,
        handler,
        description: "",
        detail: "",
        interruptHandler: undefined,
        supportedLanguages: [],
        supportsExecutionOrder: false,
        onDidChangeSelectedNotebooks: new api.EventEmitter().event,
        affinities: new Map(),
        updateNotebookAffinity(notebook, affinity) {
          controller.affinities.set(notebook, affinity);
        },
        createNotebookCellExecution(cell) {
          let executionOrder = 0;
          const tokenSource = new api.CancellationTokenSource();
          const execution = {
            get executionOrder() {
              return executionOrder;
            },
            set executionOrder(val) {
              executionOrder = val;
            },
            token: tokenSource.token,
            cell,
            start(startTime) {
              onDidChangeNotebookCellExecutionStateEmitter.fire({
                cell,
                state: 3, // Executing
              });
            },
            end(success, endTime) {
              if (cell) {
                cell.executionSummary = new api.NotebookCellExecutionSummary(
                  executionOrder,
                  success !== false,
                  endTime ? { startTime: 0, endTime } : undefined,
                );
              }
              onDidChangeNotebookCellExecutionStateEmitter.fire({
                cell,
                state: 1, // Idle
              });
            },
            clearOutput(cellOrIndex) {
              if (cell) cell.outputs = [];
            },
            replaceOutput(outputs, cellOrIndex) {
              if (cell)
                cell.outputs = Array.isArray(outputs) ? outputs : [outputs];
            },
            appendOutput(outputs, cellOrIndex) {
              if (cell) {
                const arr = Array.isArray(outputs) ? outputs : [outputs];
                cell.outputs.push(...arr);
              }
            },
            replaceOutputItems(items, output) {},
            appendOutputItems(items, output) {},
          };
          return execution;
        },
        dispose() {
          notebookControllers.delete(id);
        },
      };
      notebookControllers.set(id, controller);
      return controller;
    },
    registerNotebookCellStatusBarItemProvider(notebookType, provider) {
      return new Disposable();
    },
    onDidChangeNotebookCellStatusBarItems: event("notebooks").event,
    onDidChangeNotebookCellExecutionState:
      onDidChangeNotebookCellExecutionStateEmitter.event,
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
    secrets(ext) {
      const changed = new EventEmitter();
      const call = (method, key, value) =>
        host.scope.run(ext, () => request(method, { key, value }));
      return {
        onDidChange: changed.event,
        get: async (key) => (await call("secretGet", key)) ?? undefined,
        store: async (key, value) => {
          if (typeof value !== "string")
            throw new TypeError("Secret must be a string");
          await call("secretStore", key, value);
          changed.fire({ key });
        },
        delete: async (key) => {
          await call("secretDelete", key);
          changed.fire({ key });
        },
      };
    },
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
      quickInputEvent: (message) => quickInput.dispatch(message),
      cancelProgress({ id }) {
        const task = progressTasks.get(id);
        if (!task?.cancellable) return false;
        task.source.cancel();
        return true;
      },
      async readDocument({ uri }) {
        const doc = await openDocument(Uri.parse(uri));
        return {
          text: doc.getText(),
          languageId: doc.languageId,
          readOnly: readOnlyDocument(doc.uri),
        };
      },
      async saveVirtualDocument({ uri, text }) {
        const parsed = Uri.parse(uri);
        await api.workspace.fs.writeFile(parsed, Buffer.from(text));
        const doc = documents.get(uri);
        if (doc)
          updateDocument(
            { uri, text, isDirty: false, languageId: doc.languageId },
            "save",
          );
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
        entry.cancel?.dispose();
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
      editorViewport({ editors: updates = [] }) {
        for (const { uri, visibleRanges } of updates) {
          const editor = editorModels.get(uri);
          if (!editor || !editors.includes(editor)) continue;
          const next = visibleRanges.map(range);
          if (
            next.length === editor.visibleRanges.length &&
            next.every((value, index) =>
              value.isEqual(editor.visibleRanges[index]),
            )
          )
            continue;
          editor.visibleRanges = next;
          event("window.onDidChangeTextEditorVisibleRanges").fire({
            textEditor: editor,
            visibleRanges: editor.visibleRanges,
          });
        }
        return null;
      },
      async documentSaved({ uri, text }) {
        const doc = documents.get(uri);
        if (doc)
          updateDocument(
            { uri, text, isDirty: false, languageId: doc.languageId },
            "save",
          );
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
          for (const text of terminal._pendingOutput.splice(0))
            emit("pseudoTerminalOutput", { id, text });
          terminal._outputBytes = 0;
          await terminal._pty.open(dimensions);
          if (terminal._closed) return;
          terminal._ptyReady = true;
          for (const text of terminal._pendingInput.splice(0))
            await pseudoInput(terminal, text);
          terminal._inputBytes = 0;
        });
        try {
          await terminal._openPromise;
        } catch (error) {
          emit("notification", {
            kind: "error",
            message: `Pseudoterminal failed: ${error.message}`,
          });
          closeTerminal(terminal, undefined, 2);
          emit("terminalClose", { id });
          throw error;
        }
      },
      pseudoTerminalInput({ id, text }) {
        const terminal = terminals.find((t) => t._id === id);
        return terminal?._pty ? pseudoInput(terminal, String(text)) : undefined;
      },
      async pseudoTerminalResize({ id, dimensions }) {
        const terminal = terminals.find((t) => t._id === id);
        if (!terminal?._ptyOpened || terminal._closed) return;
        return host.scope.run(terminal._ext, () =>
          terminal._pty.setDimensions?.(dimensions),
        );
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
          let args = [];
          if (
            method === "provideCompletionItems" ||
            method === "provideInlineCompletionItems"
          )
            args = [doc, position(pos), token, context || { triggerKind: 0 }];
          else if (method === "provideCodeActions")
            args = [doc, range(r), context || { diagnostics: [] }, token];
          else if (method === "provideDocumentFormattingEdits")
            args = [doc, context || { tabSize: 2, insertSpaces: true }, token];
          else if (method === "provideDocumentRangeFormattingEdits")
            args = [
              doc,
              range(r),
              context || { tabSize: 2, insertSpaces: true },
              token,
            ];
          else if (method === "provideReferences")
            args = [
              doc,
              position(pos),
              context || { includeDeclaration: true },
              token,
            ];
          else if (
            method === "provideCodeLenses" ||
            method === "provideDocumentLinks" ||
            method === "provideFoldingRanges" ||
            method === "provideDocumentColors"
          )
            args = [doc, token];
          else if (method === "provideInlayHints")
            args = [
              doc,
              r ? range(r) : new Range(0, 0, doc.lineCount, 0),
              token,
            ];
          else if (method === "provideSignatureHelp")
            args = [
              doc,
              position(pos),
              token,
              {
                triggerKind: 1,
                isRetrigger: false,
                triggerCharacter: undefined,
                ...context,
              },
            ];
          else if (method === "provideRenameEdits")
            args = [doc, position(pos), context?.newName || "", token];
          else if (
            method === "provideIncomingCalls" ||
            method === "provideOutgoingCalls" ||
            method === "provideSupertypes" ||
            method === "provideSubtypes"
          )
            args = [context?.item, token];
          else if (
            method === "prepareCallHierarchy" ||
            method === "prepareTypeHierarchy"
          )
            args = [doc, position(pos), token];
          else if (method === "provideColorPresentations")
            args = [context?.color, { document: doc, range: range(r) }, token];
          else
            args = [
              doc,
              ...(pos ? [position(pos)] : r ? [range(r)] : []),
              token,
            ];
          let value = await host.scope.run(entry.ext, () =>
            fn.call(entry.provider, ...args),
          );
          if (
            method === "provideCodeLenses" &&
            context?.resolve &&
            Array.isArray(value) &&
            entry.provider.resolveCodeLens
          ) {
            value = await Promise.all(
              value.map(async (lens) =>
                lens.command
                  ? lens
                  : ((await host.scope.run(entry.ext, () =>
                      entry.provider.resolveCodeLens(lens, token),
                    )) ?? lens),
              ),
            );
          }
          if (method === "provideDocumentSemanticTokens" && value)
            value = {
              ...value,
              data: Array.from(value.data ?? []),
              legend: entry.options?.[0],
            };
          if (value) result.push(value);
        }
        return result;
      },
    },
    shutdown() {
      quickInput.shutdown();
      for (const terminal of [...terminals]) {
        closeTerminal(terminal, undefined, 1);
        emit("terminalClose", { id: terminal._id });
      }
      for (const dispose of watcherDisposables) dispose();
      for (const p of pending.values())
        p.reject(new Error("Extension host shutting down"));
      pending.clear();
    },
  };
  return runtime;
};
