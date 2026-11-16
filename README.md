# devyy

**A focused development environment.**

devyy is a local desktop code editor built with a Rust core, Tauri 2, React, and CodeMirror 6. Its workspace combines compact IDE navigation, floating file tabs above a separate editor surface, a unified command bar, restrained typography, and coordinated light and dark themes. Native window vibrancy softens the surrounding chrome, with independently adjustable window and editor transparency.

This repository contains a working v0.1 application, not just a visual mockup. Native filesystem, Git, terminal, language-server, and debugger operations live in Rust. The editor interface uses the operating system’s webview rather than bundling Chromium. No account, telemetry, API keys, or cloud service is required. Fonts are bundled for offline use.

![devyy dark theme](artifacts/devyy-dark.png)

![devyy light theme](artifacts/devyy-light.png)

## Run

Install Node.js 22.12+ and a current stable Rust toolchain. On macOS, install Xcode command-line tools (`xcode-select --install`). Then:

```sh
npm install
npm run desktop
```

Devyy starts on Home with no sample files, a collapsed project sidebar and a hidden terminal. Open a project with **⌘/Ctrl O** or choose a recent project. Opening a project reveals its sidebar. Native local-file and process features activate after you open a folder in the desktop app.

```sh
npm run dev             # browser preview at http://127.0.0.1:1420
npm run desktop:build   # optimized native application
```

Development and browser tests can explicitly open `http://127.0.0.1:1420/?playground=1` for sample files and locally persisted edits. Ordinary launches do not load or overwrite saved sample data. Packaged builds always start without the playground.

