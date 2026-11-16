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
