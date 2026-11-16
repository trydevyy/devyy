# Devyy compatibility roadmap

Updated 2026-11-14. This is a work list, not a claim of complete VS Code compatibility.

Recent reliability work:

- Explorer scans breadth first so large nested directories cannot hide root files. Gitignored entries remain visible, with generated folders loaded on expansion.
- Contributed trees retain refresh revisions in the workbench and refresh after a language client reports indexing complete. Explicit tree item IDs preserve expanded dependency nodes. Activation failures are surfaced instead of silently appearing as empty trees.
- Antigravity uses its documented stream-JSON input contract; Google sign-in and OpenCode account connection run in provider-owned terminal sessions inside Settings. Sign-in works before opening a workspace. No provider OAuth clients or tokens are borrowed.
- OpenCode step token/cost events accumulate without duplicate counting. CLI model discovery no longer substitutes hardcoded catalogs when installation or authentication fails. Actual account access, CLI releases and supported models still require live validation.
- Settings have directional exit/enter transitions, a hue/saturation color wheel, and matching modal exits. Closing surfaces release focus and keyboard ownership immediately. Model and workspace access controls share a row.

Open VSX distributes packages. Successfully finding or installing a VSIX does not mean that its runtime, native binaries, contributed UI, or proposed APIs work in Devyy. Compatibility must be established through behavior tests against the actual package and each supported platform.

The extension host currently reports VS Code API version `1.96.2`. That value is not a complete implementation of that release's API. A versioned, machine-readable capability inventory must replace this implicit promise before declaring a compatibility level.

## Compatibility status

No measured percentage is available. Earlier host and workbench parity estimates were not backed by a complete API inventory or published-package test matrix and have been removed. A host object, provider registration, or passing fixture does not establish that an extension works end to end.

| Area                              | Current workbench path                                                                                | Remaining validation or integration                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Activation, commands, quick input | Process host, dependency activation, interactive prompts, command dispatch                            | Actual published-package matrix and recovery behavior on each platform               |
| Language services                 | CodeMirror completion, diagnostics, navigation, hints, lenses, semantic tokens                        | Native and extension-launched server integration across real projects                |
| Status and progress               | Editor bottom bar for notifications, language status, extension progress and native LSP work reports  | Dedicated contribution-view progress placement                                       |
| Extension views and panels        | Main AI chats on the right; extension-created panels and extension settings in editor tabs            | View-column fidelity, serializers, full tab API inventory                            |
| Run and Debug                     | Project commands in terminals; built-in LLDB/debugpy DAP UI                                           | Extension-selected adapter transports, complete launch/task configuration pipelines  |
| SCM                               | Built-in Git, submodules, branches, commit graph, diffs                                               | Full rendering and interactions for arbitrary extension SCM providers                |
| Testing, notebooks, comments      | Host models and provider registration exist                                                           | Complete native Test Explorer, notebook renderer/execution UI, inline review threads |
| Workspace and configuration       | Workspace explorer includes ignored files; search honors ignores; declared extension settings persist | Full multi-root UI and settings scope/override hierarchy                             |

## Release priorities

1. Make activation, commands, document state and language-server startup reliable. Surface failures at the responsible extension instead of swallowing them or returning fake success.
2. Complete the stable VS Code API through native Devyy services, with tests covering its return values, errors, cancellation and lifecycle.
3. Test a published package matrix on macOS, Windows and Linux. Run actual packaged builds, including Windows WebView2 and Linux WebKitGTK.
4. Add the remaining workbench features that those APIs need. A namespace or type declaration without a functioning editor UI is incomplete.

## Implemented foundations

These are supported paths, with limitations listed below.

