#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

local_only=false
ad_hoc=false
if [[ "${1:-}" == --local-only ]]; then
  local_only=true
  ad_hoc=true
  shift
fi

if [[ "${1:-}" == --ad-hoc ]]; then
  ad_hoc=true
  shift
fi

if [[ "${1:-}" == --help ]]; then
  printf 'Usage: bash scripts/build-local-release.sh [--local-only | --ad-hoc]\nBuilds and stages release assets for the current OS and architecture.\n--ad-hoc stages macOS release assets without Developer ID signing or notarization.\n'
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

if $ad_hoc; then
  if [[ "$platform" != macos-* ]]; then
    echo "Ad hoc signing is available for macOS builds." >&2
    exit 1
  fi
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
  export APPLE_SIGNING_IDENTITY=-
elif [[ "$platform" == macos-* ]]; then
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    identities="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)".*/\1/p')"
    if [[ -z "$identities" || "$identities" == *$'\n'* ]]; then
      echo "Set APPLE_SIGNING_IDENTITY to an installed Developer ID Application identity, or pass --local-only for an ad hoc signed DMG." >&2
      exit 1
    fi
    export APPLE_SIGNING_IDENTITY="$identities"
  fi
  : "${APPLE_ID:?Set the Apple account for notarization}"
  : "${APPLE_PASSWORD:?Set the Apple app-specific password for notarization}"
  : "${APPLE_TEAM_ID:?Set the Apple Developer Team ID}"
fi

# Match Node to the Rust host before applying any explicit macOS bundle target.
host="$(rustc -vV | sed -n 's/^host: //p')"
case "$platform:$host" in
  macos-arm64:aarch64-apple-darwin|macos-x64:x86_64-apple-darwin|\
  windows-arm64:aarch64-pc-windows-msvc|windows-x64:x86_64-pc-windows-msvc|\
  windows-x86:i686-pc-windows-msvc|linux-arm64:aarch64-unknown-linux-gnu|\
  linux-x64:x86_64-unknown-linux-gnu) ;;
  *) echo "Rust host $host does not match supported platform $platform. Use matching Node and Rust toolchains." >&2; exit 1 ;;
esac

macos_target="${DEVYY_MACOS_TARGET:-}"
if [[ -n "$macos_target" ]]; then
  case "$host:$macos_target" in
    *-apple-darwin:x86_64-apple-darwin) platform=macos-x64 ;;
    *-apple-darwin:aarch64-apple-darwin) platform=macos-arm64 ;;
    *) echo "Unsupported macOS target $macos_target on host $host." >&2; exit 1 ;;
  esac
fi

if [[ ! -f third_party/hit/Cargo.toml ]]; then
  echo "Initialize HIT first: git submodule update --init --checkout -- third_party/hit" >&2
  exit 1
fi

version="$(node -p 'require("./package.json").version')"
output="release-assets/v$version/$platform"
if $local_only; then output="$output-local"; fi
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

bun install --frozen-lockfile
if [[ "$platform" == macos-* ]]; then
  macos_config="$(node -p 'JSON.stringify({bundle:{macOS:{signingIdentity:process.env.APPLE_SIGNING_IDENTITY}}})')"
  macos_args=(--config "$macos_config")
  if [[ -n "$macos_target" ]]; then
    macos_args+=(--target "$macos_target")
    export DEVYY_RUST_TARGET="$macos_target"
  fi
  bun run desktop:build "${macos_args[@]}"
  app="src-tauri/target/${macos_target:+$macos_target/}release/bundle/macos/Devyy.app"
  arch="$(lipo -archs "$app/Contents/MacOS/Devyy")"
  if [[ "$platform:$arch" != macos-arm64:arm64 && "$platform:$arch" != macos-x64:x86_64 ]]; then
    echo "Built app architecture $arch does not match $platform." >&2
    exit 1
  fi
  export DEVYY_DMG_PATH="$staging/Devyy.dmg"
  if $local_only; then
    bun run release:installer --skip-editor-build --app "$app" --output "$DEVYY_DMG_PATH" --local-only
    mkdir "$output"
    mv "$DEVYY_DMG_PATH" "$output/Devyy.dmg"
    printf 'Local DMG: %s/Devyy.dmg\n' "$output"
    exit 0
  fi
  installer_args=()
  if $ad_hoc; then installer_args+=(--local-only); fi
  bun run release:installer --skip-editor-build --app "$app" --output "$DEVYY_DMG_PATH" "${installer_args[@]}"
elif [[ "$platform" == linux-* ]]; then
  bun run desktop:build
else
  bun install --cwd installer --frozen-lockfile
  bun run release:installer
fi

DEVYY_AD_HOC_SIGNING="$ad_hoc" bash scripts/stage-release-assets.sh
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
