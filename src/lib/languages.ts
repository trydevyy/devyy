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
  type LanguageSupport,
} from "@codemirror/language";
export const languages = [
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
      [/\b(?:sh|bash|zsh|fish|dash|ksh)\b/, "Shell"],
    ] as const) {
      if (pattern.test(firstLine)) return language;
    }
  }
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

const loading = new Map<string, Promise<LanguageSupport>>();
export async function loadLanguage(pathOrName: string, fence = false) {
  const description = fence
    ? (languages.find(
        (language) => language.name.toLowerCase() === pathOrName.toLowerCase(),
      ) ?? LanguageDescription.matchLanguageName(languages, pathOrName, true))
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