- Process-isolated Node/CommonJS extension execution; startup, language, command, view, URI and `workspaceContains` activation; dependency ordering and failure reporting. Workspace checks support exact paths and globs, share duplicate checks, limit concurrent searches and apply a five-second deadline per glob. Exact paths cannot resolve outside the workspace through symlinks.
- Extension mementos, OS-protected encrypted per-extension secret storage, configuration overrides, package resources, output channels (with `LogOutputChannel`, log level filtering, argument formatting, clear/replace/show operations, and developer panel service/extension filtering with text search, badges, and follow lock), notifications, input/quick-pick dialogs, clipboard, URI handlers and native terminal/pseudoterminal bridges.
- Command arguments and results across the process boundary, including revived URI arguments. Commands invoked during their own extension's activation no longer wait for that same activation.
- File-backed, untitled, content-provider and custom-filesystem documents; active editor/selections, tab inventory, document change/save events, text edits, diff opening, active text editor snippet insertion (`TextEditor.insertSnippet`), and text editor decorations (`TextEditor.setDecorations` with Range and DecorationOptions). `TextDocument` instances maintain valid `isClosed`, `isUntitled`, line/offset indexing, and word ranges across edits.
- Trees, contributed webview views, webview panels, resource roots, messages, state, storage, theme changes and visibility events.
- A shared VS Code theme-token surface. Extension styles control their own widgets; Devyy does not force padding/backgrounds onto every extension button and input.
- Contributed command-palette visibility, command enablement/toggled states, grouped/submenu contributions in editor, file explorer, tab, tree, view-header and webview context menus. Webviews can use `data-vscode-context`.
- Actual container/extension icons with a placeholder fallback. Codex and Claude main chats live in the right AI workspace, pinned to `chatgpt.sidebarView` and `claudeVSCodeSidebar`. Their separately created webview panels open as editor tabs. `workbench.action.openSettings` opens editable declared extension settings in an editor tab; Claude’s preceding focus-editor command and Codex’s extension filter are supported.
- Native stdio LSP clients; extension language-client launch registration; Node stdio, IPC, pipe and socket transport bridges; launch cwd/environment; initialization options, feature capability contributions, custom request/notification handlers and shared clients across language selectors.
- Native completion, hover, definitions, formatting and diagnostics. Extensions can register additional language providers; only a subset is consumed by the editor UI. Inlay hints, code lenses and semantic tokens refresh after document changes, server connection and provider changes, with stale responses discarded. Native requests include inlay ranges; code lenses can resolve lazily; semantic highlighting uses the server/provider's declared token legend instead of assuming its ordering.
- Open VSX browsing/VSIX installation, progress, installed icons, dependency packages, themes, grammars and snippets.
- Material Icon Theme file/folder artwork and a searchable Credits & licenses page generated from dependency metadata and license files.
- Extension progress reports, percentages and cooperative notification cancellation with result/error propagation and cleanup; token cancellation dismisses pending quick picks and input prompts. Parent cancellation tokens propagate once. Progress is rendered in the editor bottom status bar, including concurrent tasks, percentages and cancellation. Native LSP work-done and rust-analyzer server-status reports use the same bottom bar; contribution-view placement remains incomplete.
- Live `window.createQuickPick` / `createInputBox` objects with mutable values, items, selection, active items, toolbar/Back and item buttons, steps, loading/disabled states, focus policy, passwords and validation severity. Selection and button callbacks return the original extension objects. Accept/hide/dispose events and reopenable sessions are bridged to Devyy controls; stale list/button/session interactions are rejected. Convenience prompts share this implementation, including promised choices, preselection, active-item callbacks, cancellation while loading and asynchronous in-place validation with stale-result suppression.
- VSX extension API namespaces and contracts:
  - `vscode.debug`: full `DebugSession` object lifecycle (`id`, `type`, `name`, `configuration`, `workspaceFolder`, `customRequest`, `getDebugProtocolBreakpoint`), parent session hierarchies (`session.parentSession`, `session.configuration.consoleMode`), active session tracking (`debug.activeDebugSession`), debug configuration providers with automatic resolution (`resolveDebugConfiguration`, `resolveDebugConfigurationWithSubstitutedVariables`), debug console output, breakpoints (`Breakpoint`, `SourceBreakpoint`, `FunctionBreakpoint`, `DebugProtocolBreakpoint`), descriptor and tracker factories (`registerDebugAdapterDescriptorFactory`, `registerDebugAdapterTrackerFactory`), and session/tracker lifecycle events (`onWillStartSession`, `onWillReceiveMessage`, `onDidSendMessage`, `onWillStopSession`, `onExit`, `onDidStartDebugSession`, `onDidChangeActiveDebugSession`, `onDidReceiveDebugSessionCustomEvent`, `onDidTerminateDebugSession`).
  - `vscode.tasks`: `TaskExecution` model with `.terminate()`, active execution tracking in `tasks.taskExecutions`, `tasks.inCustomExecution()`, `TaskGroup` defaults (`Clean`, `Build`, `Rebuild`, `Test`, `isDefault`), task providers (`vscode.tasks` and `vscode.workspace.registerTaskProvider`), task fetching (`fetchTasks`), process/shell/custom execution models (`ShellExecution`, `ProcessExecution`, `CustomExecution` with pseudoterminal integration), and process lifecycle events (`onDidStartTask`, `onDidStartTaskProcess`, `onDidEndTaskProcess`, `onDidEndTask`).
  - `vscode.scm`: source control creation (`scm.createSourceControl`), live reactive input boxes (`inputBox.value`, `placeholder`, `onDidChange`), resource groups (`SourceControlResourceGroup`, `createResourceGroup`), resource decorations (`SourceControlResourceDecorations`), quick diff providers (`control.quickDiffProvider`, `scm.registerQuickDiffProvider`, `vscode.executeQuickDiffProvider`), status bar commands, and file decorations.
  - `vscode.comments`: comment controllers (`comments.createCommentController`), controller options (`prompt`, `placeHolder`), active thread registry, `CommentThread` state tracking (`CommentThreadState.Unresolved` / `Resolved`, `CommentThreadApplicability.Current` / `Historical`, `CommentState.Published` / `Draft`), dynamic `thread.comments` assignment and retrieval, `canReply`, `isTemplate`, `collapsibleState`, `reactionHandler`, and cascading disposal.
  - `vscode.tests`: test controllers (`tests.createTestController`), hierarchical `TestItemCollection` with bidirectional parent/child references (`child.parent = parent`, `collection.add/delete/get/replace/forEach/[Symbol.iterator]`), `TestMessage.diff` side-by-side output formatters, test runs (`enqueued`, `started`, `passed`, `failed`, `errored`, `skipped`, `appendOutput`, `addCoverage`, `end`), `onDidDispose` run lifecycle notifications, run profiles (`TestRunProfile`, `TestRunRequest`), and code coverage models (`FileCoverage`, `StatementCoverage`, `BranchCoverage`, `DeclarationCoverage`).
  - `vscode.authentication`: provider registration, session requests with options (`createIfNone`, `forceNewSession`), account queries (`getAccounts`), and session change notifications.
  - `vscode.l10n`: named (`{name}`) and indexed (`{0}`) string template interpolation with graceful fallback.
  - `vscode.workspace`: multi-root `workspace.workspaceFolders` (dynamic mutations, event dispatch, closest-prefix folder resolution, `workspace.name`, and `asRelativePath`), `workspace.openUntitledTextDocument`, `workspace.save` and `workspace.saveAs`, `workspace.getConfiguration(section, scope).inspect(key)` returning scoped inspection records or undefined, `applyEdit` (with `SnippetTextEdit`, `WorkspaceEditMetadata`, and normalized edit arrays), `registerNotebookSerializer`, `openNotebookDocument`, `registerTimelineProvider`, `workspace.fs` file provider operations (with accurate `FileType.SymbolicLink` detection via `lstat`, strict `writeFile` with `overwrite: false` validation throwing `FileSystemError.FileExists`, and `findFiles` with wildcard fallback), and file events.
  - `vscode.languages`: `setLanguageConfiguration`, `createLanguageStatusItem` (reactive Proxy reporting busy state, severity, text, detail, and click commands directly to the editor status bar with codicon icon rendering), `languages.match` document and notebook selector scoring (`notebookType`), provider alias mappings for singular/plural names (`registerCodeActionProvider`, `registerDocumentColorProvider`, `registerInlayHintProvider`, `registerInlineValueProvider`, `registerLinkedEditingRangesProvider`, `registerDocumentFormattingProvider`, `registerDocumentRangeFormattingProvider`, `registerDocumentHighlightsProvider`, `registerFoldingRangesProvider`, `registerSelectionRangesProvider`, `registerCodeLensesProvider`, `registerWorkspaceSymbolsProvider`), single-argument `registerWorkspaceSymbolProvider(provider)` routing without requiring document selector, safe `onDidChange*` provider event navigation, drop/paste providers (`registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider`, `registerEvaluatableExpressionProvider`), CodeMirror 6 line-block Code Lens actions, and 5-tuple semantic tokens highlighting.
  - `vscode.window`: `setStatusBarMessage`, status bar items with codicon parsing (`$(sync~spin)`, `$(loading~spin)`, `$(error)`, `$(warning)`, etc.), spinning animation, busy state, and non-modal extension notifications routed cleanly to the status bar badge with auto-dismiss timers instead of disruptive Sonner pop-up toasts.

