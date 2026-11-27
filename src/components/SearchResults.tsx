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

import Skeleton from "./ui/Skeleton";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { FileIcon } from "./FileTree";
import { filename, type SearchMatch } from "../lib/types";
export default function SearchResults({
  matches,
  query,
  busy,
  onOpen,
  onMenu,
}: {
  matches: SearchMatch[];
  query: string;
  busy: boolean;
  onOpen: (match: SearchMatch) => void;
  onMenu: (e: React.MouseEvent, path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.path) ?? [];
    group.push(match);
    groups.set(match.path, group);
  }
  return (
    <div
      className="search-results"
      aria-label="Workspace search results"
      aria-busy={busy}
    >
      {busy && !groups.size && (
        <Skeleton variant="table" label="Searching workspace" />
      )}
      {Array.from(groups, ([path, rows]) => {
        const closed = collapsed.has(path),
          parent = path.split("/").slice(0, -1).join("/");
        return (
          <section
            className="search-file-group"
            key={path}
            onContextMenu={(e) => onMenu(e, path)}
          >
            <button
              className="search-file-heading"
              aria-expanded={!closed}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  next.has(path) ? next.delete(path) : next.add(path);
                  return next;
                })
              }
            >
              <ChevronRight size={11} className={closed ? "" : "rotated"} />
              <FileIcon path={path} size={13} />
              <strong>{filename(path)}</strong>
              <small>{parent}</small>
              <span>{rows.length}</span>
            </button>
            {!closed &&
              rows.map((match, i) => {
                const text = match.text.trim(),
                  start = text.toLowerCase().indexOf(query.toLowerCase());
                return (
                  <button
                    className="search-line"
                    key={`${match.line}:${i}`}
                    onClick={() => onOpen(match)}
                    title={`${path}:${match.line}`}
                  >
                    <span className="search-line-number">{match.line}</span>
                    <code>
                      {start < 0 ? (
                        text
                      ) : (
                        <>
                          {text.slice(0, start)}
                          <mark>{text.slice(start, start + query.length)}</mark>
                          {text.slice(start + query.length)}
                        </>
                      )}
                    </code>
                  </button>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
