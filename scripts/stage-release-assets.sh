#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

version="$(node -p 'require("./package.json").version')"
platform="${DEVYY_PLATFORM:?Expected a release platform}"
target="${DEVYY_RUST_TARGET:-}"
root=src-tauri/target/${target:+$target/}release
output="${DEVYY_RELEASE_ASSET_DIR:-release-assets}"
mkdir -p "$output"
editor="$output/Devyy-$version-$platform"
setup="$output/Devyy-Setup-$version-$platform"

copy_one() {
  local destination="$1"
  shift
  if [[ $# != 1 || ! -f "$1" ]]; then
    echo "Expected exactly one source file for $destination" >&2
    exit 1
  fi
  cp -- "$1" "$destination"
}

case "$platform" in
  windows-*)
    copy_one "$setup.exe" "$root/bundle/installer/Devyy-Setup.exe"
    copy_one "$editor.exe" "$root/Devyy.exe"
    ;;
  linux-*)
    copy_one "$setup.AppImage" "$root/bundle/installer/Devyy-Setup.AppImage"
    copy_one "$editor.AppImage" "$root"/bundle/appimage/[Dd]evyy_*.AppImage
    copy_one "$editor.deb" "$root"/bundle/deb/*.deb
    copy_one "$editor" "$root/Devyy"
    ;;
  macos-*)
    if [[ -n "${DEVYY_DMG_PATH:-}" ]]; then
      copy_one "$setup.dmg" "$DEVYY_DMG_PATH"
    else
      copy_one "$setup.dmg" "$root"/bundle/dmg/Devyy-*.dmg
    fi
    codesign --verify --deep --strict "$root/bundle/macos/Devyy.app"
    xcrun stapler validate "$root/bundle/macos/Devyy.app"
    xcrun stapler validate "$setup.dmg"
    ditto -c -k --sequesterRsrc --keepParent "$root/bundle/macos/Devyy.app" "$editor.app.zip"
    ;;
  *)
    echo "Unsupported release platform: $platform" >&2
    exit 1
    ;;
esac