### Integration evidence

The inventory below records available implementation paths and outstanding work. Host-level contracts are not a promise of complete stable or proposed API support. Native macOS compilation and automated fixtures do not establish Windows/Linux behavior or successful live sign-in flows.

## Stable API and workbench gaps

| Area                                   | Remaining work                                                                                                                                                                                                                                                                                   | Priority |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Activation and packaging               | Rechecking `workspaceContains` after files are created, retrying searches that exceed their deadline, language-less selectors, wildcard activation edge cases, manifest localization, extension kind/engine/platform compatibility checks, reload/recovery tests, browser-only extension workers | P0       |
| Command system                         | Complete built-in command routing and argument semantics, command URI links with trust checks, missing provider-execution commands, progress/cancellation, enablement and accessibility across all contribution locations                                                                        | P0       |
| LanguageClient                         | Functions returning live child processes or stream transports, full middleware and converters, dynamic feature registration, proper `$/cancelRequest`, progress/trace/error handlers, automatic restart/backoff, correct lifecycle when one of several clients stops                             | P0       |
| LSP synchronization                    | Server-originated workspace edits, file create/rename/delete operations, watched-file registration, configuration change routing, document filters/notebook selectors, per-client server request timeouts, encoding negotiation beyond UTF-16                                                    | P0       |
| LSP/editor UI                          | Signature help, references/implementation/type-definition/declaration navigation, rename UI, code-action resolving, snippets/insert-replace edits in completions, code lenses, inlay hints, semantic tokens, folding/selection ranges and diagnostics code links                                 | P0       |
| Document/editor objects                | Complete editor option change events, will-save/waitUntil, version-checked workspace edit transactions and resource operations, snippets/tab stops, decorations and gutter markers, editor groups and diff/custom-editor tab semantics                                                           | P0       |
| Workspace and filesystem               | Workspace-folder changes and multi-root behavior, configuration inspect/update scopes, complete `workspace.fs` errors/events, reliable recursive watching on every platform, search/exclude semantics, workspace trust and virtual-workspace checks                                              | P0       |
| Credentials                            | Cross-process secret-change events, migration/recovery, OS credential-store integration tests and account-provider integration. Basic get/store/delete and same-host change events now use encrypted per-extension vaults with OS-protected keys                                                 | P0       |
| Authentication                         | `authentication.registerAuthenticationProvider`, session requests/pickers, consent and session-change events, account preferences, built-in provider integrations where their public services permit them                                                                                        | P0       |
| Menus and contexts                     | Render navigation/inline view actions and all remaining menu locations; alternate commands, dynamic labels/icons, resource selections, submenu overflow, context-key scoping and full `when` grammar parity                                                                                      | P1       |
| Webviews                               | Resource URI/CSP parity across platforms, binary/resource caching, `retainContextWhenHidden`, serializers across restart, complete options/port mapping, find/copy/paste integration, accessibility/high contrast, visibility/focus precision                                                    | P1       |
| Trees                                  | Selection/multiselect, reveal/focus, checkboxes, drag/drop, custom icons, badges, title/description/message updates, refresh granularity and welcome contributions                                                                                                                               | P1       |
| Window services                        | Exact QuickInput fuzzy ranking, complete codicon/rich-tooltip rendering and large-list virtualization; per-view/status-bar progress placement and throttling; output/log levels and visibility; complete status bar accessibility/backgrounds; tab/group/window state parity                     | P1       |
| Tasks                                  | Task providers, discovery, execution, problem matchers, presentation options, cancellation, task terminals and execution events                                                                                                                                                                  | P1       |
| Debuggers                              | `debug` namespace, debugger contributions, adapter factories/trackers, configurations/compounds, breakpoint models, exception policies and debug console integration. Built-in DAP functionality does not provide extension API parity                                                           | P1       |
| Source control                         | `scm` providers/input boxes/resource groups, repository/resource events and contributed actions. Built-in Git is not a substitute for these extension APIs                                                                                                                                       | P1       |
| Terminals                              | Shell integration/execution events, terminal profiles/providers, environment collection persistence, links/quick fixes, location/group behavior and reconnection of extension-owned terminals                                                                                                    | P1       |
| Custom editors                         | Complete custom-document lifecycle, undo/redo/save/revert/backup, readonly editors, serializer recovery and notebook/custom tab inputs                                                                                                                                                           | P1       |
| Notebooks                              | Notebook documents/editors/serializers/controllers, cell execution/output, metadata edits, kernels, rendering and notebook contribution points                                                                                                                                                   | P2       |
| Testing                                | Test controllers/items, run profiles, discovery, continuous testing, results/coverage, output and a native test explorer                                                                                                                                                                         | P2       |
| Comments and history                   | Comment controllers/threads, review actions, timeline providers and corresponding workbench views                                                                                                                                                                                                | P2       |
| AI extension APIs                      | Language models, model tools, chat participants, prompt references and contribution contracts. The built-in Devyy chat does not implement VS Code's `lm`/`chat` APIs                                                                                                                             | P2       |
| Remote development                     | Remote authority resolvers, remote extension hosts, containers/SSH/WSL, remote filesystem and port tunnels. Local WSL shell selection alone is not remote development                                                                                                                            | P2       |
| Accessibility and internationalization | Screen-reader/editor parity, full keyboard traversal, localized manifests/settings, bidirectional layout, high contrast and reduced-motion testing                                                                                                                                               | P1       |
| Proposed APIs                          | Explicit capability/permission negotiation, per-extension opt-in and versioned implementations. Do not report arbitrary proposed APIs as available                                                                                                                                               | P2       |

