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

Open a project with **⌘/Ctrl O**. devyy starts with an editable Rust playground; saving playground files persists them in application-local browser storage. Native local-file and process features activate after you open a folder in the desktop app.

```sh
npm run dev             # browser playground at http://127.0.0.1:1420
npm run desktop:build   # optimized native application
```

The default bundle target is a macOS `.app`. Other platforms require their Tauri prerequisites and an appropriate bundle target in `src-tauri/tauri.conf.json`; they have not been verified here. Development builds are unsigned.

## Included

- Project explorer with nested folders, create, rename/move, delete, refresh, dirty indicators, and recent projects.
- Reorderable tabs and synchronized split editors; tabs preserve their own editing histories while open. Custom tab menus support save, split, copy path, and closing other/right/all tabs with unsaved-change protection.
- Syntax highlighting from 145 language definitions, including C/C++, C#, Go, Java, Kotlin, Swift, Ruby, PHP, SQL, YAML, TOML, Shell, PowerShell, Dockerfile, Makefile, Vue, and Svelte. Filename and extension detection also handles common dotfiles. Parsers load on demand; language-server support remains separate.
- Markdown source, rendered preview, and side-by-side views, with live updates, preserved source undo history, tables, task lists, syntax-highlighted code fences, copy-code actions, heading links, project-relative links, and bounded local image reads. Raw HTML is not executed.
- Undo/redo, multiple selections, rectangular selection, code folding, bracket matching and closing, indentation, local completion, selection highlighting, line navigation, and in-file find/replace with regex support.
- Fuzzy file navigation, a searchable command palette with Files/Commands modes and recent choices, and 41 configurable command shortcuts. Native macOS File, Edit, Selection, View, Go, Terminal, and Window menus share command bindings.
- Workspace text search with case matching, collapsible file groups, highlighted matches, and file/line navigation. Native traversal respects `.gitignore` and skips generated folders.
- Git branch and change status, text diffs, per-file staging/unstaging, and commits. Diffs appear in the Output panel. Git uses the project’s existing identity and hooks.
- Multiple independent PTY terminals in one adaptive toolbar, with grouped split islands and matching numbered panes, installed shell discovery, a persistent default profile, and per-session selection. ANSI colors, session switching/renaming/restart, split terminal panes, font/line-height/scrollback/cursor settings, copy on selection, and process-preserving panel toggles. Shell discovery and process startup run off the UI thread.
- Editable run commands plus Rust check, test, and release-build shortcuts. Running saves open changes first.
- Language Server Protocol support: server completion, hover, diagnostics, go to definition, and document formatting.
- Debug Adapter Protocol support: gutter breakpoints, launch, pause/continue, step over/into/out, stop, call stacks, and expandable local variables. Debug output appears in Output.
- Searchable glass Settings with Appearance, Editor, Files & saving, Layout, Terminal, Keyboard shortcuts, Accessibility, and About devyy. A live editor preview, section navigation, typography/ligatures/letter spacing, relative line numbers, indent guides, whitespace visibility, column ruler, cursor shapes/blink, folding, bracket behavior, completion timing, editor inset, scroll-past-end, and auto-save delay. Changes preserve text and undo history. Shortcut recording includes conflict reassignment and per-command reset. About shows app/build versions, compilation time, actual OS build, and update availability from the public GitHub releases endpoint. Failed or unavailable checks have an explicit status. Build details can be copied.
- Independent sidebar/panel toggles, full-width focus mode, maximizable panels, and draggable sidebar, panel, editor split, and terminal split edges. Keyboard-adjustable separators; double-click or Home resets sizes. Sidebar, panel and editor split sizes persist across launches and clamp to the window.
- Compact glass Settings, search, context menus, and Sonner notifications share the workbench palette.
- Consistent custom context menus for explorer files/folders/empty space, tabs, editor, terminal sessions/output, and layout. Menus fit the viewport, support arrow navigation, and open with right-click or Shift F10.
- Unsaved-change prompts, external-change detection before saves, binary file rejection, workspace boundary checks, symlink escape protection, and cleanup of managed processes.

## Project identity

The workspace selector detects a local project logo when you open or refresh a folder. It prefers `logo` / `logomark` assets, named logo variants, and project-named images before falling back to `icon` / `favicon`. SVG, PNG, WebP, JPEG, and ICO images up to 5 MiB are supported, including `assets/logo.png`. Discovery reuses the ignore-aware file listing, skips generated directories, and stays within the workspace. Missing or unreadable images fall back to the project’s first letter. Use **Refresh files** after adding or replacing a logo.

The application is named **devyy**. Its existing bundle identifier stays stable, and preferences, recent projects, debugger settings, and saved playground files are read from the previous storage keys when needed.

