import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
export default function AIPopover({
  anchor,
  label,
  onClose,
  children,
  width = 620,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState({ left: 12, top: 100 });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect(),
        panel = ref.current;
      if (!rect || !panel) return;
      const w = Math.min(width, innerWidth - 24),
        h = Math.min(panel.scrollHeight, innerHeight - 32);
      setPosition({
        left: Math.max(12, Math.min(innerWidth - w - 12, rect.right - w)),
        top: Math.max(12, Math.min(innerHeight - h - 12, rect.top - h - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, width]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      ref.current?.querySelector<HTMLElement>("input") ??
      ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]')
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'input:not(:disabled),button:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) ?? [],
        ).filter((el) => el.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      aria-modal="true"
      className="ai-popover"
      style={{ ...position, width: `min(${width}px, calc(100vw - 24px))` }}
    >
      {children}
    </div>,
    document.body,
  );
}