## Detailed VSX extension compatibility inventory

This inventory details the concrete technical gaps between Devyy's current implementation and complete Open VSX extension compatibility. Extensions are categorized by the subsystems they interact with, detailing what the extension host supports, what the workbench UI currently lacks, and the direct compatibility impact on real-world packages.

### 1. Editor & CodeMirror 6 Visual Integration

While Devyy exposes `TextEditor`, `TextDocument`, and `TextEditorEdit` across the process boundary, several visual editor features defined in the VS Code API require rendering integration in Devyy's CodeMirror 6 editor:

- **Text Editor Decorations (`window.createTextEditorDecorationType`)**:
  - _Extension Host_: Implemented. Extensions create decoration types, receive keys, and dispose them. Calls to `setDecorations` are routed across the host bridge.
  - _Devyy Integration_: Rendered into CodeMirror 6 via `extensionDecorations.ts` using `StateField<DecorationSet>` and `RangeSet<GutterMarker>`:
    - CSS styling: `backgroundColor`, `border`, `borderRadius`, `color`, `textDecoration`, `fontStyle`, `fontWeight`, `cursor`, `opacity`, `letterSpacing`.
    - Gutter markers: `gutterIconPath` and `gutterIconSize` via dedicated `cm-extension-gutter`.
    - Inline attachment widgets: `before` and `after` pseudo-elements (`AttachmentWidget`) with custom text, font, margins, and tooltips.
    - Hover integration: `hoverTooltip` in CodeMirror surfaces extension decoration `hoverMessage` alongside or in addition to LSP hovers.
  - _Impact_: GitLens inline blame annotations, Error Lens inline diagnostics, Rainbow Brackets, and Todo Tree gutter flags.

- **Snippet Controller & Tabstop Traversal (`TextEditor.insertSnippet`)**:
  - _Extension Host_: Basic text insertion is supported via edits.
  - _Devyy Gaps_: Tabstop navigation (`$1`, `$2`, `$0`), placeholder default values (`${1:default}`), nested tabstops, choice selections (`${1|one,two,three|}`), variable transformations (`${TM_FILENAME/(.*)/$1/}`), and active snippet cursor linked-mode sessions in CodeMirror.
  - _Impact_: Modern snippet packs, Emmet abbreviations, and language snippet expansions.

- **Editor Viewport & Scroll Control (`TextEditor.revealRange`)**:
  - _Extension Host_: Implemented. Receives range and `TextEditorRevealType` enums.
  - _Devyy Integration_: Rendered in `jumpTo` translating `TextEditorRevealType.AtTop` (3) to `y: "start"`, `Default` (0) to `y: "nearest"`, and `InCenter` (1) / `InCenterIfOutsideViewport` (2) to `y: "center"` via `EditorView.scrollIntoView`.
  - _Impact_: "Go to Symbol", "Go to Line", test runner jump-to-failure, and search result navigation.

