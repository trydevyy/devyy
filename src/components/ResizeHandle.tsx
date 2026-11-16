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

import { useEffect, useRef, type PointerEvent } from "react";

export default function ResizeHandle({
  label,
  axis = "x",
  value,
  min,
  max,
  onChange,
  onReset,
  reverse = false,
  percentOf,
}: {
  label: string;
  axis?: "x" | "y";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  reverse?: boolean;
  percentOf?: () => number;
}) {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  function start(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY;
    const size = percentOf?.() ?? 100;
    const scale = percentOf ? 100 / size : 1;
    let frame = 0,
      pending = value;
    document.documentElement.dataset.resizing = axis;
    e.currentTarget.dataset.dragging = "true";
    const handle = e.currentTarget;
    const move = (event: globalThis.PointerEvent) => {
      pending = clamp(
        value +
          ((axis === "x" ? event.clientX : event.clientY) - start) *
            (reverse ? -1 : 1) *
            scale,
      );
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          onChange(pending);
        });
    };
    const end = () => {
      cancelAnimationFrame(frame);
      onChange(pending);
      delete document.documentElement.dataset.resizing;
      delete handle.dataset.dragging;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cleanup.current = () => {};
    };
    cleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  return (
    <div
      className={`resize-handle resize-${axis}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const delta =
          e.key === (axis === "x" ? "ArrowRight" : "ArrowDown")
            ? 1
            : e.key === (axis === "x" ? "ArrowLeft" : "ArrowUp")
              ? -1
              : 0;
        if (delta) {
          e.preventDefault();
          onChange(
            clamp(
              value +
                delta *
                  (reverse ? -1 : 1) *
                  (percentOf ? 2 : e.shiftKey ? 40 : 10),
            ),
          );
        }
        if (e.key === "Home") {
          e.preventDefault();
          onReset();
        }
      }}
    />
  );
}
