# Devyy Installer

An offline installer and uninstaller using Devyy's Rust/Tauri stack and interface
style. Windows and Linux get a guided setup application; macOS uses the standard
Finder drag-to-Applications disk image with Devyy artwork.

## Development

From the repository root, install the editor's dependencies and generate its
license notices first:

```sh
npm ci
npm run assets:generate
npm ci --prefix installer
npm run desktop --prefix installer
```

Development builds contain no app payload and disable installation. To preview
the interface in a browser, use `npm run dev --prefix installer`. A release
installer refuses to build without a payload. The installer has no release-server
URL or unsigned remote package download: the app archive is embedded at build time.

## Build a release

```sh
npm run release:installer
```

This first builds Devyy, then packages the installer for the host OS:

- **Windows:** `src-tauri/target/release/bundle/installer/Devyy-Setup.exe`.
- **Linux:** `Devyy-Setup.AppImage` in the release `bundle/installer` folder. Make it executable, then open it. On a system without FUSE, launch it with `APPIMAGE_EXTRACT_AND_RUN=1 ./Devyy-Setup.AppImage`.
- **macOS:** the Devyy DMG in the release `bundle/dmg` folder. Opening it shows
  the actual Devyy app and Applications. Drag Devyy across to install; there is
  no intermediate setup app to open or install.

Windows/Linux payloads are created with `node installer/scripts/prepare-payload.mjs`.
Use `--app <file>`, `--platform windows|linux` and `--output <zip>` for explicit
inputs. `DEVYY_INSTALLER_PAYLOAD` can select a prepared archive for native builds.
Installer and app versions come from the root package version.

macOS packaging requires Python 3 with venv and Swift. The release script installs
pinned DMG build tools into the ignored `installer/.dmg-tools` environment. It does
not change the system Python. Build-tool licenses are separate from the GPLv3 app
license. Frontend and Rust dependency notices are bundled in the installer.

## Setup interface

Windows and Linux use four steps: location, shortcuts, licenses, then installation.
The recommended account folder and a native folder picker replace a plain path
prompt; an Edit action also permits typing a path. The destination is validated
before continuing. Back navigation preserves options. Page transitions use
horizontal movement, fading and progressive blur, reversing when going back.
Reduced-motion preferences disable those effects.

On macOS, open the DMG and drag **Devyy** onto **Applications**. The normal Devyy
app icon is preserved. Finder handles copying, replacement prompts and permissions.
Keep the image mounted until copying finishes, then open Devyy from Applications.
The transparent background artwork supplies the brand, short instruction and
arrow; the app/folder icons and interaction are real Finder items. No separate
installer, hidden app payload or setup ZIP is part of the macOS release path.
The old custom macOS window remains a development surface only.

Screenshots of Windows/Linux setup are captured from the actual React interface
with mocked native commands. The macOS layout preview is rendered with the same
background and bundled app icon; it is explicitly a preview when screen recording
permission is unavailable.

## Installation behavior

Windows setup installs for the current user. The default directory is
`%LOCALAPPDATA%\Programs\Devyy`; the user can choose another writable dedicated
folder and choose Desktop and Start-menu shortcuts. Setup creates HKCU Installed
apps registration, App Paths and Devyy's URL handler. If WebView2 is missing, a
native bootstrap prompt offers Microsoft's runtime; its Authenticode signature is
verified before execution. The app registration opens the branded uninstaller.

Linux setup defaults to `~/.local/opt/devyy`, creates an application launcher,
a `~/.local/bin/devyy` command, an uninstaller menu entry, and an optional Desktop
shortcut. The launcher uses AppImage extraction mode so Devyy does not require
FUSE at launch. To open the installer itself on a system without FUSE, use
`APPIMAGE_EXTRACT_AND_RUN=1 ./Devyy\ Installer*.AppImage`.

Installation is staged and committed with a manifest. An unrelated nonempty
folder is refused; updates refuse added files rather than discarding them.
Registration failures roll back the app copy. Shortcuts belonging to other
installations are not overwritten. Uninstall removes only manifest-owned files
and matching integration entries, preserving projects, settings, and unrelated
files. Windows relaunches its uninstaller from a temporary copy before removing
installed files; the temporary copy is cleaned after it exits.

After uninstall, the user may choose a reason, describe improvements, copy the
feedback, or open a GitHub issue draft for review. Feedback is optional and is
never posted automatically.

## Uninstall commands

Windows Installed apps opens the GUI. PowerShell can also run:

```powershell
& "$env:LOCALAPPDATA\Programs\Devyy\uninstall.ps1"
& "$env:LOCALAPPDATA\Programs\Devyy\uninstall.ps1" -Silent
```

Linux exposes **Uninstall Devyy** in the application menu, or:

```sh
~/.local/opt/devyy/uninstall.sh
~/.local/opt/devyy/uninstall.sh --silent
```

## Verification

```sh
cargo test --manifest-path installer/src-tauri/Cargo.toml
npm run test:e2e --prefix installer
npm run build --prefix installer
```

Engine tests use temporary home/install folders and synthetic app payloads.
Interface tests mock native commands and verify wizard navigation, options,
live system appearance, the internal drop target, progress, launching,
uninstall completion, optional feedback, and keyboard handling. Registry writes,
shortcuts, WebView2 setup, AppImage launching, and desktop integration still need
native acceptance checks on Windows and Linux. Building or packaging an installer
does not sign, notarize, publish, install, or uninstall the app on this machine.

The uninstaller can send optional feedback to Discord when built with
`DEVYY_FEEDBACK_WEBHOOK_URL`. Set this environment variable before running the
installer release build. CI reads the GitHub Actions secret with the same name.
Builds without the variable offer Copy feedback. The installer embeds an AES-256-GCM encrypted URL and its key. The URL can be
recovered from the binary. Use a webhook dedicated to uninstall feedback.

On Windows, the installer registers Devyy's file type icons. Choose **Open in
Devyy** on the Shortcuts screen to add it for files, folders and folder backgrounds. On Windows 11, look under
**Show more options**. To use the type icons for a file, choose Devyy as the
default app for that extension in Windows Settings.
