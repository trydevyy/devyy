# Contributing to Devyy

Issues and pull requests are welcome. For user-visible bugs, include the Devyy version, OS and architecture, steps to reproduce, and what you expected to happen. Use [private security reporting](SECURITY.md) for vulnerabilities. Follow the [code of conduct](CODE_OF_CONDUCT.md) in project spaces.

## Development setup

For browser development, install Bun, Node.js 22 or later, and Git, then run `bun install --frozen-lockfile` and `bun run dev`. Fetch the public documentation with `git submodule update --init docs`.

For native editor development, you also need SSH read access to the private HIT repository, stable Rust with rustfmt and Clippy, GNU Make, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows, use GNU Make from a shell with standard Unix tools and install the Desktop development with C++ workload and WebView2. On macOS, install Xcode Command Line Tools. On Debian or Ubuntu, the Linux CI setup includes `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libxdo-dev`, and `patchelf`. Linux native CI also uses Xvfb and xdotool.

```sh
git submodule update --init docs third_party/hit
make setup
bun run desktop
```

Use `bun run dev` for the browser UI and `bun run --cwd installer desktop` for the installer preview. The editor is in `src/`, native services and the Node extension host are under `src-tauri/`, and packaging lives in `installer/`.

## Checks

```sh
make format-check
make lint
make test
make playwright-install
make test-e2e
make test-e2e-installer
```

Run `make help` for individual formatting, static-analysis, test, build, and package commands. `make format` formats both JavaScript/TypeScript and Rust; `make verify` is the fast non-browser release-readiness suite used before a pull request.

On Linux without a display, run the native tests with `xvfb-run -a`. For the opt-in live integrations and workspace benchmark, install Node.js, clangd, Python with debugpy, and python-lsp-server, then run `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`. These tests can download packages from Open VSX. The [roadmap](ROADMAP.md) describes additional extension compatibility fixtures.

Keep changes focused and describe the platforms you tested. Include screenshots for UI changes when useful. Keep personal paths, tokens, and user data out of logs or screenshots you share. Dependency or licensing changes should preserve the generated credits and notices.

## Package locally

```sh
make package
```

Run this command on the target OS. The [installer guide](installer/README.md) lists prerequisites and output locations. Linux builders without FUSE can set `APPIMAGE_EXTRACT_AND_RUN=1` before packaging.

## Release from GitHub

1. Update the editor and installer versions in their `package.json`, Cargo manifests, Tauri configs, and lockfiles. Add a dated entry to [CHANGELOG.md](CHANGELOG.md).
2. Run the checks and merge the release commit. Create and push a matching tag such as `v0.1.0`. A tag like `v0.2.0-rc.1` produces a GitHub prerelease. An existing tag can also be selected when dispatching **Release Devyy** manually.
3. The workflow verifies the version and builds for Windows x86, x64 and ARM64 and Linux glibc x64 and ARM64. It checks the versioned installers and editor assets, generates SHA-256 checksums, and uploads to a draft before publishing. Build and add macOS assets locally.

Set the GitHub Actions repository secret `HIT_READ_PAT` to a fine-grained personal access token with **Contents: Read** on `hit-scm/hit`. Native CI and release builds fetch both pinned submodules. The HIT token is scoped to its HTTPS checkout. Fork pull requests fetch the public docs and run formatting, JavaScript unit, extension-host, and browser tests.

Editor assets use `Devyy-<version>-<platform>` plus the platform extension. Windows ships an executable, Linux ships an ELF binary, AppImage and Debian package, and macOS ships a ZIP with the complete app bundle. Installers use the `Devyy-Setup-` prefix. Linux builds require a glibc environment. Native musl builds require a compatible GTK/WebKitGTK stack.

Configure `DEVYY_CRASH_WEBHOOK_URL` and `DEVYY_FEEDBACK_WEBHOOK_URL` as separate GitHub Actions secrets if the release should enable these features. Export the variables in your shell for local packaging. Builds without these values can run locally and in CI. Both encrypted URLs can be recovered from their distributed binaries because each client includes its decryption key. Use dedicated webhooks.

### Build and add macOS assets

On a Mac, check out the same commit as the release tag. Install the native development prerequisites above, plus Python 3 with `venv` support for DMG packaging. On Apple silicon, use an ARM64 terminal with native ARM64 Node and Rust. To build for Intel, run with matching x64 tools.

```sh
git submodule update --init --checkout -- third_party/hit
bash scripts/build-local-release.sh
```

For v0.1.0 on Apple silicon, the script stages these files in `release-assets/v0.1.0/macos-arm64/`:

- `Devyy-Setup-0.1.0-macos-arm64.dmg`
- `Devyy-0.1.0-macos-arm64.app.zip`
- `SHA256SUMS-macos-arm64.txt`

Open the DMG, copy Devyy into **Applications**, and verify it launches. After the Windows and Linux release workflow succeeds, add all three files to the existing release through GitHub or the CLI:

```sh
gh release upload v0.1.0 release-assets/v0.1.0/macos-arm64/* --repo trydevyy/devyy
```

The separate checksum file covers the local macOS downloads. Keep it alongside the workflow's `SHA256SUMS.txt`. The local script also works on the supported Windows and Linux architectures with matching Node and Rust toolchains. Use Git Bash on Windows.
