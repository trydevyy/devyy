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
