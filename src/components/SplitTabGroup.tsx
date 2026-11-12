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