### 2. Language Features & LSP Workbench UI

Devyy connects native and extension-provided Language Servers over stdio, IPC, pipes, and sockets, and provides completions, hover, definitions, and formatting. The following language UX surfaces remain to be wired into the editor:

- **Signature Help (`languages.registerSignatureHelpProvider`)**:
  - _Extension Host_: Registration and request dispatch supported.
  - _Devyy Integration_: Rendered in CodeMirror 6 via `lspSignatureHelp.ts` using `showTooltip`:
    - Floating interactive signature widget above the active parameter in CodeMirror.
    - Dynamically highlights active parameter index (supports both substring and numeric range labels).
    - Surfaces parameter/signature documentation and overloaded signature counters (`1/3`).
    - Automatically triggered when typing `(` or `,`, manual trigger via `Mod+Shift+Space` (`editor.action.triggerParameterHints`), and dismissible via Escape or close button.
  - _Impact_: TypeScript, Python (Pyright/Pylance), Rust Analyzer, C/C++ function call parameter hints.

- **Inlay Hints (`languages.registerInlayHintsProvider`)**:
  - _Extension Host_: Supported with `InlayHint` and `InlayHintLabelPart` types.
  - _Devyy Integration_: Rendered in CodeMirror 6 via `lspInlayHints.ts` using `inlayHintsField` (`StateField<RangeSet<Decoration>>`) with `InlayHintWidget`:
    - Renders inline type annotations (`kind: 1`) and parameter names (`kind: 2`) inside CodeMirror buffers without modifying document offsets or copy/paste text.
    - Supports label part arrays and tooltips.
    - Debounced query updates on open and edits.
  - _Impact_: Rust Analyzer type/parameter hints, TypeScript parameter names, and Go inlay hints.

- **Code Lenses (`languages.registerCodeLensProvider`)**:
  - _Extension Host_: Provider registration supported with `provideCodeLenses` and `onDidChangeCodeLenses` change notifications.
  - _Devyy Integration_: Rendered in CodeMirror 6 via `lspCodeLenses.ts` using `codeLensesField` (`StateField<RangeSet<Decoration>>`) with `CodeLensLineWidget`:
    - Renders clickable interactive line widgets directly above functions, classes, and types (e.g. `▶ Run Test | Debug`, `3 references`).
    - Dispatches corresponding commands and arguments to the host or workbench when clicked.
  - _Impact_: Test runners, CodeLens git authors, and reference counters.

- **Symbol References & Navigation (`languages.registerReferenceProvider`, `registerImplementationProvider`)**:
  - _Extension Host_: LSP references and implementations queried.
  - _Devyy Integration_: Integrated `findReferences` command (`Shift+F12` / `editor.action.findReferences` / `editor.action.referenceSearch.trigger`) navigating through references across the workspace.
  - _Impact_: "Find All References", "Go to Implementation", "Go to Type Definition".

- **Rename Provider UI (`languages.registerRenameProvider`)**:
  - _Extension Host_: Supported with `WorkspaceEdit` multi-document transactions.
  - _Devyy Integration_: Rendered via `renameSymbol()` with `F2` / `editor.action.rename`:
    - Queries `prepareRename` for initial symbol placeholder and identifier under cursor.
    - Interactive dialog prompting for the new identifier name.
    - Queries `textDocument/rename` from native LSP and `provideRenameEdits` from active extensions.
    - Normalizes `changes` / `documentChanges` and commits atomic multi-document workspace edits across tabs and disk with range bounds validation and reverse sorting.
  - _Impact_: Safe F2 refactoring across files.

- **Semantic Tokens (`languages.registerDocumentSemanticTokensProvider`)**:
  - _Extension Host_: Supported with `SemanticTokensBuilder` and legend types.
  - _Devyy Integration_: Rendered in CodeMirror 6 via `lspSemanticTokens.ts` using `semanticTokensField`:
    - Decodes standard LSP / VS Code 5-tuple integer arrays into compiler-accurate token types (`type`, `function`, `parameter`, `variable`, `property`, `macro`, etc.) and modifiers (`declaration`, `readonly`, `static`, etc.).
    - Applies `cm-semantic-*` mark decorations to override basic grammar tokens with exact language-server resolved syntax highlights.
  - _Impact_: Rich semantic highlighting for C++, Rust, TypeScript, and Java.

### 3. Debug Adapter Protocol (DAP) & Extension-Contributed Debuggers

Devyy contains a built-in DAP client for specific runtimes, but full VSX debugger extension compatibility requires:

- **Descriptor Factory Bridge (`debug.registerDebugAdapterDescriptorFactory`)**:
  - _Extension Host_: Supported. Extensions register factories returning `DebugAdapterExecutable`, `DebugAdapterServer`, or `DebugAdapterNamedPipeServer`.
  - _Devyy Gaps_: The frontend Debugger UI needs a transport bridge that talks directly to the adapter instance returned by the extension factory rather than only using Devyy's hardcoded internal DAP launchers.
  - _Impact_: CodeLLDB, debugpy, Mock Debug, Java Debugger, and Go delve.