## Appearance and vibrancy

Dark is the default for new installations. Existing saved theme choices are preserved. The top-right overlapping-circles button toggles vibrancy; Preferences also includes **Window vibrancy** and **Reduce motion** switches. Changes persist across launches. Code syntax and live terminal colors follow the selected theme without restarting the terminal session.

On macOS, a native `NSVisualEffectView` with the Sidebar material blurs the desktop behind the window and follows window activation. The transparent webview reveals that material through one shared tint across the titlebar, activity rail, sidebar, tab strip, and outer margins; the editor has its own tint, cut out from the chrome layer so its transparency is independent. Settings floats above the visible workspace; opening it leaves files and terminal sessions in place. Search, dialogs, context menus, completion tooltips, and notifications share the same glass surface; **Menu transparency** and **Glass softness** adjust them together. **Interface motion** offers Snappy, Relaxed, or Instant transitions, and reduced motion takes priority. The terminal retains a solid background for readable output. Repeated appearance changes replace the existing material rather than stacking views. System reduced transparency disables translucency, and system reduced motion disables transitions regardless of the saved preference.

Windows uses Mica when available; Linux uses solid chrome. These platform fallbacks have not been verified here. The browser playground uses CSS frosting inside its own page; it cannot blur the actual desktop. No animated blur or continuously running animation is used.

macOS transparency requires Tauri's `macos-private-api` feature, enabled in this project. The current distribution remains a local unsigned `.app`, not a Mac App Store package.

## Markdown preview

Open a Markdown file and use the **Source**, **Preview**, or **Preview to the side** controls in the tab bar. **⌘/Ctrl Shift V** toggles preview; **⌘/Ctrl Option/Alt V** opens it beside the source. These commands are also in the command palette, tab menus, and customizable shortcuts. Edits update the preview without saving. Preview links can open workspace files or the default browser; local images stay within the workspace and have an 8 MiB limit.

## Terminal profiles

Use the arrow beside **+** in the terminal toolbar to start a shell profile, or choose **Settings → Terminal → Default shell** for future sessions. Changing the default never replaces a running shell. On macOS and Linux, discovery checks the login shell, `/etc/shells`, and installed zsh, Bash, fish, Nushell, and PowerShell executables. On Windows, it checks Command Prompt, Windows PowerShell, PowerShell 7, Git Bash, and WSL where installed; Windows behavior has not been tested on this macOS workspace. **Refresh installed shells** updates the list after an installation. An unavailable saved profile reports an error and can be changed in Settings.

## Language intelligence

Language servers are separate developer tools. Install them and ensure their executable is on the PATH inherited by devyy. Restart/reopen the project after installation.

| Language | Install | Executable |
| --- | --- | --- |
| Rust | `rustup component add rust-analyzer` | `rust-analyzer` |
| JavaScript / TypeScript | `npm install -g typescript typescript-language-server` | `typescript-language-server` |
| Python | `python3 -m pip install 'python-lsp-server[all]'` | `pylsp` |

Open a supported file to connect automatically. Toolkit shows connection status and installation commands. The Problems panel displays diagnostics actually reported by installed servers; zero diagnostics is not an assertion that an unconnected project has passed a check.

## Debug

Open **Run & build**, then configure the debugger below the run commands:

- **Rust / C / C++:** install LLVM’s `lldb-dap` and make it available on PATH. Compile a debug binary first, e.g. `cargo build`, and enter its workspace-relative path, e.g. `target/debug/my-app`. On macOS, an LLVM installation may require adding its `bin` directory to PATH.
- **Python:** install `debugpy` into the environment used by `python3`, select Python, and enter a relative script path such as `src/main.py`.

Click the gutter immediately left of the line numbers to toggle a breakpoint, then press the debugger’s Play button. Sessions stop at entry. Use the toolbar to step and inspect locals. Interactive debuggee input, attach sessions, remote adapters, custom launch arguments, and conditional breakpoints are not included in v0.1.

A terminal command is an explicit request to execute code on your machine. devyy never automatically runs commands from project configuration when opening a folder. Like other desktop IDEs, terminals, language servers, debug adapters, and Git hooks run with your user permissions.

## Shortcuts

Use ⌘ on macOS and Ctrl elsewhere.

