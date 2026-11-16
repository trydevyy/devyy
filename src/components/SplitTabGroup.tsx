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

import type { DragEvent, ReactNode } from "react";
import { Columns2 } from "lucide-react";

export default function SplitTabGroup({
  kind,
  active,
  onSeparate,
  children,
  onDragStart,
  onDragEnd,
}: {
  kind: "file" | "terminal";
  active: boolean;
  onSeparate: () => void;
  children: [ReactNode, ReactNode];
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      className={`split-tab-group ${active ? "active" : ""}`}
      role="group"
      aria-label={`Split ${kind} group`}
      draggable={!!onDragStart}
      onDragStart={(event) => {
        if (event.target === event.currentTarget) onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
    >
      {children[0]}
      <button
        className="split-tab-indicator"
        aria-label={`Separate ${kind} group`}
        title="Drag the group or click to separate"
        draggable={!!onDragStart}
        onDragStart={(event) => {
          event.stopPropagation();
          onDragStart?.(event);
        }}
        onClick={onSeparate}
      >
        <Columns2 size={12} />
      </button>
      {children[1]}
    </div>
  );
}