- **Configuration Resolution (`debug.registerDebugConfigurationProvider`)**:
  - _Extension Host_: Supported with trigger kinds (`Initial` vs `Dynamic`).
  - _Devyy Gaps_: Pre-launch resolution pipeline: running `resolveDebugConfiguration` to expand variables (e.g., `${file}`, `${workspaceFolder}`), prompt for target processes, or synthesize launch configs when `launch.json` is missing.
  - _Impact_: Zero-config "Debug Current File" for Python, Rust, and Node.

- **Debug Adapter Tracker (`debug.registerDebugAdapterTrackerFactory`)**:
  - _Extension Host_: Supported.
  - _Devyy Gaps_: Tapping into DAP message traffic (`onWillReceiveMessage`, `onDidSendMessage`) to allow telemetry, logging, and custom event interception.
  - _Impact_: Extension logging tools, DAP monitors, and custom UI views.

### 4. Tasks Engine, Shell Execution & Problem Matchers

Extensions provide build, test, and linting tasks that run outside of language servers:

- **Custom & Shell Task Execution (`tasks.registerTaskProvider`, `ShellExecution`, `ProcessExecution`)**:
  - _Extension Host_: Provider registry, task models, and lifecycle events (`onDidStartTask`, `onDidEndTask`, `onDidStartTaskProcess`, `onDidEndTaskProcess`) are implemented.
  - _Devyy Gaps_: Wiring task execution to Devyy's native terminal manager: creating a dedicated task terminal, running the command with proper environment/cwd inheritance, and streaming status to the workbench.
  - _Impact_: Cargo build/check tasks, npm script tasks, CMake tools, and Gulp/Grunt tasks.

- **Problem Matcher Parsing**:
  - _Devyy Gaps_: Background stream parser scanning task stdout/stderr for regex patterns (e.g. `$gcc`, `$tsc`, `$eslint-compact`) and feeding parsed errors/warnings directly into Devyy's Problems panel and editor diagnostic markers.
  - _Impact_: Compiler output immediately populating the editor without an active language server.

### 5. Source Control (SCM) & Multi-Repository UI

Devyy includes native Git support, but VSX SCM extensions expect generic SCM abstraction:

- **Generic SCM View Container (`scm.createSourceControl`)**:
  - _Extension Host_: Supported with `SourceControl`, `SourceControlInputBox`, and `SourceControlResourceGroup`.
  - _Devyy Gaps_: Rendering extension-registered SCM instances and resource groups (e.g. "Staged Changes", "Merge Conflicts", "Untracked") in the SCM sidebar alongside or replacing native Git when non-git VCS extensions are active.
  - _Impact_: SVN, Mercurial, Perforce, and GitLens advanced repositories view.

- **Gutter Quick Diff Provider**:
  - _Devyy Gaps_: Hooking `workspace.registerQuickDiffProvider` or SCM original-resource URIs to CodeMirror's gutter to display addition/modification/deletion color bars against the working tree.
  - _Impact_: Line-level change indicators for non-git files or secondary repositories.

### 6. Testing Subsystem (Test Explorer)

The testing namespace (`vscode.tests`) enables test runners to surface structured test suites:

- **Workbench Test Explorer UI**:
  - _Extension Host_: Implemented. `createTestController`, `TestItem` tree hierarchy, `createRunProfile`, and `createTestRun` are fully operational.
  - _Devyy Gaps_: A dedicated Test Explorer panel in the sidebar rendering the hierarchical `TestItem` tree with run/debug action buttons, filter by status (passed/failed/skipped), and continuous testing triggers.
  - _Editor Gutter Integration_: Rendering green checkmarks and red cross icons beside test definitions in CodeMirror, with click-to-run and inline diffs for failed assertions (`TestMessage`).
  - _Impact_: Vitest extension, Jest, Playwright Test runner, pytest, and Rust cargo-test explorer.

### 7. Comments, Reviews & Timeline

Code review and timeline contributions:

- **Editor Comment Threads (`comments.createCommentController`)**:
  - _Extension Host_: Implemented. Controllers and threads with range anchors are supported.
  - _Devyy Gaps_: Inline expandable comment widgets inside CodeMirror lines and Diff editors with markdown rendering, input textboxes, and action menus (Reply, Resolve, Delete).
  - _Impact_: GitHub Pull Requests and Issues extension, GitLab Workflow, and code review extensions.

- **Timeline View (`workspace.registerTimelineProvider`)**:
  - _Extension Host & Devyy Gaps_: Timeline provider registration and dedicated timeline sidebar view showing combined Git history, file saves, and issue links.
  - _Impact_: Git history inspection and local file save history.

### 8. Multi-Root Workspaces & Configuration Hierarchy

Complex enterprise projects use multi-root workspaces:

- **Workbench Multi-Folder File Tree**:
  - _Extension Host_: `workspace.workspaceFolders` supports dynamic updates, closest-prefix `getWorkspaceFolder(uri)`, and folder-prefixed `asRelativePath(uri, true)`.
  - _Devyy Gaps_: File Explorer sidebar currently assumes a single root folder. It needs support for rendering multiple root folder nodes, adding/removing folders at runtime, and persisting `.code-workspace` JSON files.
  - _Impact_: Monorepos and multi-package workspaces.

- **Configuration Scope Hierarchy**:
  - _Extension Host_: Basic configuration reading supported.
  - _Devyy Gaps_: Proper fallback resolution between `ConfigurationTarget.Global` (User), `Workspace` (`.code-workspace`), and `WorkspaceFolder` (`<folder>/.vscode/settings.json`), with schema-driven validation for extension-contributed configuration points.
  - _Impact_: Per-folder linter/formatter configurations (e.g. ESLint / Prettier rules differing across folders in a monorepo).

