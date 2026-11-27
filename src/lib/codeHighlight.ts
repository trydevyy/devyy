import {
  classHighlighter,
  highlightTree,
  tagHighlighter,
  tags,
} from "@lezer/highlight";
import { detectContentLanguage, loadLanguage } from "./languages";

const functions = tagHighlighter([
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function",
  },
]);

export async function highlightSnippet(
  code: string,
  { language, path }: { language?: string; path?: string } = {},
) {
  if (!code || code.length > 100_000) return [];
  const support = language
    ? await loadLanguage(language, true)
    : (path && (await loadLanguage(path))) ||
      (await loadLanguage(detectContentLanguage(code) ?? "", true));
  if (!support) return [];

  const parts: { text: string; classes?: string }[] = [];
  let cursor = 0;
  highlightTree(
    support.language.parser.parse(code),
    [classHighlighter, functions],
    (from, to, classes) => {
      if (from > cursor) parts.push({ text: code.slice(cursor, from) });
      parts.push({ text: code.slice(from, to), classes });
      cursor = to;
    },
  );
  if (cursor === 0) return [];
  if (cursor < code.length) parts.push({ text: code.slice(cursor) });
  return parts;
}

export function highlightCodeElement(
  element: HTMLElement,
  code: string,
  options?: Parameters<typeof highlightSnippet>[1],
) {
  element.classList.add("devyy-syntax");
  element.textContent = code;
  void highlightSnippet(code, options)
    .then((parts) => {
      if (parts.length === 0 || element.textContent !== code) return;
      const fragment = document.createDocumentFragment();
      for (const { text, classes } of parts) {
        if (classes) {
          const token = document.createElement("span");
          token.className = classes;
          token.textContent = text;
          fragment.append(token);
        } else {
          fragment.append(text);
        }
      }
      element.replaceChildren(fragment);
    })
    .catch(() => {});
}

export function* documentationBlocks(
  text: string,
): Generator<{ text: string } | { code: string; language: string }> {
  const fenceLines = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gm;
  let cursor = 0;
  let opening:
    | { index: number; start: number; fence: string; language: string }
    | undefined;
  for (const match of text.matchAll(fenceLines)) {
    const [, fence, info] = match;
    if (!opening) {
      if (fence[0] === "`" && info.includes("`")) continue;
      opening = {
        index: match.index,
        start: match.index + match[0].length + 1,
        fence,
        language: info.trim().split(/\s+/, 1)[0],
      };
      continue;
    }
    if (!fence.startsWith(opening.fence) || info.trim()) continue;
    if (opening.index > cursor)
      yield { text: text.slice(cursor, opening.index) };
    yield {
      code: text.slice(opening.start, match.index).replace(/\r?\n$/, ""),
      language: opening.language,
    };
    cursor = match.index + match[0].length;
    opening = undefined;
  }
  if (cursor < text.length) yield { text: text.slice(cursor) };
}