| Shortcut | Action |
| --- | --- |
| ⌘/Ctrl P or K | Go to file |
| ⌘/Ctrl Shift P | Command palette |
| ⌘/Ctrl O | Open folder |
| ⌘/Ctrl S | Save active file |
| ⌘/Ctrl W | Close active tab |
| ⌘/Ctrl F | Find / replace in file |
| ⌘/Ctrl Shift F | Workspace search |
| ⌘/Ctrl B | Toggle sidebar |
| ⌘/Ctrl J | Toggle bottom panel |
| ⌘/Ctrl backtick | Focus terminal |
| Control Shift backtick | New terminal |
| ⌘/Ctrl Option/Alt backslash | Split terminal |
| ⌘/Ctrl Shift Enter | Toggle focus mode |
| ⌘/Ctrl Shift J | Maximize / restore panel |
| ⌘/Ctrl L | Go to line |
| Option/Alt Shift F | Format document |
| ⌘/Ctrl backslash | Toggle split editor |
| ⌘/Ctrl comma | Preferences |
| F12 | Go to definition |
| Escape | Close dialog / exit focus mode |

All command shortcuts can be changed or removed in **Preferences → Keyboard shortcuts**. Click a binding, press the combination, then use **Use shortcut** (or **Reassign shortcut** when another command uses it). Standard OS/clipboard combinations are reserved. Save all, undo/redo, and theme/wrapping controls are also in the command palette. Alt/Option-click adds editor cursors; CodeMirror’s standard editor keymap remains available.

## Verification

```sh
npm run build       # strict TypeScript checks and production frontend
npm run check       # TypeScript and Rust compilation
npm test            # frontend unit tests and native Rust tests
npm run test:e2e    # browser workflow tests (Google Chrome required)
```

Native tests cover path and symlink boundaries, ignore rules, external-save conflicts, real Tauri IPC → filesystem → search → Git commit, and actual independent PTY shells, including discovery and launching a selected shell profile. Browser tests cover edit/save/reload, tabs, command navigation, search, split views, themes, focus mode, file creation/rename, breakpoint toggles, appearance persistence, reduced motion, compact window layouts, independent panel toggles, drag resizing, shortcut reassignment/persistence, context menu actions, multi-terminal lifecycle and profile selection through the native bridge, shared glass/solid overlays, live editor options with undo-history preservation, compact toolbar alignment, About metadata and update states, Markdown rendering/live edits/history/link handling, native preview images, broad syntax loading, and compact search.

Two optional native integration tests exercise real language and debug adapters:

```sh
# With pylsp, and python3 with debugpy, on PATH:
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

These use a Python server and debug adapter to verify completion over framed stdio, breakpoints, stopped events, stack frames, local variables, and debugger shutdown. LLDB and Rust/TypeScript-specific adapter behavior requires separate platform verification.

To check the native window material against real AppKit views (not the mock runtime):

```sh
npm run build
cargo run --manifest-path src-tauri/Cargo.toml --example appearance_smoke
```

This exercises repeated enables, light/dark theme changes, disabling the material, and invalid-theme rejection on the main thread. It also installs the native application menus, validates customizable accelerators, and measures the actual macOS window controls after AppKit layout, checking their alignment with the 54-pixel titlebar. On macOS it reports the native `vibrancy` material for enabled states and `solid` for disabled states.

## Scope and limits

This is an initial editor implementation, not feature parity with VS Code. There is no extension marketplace, remote/SSH/container workspace support, collaborative editing, graphical merge editor, notebook engine, semantic refactoring UI, or built-in Git synchronization. You can use the terminal for your existing tools.

Native editing is limited to UTF-8 text files up to 5 MB. Listings stop at 30,000 entries and 20 directory levels; search checks text files up to 1 MB and returns at most 500 matching lines. Searches are plain text; in-file find supports regular expressions. Empty directories may be deleted, but recursive project deletion is deliberately unsupported. Workspace files reload on window focus when clean; the explorer has explicit refresh rather than a continuous filesystem watcher. External-change checks are optimistic, not filesystem locks.

The browser playground supports local editing and preferences. It deliberately does not pretend to access your filesystem, spawn processes, or report invented Git or compiler results.

## Layout

```text
src/                         React shell, editor, terminal, debugger, palettes
src/lib/native.ts            Typed Tauri / LSP client
src-tauri/src/appearance.rs  Native window material and color theme
src-tauri/src/workspace.rs   Scoped file operations and ignore-aware search
src-tauri/src/git.rs         Git status, diff, staging, commits
src-tauri/src/terminal.rs    PTY sessions and lifecycle
src-tauri/src/lsp.rs         Language-server stdio transport
src-tauri/src/debug.rs       Debug-adapter stdio transport
src-tauri/src/tool_tests.rs  Native terminal / language / debug integration
```

Rust handles native work; CodeMirror owns the editor document, selections, and viewport. React renders the surrounding workspace. Language parsers and the terminal are separate chunks, editors are memoized, and filesystem/search/Git work runs off the UI thread. No benchmark claims are made without measurements.