### 9. Webview Resource Scheme & Platform Sandboxing

Webviews run complex interactive user interfaces (e.g. markdown previews, database explorers, AI chats):

- **Local Resource URI Proxying (`asWebviewUri`)**:
  - _Devyy Gaps_: On macOS (WKWebView), Windows (WebView2), and Linux (WebKitGTK), resolving extension local assets (`asWebviewUri(Uri.file(...))`) via custom protocol schemes without violating browser CORS or sandbox boundaries.
  - *Serialization & Restoring (`WebviewPanelSerializer`)**:
    - Restoring webview panels and state after application restart or workspace reload.
  - _Impact_: Draw.io, Hex Editor, Markdown Preview Enhanced, and Postman extensions.

### 10. Native Node Addons, Platform Binaries & ABI Compatibility

Certain VSX extensions bundle compiled C/C++ or Rust native Node modules (`.node` files):

- **Node.js ABI vs Electron ABI**:
  - Devyy runs its extension host as a pure Node.js CommonJS child process. Extensions that publish precompiled native binaries for Electron ABI rather than standard Node.js ABI will fail to `dlopen()` unless the native addon supports N-API (Node-API) or matches the host Node version.
  - _Platform Package Resolution_: Open VSX publishes both universal VSIX packages and platform-specific VSIX packages (e.g., `darwin-arm64`, `linux-x64`, `win32-x64`). Devyy's VSIX downloader must query platform-specific releases first to ensure native binaries (such as `@swc/core` or `tree-sitter`) match the host OS architecture.
  - _Impact_: Extensions using native speedups (SQLite, ripgrep native bindings, Keytar, Tree-sitter parsers).

## File previews and explorer

- Ignored files remain visible in the explorer. Generated folders are listed immediately and expanded on demand; `.git` internals stay hidden. Search retains its separate ignore-aware behavior.
- Image tabs support PNG, JPEG, SVG, WebP, GIF, ICO, BMP and AVIF with fit/zoom and SVG source switching. Images use inert image elements rather than executing SVG markup.
- Audio/video tabs support common browser media containers. Codec availability depends on the platform webview. Image reads are capped at 8 MiB; audio/video reads at 32 MiB. Large media streaming, PDFs, hex editing and dedicated notebook rendering remain outstanding.

## Editor features beyond extension APIs

- Complete multi-root workspaces and persistent workspace profiles.
- Workspace symbol/reference search, rename previews, refactor/code-action previews and navigation history across editor groups.
- Search/replace parity including exclusion configuration, ignore-file controls and previewing workspace replacements.
- Git line/hunk staging, merge-conflict resolution, interactive history/commit operations, independent repositories outside the workspace/submodule tree, push/pull workflows and extension SCM integration. Local/remote branch management, recursive submodule repositories and staging/commits are implemented. History now includes a paged topology graph, commit details, selectable merge parents and read-only historical file diffs.
- Launch/task configuration editing, problem matchers, compounds, debugger watches/breakpoint conditions and extension-provided adapters.
- Extension-contributed settings with scope/validation, schema-driven JSON configuration and settings sync/profiles.
- Full file/product icon theme contributions, semantic theme mappings, high contrast and accessibility settings.
- Recovery of unsaved documents after a crash, large-file safeguards and reproducible startup/memory/typing benchmarks.
- Platform CI for PTYs, shell discovery, file watching, credential stores, WebView resource loading, native dialogs, installers and updates.

## Built-in agent and desktop integration

- Implemented: session-scoped workspace consent, read/search/list tools, full-access review proposals, unchanged-buffer validation, atomic new-file saves, visible tool activity and bounded tool loops for Responses, Messages, compatible Chat Completions, Claude Code structured output, Google DeepMind Antigravity CLI and OpenCode agent harnesses. Full workspace mode also exposes time-limited workspace commands; attached and read-only modes do not.
- Implemented: provider onboarding, editor import marks and notices, vertical category motion, background workspace indexing and deferred AI history loading.
- Implemented: dedicated Antigravity `acp --login` sessions, OpenCode CLI routing in workspace mode with isolated scoped tools, incremental structured-answer decoding, cumulative/delta text handling, model-reported reasoning names and stages, and progressive answer reveal with reduced-motion support. Unreported model capabilities use provider defaults. Live authenticated CLI compatibility remains to be validated with user accounts.
- Implemented: interface scale/text-size preferences, transparent editor gutters with content/selection clipping and pane isolation, independent completion sources, opt-in AI completion with provider/model selection and usage recording, custom text/JSONL CLI providers, persistent local usage totals and a branded ChatGPT loopback authorization page. AI completion currently uses a popup rather than inline ghost text; complete completion-item resolving parity remains incomplete.
- Implemented: optional Git/GitHub onboarding, dependency download links, GitHub CLI browser/device authorization with cancellation, selectable HTTPS credential setup and separately confirmed global commit identity. GitHub CLI owns account credentials. Devyy-owned GitHub OAuth registration, account switching UI and live account/platform verification remain future work.
- Implemented: explicit macOS file-type associations, Windows per-user registration/system chooser, Linux desktop/MIME registration, and queued OS file-open routing. Windows/Linux behavior requires native platform validation.
- Remaining: live account/tool-loop validation against provider services, cancellation/recovery under real network failures, permission persistence UI if requested, richer patch/multi-file review, shell/task approvals, complete startup/typing/memory benchmarks, remote workspaces and conflict-resolution workflows.

