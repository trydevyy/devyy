# Changelog

## v0.1.0

First public release of Devyy, a desktop workspace for editing, running, and shipping code.

- Open local projects, split editors, search across files, and preview Markdown and images.
- Run independent terminal sessions, use supported debug adapters, and connect to SSH workspaces with port forwarding.
- Stage changes, inspect diffs and commit history, and manage Git branches and submodules.
- Install extensions from Open VSX or VSIX files. Devyy implements a subset of the VS Code extension API, so compatibility varies by extension.
- Configure AI providers, attach selected workspace context, and review proposed edits before applying them. AI code completion is opt-in.
- Customize themes, shortcuts, and layout. Start in guest mode or import supported settings.
- Review and approve diagnostic reports before sending them in builds configured for crash reporting.
- The release workflow targets Windows x86, x64, and ARM64, Linux glibc x64 and ARM64, and Intel and Apple silicon Macs. Release assets include installers, editor downloads, and SHA-256 checksums.
- Browser development and public CI can run without HIT access. Native source builds use the private HIT submodule.