Platform bundle configurations are included: macOS `.app`, Windows NSIS installer (with WebView2 bootstrapper), and Linux `.deb` / `.AppImage`. Windows needs the Visual Studio C++ Build Tools and Windows SDK. Debian/Ubuntu builds need `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, and `patchelf`. `.github/workflows/desktop.yml` runs compilation, unit/native tests, and packaging on macOS, Windows, and Ubuntu. Native Windows/Linux results still need to be collected from those runners; local native verification is on macOS. Development builds are unsigned.

The separate [installer project](installer/README.md) adds a guided Windows/Linux
setup (location, shortcuts, licenses, installation), per-user registration and
a branded uninstaller with optional feedback. macOS uses a styled Finder DMG containing Devyy itself and an Applications
shortcut, with no intermediate installer application. Build it with `npm run release:installer`.


## Included

- First-run setup with live appearance/accent choices, editor preferences, opt-in AI code suggestions, reviewed settings imports, extension browsing, provider connections, and Git/GitHub setup. Existing installations keep their preferences; **Set up devyy** reopens the flow from the command palette or **Settings → Setup & import**.
- Independent interface scale and interface text-size controls in Appearance. Editor and terminal fonts retain separate settings. The titlebar workspace menu lists recent folders and opens another folder through the native picker.
- Open VSX search, pagination, install/update, enable/disable, uninstall, and local VSIX installation. Installed language definitions, TextMate grammars, snippets, and syntax color themes work without running JavaScript entrypoints. The Installed list identifies contributions requiring a VS Code extension host.
- Project explorer with nested folders, create, rename/move, delete, refresh, dirty indicators, and recent projects.
- Reorderable tabs and persistent split groups for two distinct files. Right-click another file and choose **Open in split editor** to pair it with the current file. Opening an unrelated tab shows it alone; selecting either group member restores the pair. Separating or closing a member leaves the other file open, and editor histories stay intact. Custom tab menus support save, split, copy path, and closing other/right/all tabs with unsaved-change protection. File groups and Markdown previews retain independent widths during the session. Keyboard tab navigation and closing tabs to the right follow the displayed group order; Home/End jump to the first/last tab.
- Syntax highlighting from 145 language definitions, including C/C++, C#, Go, Java, Kotlin, Swift, Ruby, PHP, SQL, YAML, TOML, Shell, PowerShell, Dockerfile, Makefile, Vue, and Svelte. Filename and extension detection also handles common dotfiles. Parsers load on demand; language-server support remains separate.
- Markdown source, rendered preview, and side-by-side views, with live updates, preserved source undo history, tables, task lists, syntax-highlighted code fences, copy-code actions, heading links, project-relative links, and bounded local image reads. Embedded HTML renders through sanitization, including details/summary, tables, inline formatting, and image dimensions. Scripts, event handlers, embedded frames, and document styles are removed.
- Undo/redo, multiple selections, rectangular selection, code folding, bracket matching and closing, indentation, local completion, selection highlighting, line navigation, and in-file find/replace with regex support.
- Fuzzy file navigation, a searchable command palette with Files/Commands modes and recent choices, and configurable command shortcuts. Native macOS File, Edit, Selection, View, Go, Terminal, and Window menus share command bindings.
- Workspace text search with case matching, collapsible file groups, highlighted matches, and file/line navigation. Native traversal respects `.gitignore` and skips generated folders.
- Git source control with separate staged and working-tree lists, individual/bulk staging and unstaging, confirmed discard of tracked working changes, local and remote branch discovery, tracked remote checkout, branch creation/renaming/safe deletion, fetch and fast-forward updates, upstream ahead/behind counts, and the latest 40 commits. Clicking a changed file opens a dedicated comparison tab with side-by-side or inline diffs, syntax and changed-line highlighting, synchronized scrolling, change navigation, and collapsible unchanged lines. Comparisons distinguish HEAD → index from index → saved working tree, preserve open editor buffers, and handle added/deleted/renamed/binary files. Visual text diffs are limited to 2 MiB per side. Git uses the project’s existing identity and hooks; branch switching requires saving open edits and never forces checkout. A repository selector scopes changes, staging, commits, branches, and history to the workspace or an initialized submodule. Recursive submodule discovery shows initialization, dirty files, changed commits, and conflicts; submodules can be added, initialized, updated to the recorded commit, and synchronized. Commit drafts are kept separately for each repository. Gitlinks have textual commit-pointer diffs. Push/pull workflows, merge conflict resolution, and hunk staging remain outside this implementation.
- Multiple independent PTY terminals in one adaptive toolbar, with persistent split groups, a shared file/terminal tab design, matching numbered panes, and per-group split widths, installed shell discovery, a persistent default profile, and per-session selection. ANSI colors, session switching/renaming/restart, split terminal panes, font/line-height/scrollback/cursor settings, copy on selection, and process-preserving panel toggles. Terminal tabs and whole split groups can be reordered by dragging; middle-click closes one session. Reordering preserves running processes. Home/End jump to the first/last terminal tab. Shell discovery and process startup run off the UI thread.
- Editable run commands plus Rust check, test, and release-build shortcuts. Running saves open changes first.
- Language Server Protocol support: server completion, hover, diagnostics, go to definition, and document formatting.
- Debug Adapter Protocol support: gutter breakpoints, launch, pause/continue, step over/into/out, stop, call stacks, and expandable local variables. Debug output appears in Output. The Output panel features service and extension channel filtering (built-in Devyy services: Devyy core, Debugger, Extension Host, Language Servers, Tasks, Git; plus dynamically discovered extension channels), real-time substring filtering with Esc clear, matching line count badges, auto-scroll follow lock, clipboard copy, and scoped or global clearing.
- Searchable glass Settings with Appearance, Editor, Files & saving, Layout, Terminal, Keyboard shortcuts, Accessibility, Extensions, Language servers, Setup & import, and About devyy. A live editor preview, section navigation, typography/ligatures/letter spacing, relative line numbers, indent guides, whitespace visibility, column ruler, cursor shapes/blink, folding, bracket behavior, completion timing, editor inset, scroll-past-end, and auto-save delay. Changes preserve text and undo history. Shortcut recording includes conflict reassignment and per-command reset. About shows app/build versions, compilation time, actual OS build, and update availability from the public GitHub releases endpoint. Failed or unavailable checks have an explicit status. Build details can be copied.
- Independent sidebar/panel toggles, full-width focus mode, maximizable panels, and draggable sidebar, panel, editor split, and terminal split edges. Keyboard-adjustable separators; double-click or Home resets sizes. Sidebar, panel and editor split sizes persist across launches and clamp to the window.
- Compact glass Settings, search, context menus, and Sonner notifications share the workbench palette.
- Consistent custom context menus for explorer files/folders/empty space, tabs, editor, terminal sessions/output, and layout. Menus fit the viewport, support arrow navigation, and open with right-click or Shift F10.
- Unsaved-change prompts, external-change detection before saves, binary file rejection, workspace boundary checks, symlink escape protection, and cleanup of managed processes.

## Workspace responsiveness

Opening a folder returns a bounded, two-level snapshot and opens the first document immediately. The complete ignore-aware index and project identity refresh run on blocking workers in the background. Extension-host synchronization, language-server shutdown and debug cleanup do not block the editor's first document. Cached sort keys avoid repeated path allocations during indexing. File icons load lazily and decode asynchronously, and persisted AI history hydrates when the built-in assistant is first used. The former Opening workspace overlay has been removed. A native scan measurement is available with `cargo test --manifest-path src-tauri/Cargo.toml benchmark_open_snapshot -- --ignored --nocapture`; it measures directory enumeration, not end-to-end startup.

The file and command palette (**⌘/Ctrl P**, **⌘/Ctrl Shift P**) separates file names from their directories, highlights exact and fuzzy matches, and marks recently used items. Clear resets the search without losing keyboard focus. Arrow keys select results and Enter opens a file or runs a command. **⌘/Ctrl S** remains Save.

**⌘/Ctrl F** opens Devyy's compact Find and Replace panel at the top right of the document. It shows match counts, case/whole-word/regular-expression controls, previous/next matches, selection of all matches, and an expandable replacement row. Invalid expressions show inline feedback, replacement respects read-only documents and edits remain undoable. Match counts are bounded at 10,000. The same Find panel is used in visual diffs.

Dropdowns, model suggestions, accent color editing, checkboxes and confirmation alerts use Devyy's own styled controls. Dropdowns support arrow keys, Home/End, type-ahead and Escape; destructive confirmations initially focus Cancel. File and folder pickers remain native OS dialogs.

## Default applications

**Settings → Default applications** lists supported source/document extensions and their current handlers. On macOS, **Use Devyy** asks Launch Services to associate that type with the installed app. On Windows, Devyy registers its per-user capabilities and opens the protected Windows chooser; finish the selection there. Linux registers a user desktop entry and applies the selected MIME association through `xdg-mime`. These controls never change defaults merely by opening Settings. File associations are declared in the app bundle; OS file-open events and subsequent single-instance launches are queued into the existing workbench. Windows/Linux native behavior still needs platform testing.

## Commit graph

Source Control separates **Changes**, **History**, and **Repositories**. Changes contains staging and commit controls; Repositories contains branch management and submodules. Choose **History → Open commit graph** for a paged graph across local and remote refs, searchable commit metadata, commit messages, merge-parent selection and changed-file lists. Use Arrow Up/Down or Home/End to select commits with the keyboard. Selecting a changed file opens a read-only visual diff between the chosen commit and parent, including initial commits, renames, deletions and binary indicators. Diff headers identify the parent revision or empty tree, and **Back to commit graph** restores the selected commit and merge parent. Historical diffs do not stage files or modify the working tree. Older history loads in bounded pages.

## Project identity

The workspace selector detects a local project logo when you open or refresh a folder. It prefers `logo` / `logomark` assets, named logo variants, and project-named images before falling back to `icon` / `favicon`. SVG, PNG, WebP, JPEG, and ICO images up to 5 MiB are supported, including `assets/logo.png`. Discovery reuses the ignore-aware file listing, skips generated directories, and stays within the workspace. Missing or unreadable images fall back to the project’s first letter. Use **Refresh files** after adding or replacing a logo.

The application is named **devyy**. Its existing bundle identifier stays stable, and preferences, recent projects, debugger settings, and saved playground files are read from the previous storage keys when needed.

## Appearance and vibrancy

Dark with neutral white accents is the default for new installations. Light mode uses a dark neutral accent. Choose blue, violet, mint, amber, or a custom color in **Settings → Appearance**; controls keep a contrasting foreground. The logo remains neutral, and the window icon, macOS Dock icon, and browser favicon follow the selected theme. Installed extension themes can supply syntax colors. Follow system appearance is optional. Existing saved theme choices are preserved. The top-right overlapping-circles button toggles vibrancy; Preferences also includes **Window vibrancy** and **Reduce motion** switches. Changes persist across launches. Code syntax and live terminal colors follow the selected theme without restarting the terminal session.

On macOS, a native `NSVisualEffectView` with the Sidebar material blurs the desktop behind the window and follows window activation. The transparent webview reveals that material through one shared tint across the titlebar, activity rail, sidebar, tab strip, and outer margins; the editor has its own tint, cut out from the chrome layer so its transparency is independent. Settings floats above the visible workspace; opening it leaves files and terminal sessions in place. Search, dialogs, context menus, completion tooltips, and notifications share the same glass surface; **Menu transparency** and **Glass softness** adjust them together. **Interface motion** offers Snappy, Relaxed, or Instant transitions, and reduced motion takes priority. The terminal retains a solid background for readable output. Repeated appearance changes replace the existing material rather than stacking views. System reduced transparency disables translucency, and system reduced motion disables transitions regardless of the saved preference.

Windows uses Mica when available and falls back to an opaque themed window on older builds; Linux uses opaque themed chrome. Both use native window decorations rather than macOS traffic-light spacing. These platform fallbacks have not been verified on this macOS machine. The browser playground uses CSS frosting inside its own page; it cannot blur the actual desktop. No animated blur or continuously running animation is used.

macOS transparency requires Tauri's `macos-private-api` feature, enabled in this project. The current distribution remains a local unsigned `.app`, not a Mac App Store package.

## Markdown preview

Open a Markdown file and use the **Source**, **Preview**, or **Preview to the side** controls in the tab bar. **⌘/Ctrl Shift V** toggles preview; **⌘/Ctrl Option/Alt V** opens it beside the source. These commands are also in the command palette, tab menus, and customizable shortcuts. Edits update the preview without saving. Preview links can open workspace files or the default browser; local images stay within the workspace and have an 8 MiB limit.

## Terminal profiles

Use the arrow beside **+** in the terminal toolbar to start a shell profile, or choose **Settings → Terminal → Default shell** for future sessions. Changing the default never replaces a running shell. On macOS and Linux, discovery checks the login shell, `/etc/shells`, and installed zsh, Bash, fish, Nushell, and PowerShell executables. On Windows, it checks Command Prompt, Windows PowerShell, PowerShell 7, Git Bash, and WSL where installed; Windows behavior has not been tested on this macOS workspace. **Refresh installed shells** updates the list after an installation. An unavailable saved profile reports an error and can be changed in Settings.

## Language intelligence

Compatible bundled extension servers are discovered automatically. Other language servers are separate developer tools; install them and ensure their executable is on the PATH inherited by devyy. Restart/reopen the project after installation.

| Language                | Install                                                | Executable                   |
| ----------------------- | ------------------------------------------------------ | ---------------------------- |
| Rust                    | `rustup component add rust-analyzer`                   | `rust-analyzer`              |
| JavaScript / TypeScript | `npm install -g typescript typescript-language-server` | `typescript-language-server` |
| Python                  | `python3 -m pip install 'python-lsp-server[all]'`      | `pylsp`                      |

Open a supported file to connect automatically. **Extensions & languages** shows active connection status. **Settings → Language servers** has presets for Rust, JS/TS, Python, Go, C/C++, HTML, CSS, JSON, YAML, Svelte, Vue, Shell, Lua, and TOML. Any stdio LSP server can be added with a language ID, executable, JSON argument array, initialization options, and workspace configuration. Executables and arguments are kept separate; Windows npm shims are resolved and background tools do not create console windows. Saved configuration restarts language connections. The user configuration file is `language-servers.json` in the OS application config directory. The Problems panel displays diagnostics actually reported by installed servers; zero diagnostics is not an assertion that an unconnected project has passed a check.

## AI workspace

![Devyy AI workspace](artifacts/devyy-ai.png)

Use the **AI workspace** right-panel button in the header, **⌘/Ctrl Shift I**, or **Open AI assistant** in the command palette. The right workspace shares the project sidebar's translucent material, with a wider grip gutter and no separator beneath the agent tabs. Its composer includes a searchable model picker, favorites across enabled providers, manual model configuration, and supported reasoning controls. Model rows show display names and a provider badge on the logo. ChatGPT discovery preserves account-advertised capabilities; Claude discovery uses documented aliases and inspects the installed CLI's supported effort flag. Other APIs discover their own models without assuming unsupported reasoning options.

AI providers are available in first-run setup as well as Settings. The import step shows the detected editor's mark, with its upstream notices included in Credits. **Settings → AI providers** uses a provider list with enable switches and a detail pane for connection status, display name, account/API setup, default model, and runtime information. Custom providers can be added or removed. Changing connection details invalidates the model cache; inspecting another provider preserves unsaved edits. Account checks do not silently save pending settings.

The attachment picker can combine workspace files, folders, editor selections, individual/all diagnostics, output, and terminal snapshots. File tabs, explorer entries, problem rows/panel tabs, individual terminal tabs, and the center handle of split file/terminal groups drag into the composer. Split-group drops capture both members and retain their layout and running sessions. Device text files can be selected or dropped. Attachment previews show the exact snapshot, and repeated drops refresh an existing attachment. Context is captured when attached; later file changes do not alter a sent message. Each attachment is bounded to 160 KiB, with up to 32 items and 350 KiB total per message. Folders include at most 24 bounded files, terminal snapshots include the last 400 parsed lines, and truncated snapshots are marked. Binary/image attachments are not supported by these text transports.

Conversation history supports search, rename, delete, copying the transcript, branching after an assistant reply, and editing/resending a prompt. Branches preserve the original thread. Replies support Markdown, code copying, retry, cancellation, and explicit file replacement review. Escape stops a response from the composer or cancels a message edit. Streaming updates are batched to animation frames; unchanged Markdown replies are memoized.

**Usage** opens inside AI provider Settings with a reversible slide-and-fade transition; Back restores the provider's unsaved settings and keyboard focus. The chat toolbar also offers a standalone Usage surface. Usage filters by provider and separates **Cost**, **Tokens**, and **Limits**. Account quota bars show reported remaining percentages and reset countdowns. Token/request counters cover this Devyy session. Cost is shown only when a provider supplies an actual USD figure (currently Claude Code's result events); unavailable balances and prices remain unavailable. Account refresh replaces stale limits.

- **ChatGPT / Devyy authorization:** choose **Continue with ChatGPT**. Devyy uses OpenAI’s public desktop registration flow with `agent_name_hint=Devyy`; the browser authorizes Devyy and returns an issued client ID for that account/workspace. No CLI, client secret, borrowed Codex client ID, or developer-dashboard registration is required for this public-client flow. Saved registrations can be selected, reconnected or added without signing out of the CLI. Account-specific models come from `/v1/models`; chats stream through the public `/v1/responses` endpoint with `store: false`. Access depends on the user’s plan, workspace policy and granted plan-use scope.

- **Claude Code:** if the runtime is missing, choose **Install** in Devyy. This user-triggered action downloads the official platform installer, follows redirects only to allowlisted official script sources, reports installation stages, supports cancellation, and verifies the installed executable. A custom executable path can also be configured. **Sign in** runs `claude auth login`; the unmodified CLI owns browser authentication and credentials. Devyy streams conversations through `claude -p` using that CLI's configured authentication. **Check account & usage** reads `claude auth status`. Exact remaining subscription percentages are not available through this integration; available rate-limit events appear in Usage. Anthropic currently does not document a Devyy-owned Claude.ai registration flow for third-party inference. Use an Anthropic API key for a direct connection; Devyy does not borrow Claude Code’s OAuth client ID.
- **Antigravity:** connect to Google DeepMind's agent platform and local `agy` CLI harness. Antigravity discovers frontier reasoning models (Gemini 3.8 Flash, Claude Sonnet/Opus thinking, GPT-OSS) and reasoning effort tiers (`low`, `medium`, `high`, `xhigh`, `max`), streaming text and thinking deltas over stream-json with structured tool loop support.
- **OpenCode:** connect to the open-source `opencode` developer agent CLI (`anomalyco/opencode`). It streams JSONL text deltas, step completions, and usage counters directly from your local developer tools and configured models.
- **OpenAI / Anthropic APIs:** configure an API key and model. OpenAI uses streaming Responses; Anthropic uses streaming Messages. Custom OpenAI-compatible providers keep Chat Completions compatibility. **Discover models** queries the provider's actual models endpoint. API billing is separate from subscriptions.
- **Custom endpoints:** add a provider with a name, model, base URL (including its API version path, such as `/v1`), and optional key. OpenAI compatible and Anthropic Messages protocols are supported. Local unauthenticated endpoints work without an unlocked credential store. Remote endpoints require HTTPS; loopback HTTP is supported.

Keys are kept in macOS Keychain, Windows Credential Manager, or the Linux Secret Service. There is no plaintext fallback. Provider configuration, without keys, is written atomically to `ai-providers.json` in the OS application config directory. Blank key fields retain saved keys; **Remove key** deletes one. The independent ChatGPT connection verifies ID-token signatures/issuer/audience/expiry/nonce, encrypts its account/token records with AES-256-GCM, and keeps the encryption key in the OS credential store. It refreshes rotating tokens under a lock and attempts session revocation on disconnect. Disconnecting it does not sign out of Codex. Signing out of Claude Code signs out of that CLI. Runtimes install only after an explicit Install action; models are not downloaded automatically. Codex CLI is retired as a built-in provider. Existing CLI conversations keep their messages and attachments and migrate to the independent ChatGPT provider with a fresh model choice. The Codex extension remains available.

Devyy stores up to 40 recent conversations in local application webview storage, including attached snapshots; individual conversations can be deleted in History. Messages and attachments are sent to the selected provider. Account CLIs also load their own project instructions and configuration. Attachments-only chat does not expose workspace tools. **Agent workspace access** adds two explicit, session-scoped choices: **Read workspace** permits listing/searching/reading saved text files; **Full workspace** also permits ignored text files, proposed edits, and time-limited workspace commands. Commands run from the project directory using your normal user permissions. The consent dialog names the workspace and the selected provider receives files the agent requests. Common credential paths require full access. Grants are enforced by Rust, bound to the canonical workspace, and changing/revoking them cancels active agent jobs. Every tool result checks the active workspace and grant version; symlink and traversal escapes are rejected. The agent can iterate up to 12 bounded tool rounds, with visible workspace activity.

OpenAI/ChatGPT use Responses function tools, Anthropic uses Messages tool use, and custom OpenAI-compatible endpoints use Chat Completions tools. Claude Code uses its documented structured-output interface to request the same Devyy tools, with built-in tools disabled, project settings excluded and an isolated working directory. The Devyy agent has no command-execution tool.

**Proposed changes** appear as per-file review cards. **Review diff** opens the replacement or new file in the editor; **Apply to editor** updates an unsaved buffer and preserves the original until normal Save. New-file saves use atomic creation without overwriting an existing file. Existing buffers and disk stamps are checked for concurrent changes. Proposals and tool activity are retained with the conversation. **Review replacement** opens a complete attached file's suggested full replacement in the diff editor (multiple attached files require an explicit target); **Apply to editor** changes the unsaved buffer only after review and refuses when the original buffer changed. Normal saving behavior still applies.

Provider-reported thinking summaries stream separately from answer text in a collapsible **Thinking summary** section and are saved with the conversation. Devyy requests summaries for supported OpenAI reasoning models and adaptive thinking for recognized compatible Anthropic models; Claude Code's published thinking deltas are also supported. Signatures, opaque reasoning items, and unsupported fields are not displayed. No thinking text is fabricated.

Settings, context menus, model/context pickers, and the command palette share spring motion for opening and size changes. Category contents enter vertically in the direction of the selected category, reversing when navigating upward. Motion honors both the system's reduced-motion preference and Devyy's Reduced motion/Instant settings. Modal backdrops use a subtle blur.

Assistant Markdown uses a soft reveal for newly mounted blocks and preserves code-block controls while text streams. Provider requests reuse pooled HTTP connections; actual generation speed still depends on the connected service.

Usage records provider-reported input/output, cached-input and reasoning-token totals on this device, including AI completions, and persists counters across launches. Cumulative events are deduplicated; incomplete ChatGPT responses retain reported usage. Cached and reasoning tokens are included in their parent input/output totals. Account quotas, request rate limits, and billing remain distinct: ChatGPT authorization uses its plan allowance and does not expose API-dollar costs or a public remaining-plan-quota endpoint to Devyy. Its Usage page links to ChatGPT for account management. Unavailable values are not estimated. API rate-limit headers and Claude limit events remain inspectable. Authenticated live-provider sessions require the user's own account/key and are not exercised by automated fixtures.

Custom providers can select **Command line (CLI)** instead of an API protocol. Set an executable and an argument array; `{model}` is substituted in each argument without a shell. The default protocol writes the conversation prompt to stdin, closes stdin, and streams UTF-8 stdout. JSON mode sends `{system,messages,model,stream}` and accepts newline-separated `delta`/`text`, `reasoning`, `usage`, `cost`, `error`, and `done` events. Example: `{"type":"delta","text":"Hello"}` or `{"type":"usage","input_tokens":10,"output_tokens":2}`. CLI tools manage their own credentials and receive attached conversation context; Devyy's workspace tool loop remains specific to API providers and its supported Claude Code integration. Cancellation, bounded output and process cleanup are supported.

AI completion is off by default and separate from local/language-server completion. Enable it in Editor settings or setup, then select a completion provider/model or leave selection automatic. Automatic selection prefers a small model from an actual provider catalog. Suggestions debounce typing, cancel on document changes, use bounded nearby code, and account for reported tokens. They appear in the completion menu; this is not full inline ghost-text or edit-prediction support. Local words, snippets and language-server results can appear while a remote source is pending.

**Settings → Git & GitHub** checks Git/GitHub CLI installation and offers their official download pages. GitHub sign-in uses GitHub CLI's official device/browser flow and credential storage; Devyy never reads its token. HTTPS credential-helper setup is selectable. After sign-in, a separate confirmation offers to set the global Git name/email and identifies any existing values; declining preserves them. The identity form also supports explicit manual edits. Repository identity overrides continue to take precedence. Local Git does not require GitHub sign-in. Live account authorization and native Windows/Linux installers remain unverified.

Codex (`openai.chatgpt`) and Claude Code (`anthropic.claude-code`) extension webviews share this same right sidebar, width, resize handle, and height. Devyy chat and each extension have separate tabs; hidden webview frames retain their state. Other extension panels continue to use the main workbench extension panel. Extension runtime compatibility limits below still apply.

## Extensions and importing preferences

Open **Settings → Extensions** or **⌘/Ctrl Shift X**. Registry requests use Open VSX, prefer the current platform, fall back only to universal packages, and support local `.vsix` files. Registry installs reject packages targeting a different operating system or architecture. Installs use a staging directory and bounded, path-checked extraction before replacing an existing package. Downloads stream into temporary files instead of buffering whole archives in memory. Each extension row shows real downloaded bytes and a smooth percentage bar, followed by installation/setup states. Unknown totals use an indeterminate bar; progress survives closing Settings, respects reduced motion, and clears on completion or failure. Remote and local packages allow up to 1 GiB compressed, 4 GiB extracted, and 1 GiB per file; failed downloads and installs remove their temporary files. Extension files live under the OS application data directory in `extensions/<publisher>.<name>`. Installed extensions keep their package icons, including when disabled.

Language IDs/file associations, JSON/plist TextMate grammars, basic VS Code snippets, and JSON/JSONC syntax themes work directly. JavaScript extensions use a separate Node process with a bounded `vscode` API adapter. **Node.js 20+ must be on the desktop app’s PATH**; it is not bundled. Extension code runs with your local account’s permissions. Disabling, uninstalling, changing the workspace, and restarting the host replace its process and dispose its views. Closing Devyy stops the host process tree.

**Automatic language servers.** Enabled packages are checked for known bundled stdio server layouts: rust-analyzer, clangd, Pyright/basedpyright, YAML, Svelte, Vue, and VS Code HTML/CSS/JSON servers. Discovery uses existing files inside the installed package; it does not run arbitrary installers. Devyy-aware extensions can declare `contributes["devyy.languageServers"]` entries with `language`, package-relative `module` or `command`, `args`, `initializationOptions`, and `settings`. The API adapter also registers stdio launch options from supported, externally required `vscode-languageclient/node` clients. Registered servers appear in **Language servers** with their source extension; saved manual settings take priority. Packages that download servers separately or bundle their own language-client implementation may still need manual configuration. The default PATH servers remain available.

**Commands and views.** Contributed commands appear in the command palette. `registerCommand`, `registerTreeDataProvider`, and `createTreeView` provide activation and native tree controls. Activity-bar containers and views in Explorer, Source Control, Debug, and Test are placed in the corresponding Devyy areas. View visibility follows context keys and supported VS Code `when` expressions. `createWebviewPanel`, `registerWebviewViewProvider`, and custom editor providers use the extension panel.

Webviews retain their original HTML and JavaScript. A dedicated resource protocol serves package/workspace assets within `localResourceRoots`, including relative ESM imports, dynamic chunks, stylesheets and fonts. Resource capabilities are random and are revoked when the view closes or the host restarts; canonical path checks reject traversal and symlink escapes. Frames remain sandboxed without same-origin, popup, privileged navigation or editor IPC permissions. Their own CSP can further restrict the host policy. HTTPS and loopback connections are allowed by the host policy; this does not implement remote port forwarding. Links open through the native URL opener.

The bridge preserves message ordering, queues replies until a frame is ready, reconstructs typed arrays/ArrayBuffers, and supplies the webview origin expected by extension RPC clients. `acquireVsCodeApi()` state is retained while the view is open. Opaque frames receive a scoped Web Storage adapter: local storage persists per extension, while session storage stays within the frame. Theme changes update VS Code color tokens and theme attributes without reloading the extension. Browser APIs such as IndexedDB and service workers remain limited by the sandbox.

**Dependencies and extension packs.** Installing from Open VSX or a local VSIX resolves required dependencies and pack members before restarting the host. Existing packages are reused, shared dependencies download once, required cycles are rejected, and bundles are bounded to 128 visited packages. Disabled packages keep their state; a disabled required dependency produces an actionable error. Progress stays on the original extension row and identifies the package currently downloading. **Repair dependencies** installs missing packages without downloading the parent again, refreshes grammars/assets, and restarts the host even when the version is unchanged. Individual package replacement is atomic; a bundle failure can leave its successfully installed packages present and listed.

**Extension-owned terminals and documents.** `createTerminal({ pty })` renders through the same xterm UI as shell terminals. Pseudoterminals support initial dimensions, output, serialized input, resize callbacks, name changes, active-terminal state, and one-time disposal with exit codes. They work without an open project and do not start a shell. Startup terminal events are retained until the lazy terminal UI mounts, and renderer initialization no longer reports a native shell as closed. Custom filesystem providers supply virtual document reads and writes, synchronous writability checks, and read-only enforcement; unknown URI schemes cannot fall through to disk. Content-provider changes refresh open read-only buffers. Document positions account for CRLF, cached editor identities remain stable, split panes report their columns/visibility, and open-tab inventories include hidden documents. Editor selection assignments reach the UI, including multiple cursors. Untitled-document Save As, full file-operation atomicity, every editor option/decorations API, and complete VS Code editor-group semantics remain incomplete.

**Editor and native services.** Extensions receive open/changed/saved/closed document events, active editor and selection changes, theme and focus events, document text/line/position helpers, workspace edits, filesystem search and watchers, and persistent global configuration updates. Completion, hover, definition and formatting providers connect to the editor; diagnostic collections connect to Problems. Additional provider registrations exist for bundled language clients, but their corresponding UI is not all implemented. Quick picks, input prompts, message actions, native file dialogs, clipboard access, status items, external links, URI handlers and shell terminals use Devyy's workbench. Extension terminals can specify a shell, arguments, working directory and environment mutations. Deep links use the `devyy` scheme; installed desktop builds register it, and the single-instance plugin forwards callbacks to an existing window.

**Native Devyy UI.** New extensions can use `require("devyy").ui.registerView` and `updateView` to describe text, headings, badges, buttons, inputs, and stacks. Devyy renders these as its own React controls, sharing typography, spacing, focus behavior, and theme colors. Commands handle their actions. `languages.registerServer` registers a stdio server directly. Types live in [sdk/devyy.d.ts](sdk/devyy.d.ts); a runnable example with native controls, a tree, webview messaging, and a demonstration LSP lives in [examples/devyy-extension](examples/devyy-extension/README.md).

**Extension commands and shortcuts.** Contributed keybindings support platform overrides, command arguments, up to three chord strokes, when clauses, command enablement, and explicit user shortcut priority. Native menus and keyboard events use one dispatch path; extension chord prefixes leave the native accelerator free so the chord can reach the workbench. Sandboxed webviews forward the configured global navigation/layout shortcuts while keeping local editing keys. Common workbench actions, command enumeration, and registered hover/completion/definition/declaration/type/implementation/symbol/code-action/document-formatting provider commands are bridged. `vscode.diff` uses the same visual comparison editor as Git. Provider execution covers Devyy’s registered extension providers; arbitrary VS Code internal services remain unavailable.

**Compatibility boundary.** See [ROADMAP.md](ROADMAP.md) for the prioritized API/workbench gap list and verification gate. This is still an API adapter rather than the complete VS Code workbench. Node/CommonJS entrypoints, startup and lazy activation, installed dependencies, extension state and the services above are supported. Browser-only entrypoints, built-in account authentication providers, debugger/SCM/notebook/test contributions, arbitrary proposed APIs, full shell integration and pseudoterminal dimension overrides, remaining contributed menu locations and all VS Code keybinding contexts, all editor decorations and language feature UIs, complete LanguageClient middleware/converters and live stream/child-process launch functions remain incomplete. Installed dependencies must be present. Unsupported activation reports the extension's error under **Installed**; registry availability alone does not establish compatibility.

Extensions can activate on `workspaceContains` exact paths and glob patterns when a project opens. Checks are shared across extensions, glob searches use at most four concurrent workers with a five-second deadline per pattern, and timeouts report to Output. Activation failures retain the extension's error status. File creation does not yet rerun these checks; reopen the project after adding an activation file.

`window.withProgress` displays title/message updates and incremental progress in the workbench. Notification progress supports cooperative cancellation, and cancelling a token also dismisses its pending `showQuickPick` or `showInputBox`. Task results and failures propagate back to the extension. Progress placement within individual contributed views remains on the roadmap.

`window.createQuickPick` and `createInputBox` provide live extension-owned prompts rendered with Devyy controls. They support changing choices/values, active and selected items, multi-select, separators, Back/toolbar/item buttons, steps, disabled/loading states, passwords, selection ranges and validation severity. Callbacks preserve the original item/button identity; accepting a live prompt leaves its lifecycle under the extension's control. Convenience prompts use the same bridge, with promised choices, cancellation during loading, active-item callbacks and asynchronous validation that updates in place and ignores stale results. Real-host browser fixtures exercise this flow. Exact VS Code fuzzy ranking, every codicon/rich tooltip and large-list virtualization remain incomplete.

**Verified third-party bundles (macOS ARM64).** Codex `openai.chatgpt` 26.51106.51428 activates, exchanges its RPC handshake and renders its sign-in/API-key screen. Claude Code `Anthropic.claude-code` 2.1.322 activates, renders its chat interface and launches its native backend. The installed Lex 0.10.7 extension activates its bundled language client/server and registers language providers. These checks use temporary workspace/configuration directories, without sending an AI prompt or completing sign-in. Signed-in chat, every command, optional proposed chat APIs and Windows/Linux runtime behavior have not been verified.

**Setup & import** detects standard settings folders for VS Code, VS Code Insiders, VSCodium, Cursor, Windsurf, and Zed on the current OS. It reads compatible appearance, editor, saving, and terminal preferences and supported global shortcuts, shows the exact changes before applying, and leaves source files untouched. Contextual/chorded/unsupported shortcuts and unrelated settings are excluded. Local extension IDs become browse suggestions during setup; extensions are installed only when you choose Install. Exact third-party theme colors require the corresponding Open VSX theme.

## Debug

Open **Run & build**, then configure the debugger below the run commands:

- **Rust / C / C++:** install LLVM’s `lldb-dap` and make it available on PATH. Compile a debug binary first, e.g. `cargo build`, and enter its workspace-relative path, e.g. `target/debug/my-app`. On macOS, an LLVM installation may require adding its `bin` directory to PATH.
- **Python:** install `debugpy` into the environment used by `python3`, select Python, and enter a relative script path such as `src/main.py`.

Click the gutter immediately left of the line numbers to toggle a breakpoint, then press the debugger’s Play button. Sessions stop at entry. Use the toolbar to step and inspect locals. Interactive debuggee input, attach sessions, remote adapters, custom launch arguments, and conditional breakpoints are not included in v0.1.

A terminal command is an explicit request to execute code on your machine. devyy never automatically runs commands from project configuration when opening a folder. Like other desktop IDEs, terminals, language servers, debug adapters, and Git hooks run with your user permissions.

## Shortcuts

Use ⌘ on macOS and Ctrl elsewhere.

| Shortcut                    | Action                         |
| --------------------------- | ------------------------------ |
| ⌘/Ctrl P or K               | Go to file                     |
| ⌘/Ctrl Shift P              | Command palette                |
| ⌘/Ctrl O                    | Open folder                    |
| ⌘/Ctrl S                    | Save active file               |
| ⌘/Ctrl W                    | Close active tab               |
| ⌘/Ctrl F                    | Find / replace in file         |
| ⌘/Ctrl Shift F              | Workspace search               |
| ⌘/Ctrl B                    | Toggle sidebar                 |
| ⌘/Ctrl J                    | Toggle bottom panel            |
| ⌘/Ctrl backtick             | Focus terminal                 |
| Control Shift backtick      | New terminal                   |
| ⌘/Ctrl Option/Alt backslash | Split terminal                 |
| ⌘/Ctrl Shift Enter          | Toggle focus mode              |
| ⌘/Ctrl Shift J              | Maximize / restore panel       |
| ⌘/Ctrl L                    | Go to line                     |
| Option/Alt Shift F          | Format document                |
| ⌘/Ctrl backslash            | Toggle split editor            |
| ⌘/Ctrl comma                | Preferences                    |
| F12                         | Go to definition               |
| Escape                      | Close dialog / exit focus mode |

All command shortcuts can be changed or removed in **Preferences → Keyboard shortcuts**. Click a binding, press the combination, then use **Use shortcut** (or **Reassign shortcut** when another command uses it). Standard OS/clipboard combinations are reserved. Save all, undo/redo, and theme/wrapping controls are also in the command palette. Alt/Option-click adds editor cursors; CodeMirror’s standard editor keymap remains available.

## Verification

```sh
npm run build       # strict TypeScript checks and production frontend
npm run check       # TypeScript and Rust compilation
npm test            # frontend unit tests and native Rust tests
npm run test:e2e    # browser workflow tests (Google Chrome required)
npm run test:extension-host # real Node extension-host integration tests
```

Native tests cover path and symlink boundaries, ignore rules, external-save conflicts, real Tauri IPC → filesystem → search → Git commit, and actual independent PTY shells, including discovery and launching a selected shell profile. Browser tests cover edit/save/reload, tabs, command navigation, search, split views, themes, focus mode, file creation/rename, breakpoint toggles, appearance persistence, reduced motion, compact window layouts, independent panel toggles, drag resizing, shortcut reassignment/persistence, context menu actions, multi-terminal lifecycle and profile selection through the native bridge, shared glass/solid overlays, live editor options with undo-history preservation, compact toolbar alignment, About metadata and update states, Markdown rendering/live edits/history/link handling, native preview images, broad syntax loading, compact search, setup completion/re-entry, reviewed imports, custom language-server settings, and installed extension grammar/snippet/theme activation. Native package tests cover identity checks, traversal, Windows device names, atomic replacement, and asset boundaries.

Optional native integration tests exercise real language and debug adapters:

```sh
# With pylsp, and python3 with debugpy, on PATH:
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