## Provider authorization

- **Implemented:** Devyy's independent public-client ChatGPT registration, system-browser consent, PKCE/state/nonce, verified OIDC identity, per-account issued client IDs, host identity, encrypted credentials protected by the OS credential store, refresh and revocation. Inference uses the public Responses endpoint with `store: false` and streaming.
- **Supported account runtimes:** the unmodified Claude Code account flow, with explicit in-app installation when missing. Devyy’s ChatGPT connection does not read or replace CLI credentials. Codex CLI has been retired as a built-in provider; its existing conversation content is preserved and migrated to ChatGPT. The Codex extension remains independent.
- **Claude limitation:** Anthropic currently directs third-party applications to API keys or supported Claude Code integrations. Do not borrow Claude Code's OAuth client ID or present its subscription OAuth tokens as Devyy-owned authorization. Add a Devyy-branded Claude account flow only when Anthropic publishes an applicable registration/inference contract.
- **Remaining:** live user-driven authorization validation, account grant recovery/expiry scenarios against the service, account eligibility/plan permission UX, multi-process refresh locking, platform credential-store testing and any provider-approved usage endpoints. Do not estimate unavailable account percentages or costs.

## Compatibility verification gate

A package is only marked verified when its important workflow has been exercised with the actual package version:

1. Install the correct platform package, including dependencies and required runtimes.
2. Activate it through the intended event and surface any missing API precisely.
3. Execute commands with real document/resource arguments and inspect return values/errors.
4. Exercise its contributed views, menus, settings, editor actions and cancellation/disposal.
5. For language extensions, verify process startup, initialize, document changes, diagnostics, completion and navigation. Registering a server configuration is insufficient.
6. Test theme changes, hidden/reopened views, extension disable/reload and workspace switches without losing sessions or duplicating processes.
7. Run these checks in packaged macOS, Windows and Linux applications. Browser fixtures cannot establish native platform compatibility.

The test suite includes real installed Codex/Claude bundle activation and view resolution when their package paths are supplied. This is narrower than proving every feature of either extension. Native fixture tests exercise actual server processes over stdio, IPC, pipes and sockets, custom request replies, launch environment/cwd, diagnostics and shared-client shutdown. A separate integration test verifies diagnostics from the real Apple clangd process on macOS. Authenticated provider chats and real account grants are not automated tests.

QuickInput tests run a real fixture extension in the production Node host and connect its prompts to the React workbench through a substituted native transport. They verify original item/button identity, event ordering, multi-select, list replacement, stale-event rejection, reopening, disabled/loading state, in-place validation, passwords and cancellation. These browser checks do not establish Windows/Linux native transport or accessibility parity.

References: [VS Code API](https://code.visualstudio.com/api/references/vscode-api), [contribution points](https://code.visualstudio.com/api/references/contribution-points), [Open VSX](https://github.com/eclipse/openvsx), [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

## Beta preparation

Explorer supports moving files/folders with destination feedback, hover expansion,
collision checks and preservation of open editor buffers and split groups. The
gutter stays transparent while code, cursor and selection layers are clipped at
its edge. Completion sources return independently; member triggers, server edit
ranges, snippets and additional imports have interface regressions. OpenCode
model discovery reads its structured catalog in the same isolated scope as chat,
preserves routed model identities and reports account/credit errors.

Devyy's original code uses GPL-3.0-only. Credits retain dependency and artwork licenses.
See `BETA_TESTING.md` for acceptance checks and known limits. Platform bundle
targets and CI jobs are configured; Windows/Linux native execution, signing,
notarization and publication still require release validation.

## Installer and desktop chrome

Implemented a separate Rust/Tauri installer with staged per-user Windows/Linux
installation, managed uninstall, registry/shortcut integration and optional
user-reviewed feedback. Setup has location, shortcuts, licenses and installation
pages with reversible horizontal blur transitions. macOS now uses a standard Finder DMG containing Devyy itself beside Applications,
with transparent Devyy artwork. Opening the image leads directly to the real
drag-to-Applications operation; no custom setup application is shipped for macOS.
The normal app icon is preserved. Extension warning/error reports use toasts; background checks remain in the
status bar. The footer clips to a single row and non-macOS header menus overflow
into More. Settings transitions reverse with navigation direction.

Remaining release gates: native Windows/Linux installation, upgrade and uninstall
acceptance; macOS Finder drag acceptance with a signed/notarized app;
release signing, notarization and publication. Mocked interface tests cannot
establish those guarantees.

## Agent and packaging hardening

Strict tool schemas now require every declared property and represent optional
values with null, recursively including nested structured CLI results. Batched
file reads preserve individual errors and permission boundaries. Malformed tool
arguments produce recoverable tool results. OpenCode uses the same authenticated
CLI service as sign-in, with temporary scoped configuration and canonical Unix
working-directory environment. Local CLI model discovery and a nonexistent-model
transport probe passed; account-specific paid inference remains a live acceptance
check.

Devyy's original code is GPL-3.0-only. Display name and release executable are
Devyy on all platforms; publisher, copyright, descriptions, source homepage and
license metadata are configured. macOS bundle metadata and embedded GPL text
are verified locally. Windows PE metadata and Linux desktop integration still
require native release checks.
