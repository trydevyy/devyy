# Devyy compatibility roadmap

Updated 2026-11-12. This is a work list, not a claim of complete VS Code compatibility.

Open VSX distributes packages. Successfully finding or installing a VSIX does not mean that its runtime, native binaries, contributed UI, or proposed APIs work in Devyy. Compatibility must be established through behavior tests against the actual package and each supported platform.

The extension host currently reports VS Code API version `1.96.2`. That value is not a complete implementation of that release's API. A versioned, machine-readable capability inventory must replace this implicit promise before declaring a compatibility level.

## Release priorities

1. Make activation, commands, document state and language-server startup reliable. Surface failures at the responsible extension instead of swallowing them or returning fake success.
2. Complete the stable VS Code API through native Devyy services, with tests covering its return values, errors, cancellation and lifecycle.
3. Test a published package matrix on macOS, Windows and Linux. Run actual packaged builds, including Windows WebView2 and Linux WebKitGTK.
4. Add the remaining workbench features that those APIs need. A namespace or type declaration without a functioning editor UI is incomplete.

## Implemented foundations

These are supported paths, with limitations listed below.

- Process-isolated Node/CommonJS extension execution; startup, language, command, view and URI activation; dependency ordering and failure reporting.
- Extension mementos, OS-protected encrypted per-extension secret storage, configuration overrides, package resources, output, notifications, input/quick-pick dialogs, clipboard, URI handlers and native terminal/pseudoterminal bridges.
- Command arguments and results across the process boundary, including revived URI arguments. Commands invoked during their own extension's activation no longer wait for that same activation.
- File-backed, untitled, content-provider and custom-filesystem documents; active editor/selections, tab inventory, document change/save events, text edits and diff opening.
- Trees, contributed webview views, webview panels, resource roots, messages, state, storage, theme changes and visibility events.
- A shared VS Code theme-token surface. Extension styles control their own widgets; Devyy does not force padding/backgrounds onto every extension button and input.
- Contributed command-palette visibility, command enablement/toggled states, grouped/submenu contributions in editor, file explorer, tab, tree, view-header and webview context menus. Webviews can use `data-vscode-context`.
- Actual container/extension icons with a placeholder fallback. Codex and Claude live in the right AI workspace, pinned to `chatgpt.sidebarView` and `claudeVSCodeSidebar`.
- Native stdio LSP clients; extension language-client launch registration; Node stdio, IPC, pipe and socket transport bridges; launch cwd/environment; initialization options, feature capability contributions, custom request/notification handlers and shared clients across language selectors.
- Native completion, hover, definitions, formatting and diagnostics. Extensions can register additional language providers; only a subset is consumed by the editor UI.
- Open VSX browsing/VSIX installation, progress, installed icons, dependency packages, themes, grammars and snippets.
- Material Icon Theme file/folder artwork and a searchable Credits & licenses page generated from dependency metadata and license files.

## Stable API and workbench gaps

