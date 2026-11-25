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

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Problem } from "../lib/types";

const rowHeight = 34;
const buffer = 8;

export default function ProblemList({
  problems,
  renderRow,
}: {
  problems: Problem[];
  renderRow: (problem: Problem, index: number) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const virtual = problems.length > 100;
  function measure() {
    const element = viewport.current;
    if (!element) return;
    const top = Math.floor(element.scrollTop / rowHeight) * rowHeight;
    const height = element.clientHeight;
    setView((previous) =>
      previous.top === top && previous.height === height
        ? previous
        : { top, height },
    );
  }
  useLayoutEffect(() => {
    if (!virtual || !viewport.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [virtual, problems.length]);
  const start = virtual
    ? Math.max(
        0,
        Math.min(
          Math.floor(view.top / rowHeight),
          problems.length - Math.ceil(view.height / rowHeight),
        ) - buffer,
      )
    : 0;
  const end = virtual
    ? Math.min(
        problems.length,
        start + Math.ceil(view.height / rowHeight) + 2 * buffer,
      )
    : problems.length;
  const rows = problems
    .slice(start, end)
    .map((problem, index) => renderRow(problem, start + index));
  return (
    <div
      className="problems-list"
      ref={viewport}
      onScroll={virtual ? measure : undefined}
      tabIndex={virtual ? 0 : undefined}
      aria-label="Diagnostics"
    >
      {virtual ? (
        <div
          className="problems-window"
          style={
            {
              paddingTop: start * rowHeight,
              paddingBottom: (problems.length - end) * rowHeight,
              "--problem-row-height": `${rowHeight}px`,
            } as React.CSSProperties
          }
        >
          {rows}
        </div>
      ) : (
        rows
      )}
    </div>
  );
}
