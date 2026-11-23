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
      const list = Array.isArray(edits)
        ? edits.map((e) => (Array.isArray(e) ? e[0] : e))
        : [edits];
      this.edits.set(uri.toString(), [uri, list]);
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
    get hasFileOperations() {
      return this.fileOperations.length > 0;
    }
  }
  class WorkspaceEditMetadata {
    constructor(options = {}) {
      this.needsConfirmation = !!options.needsConfirmation;
      this.label = options.label || "";
      this.description = options.description;
      this.iconPath = options.iconPath;
    }
  }
  class Diagnostic {
    constructor(range, message, severity = 0) {
      this.range = range;
      this.message = message;
      this.severity = severity;
      this.source = undefined;
      this.code = undefined;
      this.relatedInformation = undefined;
      this.tags = undefined;
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
      const val =
        typeof value === "function" ? value(new SnippetString()).value : value;
      this.value += "${" + n + ":" + val + "}";
      return this;
    }
    appendChoice(values, n = this.index++) {
      this.value += "${" + n + "|" + values.join(",") + "|}";
      return this;
    }
    appendVariable(name, defaultValue) {
      if (defaultValue !== undefined) {
        const val =
          typeof defaultValue === "function"
            ? defaultValue(new SnippetString()).value
            : defaultValue;
        this.value += "${" + name + ":" + val + "}";
      } else {
        this.value += "${" + name + "}";
      }
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
  class TabInputCustom {
    constructor(uri, viewType) {
      this.uri = uri;
      this.viewType = viewType;
    }
  }
  class TabInputNotebook {
    constructor(uri, notebookType) {
      this.uri = uri;
      this.notebookType = notebookType;
    }
  }
  class TabInputNotebookDiff {
    constructor(original, modified, notebookType) {
      this.original = original;
      this.modified = modified;
      this.notebookType = notebookType;
    }
  }
  class TabInputTerminal {
    constructor() {}
  }
  class TabInputTextMerge {
    constructor(base, input1, input2, result) {
      this.base = base;
      this.input1 = input1;
      this.input2 = input2;
      this.result = result;
    }
  }
  class FileSystemError extends Error {
    constructor(message, code = "Unknown") {
      super(String(message ?? "Filesystem error"));
      this.name = "FileSystemError";
      this.code = code;
    }
    static FileNotFound(uri) {
      return new FileSystemError("File not found: " + uri, "FileNotFound");
    }
    static FileExists(uri) {
      return new FileSystemError("File exists: " + uri, "FileExists");
    }
    static NoPermissions(uri) {
      return new FileSystemError("No permissions: " + uri, "NoPermissions");
    }
    static Unavailable(uri) {
      return new FileSystemError("Unavailable: " + uri, "Unavailable");
    }
    static FileIsADirectory(uri) {
      return new FileSystemError(
        "File is a directory: " + uri,
        "FileIsADirectory",
      );
    }
    static FileNotADirectory(uri) {
      return new FileSystemError(
        "File is not a directory: " + uri,
        "FileNotADirectory",
      );
    }
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
    TabInputCustom,
    TabInputNotebook,
    TabInputNotebookDiff,
    TabInputTerminal,
    TabInputTextMerge,
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
  class CallHierarchyIncomingCall {
    constructor(item, fromRanges) {
      this.from = item;
      this.fromRanges = fromRanges;
    }
  }
  class CallHierarchyOutgoingCall {
    constructor(item, fromRanges) {
      this.to = item;
      this.fromRanges = fromRanges;
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
  class SemanticTokensEdit {
    constructor(start, deleteCount, data) {
      this.start = start;
      this.deleteCount = deleteCount;
      this.data = data;
    }
  }
  class SemanticTokensEdits {
    constructor(edits, resultId) {
      this.edits = edits;
      this.resultId = resultId;
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
  class DebugAdapterExecutable {
    constructor(command, args = [], options = {}) {
      this.command = command;
      this.args = args;
      this.options = options;
    }
  }
  class DebugAdapterServer {
    constructor(port, host) {
      this.port = port;
      this.host = host;
    }
  }
  class DebugAdapterNamedPipeServer {
    constructor(path) {
      this.path = path;
    }
  }
  class DebugAdapterInlineImplementation {
    constructor(implementation) {
      this.implementation = implementation;
    }
  }
  let bpSerial = 0;
  class Breakpoint {
    constructor(enabled = true, condition, hitCondition, logMessage) {
      this.id = "bp-" + ++bpSerial;
      this.enabled = enabled;
      this.condition = condition;
      this.hitCondition = hitCondition;
      this.logMessage = logMessage;
    }
  }
  class SourceBreakpoint extends Breakpoint {
    constructor(location, enabled = true, condition, hitCondition, logMessage) {
      super(enabled, condition, hitCondition, logMessage);
      this.location = location;
    }
  }
  class FunctionBreakpoint extends Breakpoint {
    constructor(
      functionName,
      enabled = true,
      condition,
      hitCondition,
      logMessage,
    ) {
      super(enabled, condition, hitCondition, logMessage);
      this.functionName = functionName;
    }
  }
  class DebugProtocolBreakpoint {
    constructor(verified, id, message) {
      this.verified = verified;
      this.id = id;
      this.message = message;
    }
  }
  class DebugSession {
    constructor(id, type, name, configuration, workspaceFolder) {
      this.id = id;
      this.type = type;
      this.name = name;
      this.configuration = configuration;
      this.workspaceFolder = workspaceFolder;
      this.parentSession = undefined;
    }
    async customRequest(command, args) {
      return undefined;
    }
    async getDebugProtocolBreakpoint(breakpoint) {
      if (!breakpoint) return undefined;
      return new DebugProtocolBreakpoint(true, breakpoint.id, undefined);
    }
  }
  class Task {
    constructor(definition, target, name, source, execution, problemMatchers) {
      this.definition = definition;
      this.scope = target;
      this.name = name;
      this.source = source;
      this.execution = execution;
      this.problemMatchers =
        typeof problemMatchers === "string"
          ? [problemMatchers]
          : problemMatchers || [];
      this.isBackground = false;
      this.presentationOptions = {};
      this.runOptions = {};
      this.group = undefined;
      this.detail = undefined;
    }
  }
  class TaskGroup {
    constructor(id, label) {
      this.id = id;
      this.label = label;
      this.isDefault = false;
    }
    static Clean = new TaskGroup("clean", "Clean");
    static Build = new TaskGroup("build", "Build");
    static Rebuild = new TaskGroup("rebuild", "Rebuild");
    static Test = new TaskGroup("test", "Test");
  }
  class SourceControlResourceGroup {
    constructor(id, label) {
      this.id = id;
      this.label = label;
      this.hideWhenEmpty = false;
      this.resourceStates = [];
    }
    dispose() {}
  }
  class SourceControlResourceDecorations {
    constructor(options = {}) {
      this.strikeThrough = !!options.strikeThrough;
      this.faded = !!options.faded;
      this.tooltip = options.tooltip;
      this.light = options.light;
      this.dark = options.dark;
      this.iconPath = options.iconPath;
    }
  }
  class ShellExecution {
    constructor(commandLineOrExecutable, argsOrOptions, options) {
      if (Array.isArray(argsOrOptions)) {
        this.command = commandLineOrExecutable;
        this.args = argsOrOptions;
        this.options = options;
      } else {
        this.commandLine = commandLineOrExecutable;
        this.options = argsOrOptions;
      }
    }
  }
  class ProcessExecution {
    constructor(process, argsOrOptions, options) {
      this.process = process;
      if (Array.isArray(argsOrOptions)) {
        this.args = argsOrOptions;
        this.options = options;
      } else {
        this.args = [];
        this.options = argsOrOptions;
      }
    }
  }
  class CustomExecution {
    constructor(callback) {
      this.callback = callback;
    }
  }
  class TaskExecution {
    constructor(task, terminateFn) {
      this.task = task;
      this._terminateFn = terminateFn;
    }
    terminate() {
      if (typeof this._terminateFn === "function") {
        this._terminateFn();
      }
    }
  }
  class TestMessage {
    constructor(message) {
      this.message = message;
      this.expectedOutput = undefined;
      this.actualOutput = undefined;
      this.location = undefined;
    }
    static diff(message, expected, actual) {
      const msg = new TestMessage(message);
      msg.expectedOutput = String(expected);
      msg.actualOutput = String(actual);
      return msg;
    }
  }
  class TestTag {
    constructor(id) {
      this.id = id;
    }
  }
  class TestRunProfile {
    constructor(
      label,
      kind,
      runHandler,
      isDefault = false,
      tag,
      supportsContinuousRun = false,
    ) {
      this.label = label;
      this.kind = kind;
      this.runHandler = runHandler;
      this.isDefault = isDefault;
      this.tag = tag;
      this.supportsContinuousRun = supportsContinuousRun;
      this.loadHandler = undefined;
      this.configureHandler = undefined;
    }
    dispose() {}
  }
  class TestRunRequest {
    constructor(include, exclude, profile, continuous = false) {
      this.include = include;
      this.exclude = exclude;
      this.profile = profile;
      this.continuous = continuous;
    }
  }
  class FileCoverage {
    constructor(uri, statementCoverage, branchCoverage, declarationCoverage) {
      this.uri = uri;
      this.statementCoverage = statementCoverage;
      this.branchCoverage = branchCoverage;
      this.declarationCoverage = declarationCoverage;
    }
    static fromDetails(uri, details) {
      return new FileCoverage(
        uri,
        details?.statementCoverage,
        details?.branchCoverage,
        details?.declarationCoverage,
      );
    }
  }
  class StatementCoverage {
    constructor(executed, location, branches = []) {
      this.executed = executed;
      this.location = location;
      this.branches = branches;
    }
  }
  class BranchCoverage {
    constructor(executed, location, label) {
      this.executed = executed;
      this.location = location;
      this.label = label;
    }
  }
  class DeclarationCoverage {
    constructor(name, executed, location) {
      this.name = name;
      this.executed = executed;
      this.location = location;
    }
  }
  class NotebookCellData {
    constructor(kind, value, languageId) {
      this.kind = kind;
      this.value = value;
      this.languageId = languageId;
      this.outputs = [];
      this.metadata = {};
      this.executionSummary = undefined;
    }
  }
  class NotebookData {
    constructor(cells = []) {
      this.cells = cells;
      this.metadata = {};
    }
  }
  class NotebookRange {
    constructor(start, end) {
      this.start = Math.min(start, end);
      this.end = Math.max(start, end);
    }
    get isEmpty() {
      return this.start === this.end;
    }
  }
  class NotebookEdit {
    constructor(range, newCells) {
      this.range = range;
      this.newCells = newCells;
    }
    static replaceCells(range, newCells) {
      return new NotebookEdit(range, newCells);
    }
    static insertCells(index, newCells) {
      return new NotebookEdit(new NotebookRange(index, index), newCells);
    }
    static deleteCells(range) {
      return new NotebookEdit(range, []);
    }
  }
  class SnippetTextEdit {
    constructor(range, snippet) {
      this.range = range;
      this.snippet = snippet;
    }
    static replace(range, snippet) {
      return new SnippetTextEdit(range, snippet);
    }
    static insert(position, snippet) {
      return new SnippetTextEdit(new Range(position, position), snippet);
    }
  }
  class NotebookCellOutput {
    constructor(items, metadata = {}) {
      this.items = items;
      this.metadata = metadata;
      this.id = "output-" + Math.random().toString(36).slice(2);
    }
  }
  class NotebookCellExecutionSummary {
    constructor(executionOrder, success, timing) {
      this.executionOrder = executionOrder;
      this.success = success;
      this.timing = timing;
    }
  }
  class NotebookCellStatusBarItem {
    constructor(text, alignment = 1, priority = 0) {
      this.text = text;
      this.alignment = alignment;
      this.priority = priority;
      this.tooltip = undefined;
      this.command = undefined;
      this.accessibilityInformation = undefined;
    }
  }
  class NotebookCellOutputItem {
    constructor(data, mime) {
      this.data = data instanceof Uint8Array ? data : Buffer.from(data || "");
      this.mime = mime;
    }
    static text(value, mime = "text/plain") {
      return new NotebookCellOutputItem(Buffer.from(String(value)), mime);
    }
    static json(value, mime = "application/json") {
      return new NotebookCellOutputItem(
        Buffer.from(JSON.stringify(value)),
        mime,
      );
    }
    static stdout(value) {
      return new NotebookCellOutputItem(
        Buffer.from(String(value)),
        "application/vnd.code.notebook.stdout",
      );
    }
    static stderr(value) {
      return new NotebookCellOutputItem(
        Buffer.from(String(value)),
        "application/vnd.code.notebook.stderr",
      );
    }
    static error(err) {
      const errObj = {
        name: err?.name || "Error",
        message: err?.message || String(err),
        stack: err?.stack || "",
      };
      return new NotebookCellOutputItem(
        Buffer.from(JSON.stringify(errObj)),
        "application/vnd.code.notebook.error",
      );
    }
  }
  class TerminalProfile {
    constructor(options) {
      this.options = options;
    }
  }
  class EvaluatableExpression {
    constructor(range, expression) {
      this.range = range;
      this.expression = expression;
    }
  }
  class InlineValueText {
    constructor(range, text) {
      this.range = range;
      this.text = text;
    }
  }
  class InlineValueVariableLookup {
    constructor(range, variableName, caseSensitiveLookup = true) {
      this.range = range;
      this.variableName = variableName;
      this.caseSensitiveLookup = caseSensitiveLookup;
    }
  }
  class InlineValueEvaluatableExpression {
    constructor(range, expression) {
      this.range = range;
      this.expression = expression;
    }
  }
  class TelemetryTrustedValue {
    constructor(value) {
      this.value = value;
    }
  }
  class DocumentDropEdit {
    constructor(insertText) {
      this.insertText = insertText;
      this.additionalEdit = undefined;
      this.title = "";
      this.kind = undefined;
    }
  }
  class DocumentPasteEdit {
    constructor(insertText, title, kind) {
      this.insertText = insertText;
      this.title = title || "";
      this.kind = kind;
      this.additionalEdit = undefined;
    }
  }
  class DocumentDropOrPasteEditKind {
    constructor(value) {
      this.value = value;
    }
    append(part) {
      return new DocumentDropOrPasteEditKind(
        this.value ? this.value + "." + part : part,
      );
    }
    intersects(other) {
      return (
        this.value === other?.value ||
        this.value.startsWith(other?.value + ".") ||
        (other?.value && other.value.startsWith(this.value + "."))
      );
    }
    contains(other) {
      return (
        this.value === other?.value ||
        (other?.value && other.value.startsWith(this.value + "."))
      );
    }
  }
  DocumentDropOrPasteEditKind.Empty = new DocumentDropOrPasteEditKind("");
  DocumentDropOrPasteEditKind.Text = new DocumentDropOrPasteEditKind("text");
  DocumentDropOrPasteEditKind.TextPlain = new DocumentDropOrPasteEditKind(
    "text.plain",
  );

  class LanguageModelChatMessage {
    constructor(role, content, name) {
      this.role = role;
      this.content = content;
      this.name = name;
    }
    static User(content, name) {
      return new LanguageModelChatMessage(1, content, name);
    }
    static Assistant(content, name) {
      return new LanguageModelChatMessage(2, content, name);
    }
  }
  class LanguageModelError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "LanguageModelError";
      this.code = code;
    }
    static Blocked(message) {
      return new LanguageModelError(message, "Blocked");
    }
    static NoPermissions(message) {
      return new LanguageModelError(message, "NoPermissions");
    }
    static NotFound(message) {
      return new LanguageModelError(message, "NotFound");
    }
    static QuotaExceeded(message) {
      return new LanguageModelError(message, "QuotaExceeded");
    }
  }
  class LanguageModelChatResponse {
    constructor(stream) {
      this.stream = stream;
    }
    get text() {
      return this.stream;
    }
  }

  class LanguageModelChatTool {
    constructor(name, description, inputSchema) {
      this.name = name;
      this.description = description;
      this.inputSchema = inputSchema;
    }
  }

  Object.assign(api, {
    CallHierarchyItem,
    CallHierarchyIncomingCall,
    CallHierarchyOutgoingCall,
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
    SemanticTokensEdit,
    SemanticTokensEdits,
    DocumentHighlight,
    SelectionRange,
    Color,
    ColorInformation,
    ColorPresentation,
    LinkedEditingRanges,
    InlineCompletionItem,
    InlineCompletionList,
    FileDecoration,
    DebugAdapterExecutable,
    DebugAdapterServer,
    DebugAdapterNamedPipeServer,
    DebugAdapterInlineImplementation,
    Breakpoint,
    SourceBreakpoint,
    FunctionBreakpoint,
    DebugProtocolBreakpoint,
    DebugSession,
    Task,
    TaskGroup,
    ShellExecution,
    ProcessExecution,
    CustomExecution,
    TaskExecution,
    SourceControlResourceGroup,
    SourceControlResourceDecorations,
    WorkspaceEditMetadata,
    TestMessage,
    TestTag,
    TestRunProfile,
    TestRunRequest,
    FileCoverage,
    StatementCoverage,
    BranchCoverage,
    DeclarationCoverage,
    NotebookCellData,
    NotebookData,
    NotebookRange,
    NotebookEdit,
    SnippetTextEdit,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCellStatusBarItem,
    NotebookCellExecutionSummary,
    TerminalProfile,
    EvaluatableExpression,
    InlineValueText,
    InlineValueVariableLookup,
    InlineValueEvaluatableExpression,
    TelemetryTrustedValue,
    DocumentDropEdit,
    DocumentPasteEdit,
    DocumentDropOrPasteEditKind,
    LanguageModelChatMessage,
    LanguageModelError,
    LanguageModelChatResponse,
    LanguageModelChatTool,
  });
  const enums = {
    IndentAction: { None: 0, Indent: 1, IndentOutdent: 2, Outdent: 3 },
    DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
    InlayHintKind: { Type: 1, Parameter: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    TaskScope: { Global: 1, Workspace: 2 },
    TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
    TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
    DebugConsoleMode: { Separate: 0, MergeWithParent: 1 },
    DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
    CommentMode: { Editing: 0, Preview: 1 },
    CommentState: { Published: 0, Draft: 1 },
    CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
    CommentThreadState: { Unresolved: 0, Resolved: 1 },
    CommentThreadApplicability: { Current: 0, Historical: 1 },
    TestRunState: {
      Queued: 1,
      Running: 2,
      Passed: 3,
      Failed: 4,
      Skipped: 5,
      Errored: 6,
    },
    LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
    TextEditorRevealType: {
      Default: 0,
      InCenter: 1,
      InCenterIfOutsideViewport: 2,
      AtTop: 3,
    },
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    FilePermission: { Readonly: 1 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
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
    CodeActionTriggerKind: { Invoke: 1, Automatic: 2 },
    SignatureHelpTriggerKind: {
      Invoke: 1,
      TriggerCharacter: 2,
      ContentChange: 3,
    },
    SymbolTag: { Deprecated: 1 },
    CompletionItemTag: { Deprecated: 1 },
    NotebookCellKind: { Markup: 1, Code: 2 },
    NotebookCellStatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: {
      Active: -1,
      Beside: -2,
      One: 1,
      Two: 2,
      Three: 3,
      Four: 4,
      Five: 5,
      Six: 6,
      Seven: 7,
      Eight: 8,
      Nine: 9,
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    UIKind: { Desktop: 1, Web: 2 },
    ColorThemeKind: {
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4,
    },
    TerminalExitReason: {
      Unknown: 0,
      Shutdown: 1,
      Process: 2,
      User: 3,
      Extension: 4,
    },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    SyntaxTokenType: { Other: 0, Comment: 1, String: 2, RegEx: 3 },
    NotebookEditorRevealType: {
      Default: 0,
      InCenter: 1,
      InCenterIfOutsideViewport: 2,
      AtTop: 3,
    },
    InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
    NotebookCellExecutionState: { Idle: 1, Pending: 2, Executing: 3 },
    DocumentPasteTriggerKind: { Automatic: 0, PasteAs: 1 },
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    ChatVariableLevel: { Short: 1, Medium: 2, Full: 3 },
    InteractiveSessionVoteDirection: { Down: 0, Up: 1 },
    NotebookControllerAffinity: { Default: 1, Preferred: 2 },
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
