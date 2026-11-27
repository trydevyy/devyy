// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import {
  detectContentLanguage,
  loadDocumentLanguage,
  languages,
  languageId,
  languageDescription,
  loadLanguage,
} from "./languages";
import { documentationBlocks, highlightSnippet } from "./codeHighlight";
import { markdownPath, headingId } from "./markdown";
describe("language registry", () => {
  it("detects source, configuration and special filenames across the bundled registry", () => {
    expect(languages.length).toBeGreaterThan(100);
    for (const [path, name] of [
      ["src/main.rs", "rust"],
      ["app.tsx", "typescript"],
      ["view.jsx", "javascript"],
      ["main.go", "go"],
      ["app.java", "java"],
      ["script.rb", "ruby"],
      ["main.cpp", "c++"],
      ["Program.cs", "c#"],
      ["App.swift", "swift"],
      ["main.kt", "kotlin"],
      ["query.sql", "sql"],
      ["data.yaml", "yaml"],
      ["Cargo.toml", "toml"],
      ["page.php", "php"],
      ["script.sh", "shell"],
      ["Dockerfile.dev", "dockerfile"],
      [".zshrc", "shell"],
      ["config.env", "properties files"],
      [".env.local", "properties files"],
      ["README.MD", "markdown"],
      ["page.vue", "vue"],
      ["App.svelte", "svelte"],
      ["Makefile", "makefile"],
    ]) {
      expect(languageId(path), path).toBe(name);
    }
    expect(languageDescription("custom.unknown")).toBeNull();
  });
  it("shares file and fence grammars and preserves all source text", async () => {
    const snippets = [
      [
        "project.tf",
        "terraform",
        'resource "example" "main" { enabled = true }',
      ],
      ["flake.nix", "nix", 'let greeting = "hello"; in greeting'],
      ["build.zig", "zig", 'const io = @import("std");'],
      [
        "app.ex",
        "elixir",
        "defmodule Example do\n  def hello, do: :hello\nend",
      ],
      ["Token.sol", "solidity", "pragma solidity ^0.8.0;\ncontract Token {}"],
      ["script.fish", "fish", 'function greet; set name "devyy"; end'],
      ["schema.graphqls", "gql", "type Query { health: Boolean! }"],
      [".editorconfig", "ini", "[*]\nindent_size = 2"],
      ["chart.mmd", "mermaid", "flowchart LR\n  a --> b"],
      ["doc.typ", "typst", '#let title = "Devyy"'],
      ["shader.frag", "glsl", "uniform float opacity;"],
      ["main.hql", "hive", "SELECT * FROM logs;"],
    ];
    for (const [path, language, code] of snippets) {
      expect(await loadLanguage(path), path).not.toBeNull();
      expect(await loadLanguage(language, true), language).toBe(
        await loadLanguage(path),
      );
      const parts = await highlightSnippet(code, { language });
      expect(
        parts.some(({ classes }) => classes),
        language,
      ).toBe(true);
      expect(parts.map(({ text }) => text).join(""), language).toBe(code);
    }
    expect(
      await highlightSnippet("fn main() {}", { language: "text" }),
    ).toEqual([]);
    expect(await highlightSnippet("fn main() {}")).not.toEqual([]);
  });
  it("preserves indents and nested fences in documentation", () => {
    expect([
      ...documentationBlocks("Intro\n~~~~py test\n  greet()\n~~~~~\n"),
    ]).toEqual([
      { text: "Intro\n" },
      { code: "  greet()", language: "py" },
      { text: "\n" },
    ]);
    expect([
      ...documentationBlocks("````markdown\n```rs\nfn main() {}\n```\n````"),
    ]).toEqual([{ code: "```rs\nfn main() {}\n```", language: "markdown" }]);
  });
  it("highlights recognizable content without a known filename", async () => {
    expect(
      detectContentLanguage("#!/usr/bin/env -S python3 -u\nprint(1)"),
    ).toBe("Python");
    expect(detectContentLanguage('{"project":"Devyy"}')).toBe("JSON");
    expect(detectContentLanguage("<!DOCTYPE html><html></html>")).toBe("HTML");
    expect(detectContentLanguage("fn main() {}")).toBe("Rust");
    expect(
      detectContentLanguage("Meeting notes\nBring coffee."),
    ).toBeUndefined();
    expect(
      detectContentLanguage("".padEnd(4096) + "fn main() {}"),
    ).toBeUndefined();
    expect(await loadDocumentLanguage("launcher", "Python")).toBe(
      await loadLanguage("launcher.py"),
    );
    expect(await loadDocumentLanguage("launcher", "Python", "Shell")).toBe(
      await loadLanguage("launcher.sh"),
    );
  });
  it("loads and parses both modern and legacy language modules on demand", async () => {
    const samples = [
      ["main.go", "package main\nfunc main() {}"],
      ["App.svelte", "<script>let count = 1</script><h1>{count}</h1>"],
      ["Makefile", "NAME := devyy\nall:\n\t@echo $(NAME)\n"],
      ["Program.cs", "public class Program { static void Main() {} }"],
      ["config.yaml", "name: devyy\nready: true"],
      ["query.sql", "SELECT * FROM projects;"],
      ["Dockerfile", "FROM node:22\nRUN npm install"],
      ["Cargo.toml", '[package]\nname = "devyy"'],
      ["main.rb", 'def greet\n  puts "hello"\nend'],
      ["README.md", "# Hello\n\n```rust\nfn main() {}\n```"],
    ];
    for (const [path, code] of samples) {
      const support = await loadLanguage(path);
      expect(support, path).not.toBeNull();
      expect(support!.language.parser.parse(code).length).toBe(code.length);
    }
    expect(await loadLanguage("Go", true)).toBe(await loadLanguage("main.go"));
  });
});
describe("Markdown paths", () => {
  it("resolves links and encoded image paths inside the workspace", () => {
    expect(markdownPath("docs/README.md", "../assets/logo%20dark.png")).toEqual(
      { path: "assets/logo dark.png", hash: "" },
    );
    expect(markdownPath("docs/README.md", "guide.md#L12")).toEqual({
      path: "docs/guide.md",
      hash: "L12",
    });
    expect(markdownPath("README.md", "/docs/guide.md")).toEqual({
      path: "docs/guide.md",
      hash: "",
    });
    for (const target of [
      "../secret",
      "%2e%2e/secret",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "//example.com/x",
      "bad%xx",
    ])
      expect(markdownPath("README.md", target), target).toBeNull();
    expect(headingId("Getting started!")).toBe("getting-started");
  });
});
