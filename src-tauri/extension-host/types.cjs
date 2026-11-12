"use strict";
// Value types shared across extensions. These are real data objects, not API stubs.
module.exports = function installTypes(api) {
  class Position {
    constructor(line, character) {
      if (line < 0 || character < 0)
        throw new RangeError("Position must be non-negative");
      this.line = line;
      this.character = character;
    }
    compareTo(p) {
      return this.line - p.line || this.character - p.character;
    }
    isBefore(p) {
      return this.compareTo(p) < 0;
    }
    isBeforeOrEqual(p) {
      return this.compareTo(p) <= 0;
    }
    isAfter(p) {
      return this.compareTo(p) > 0;
    }
    isAfterOrEqual(p) {
      return this.compareTo(p) >= 0;
    }
    isEqual(p) {
      return this.compareTo(p) === 0;
    }
    translate(line = 0, character = 0) {
      if (typeof line === "object")
        ({ lineDelta: line = 0, characterDelta: character = 0 } = line);
      return new Position(this.line + line, this.character + character);
    }
    with(line = this.line, character = this.character) {
      if (typeof line === "object")
        ({ line = this.line, character = this.character } = line);
      return new Position(line, character);
    }
  }
  class Range {
    constructor(a, b, c, d) {
      const p = typeof a === "number" ? new Position(a, b) : a;
      const q = typeof a === "number" ? new Position(c, d) : b;
      [this.start, this.end] = p.isBefore(q) ? [p, q] : [q, p];
    }
    get isEmpty() {
      return this.start.isEqual(this.end);
    }
    get isSingleLine() {
      return this.start.line === this.end.line;
    }
    contains(p) {
      return p.start
        ? this.contains(p.start) && this.contains(p.end)
        : this.start.isBeforeOrEqual(p) && this.end.isAfterOrEqual(p);
    }
    isEqual(r) {
      return this.start.isEqual(r.start) && this.end.isEqual(r.end);
    }
    intersection(r) {
      const a = this.start.isAfter(r.start) ? this.start : r.start;
      const b = this.end.isBefore(r.end) ? this.end : r.end;
      return a.isAfter(b) ? undefined : new Range(a, b);
    }
    union(r) {
      return new Range(
        this.start.isBefore(r.start) ? this.start : r.start,
        this.end.isAfter(r.end) ? this.end : r.end,
      );
    }
    with(start = this.start, end = this.end) {
      if (start.start) ({ start = this.start, end = this.end } = start);
      return new Range(start, end);
    }
  }
  class Selection extends Range {
    constructor(a, b, c, d) {
      const p = typeof a === "number" ? new Position(a, b) : a;
      const q = typeof a === "number" ? new Position(c, d) : b;
      super(p, q);
      this.anchor = p;
      this.active = q;
    }
    get isReversed() {
      return this.anchor.isAfter(this.active);
    }
  }
  class TextEdit {
    constructor(range, newText) {
      this.range = range;
      this.newText = newText;
    }
    static replace(r, t) {
      return new TextEdit(r, t);
    }
    static insert(p, t) {
      return new TextEdit(new Range(p, p), t);
    }
    static delete(r) {
      return new TextEdit(r, "");
    }
    static setEndOfLine(eol) {
      const e = new TextEdit(undefined, "");
      e.newEol = eol;
      return e;
    }
  }
  class WorkspaceEdit {
    constructor() {
      this.edits = new Map();
      this.fileOperations = [];
    }
    set(uri, edits) {
      this.edits.set(uri.toString(), [uri, edits]);
    }
    get(uri) {
      return this.edits.get(uri.toString())?.[1] || [];
    }
    has(uri) {
      return this.edits.has(uri.toString());
    }
    entries() {
      return [...this.edits.values()];
    }
    get size() {
      return this.edits.size;
    }
    replace(uri, r, t) {
      this.set(uri, [...this.get(uri), TextEdit.replace(r, t)]);
    }
    insert(uri, p, t) {
      this.replace(uri, new Range(p, p), t);
    }
    delete(uri, r) {
      this.replace(uri, r, "");
    }
    createFile(uri, options) {
      this.fileOperations.push({ kind: "create", uri, options });
    }
    deleteFile(uri, options) {
      this.fileOperations.push({ kind: "delete", uri, options });
    }
    renameFile(oldUri, newUri, options) {
      this.fileOperations.push({ kind: "rename", oldUri, newUri, options });
    }
  }
  class Diagnostic {
    constructor(range, message, severity = 0) {
      Object.assign(this, { range, message, severity });
    }
  }
  class DiagnosticRelatedInformation {
    constructor(location, message) {
      Object.assign(this, { location, message });
    }
  }
  class Location {
    constructor(uri, range) {
      this.uri = uri;
      this.range = range instanceof Position ? new Range(range, range) : range;
    }
  }
  class CodeLens {
    constructor(range, command) {
      Object.assign(this, { range, command });
    }
  }
  class CodeAction {
    constructor(title, kind) {
      Object.assign(this, { title, kind });
    }
  }
  class CodeActionKind {
    constructor(value) {
      this.value = value;
    }
    append(part) {
      return new CodeActionKind(this.value ? this.value + "." + part : part);
    }
    contains(other) {
      return (
        other.value === this.value || other.value.startsWith(this.value + ".")
      );
    }
    intersects(other) {
      return this.contains(other) || other.contains(this);
    }
  }
  for (const [key, value] of Object.entries({
    Empty: "",
    QuickFix: "quickfix",
    Refactor: "refactor",
    RefactorExtract: "refactor.extract",
    RefactorInline: "refactor.inline",
    RefactorRewrite: "refactor.rewrite",
    Source: "source",
    SourceOrganizeImports: "source.organizeImports",
    SourceFixAll: "source.fixAll",
  }))
    CodeActionKind[key] = new CodeActionKind(value);
  class SnippetString {
    constructor(value = "") {
      this.value = value;
      this.index = 1;
    }
    appendText(value) {
      this.value += value.replace(/[$}\\]/g, "\\$&");
      return this;
    }
    appendTabstop(n = this.index++) {
      this.value += "$" + n;
      return this;
    }
    appendPlaceholder(value, n = this.index++) {
      this.value += "${" + n + ":" + value + "}";
      return this;
    }
  }
  class CompletionItem {
    constructor(label, kind) {
      Object.assign(this, { label, kind });
    }
  }
  class CompletionList {
    constructor(items = [], isIncomplete = false) {
      Object.assign(this, { items, isIncomplete });
    }
  }
  class Hover {
    constructor(contents, range) {
      Object.assign(this, { contents, range });
    }
  }
  class DocumentLink {
    constructor(range, target) {
      Object.assign(this, { range, target });
    }
  }
  class RelativePattern {
    constructor(base, pattern) {
      this.baseUri =
        typeof base === "string" ? api.Uri.file(base) : base.uri || base;
      this.base = this.baseUri.fsPath;
      this.pattern = pattern;
    }
  }
  class TabInputText {
    constructor(uri) {
      this.uri = uri;
    }
  }
  class TabInputTextDiff {
    constructor(original, modified) {
      Object.assign(this, { original, modified });
    }
  }
  class TabInputWebview {
    constructor(viewType) {
      this.viewType = viewType;
    }
  }
  class FileSystemError extends Error {
    constructor(message, code = "Unknown") { super(String(message ?? "Filesystem error")); this.name = "FileSystemError"; this.code = code; }
    static FileNotFound(uri) { return new FileSystemError("File not found: " + uri, "FileNotFound"); }
    static FileExists(uri) { return new FileSystemError("File exists: " + uri, "FileExists"); }
    static NoPermissions(uri) { return new FileSystemError("No permissions: " + uri, "NoPermissions"); }
    static Unavailable(uri) { return new FileSystemError("Unavailable: " + uri, "Unavailable"); }
    static FileIsADirectory(uri) { return new FileSystemError("File is a directory: " + uri, "FileIsADirectory"); }
    static FileNotADirectory(uri) { return new FileSystemError("File is not a directory: " + uri, "FileNotADirectory"); }
  }
  class CancellationError extends Error {
    constructor() {
      super("Canceled");
      this.name = "Canceled";
    }
  }
  class DataTransfer extends Map {
    forEach(fn, self) {
      super.forEach((v, k) => fn.call(self, v, k, this));
    }
  }
  class DataTransferItem {
    constructor(value) {
      this.value = value;
    }
    async asString() {
      return String(this.value);
    }
    asFile() {
      return undefined;
    }
  }
  Object.assign(api, {
    Position,
    Range,
    Selection,
    TextEdit,
    WorkspaceEdit,
    Diagnostic,
    DiagnosticRelatedInformation,
    Location,
    CodeLens,
    CodeAction,
    CodeActionKind,
    SnippetString,
    CompletionItem,
    CompletionList,
    Hover,
    DocumentLink,
    RelativePattern,
    TabInputText,
    TabInputTextDiff,
    TabInputWebview,
    FileSystemError,
    CancellationError,
    DataTransfer,
    DataTransferItem,
  });
  class CallHierarchyItem {
    constructor(kind, name, detail, uri, range, selectionRange) {
      Object.assign(this, { kind, name, detail, uri, range, selectionRange });
    }
  }
  class TypeHierarchyItem extends CallHierarchyItem {}
  class InlayHint {
    constructor(position, label, kind) {
      Object.assign(this, { position, label, kind });
    }
  }
  class InlayHintLabelPart {
    constructor(value) {
      this.value = value;
    }
  }
  class SymbolInformation {
    constructor(name, kind, containerName, location) {
      Object.assign(this, { name, kind, containerName, location });
    }
  }
  class DocumentSymbol {
    constructor(name, detail, kind, range, selectionRange) {
      Object.assign(this, {
        name,
        detail,
        kind,
        range,
        selectionRange,
        children: [],
      });
    }
  }
  class SignatureInformation {
    constructor(label, documentation) {
      Object.assign(this, { label, documentation, parameters: [] });
    }
  }
  class ParameterInformation {
    constructor(label, documentation) {
      Object.assign(this, { label, documentation });
    }
  }
  class SignatureHelp {
    constructor() {
      this.signatures = [];
      this.activeSignature = 0;
      this.activeParameter = 0;
    }
  }
  class FoldingRange {
    constructor(start, end, kind) {
      Object.assign(this, { start, end, kind });
    }
  }
  class FoldingRangeKind {
    constructor(value) {
      this.value = value;
    }
  }
  FoldingRangeKind.Comment = new FoldingRangeKind("comment");
  FoldingRangeKind.Imports = new FoldingRangeKind("imports");
  FoldingRangeKind.Region = new FoldingRangeKind("region");
  class SemanticTokens {
    constructor(data, resultId) {
      Object.assign(this, { data, resultId });
    }
  }
  class SemanticTokensLegend {
    constructor(tokenTypes, tokenModifiers = []) {
      Object.assign(this, { tokenTypes, tokenModifiers });
    }
  }
  class SemanticTokensBuilder {
    constructor(legend) {
      this.legend = legend;
      this.tokens = [];
    }
    push(line, character, length, type, modifiers = 0) {
      if (line instanceof Range) {
        const range = line;
        const name = character;
        const names = length || [];
        line = range.start.line;
        character = range.start.character;
        length = range.end.character - character;
        type = this.legend?.tokenTypes.indexOf(name);
        modifiers = names.reduce((bits, name) => {
          const index = this.legend?.tokenModifiers.indexOf(name);
          return index >= 0 ? bits | (1 << index) : bits;
        }, 0);
      }
      if (type < 0 || line < 0 || character < 0 || length < 0)
        throw Error("Invalid semantic token");
      this.tokens.push([line, character, length, type, modifiers]);
    }
    build(resultId) {
      let line = 0,
        character = 0;
      const data = [];
      for (const token of this.tokens.sort(
        (a, b) => a[0] - b[0] || a[1] - b[1],
      )) {
        data.push(
          token[0] - line,
          token[0] === line ? token[1] - character : token[1],
          ...token.slice(2),
        );
        [line, character] = token;
      }
      return new SemanticTokens(Uint32Array.from(data), resultId);
    }
  }
  class DocumentHighlight {
    constructor(range, kind) {
      Object.assign(this, { range, kind });
    }
  }
  class SelectionRange {
    constructor(range, parent) {
      Object.assign(this, { range, parent });
    }
  }
  class Color {
    constructor(red, green, blue, alpha) {
      Object.assign(this, { red, green, blue, alpha });
    }
  }
  class ColorInformation {
    constructor(range, color) {
      Object.assign(this, { range, color });
    }
  }
  class ColorPresentation {
    constructor(label) {
      this.label = label;
    }
  }
  class LinkedEditingRanges {
    constructor(ranges, wordPattern) {
      Object.assign(this, { ranges, wordPattern });
    }
  }
  class InlineCompletionItem {
    constructor(insertText, range, command) {
      Object.assign(this, { insertText, range, command });
    }
  }
  class InlineCompletionList {
    constructor(items) {
      this.items = items;
    }
  }
  class FileDecoration {
    constructor(badge, tooltip, color) {
      Object.assign(this, { badge, tooltip, color });
    }
  }
  Object.assign(api, {
    CallHierarchyItem,
    TypeHierarchyItem,
    InlayHint,
    InlayHintLabelPart,
    SymbolInformation,
    DocumentSymbol,
    SignatureInformation,
    ParameterInformation,
    SignatureHelp,
    FoldingRange,
    FoldingRangeKind,
    SemanticTokens,
    SemanticTokensLegend,
    SemanticTokensBuilder,
    DocumentHighlight,
    SelectionRange,
    Color,
    ColorInformation,
    ColorPresentation,
    LinkedEditingRanges,
    InlineCompletionItem,
    InlineCompletionList,
    FileDecoration,
  });
  const enums = {
    DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
    InlayHintKind: { Type: 1, Parameter: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    TextEditorRevealType: {
      Default: 0,
      InCenter: 1,
      InCenterIfOutsideViewport: 2,
      AtTop: 3,
    },
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    EndOfLine: { LF: 1, CRLF: 2 },
    FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
    DecorationRangeBehavior: {
      OpenOpen: 0,
      ClosedClosed: 1,
      OpenClosed: 2,
      ClosedOpen: 3,
    },
    ExtensionKind: { UI: 1, Workspace: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    CompletionTriggerKind: {
      Invoke: 0,
      TriggerCharacter: 1,
      TriggerForIncompleteCompletions: 2,
    },
    TerminalLocation: { Panel: 1, Editor: 2 },
    ExternalUriOpenerPriority: { None: 0, Option: 1, Default: 2, Preferred: 3 },
  };
  const lists = {
    CompletionItemKind: [
      "Text",
      "Method",
      "Function",
      "Constructor",
      "Field",
      "Variable",
      "Class",
      "Interface",
      "Module",
      "Property",
      "Unit",
      "Value",
      "Enum",
      "Keyword",
      "Snippet",
      "Color",
      "File",
      "Reference",
      "Folder",
      "EnumMember",
      "Constant",
      "Struct",
      "Event",
      "Operator",
      "TypeParameter",
      "User",
      "Issue",
    ],
    SymbolKind: [
      "File",
      "Module",
      "Namespace",
      "Package",
      "Class",
      "Method",
      "Property",
      "Field",
      "Constructor",
      "Enum",
      "Interface",
      "Function",
      "Variable",
      "Constant",
      "String",
      "Number",
      "Boolean",
      "Array",
      "Object",
      "Key",
      "Null",
      "EnumMember",
      "Struct",
      "Event",
      "Operator",
      "TypeParameter",
    ],
  };
  for (const [name, names] of Object.entries(lists))
    enums[name] = Object.fromEntries(names.map((n, i) => [n, i]));
  for (const [name, values] of Object.entries(enums))
    api[name] = Object.fromEntries(
      Object.entries(values).flatMap(([k, v]) => [
        [k, v],
        [v, k],
      ]),
    );
};
