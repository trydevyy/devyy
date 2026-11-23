# Developer commands for Devyy. Run `make help` to see the available targets.

.DEFAULT_GOAL := help

NPM := npm
CARGO := cargo

ifeq ($(OS),Windows_NT)
  NATIVE_TEST = $(CARGO) test --locked --manifest-path $1
else ifeq ($(shell uname -s),Linux)
  ifneq ($(shell command -v xvfb-run 2>/dev/null),)
  NATIVE_TEST = xvfb-run -a $(CARGO) test --locked --manifest-path $1
  else
  NATIVE_TEST = $(CARGO) test --locked --manifest-path $1
  endif
else
  NATIVE_TEST = $(CARGO) test --locked --manifest-path $1
endif

.PHONY: help setup assets playwright-install format format-js format-rust format-check format-check-js format-check-rust check lint lint-js lint-rust test test-js test-rust test-e2e test-e2e-installer build build-installer package verify clean

help: ## Show this help message.
	@awk 'BEGIN { FS = ":.*##" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

setup: ## Install locked editor and installer dependencies.
	$(NPM) ci
	$(NPM) ci --prefix installer

assets: ## Regenerate third-party asset metadata.
	$(NPM) run assets:generate

playwright-install: ## Install the pinned Chromium browser required by end-to-end tests.
	$(NPM) exec -- playwright install chromium

format: format-js format-rust ## Format JavaScript/TypeScript/JSON and Rust sources.

format-js: ## Format JavaScript, TypeScript, JSON, Markdown, YAML, and CSS.
	$(NPM) exec -- prettier --write --ignore-unknown .

format-rust: ## Format the editor and installer Rust crates.
	$(CARGO) fmt --manifest-path src-tauri/Cargo.toml
	$(CARGO) fmt --manifest-path installer/src-tauri/Cargo.toml

format-check: format-check-js format-check-rust ## Check formatting without modifying files.

format-check-js: ## Check JavaScript/TypeScript/JSON and documentation formatting.
	$(NPM) exec -- prettier --check --ignore-unknown .

format-check-rust: ## Check Rust formatting without modifying files.
	$(CARGO) fmt --manifest-path src-tauri/Cargo.toml -- --check
	$(CARGO) fmt --manifest-path installer/src-tauri/Cargo.toml -- --check

check: ## Type-check the web app and compile-check the editor and installer.
	$(NPM) run check
	$(CARGO) check --locked --manifest-path installer/src-tauri/Cargo.toml

lint: lint-js lint-rust ## Run static analysis for JavaScript/TypeScript and Rust.

lint-js: ## Run the TypeScript compiler.
	$(NPM) run check

lint-rust: ## Run Clippy for the editor and installer Rust crates.
	$(CARGO) clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets
	$(CARGO) clippy --locked --manifest-path installer/src-tauri/Cargo.toml --all-targets

test: test-js test-rust ## Run unit, extension-host, and native test suites.

test-js: ## Run browser-independent unit and extension-host tests.
	$(NPM) exec -- vitest run
	$(NPM) run test:extension-host

test-rust: ## Run native editor and installer tests (Xvfb on Linux).
	$(call NATIVE_TEST,src-tauri/Cargo.toml)
	$(call NATIVE_TEST,installer/src-tauri/Cargo.toml)

test-e2e: ## Run the editor Playwright end-to-end suite.
	$(NPM) run test:e2e -- --workers=2

test-e2e-installer: ## Run the installer Playwright end-to-end suite.
	$(NPM) run test:e2e --prefix installer -- --workers=2

build: ## Build the production editor frontend and native binary without bundling.
	$(NPM) run desktop:build -- --no-bundle

build-installer: ## Build the custom installer for the current platform.
	$(NPM) run release:installer

package: build-installer ## Build the editor and matching custom installer.

verify: format-check lint test ## Run the fast release-readiness verification suite.
	git diff --check

clean: ## Remove generated frontend and native build output.
	node -e "for (const path of ['dist', 'src-tauri/target', 'installer/src-tauri/target']) require('node:fs').rmSync(path, { force: true, recursive: true });"