| Area                                   | Remaining work                                                                                                                                                                                                                                                       | Priority |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Activation and packaging               | `workspaceContains`, language-less selectors, wildcard activation edge cases, manifest localization, extension kind/engine/platform compatibility checks, reload/recovery tests, browser-only extension workers                                                      | P0       |
| Command system                         | Complete built-in command routing and argument semantics, command URI links with trust checks, missing provider-execution commands, progress/cancellation, enablement and accessibility across all contribution locations                                            | P0       |
| LanguageClient                         | Functions returning live child processes or stream transports, full middleware and converters, dynamic feature registration, proper `$/cancelRequest`, progress/trace/error handlers, automatic restart/backoff, correct lifecycle when one of several clients stops | P0       |
| LSP synchronization                    | Server-originated workspace edits, file create/rename/delete operations, watched-file registration, configuration change routing, document filters/notebook selectors, per-client server request timeouts, encoding negotiation beyond UTF-16                        | P0       |
| LSP/editor UI                          | Signature help, references/implementation/type-definition/declaration navigation, rename UI, code-action resolving, snippets/insert-replace edits in completions, code lenses, inlay hints, semantic tokens, folding/selection ranges and diagnostics code links     | P0       |
| Document/editor objects                | Complete editor option change events, will-save/waitUntil, version-checked workspace edit transactions and resource operations, snippets/tab stops, decorations and gutter markers, editor groups and diff/custom-editor tab semantics                               | P0       |
| Workspace and filesystem               | Workspace-folder changes and multi-root behavior, configuration inspect/update scopes, complete `workspace.fs` errors/events, reliable recursive watching on every platform, search/exclude semantics, workspace trust and virtual-workspace checks                  | P0       |
| Credentials                            | Cross-process secret-change events, migration/recovery, OS credential-store integration tests and account-provider integration. Basic get/store/delete and same-host change events now use encrypted per-extension vaults with OS-protected keys                     | P0       |
| Authentication                         | `authentication.registerAuthenticationProvider`, session requests/pickers, consent and session-change events, account preferences, built-in provider integrations where their public services permit them                                                            | P0       |
| Menus and contexts                     | Render navigation/inline view actions and all remaining menu locations; alternate commands, dynamic labels/icons, resource selections, submenu overflow, context-key scoping and full `when` grammar parity                                                          | P1       |
| Webviews                               | Resource URI/CSP parity across platforms, binary/resource caching, `retainContextWhenHidden`, serializers across restart, complete options/port mapping, find/copy/paste integration, accessibility/high contrast, visibility/focus precision                        | P1       |
| Trees                                  | Selection/multiselect, reveal/focus, checkboxes, drag/drop, custom icons, badges, title/description/message updates, refresh granularity and welcome contributions                                                                                                   | P1       |
| Window services                        | QuickInput/QuickPick objects and their event lifecycle, validation/cancellation, progress with cancellation, output/log levels and visibility, complete status bar accessibility/backgrounds, tab/group/window state parity                                          | P1       |
| Tasks                                  | Task providers, discovery, execution, problem matchers, presentation options, cancellation, task terminals and execution events                                                                                                                                      | P1       |
| Debuggers                              | `debug` namespace, debugger contributions, adapter factories/trackers, configurations/compounds, breakpoint models, exception policies and debug console integration. Built-in DAP functionality does not provide extension API parity                               | P1       |
| Source control                         | `scm` providers/input boxes/resource groups, repository/resource events and contributed actions. Built-in Git is not a substitute for these extension APIs                                                                                                           | P1       |
| Terminals                              | Shell integration/execution events, terminal profiles/providers, environment collection persistence, links/quick fixes, location/group behavior and reconnection of extension-owned terminals                                                                        | P1       |
| Custom editors                         | Complete custom-document lifecycle, undo/redo/save/revert/backup, readonly editors, serializer recovery and notebook/custom tab inputs                                                                                                                               | P1       |
| Notebooks                              | Notebook documents/editors/serializers/controllers, cell execution/output, metadata edits, kernels, rendering and notebook contribution points                                                                                                                       | P2       |
| Testing                                | Test controllers/items, run profiles, discovery, continuous testing, results/coverage, output and a native test explorer                                                                                                                                             | P2       |
| Comments and history                   | Comment controllers/threads, review actions, timeline providers and corresponding workbench views                                                                                                                                                                    | P2       |
| AI extension APIs                      | Language models, model tools, chat participants, prompt references and contribution contracts. The built-in Devyy chat does not implement VS Code's `lm`/`chat` APIs                                                                                                 | P2       |
| Remote development                     | Remote authority resolvers, remote extension hosts, containers/SSH/WSL, remote filesystem and port tunnels. Local WSL shell selection alone is not remote development                                                                                                | P2       |
| Accessibility and internationalization | Screen-reader/editor parity, full keyboard traversal, localized manifests/settings, bidirectional layout, high contrast and reduced-motion testing                                                                                                                   | P1       |
| Proposed APIs                          | Explicit capability/permission negotiation, per-extension opt-in and versioned implementations. Do not report arbitrary proposed APIs as available                                                                                                                   | P2       |

## Editor features beyond extension APIs

- Complete multi-root workspaces and persistent workspace profiles.
- Workspace symbol/reference search, rename previews, refactor/code-action previews and navigation history across editor groups.
- Search/replace parity including exclusion configuration, ignore-file controls and previewing workspace replacements.
- Git line/hunk staging, merge-conflict resolution, interactive history/commit operations, independent repositories outside the workspace/submodule tree, push/pull workflows and extension SCM integration. Local/remote branch management and recursive submodule repository selection, staging, commits and history are implemented.
- Launch/task configuration editing, problem matchers, compounds, debugger watches/breakpoint conditions and extension-provided adapters.
- Extension-contributed settings with scope/validation, schema-driven JSON configuration and settings sync/profiles.
- Full file/product icon theme contributions, semantic theme mappings, high contrast and accessibility settings.
- Recovery of unsaved documents after a crash, large-file safeguards and reproducible startup/memory/typing benchmarks.
- Platform CI for PTYs, shell discovery, file watching, credential stores, WebView resource loading, native dialogs, installers and updates.

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

References: [VS Code API](https://code.visualstudio.com/api/references/vscode-api), [contribution points](https://code.visualstudio.com/api/references/contribution-points), [Open VSX](https://github.com/eclipse/openvsx), [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