The Python tests use a server and debug adapter to verify completion over framed stdio, breakpoints, stopped events, stack frames, local variables, and debugger shutdown. LLDB and Rust/TypeScript-specific adapter behavior requires separate platform verification. The opt-in `live_open_vsx_package_installs_and_exposes_real_theme_assets` test downloads a real Open VSX theme into a temporary directory, verifies installation and asset reads, and removes it. `live_open_vsx_pyright_is_discovered_and_returns_real_completions` downloads Pyright, discovers its bundled Node server, initializes it over stdio, and checks an actual `os.path` completion without manual configuration.

To check the actual native extension path (Tauri IPC → Node activation/tree →
bundled LSP → completion, plus sandboxed custom-protocol scripts under native CSP):

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example extension_smoke
```

The example uses temporary application directories and removes them afterward.
The native run has been verified on macOS; Windows/Linux remain covered by CI configuration and require execution there.

To verify an unpacked third-party extension through the real Node host and native sandboxed webview on macOS:

```sh
DEVYY_COMPAT_EXTENSION=/absolute/path/to/extension cargo run --manifest-path src-tauri/Cargo.toml --example extension_compat_smoke
```

The fixture requires a contributed webview, isolates Codex/Claude configuration, routes the production message and resource protocols, and rejects an empty view or a rendered error screen. It never signs in or sends a chat prompt. Optional `DEVYY_CODEX_EXTENSION`, `DEVYY_CLAUDE_EXTENSION`, and `DEVYY_LEX_EXTENSION` paths enable real-bundle activation tests in `npm run test:extension-host`; the default suite uses deterministic local fixtures. The native third-party fixture currently uses Unix symlinks.

To check the native window material against real AppKit views (not the mock runtime):

```sh
npm run build
cargo run --manifest-path src-tauri/Cargo.toml --example appearance_smoke
```

This exercises repeated enables, light/dark theme changes, disabling the material, and invalid-theme rejection on the main thread. It also installs the native application menus, validates customizable accelerators, and measures the actual macOS window controls after AppKit layout, checking their alignment with the 54-pixel titlebar. On macOS it reports the native `vibrancy` material for enabled states and `solid` for disabled states.

## Scope and limits

This is an initial editor implementation, not feature parity with VS Code. The bounded extension adapter does not provide full VS Code API compatibility. There is no remote/SSH/container workspace support, collaborative editing, graphical merge editor, notebook engine, semantic refactoring UI, or built-in Git synchronization. You can use the terminal for your existing tools.

Native editing is limited to UTF-8 text files up to 5 MB. Listings stop at 30,000 entries and 20 directory levels; search checks text files up to 1 MB and returns at most 500 matching lines. Searches are plain text; in-file find supports regular expressions. File and folder deletion is permanent and requires a Devyy confirmation. Folders include their contents; workspace-root deletion and paths outside the workspace are rejected. Workspace files reload on window focus when clean; the explorer has explicit refresh rather than a continuous filesystem watcher. External-change checks are optimistic, not filesystem locks.

The development-only browser playground supports local editing and preferences. It deliberately does not pretend to access your filesystem, spawn processes, or report invented Git or compiler results.

## Layout

```text
src/                         React shell, editor, terminal, debugger, palettes
src/lib/native.ts            Typed Tauri / LSP client
src-tauri/src/appearance.rs  Native window material and color theme
src-tauri/src/workspace.rs   Scoped file operations and ignore-aware search
src-tauri/src/git.rs         Git status, diff, staging, commits
src-tauri/src/terminal.rs    PTY sessions and lifecycle
src-tauri/src/lsp.rs         Language-server stdio transport
src-tauri/src/extensions.rs  Open VSX downloads and bounded VSIX installation
src-tauri/extension-host/host.cjs Node API adapter and extension lifecycle
src-tauri/src/extension_host.rs Native process and webview-protocol bridge
src-tauri/src/extension_servers.rs Bundled language-server discovery
sdk/devyy.d.ts               Native extension UI/server API
src-tauri/src/setup_import.rs Local IDE settings discovery and import
src-tauri/src/debug.rs       Debug-adapter stdio transport
src-tauri/src/tool_tests.rs  Native terminal / language / debug integration
```

Rust handles native work; CodeMirror owns the editor document, selections, and viewport. React renders the surrounding workspace. Language parsers and the terminal are separate chunks, editors are memoized, and filesystem/search/Git work runs off the UI thread. Editor changes are coalesced before LSP notifications and flushed before completion requests; stale/duplicate document connections are discarded. Chrome prevents accidental text selection and page overscroll while document, terminal, output, Problems, and input content remain selectable. Settings and long lists scroll within their own bounds. Browser context menus are suppressed before page load across the desktop webview and its child frames; Devyy and extension context-menu handlers still receive events. No benchmark claims are made without measurements.

### Extension UI and licenses

Codex and Claude are docked on the right and always resolve their main sidebar view. They are excluded from the left activity bar. Other contributed containers use their declared icon, their extension package icon, or a placeholder. Contributed webview views render inside their sidebar sections; editor webview panels use tabs. Webviews receive Devyy theme tokens without globally restyling their controls. Editor/explorer/tab/tree/view/webview context menus support grouped contributions, submenus, `when`, enablement and toggled states; webviews can contribute `data-vscode-context`.

File/folder artwork uses the MIT-licensed [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme). **Settings → Credits & licenses** lists JavaScript, Rust and artwork dependencies with expandable license files. `npm run assets:generate` refreshes artwork and notices from the installed, locked dependencies; development and production builds run it automatically. Devyy’s own GPLv3 license appears first, followed by the separate licenses for dependencies and artwork.

Authorization references: [ChatGPT public-client sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [tokens and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Anthropic integration policy](https://code.claude.com/docs/en/legal-and-compliance), [T3 Code Claude login](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/providers-claude.md).

Extension `context.secrets` is backed by separate authenticated encrypted vaults with their encryption keys in the OS credential store. It does not write credentials to extension mementos or browser storage. OS access failures are reported, without a plaintext fallback.

## License

Devyy’s original source code is available under the [GNU General Public License v3](LICENSE). Bundled dependencies and third-party artwork retain their own licenses and trademark terms; their notices are available in Settings → Credits & licenses and `public/third-party-licenses.json`.

AI panel visibility follows the same transition timing as Explorer and Terminal.
**Settings → Layout → Open AI panel while dragging** controls temporary drag
previews; ending a drag restores the previous visibility. The editor tab bar no
longer includes a redundant New file button; file creation remains available in
Explorer, the application menu and keyboard shortcuts.

Agent tools use strict JSON schemas with nullable optional values for provider
compatibility. `read_files` reads up to eight files per call and reports individual
file/permission errors. Invalid tool JSON is returned to the model as a tool error
so it can correct the request. OpenCode chat and discovery use its authenticated
managed CLI service and a temporary project configuration with matching `PWD`;
Devyy never copies account credentials or manually constructs its auth headers.
