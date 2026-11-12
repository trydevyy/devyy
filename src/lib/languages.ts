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
const loading = new Map<string, Promise<LanguageSupport>>();
export async function loadLanguage(pathOrName: string, fence = false) {
  const description = fence
    ? LanguageDescription.matchLanguageName(languages, pathOrName, true)
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
