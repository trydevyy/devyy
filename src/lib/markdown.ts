/** Resolve a Markdown link relative to its file, without allowing workspace escapes. */
export function markdownPath(
  document: string,
  href: string,
): { path: string; hash: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const [raw, hash = ""] = href.split("#", 2);
  try {
    const decoded = decodeURIComponent(raw.split("?")[0]);
    if (decoded.includes("\\") || decoded.includes("\0")) return null;
    const parts = decoded.startsWith("/")
      ? []
      : document.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(part);
    }
    return {
      path: raw ? parts.join("/") : document,
      hash: decodeURIComponent(hash),
    };
  } catch {
    return null;
  }
}
export function headingId(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
    .replace(/\s/g, "-");
}
