#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${1:-}" == --help ]]; then
  printf 'Usage: bash scripts/build-local-release.sh\nBuilds and stages release assets for the current OS and architecture.\n'
  exit 0
fi
if [[ $# != 0 ]]; then
  echo "Unexpected arguments. Run with --help for usage." >&2
  exit 1
fi

platform="$(node -p 'process.platform + "-" + process.arch')"
case "$platform" in
  darwin-arm64|darwin-x64) platform="macos-${platform#darwin-}" ;;
  win32-arm64|win32-x64|win32-ia32)
    arch="${platform#win32-}"
    [[ "$arch" != ia32 ]] || arch=x86
    platform="windows-$arch"
    ;;
  linux-arm64|linux-x64) ;;
  *) echo "Unsupported build platform: $platform" >&2; exit 1 ;;
esac

# Match the architecture reported by Node against the actual Rust toolchain.
host="$(rustc -vV | sed -n 's/^host: //p')"
case "$platform:$host" in
  macos-arm64:aarch64-apple-darwin|macos-x64:x86_64-apple-darwin|\
  windows-arm64:aarch64-pc-windows-msvc|windows-x64:x86_64-pc-windows-msvc|\
  windows-x86:i686-pc-windows-msvc|linux-arm64:aarch64-unknown-linux-gnu|\
  linux-x64:x86_64-unknown-linux-gnu) ;;
  *) echo "Rust host $host does not match supported platform $platform. Use matching Node and Rust toolchains." >&2; exit 1 ;;
esac

if [[ ! -f third_party/hit/Cargo.toml ]]; then
  echo "Initialize HIT first: git submodule update --init --checkout -- third_party/hit" >&2
  exit 1
fi

version="$(node -p 'require("./package.json").version')"
output="release-assets/v$version/$platform"
if [[ -e "$output" ]]; then
  echo "Output already exists: $output. Move it before building again." >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
staging="$(mktemp -d "$(dirname "$output")/.staging.XXXXXX")"
trap 'rm -r -- "$staging"' EXIT

# Use the same paths as the GitHub packaging scripts.
export CARGO_TARGET_DIR="$(node -p 'require("node:path").resolve("src-tauri/target")')"
export DEVYY_PLATFORM="$platform"
export DEVYY_RELEASE_ASSET_DIR="$staging/assets"
unset DEVYY_RUST_TARGET DEVYY_DMG_PATH

npm ci
if [[ "$platform" == macos-* ]]; then
  : "${APPLE_SIGNING_IDENTITY:?Set the Developer ID Application signing identity}"
  : "${APPLE_ID:?Set the Apple account for notarization}"
  : "${APPLE_PASSWORD:?Set the Apple app-specific password for notarization}"
  : "${APPLE_TEAM_ID:?Set the Apple Developer Team ID}"
  macos_config="$(node -p 'JSON.stringify({bundle:{macOS:{signingIdentity:process.env.APPLE_SIGNING_IDENTITY}}})')"
  npm run desktop:build -- --config "$macos_config"
  app=src-tauri/target/release/bundle/macos/Devyy.app
  arch="$(lipo -archs "$app/Contents/MacOS/Devyy")"
  if [[ "$platform:$arch" != macos-arm64:arm64 && "$platform:$arch" != macos-x64:x86_64 ]]; then
    echo "Built app architecture $arch does not match $platform." >&2
    exit 1
  fi
  export DEVYY_DMG_PATH="$staging/Devyy.dmg"
  npm run release:installer -- --skip-editor-build --app "$app" --output "$DEVYY_DMG_PATH"
else
  npm ci --prefix installer
  npm run release:installer
fi

bash scripts/stage-release-assets.sh
(
  cd "$DEVYY_RELEASE_ASSET_DIR"
  files=(Devyy*)
  manifest="SHA256SUMS-$platform.txt"
  if command -v sha256sum >/dev/null; then
    sha256sum -- "${files[@]}" > "$manifest"
    sha256sum -c "$manifest"
  else
    shasum -a 256 -- "${files[@]}" > "$manifest"
    shasum -a 256 -c "$manifest"
  fi
)
mv -- "$DEVYY_RELEASE_ASSET_DIR" "$output"
printf '\nUpload these files to the v%s release:\n' "$version"
printf '  %s\n' "$output"/*
