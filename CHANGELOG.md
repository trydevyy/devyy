# Changelog

## v0.3.0

Devyy starts and scrolls more smoothly, with a redesigned Settings and setup experience, clearer AI usage, and verified in-app updates.

### Editing and workspace

- Open large projects with less startup work. The file tree and editor render more smoothly during fast scrolling, and catalog data is cached locally to reduce repeated loading.
- Create files or folders with nested paths in one step. The file tree dims Git-ignored entries and uses Material file icons in light themes.
- Detect syntax from recognizable file contents when the filename gives no language hint. Added highlighting for 14 languages and formats, including Terraform, Zig, GraphQL, and Mermaid. Code blocks in AI chat, Markdown previews, and editor hover cards now share the editor’s syntax colors.
- Find pull and push actions in the redesigned Source Control panel, including for submodules.
- Source Control fits narrow sidebars, and long branch names truncate to fit the title bar and status bar.

### Settings and setup

- Settings and first-run setup share a sidebar layout. The redesigned Git & GitHub page puts connection status, sign-in, and missing-tool downloads up front, with separate sections for the commit author and repository tools.
- Settings keeps the same dialog open as the loading placeholders give way to preferences.
- Dialogs share consistent enter and exit animations and support outside-click dismissal when idle. File search and the command palette have a centered search field and cleaner results.
- Empty terminal, problems, output, ports, and SSH panels use a consistent layout and show the relevant next action.
- Custom theme artwork applies to the OS dock or taskbar. The workbench keeps the Devyy mark, and macOS gets a shaped Dock icon from opaque artwork.

### AI

- Providers start disabled on fresh installs. ChatGPT sign-in uses Codex, and OpenAI API keys have their own connection.
- AI Usage filters to configured providers and includes daily cost and token charts, plan limits where available, and an Antigravity quota view.
- Cost estimates refresh against published OpenAI, Anthropic, and Gemini rates. OpenRouter uses reported charges, and API-equivalent estimates are labeled separately from reported costs.

### Desktop updates and releases

- Devyy defaults to 100% interface zoom and uses the webview's default text rendering on Windows and Linux. Saved zoom preferences are preserved.
- Devyy can download, verify, and apply supported desktop updates, then restart. The updater checks platform-specific SHA-256 manifests when the combined manifest lacks the asset.
- Linux downloads use the editor AppImage directly, with Debian packages also available. Windows keeps its custom installer, and macOS uses a drag-to-Applications disk image.
- Desktop CI scopes checks to changed files and reuses Rust dependencies. Release tests run alongside packaging and still gate publication. Intel macOS packages are built on Apple silicon and checked for the correct architecture.
- Installer browser tests start without generated release notices, including on clean CI runners.
- Linux AppImages launch the Node extension host with system libraries, fixing startup failures that prevented extensions such as rust-analyzer from activating.

### Dependency security

- The editor and installer require ZIP 9.0.5 or newer within the 9.x series. Extension installation now handles invalid archive entry names with the ZIP 9 API.
- Backported the GLib variant-string iterator fix from 0.20 to the GTK 3-compatible GLib 0.18 used by the Linux desktop builds. Removed the unused `jsonwebtoken` dependency.

## v0.1.0

First public release of Devyy, a desktop workspace for editing, running, and shipping code.

- Open local projects, split editors, search across files, and preview Markdown and images.
- Run independent terminal sessions, use supported debug adapters, and connect to SSH workspaces with port forwarding.
- Stage changes, inspect diffs and commit history, and manage Git branches and submodules.
- Install extensions from Open VSX or VSIX files. Devyy implements a subset of the VS Code extension API, so compatibility varies by extension.
- Configure AI providers, attach selected workspace context, and review proposed edits before applying them. AI code completion is opt-in.
- Customize themes, shortcuts, and layout. Start in guest mode or import supported settings.
- Review and approve diagnostic reports before sending them in builds configured for crash reporting.
- GitHub Actions builds Windows x86, x64, and ARM64 and Linux glibc x64 and ARM64. Maintainers can build and add Intel and Apple silicon macOS assets locally. Release assets include installers, editor downloads, and SHA-256 checksums.
- Browser development and public CI can run without HIT access. Native source builds use the private HIT submodule.
