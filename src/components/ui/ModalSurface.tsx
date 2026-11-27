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

import {
  createElement,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { X } from "lucide-react";
import { useDialogMotion } from "../../lib/motion";

type SurfaceTag = "div" | "section" | "form" | "dialog";
type SurfaceProps<T extends SurfaceTag> = ComponentPropsWithRef<T> & {
  as?: T;
  entryMotion?: boolean;
};

export function ModalSurface<T extends SurfaceTag = "div">({
  as,
  className,
  entryMotion = true,
  ...props
}: SurfaceProps<T>) {
  return createElement(as ?? "div", {
    ...props,
    className: ["devyy-modal", className].filter(Boolean).join(" "),
    "data-surface-entry": entryMotion || undefined,
  });
}

function animatedSurface<T extends SurfaceTag>(props: SurfaceProps<T>) {
  return <ModalSurface {...props} entryMotion={false} />;
}
export const MotionModalSurface = motion.create(animatedSurface<"div">);
export const MotionModalSection = motion.create(animatedSurface<"section">);

export const MotionModalForm = motion.create(animatedSurface<"form">);
const MotionNativeSurface = motion.create(animatedSurface<"dialog">);

export function NativeModal({
  ref,
  onPointerDown,
  onClick,
  onClickCapture,
  onCancel,
  ...props
}: HTMLMotionProps<"dialog"> & Pick<ComponentPropsWithRef<"dialog">, "ref">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  const present = useIsPresent();
  const animation = useDialogMotion();
  function outside(event: {
    target: EventTarget;
    currentTarget: HTMLDialogElement;
    clientX: number;
    clientY: number;
  }) {
    const { left, right, top, bottom } =
      event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < left ||
        event.clientX > right ||
        event.clientY < top ||
        event.clientY > bottom)
    );
  }
  useImperativeHandle(ref, () => dialog.current!, []);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <MotionNativeSurface
      as="dialog"
      {...props}
      {...animation}
      data-modal-motion={animation.initial.scale !== 1 || undefined}
      data-modal-exiting={!present || undefined}
      data-escape-scope="active"
      ref={dialog}
      onCancel={(event) => {
        if (present) onCancel?.(event);
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        outsidePress.current =
          !event.defaultPrevented && event.button === 0 && outside(event);
      }}
      onClickCapture={(event) => {
        if (!present) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClickCapture?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
        const shouldClose = outsidePress.current && outside(event);
        outsidePress.current = false;
        if (shouldClose && !event.defaultPrevented)
          event.currentTarget.dispatchEvent(
            new Event("cancel", { cancelable: true }),
          );
      }}
    />
  );
}

export function ModalHeader({
  id,
  title,
  description,
  icon,
  actions,
  onClose,
  closeLabel = "Close",
  busy,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  busy?: boolean;
}) {
  return (
    <header className="devyy-modal-heading">
      {icon && <span className="devyy-modal-icon">{icon}</span>}
      <div>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions}
      {onClose && (
        <button
          type="button"
          className="icon-button"
          aria-label={closeLabel}
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      )}
    </header>
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <footer className="devyy-modal-actions">{children}</footer>;
}

export function ModalBody({
  className,
  flush = false,
  ...props
}: ComponentPropsWithRef<"div"> & { flush?: boolean }) {
  return (
    <div
      {...props}
      className={[
        "devyy-modal-body",
        flush && "devyy-modal-body-flush",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
