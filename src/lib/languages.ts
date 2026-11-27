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

import { extensionLanguage } from "./extensions";
import { languages as bundledLanguages } from "@codemirror/language-data";
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
const additionalLanguages = [
  {
    id: "hcl",
    name: "HCL",
    alias: ["terraform", "tf", "tfvars"],
    extensions: ["hcl", "tf", "tfvars", "tofu"],
  },
  { id: "nix", name: "Nix", extensions: ["nix"] },
  { id: "zig", name: "Zig", extensions: ["zig", "zon"] },
  {
    id: "elixir",
    name: "Elixir",
    alias: ["ex", "exs"],
    extensions: ["ex", "exs"],
  },
  { id: "solidity", name: "Solidity", alias: ["sol"], extensions: ["sol"] },
  { id: "fish", name: "Fish", extensions: ["fish"] },
  {
    id: "graphql",
    name: "GraphQL",
    alias: ["gql"],
    extensions: ["graphql", "gql", "graphqls"],
  },
  {
    id: "ini",
    name: "INI",
    alias: ["editorconfig"],
    extensions: ["ini"],
    filename: /^(\.editorconfig|\.gitconfig)$/i,
  },
  {
    id: "mermaid",
    name: "Mermaid",
    alias: ["mmd"],
    extensions: ["mmd", "mermaid"],
  },
  { id: "typst", name: "Typst", alias: ["typ"], extensions: ["typ"] },
] as const;
export const languages = [
  ...additionalLanguages.map(({ id, ...info }) =>
    LanguageDescription.of({
      ...info,
      extensions: [...info.extensions],
      alias: "alias" in info ? [...info.alias] : undefined,
      load: () =>
        import("./additionalLanguages").then((m) => m.additionalLanguage(id)),
    }),
  ),
  LanguageDescription.of({
    name: "GLSL",
    alias: ["shader", "vert", "frag"],
    extensions: [
      "glsl",
      "vert",
      "frag",
      "geom",
      "tesc",
      "tese",
      "comp",
      "glslv",
      "glslf",
    ],
    load: () =>
      import("@codemirror/legacy-modes/mode/clike").then(
        ({ shader }) => new LanguageSupport(StreamLanguage.define(shader)),
      ),
  }),
  LanguageDescription.of({
    name: "HiveQL",
    alias: ["hive", "hql"],
    extensions: ["hql"],
    load: () =>
      import("@codemirror/legacy-modes/mode/sql").then(
        ({ hive }) => new LanguageSupport(StreamLanguage.define(hive)),
      ),
  }),
  LanguageDescription.of({
    name: "Ceylon",
    extensions: ["ceylon"],
    load: () =>
      import("@codemirror/legacy-modes/mode/clike").then(
        ({ ceylon }) => new LanguageSupport(StreamLanguage.define(ceylon)),
      ),
  }),
  LanguageDescription.of({
    name: "nesC",
    extensions: ["nc"],
    load: () =>
      import("@codemirror/legacy-modes/mode/clike").then(
        ({ nesC }) => new LanguageSupport(StreamLanguage.define(nesC)),
      ),
  }),
  ...bundledLanguages,
  LanguageDescription.of({
    name: "Svelte",
    extensions: ["svelte"],
    load: () =>
      import("@replit/codemirror-lang-svelte").then((m) => m.svelte()),
  }),
  LanguageDescription.of({
    name: "Makefile",
    extensions: ["mk", "mak"],
    filename: /^(GNUmakefile|[mM]akefile)$/,
    load: () => import("./makefileLanguage").then((m) => m.makefile()),
  }),
];
const descriptions = new Map<string, LanguageDescription | null>();
export function languageDescription(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  if (descriptions.has(name)) return descriptions.get(name)!;
  const special = /^(Dockerfile|Containerfile)(\.|$)/i.test(name)
    ? "Dockerfile"
    : /^\.env(\.|$)/.test(name) || name.endsWith(".env")
      ? "Properties files"
      : /^(\.bashrc|\.zshrc|\.profile|\.bash_profile)$/.test(name)
        ? "Shell"
        : /\.(mdown|mdx)$/i.test(name)
          ? "Markdown"
          : /\.(jsonc|json5)$/i.test(name)
            ? "JSON"
            : null;
  const description = special
    ? LanguageDescription.matchLanguageName(languages, special)
    : (LanguageDescription.matchFilename(languages, name.toLowerCase()) ??
      LanguageDescription.matchFilename(languages, name));
  if (descriptions.size >= 4096)
    descriptions.delete(descriptions.keys().next().value!);
  descriptions.set(name, description);
  return description;
}
export function languageId(path: string): string {
  const contributed = extensionLanguage(path);
  if (contributed) return contributed.id;
  const name = languageDescription(path)?.name.toLowerCase() ?? "text";
  return name === "tsx"
    ? "typescript"
    : name === "jsx"
      ? "javascript"
      : name === "shell"
        ? "shell"
        : name;
}
// Treat filenames and explicit language choices as authoritative. For unnamed
// buffers, use a bounded prefix and require recognizable syntax.
export function detectContentLanguage(content: string): string | undefined {
  const sample = content.slice(0, 4096).trimStart();
  if (!sample || sample.includes("\0")) return;
  const firstLine = sample.split(/\r?\n/, 1)[0];
  if (firstLine.startsWith("#!")) {
    for (const [pattern, language] of [
      [/\b(?:python(?:\d+(?:\.\d+)?)?|pypy\d*)\b/, "Python"],
      [/\b(?:node|deno|bun)\b/, "JavaScript"],
      [/\bruby\b/, "Ruby"],
      [/\bperl\b/, "Perl"],
      [/\bphp\b/, "PHP"],
      [/\bpwsh\b/, "PowerShell"],
      [/\bfish\b/, "Fish"],
      [/\b(?:sh|bash|zsh|dash|ksh)\b/, "Shell"],
    ] as const) {
      if (pattern.test(firstLine)) return language;
    }
  }
  if (/^pragma\s+solidity\s+/m.test(sample)) return "Solidity";
  if (/^\s*defmodule\s+[A-Z][\w.]*\s+do\b/m.test(sample)) return "Elixir";
  if (/^\s*(?:const|var)\s+\w+\s*=\s*@import\(/m.test(sample)) return "Zig";
  if (/^\s*(?:resource|data)\s+"[^"]+"\s+"[^"]+"\s*\{/m.test(sample))
    return "HCL";
  if (/^\s*#version\s+\d{3}\b/m.test(sample)) return "GLSL";
  if (/^(?:flowchart\s+(?:LR|RL|TD|TB|BT)|sequenceDiagram)\b/.test(sample))
    return "Mermaid";
  if (/^<\?php\b/i.test(sample)) return "PHP";
  if (/^(?:<!doctype\s+html|<(?:html|head|body)\b)/i.test(sample))
    return "HTML";
  if (/^<\?xml\s|^<svg\b/i.test(sample)) return "XML";
  if (/^\{\s*"[^"\r\n]+"\s*:/.test(sample)) return "JSON";
  if (sample.startsWith("[") && content.length <= 4096) {
    try {
      if (Array.isArray(JSON.parse(sample))) return "JSON";
    } catch {}
  }
  if (
    /^(?:FROM|ARG)\s+\S+/m.test(sample) &&
    /^\s*(?:RUN|COPY|ENTRYPOINT|WORKDIR|EXPOSE)\s+\S+/m.test(sample)
  )
    return "Dockerfile";
  if (/^package\s+\w+\s*$/m.test(sample) && /^func\s+(?:\w+|\()/m.test(sample))
    return "Go";
  if (/^\s*(?:pub\s+)?fn\s+\w+\s*\([^\r\n]*\)\s*(?:->|\{)/m.test(sample))
    return "Rust";
  if (
    /^\s*(?:async\s+)?def\s+\w+\s*\([^\r\n]*\)\s*(?:->[^:\n]+)?\s*:/m.test(
      sample,
    )
  )
    return "Python";
  if (/^\s*(?:export\s+)?(?:interface\s+\w+\s*\{|type\s+\w+\s*=)/m.test(sample))
    return "TypeScript";
  if (
    /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=|^\s*(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\(/m.test(
      sample,
    )
  )
    return "JavaScript";
  if (
    /^(?:SELECT\b[^;]+\bFROM\b|CREATE\s+TABLE\b|INSERT\s+INTO\b|UPDATE\s+[\w.]+\s+SET\b)/i.test(
      sample,
    )
  )
    return "SQL";
  if (/^\[\w[\w.-]*\]\s*\r?\n\s*[\w.-]+\s*=/m.test(sample)) return "TOML";
  if (/^---\s*\r?\n\s*[\w.-]+:\s+\S/.test(sample)) return "YAML";
}

export function loadDocumentLanguage(
  path: string,
  inferred?: string,
  explicit?: string,
) {
  if (explicit && explicit.toLowerCase() !== "text")
    return loadLanguage(explicit, true).then(
      (support) => support ?? loadLanguage(path),
    );
  return inferred ? loadLanguage(inferred, true) : loadLanguage(path);
}

const fenceAliases: Record<string, string> = {
  "c++": "C++",
  "c#": "C#",
  "f#": "F#",
  bash: "Shell",
  sh: "Shell",
  zsh: "Shell",
  console: "Shell",
  shellscript: "Shell",
  ps1: "PowerShell",
  "objective-c": "Objective-C",
  objc: "Objective-C",
  "objective-cpp": "Objective-C++",
  jsonc: "JSON",
  json5: "JSON",
  yml: "YAML",
  mdx: "Markdown",
  golang: "Go",
  rustlang: "Rust",
  wasm: "WebAssembly",
  docker: "Dockerfile",
  containerfile: "Dockerfile",
  make: "Makefile",
  latex: "LaTeX",
  protobuf: "ProtoBuf",
  vuejs: "Vue",
  "html+jinja": "Jinja",
};
const fenceLanguages = new Map<string, LanguageDescription>();
for (const description of languages) {
  for (const alias of description.alias) {
    if (!fenceLanguages.has(alias)) fenceLanguages.set(alias, description);
  }
  fenceLanguages.set(description.name.toLowerCase(), description);
}
function fenceDescription(name: string) {
  if (
    !name ||
    [
      "plain",
      "plain-text",
      "plaintext",
      "text",
      "txt",
      "none",
      "nohighlight",
    ].includes(name)
  )
    return;
  const alias = Object.hasOwn(fenceAliases, name)
    ? fenceAliases[name].toLowerCase()
    : name;
  return (
    fenceLanguages.get(alias) ??
    LanguageDescription.matchFilename(languages, `snippet.${name}`)
  );
}

const loading = new Map<string, Promise<LanguageSupport>>();
export async function loadLanguage(pathOrName: string, fence = false) {
  const name = pathOrName.trim().toLowerCase();
  const description = fence
    ? fenceDescription(name)
    : languageDescription(pathOrName);
  if (!description) return null;
  if (!loading.has(description.name)) {
    const promise =
      description.name === "Markdown"
        ? import("@codemirror/lang-markdown").then((m) =>
            m.markdown({ codeLanguages: languages }),
          )
        : description.load();
    loading.set(
      description.name,
      promise.catch((error) => {
        loading.delete(description.name);
        throw error;
      }),
    );
  }
  return loading.get(description.name)!;
}
