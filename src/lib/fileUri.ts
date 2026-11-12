export function fileUri(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("//")) {
    const [host, ...parts] = normalized.slice(2).split("/");
    return `file://${host}/${parts.map(encodeURIComponent).join("/")}`;
  }
  const parts = normalized
    .split("/")
    .map((part, index) =>
      index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part),
    );
  return `file://${normalized.startsWith("/") ? "" : "/"}${parts.join("/")}`;
}
