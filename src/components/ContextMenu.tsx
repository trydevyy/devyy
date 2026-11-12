import { AnimatePresence, motion } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  Pencil,
  Plus,
  FolderOpen,
  Search,
  Settings2,
  ArrowUpRight,
  PanelLeft,
  Terminal,
  Columns2,
  Undo2,
  Redo2,
  Save,
  File,
  ChevronRight,
} from "lucide-react";
function actionIcon(label: string) {
  if (/copy/i.test(label)) return Copy;
  if (/cut/i.test(label)) return Scissors;
  if (/paste/i.test(label)) return Clipboard;
  if (/delete|remove|discard/i.test(label)) return Trash2;
  if (/rename/i.test(label)) return Pencil;
  if (/new|create|add/i.test(label)) return Plus;
  if (/folder|reveal|finder|explorer/i.test(label)) return FolderOpen;
  if (/find|search/i.test(label)) return Search;
  if (/setting|preference/i.test(label)) return Settings2;
  if (/terminal/i.test(label)) return Terminal;
  if (/split/i.test(label)) return Columns2;
  if (/sidebar|panel|layout/i.test(label)) return PanelLeft;
  if (/undo/i.test(label)) return Undo2;
  if (/redo/i.test(label)) return Redo2;
  if (/save/i.test(label)) return Save;
  if (/open|go to/i.test(label)) return ArrowUpRight;
  return File;
}
export interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}
type MenuState = { x: number; y: number; items: MenuItem[] };
type MenuEvent = {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
  currentTarget: EventTarget | null;
};
const MenuContext = createContext<(e: MenuEvent, items: MenuItem[]) => void>(
  () => {},
);
export const useContextMenu = () => useContext(MenuContext);
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const { transition, instant } = useSurfaceMotion();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      const el = document.activeElement as HTMLElement;
      if (
        !el?.closest(
          ".tree-row,.tab,.code-editor,.terminal-instance,.terminal-session,.panel-header,.tabbar",
        )
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(25, rect.width / 2),
          clientY: rect.top + Math.min(25, rect.height / 2),
        }),
      );
    };
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, []);
  function close() {
    setMenu(null);
    restore.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const el = ref.current,
      rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8))}px`;
    el.style.setProperty(
      "--menu-origin",
      `${menu.x > innerWidth - rect.width - 8 ? "right" : "left"} ${menu.y > innerHeight - rect.height - 8 ? "bottom" : "top"}`,
    );
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = () => setMenu(null);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);
  const open = useCallback((e: MenuEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    restore.current = document.activeElement as HTMLElement;
    const rect =
      e.currentTarget instanceof HTMLElement
        ? e.currentTarget.getBoundingClientRect()
        : null;
    setMenu({
      x: e.clientX || rect?.left || 8,
      y: e.clientY || rect?.bottom || 8,
      items,
    });
  }, []);
  return (
    <MenuContext.Provider value={open}>
      {children}
      {createPortal(
        <AnimatePresence>
          {menu && (
            <motion.div
              key="context-menu"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: instant ? 0 : 0.12 }}
              className="context-dismiss"
              onPointerDown={() => close()}
              onContextMenu={(e) => {
                e.preventDefault();
                close();
              }}
            >
              <motion.div
                layout
                transition={transition}
                initial={{ opacity: 0, scale: instant ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                ref={ref}
                className="context-menu"
                role="menu"
                aria-label="Actions"
                style={{ left: menu.x, top: menu.y }}
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  const buttons = Array.from(
                    ref.current?.querySelectorAll<HTMLButtonElement>(
                      ":scope > .context-menu-entry > button:not(:disabled)",
                    ) ?? [],
                  );
                  const i = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    buttons[
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? buttons.length - 1
                          : (i +
                              (e.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                            buttons.length
                    ]?.focus();
                  }
                  if (e.key === "Escape" || e.key === "Tab") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
              >
                <MenuEntries items={menu.items} close={close} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </MenuContext.Provider>
  );
}

function MenuEntries({
  items,
  close,
}: {
  items: MenuItem[];
  close: () => void;
}) {
  const { transition, instant } = useSurfaceMotion();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  return (
    <>
      {items.map((item, i) => {
        const Icon = actionIcon(item.label),
          submenu = item.children?.length;
        const open = (button: HTMLElement) => {
          setLeft(button.getBoundingClientRect().right + 250 > innerWidth);
          setExpanded(i);
        };
        return (
          <div
            key={i}
            className="context-menu-entry"
            onPointerEnter={(e) => {
              if (submenu && !item.disabled) open(e.currentTarget);
              else setExpanded(null);
            }}
          >
            {item.separator && i > 0 && (
              <div role="separator" className="context-separator" />
            )}
            <button
              role={
                item.checked !== undefined ? "menuitemcheckbox" : "menuitem"
              }
              aria-checked={item.checked}
              aria-label={item.label}
              aria-haspopup={submenu ? "menu" : undefined}
              aria-expanded={submenu ? expanded === i : undefined}
              disabled={item.disabled}
              className={item.danger ? "danger" : ""}
              onKeyDown={(e) => {
                if (
                  submenu &&
                  (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const button = e.currentTarget;
                  open(button);
                  requestAnimationFrame(() =>
                    button.parentElement
                      ?.querySelector<HTMLButtonElement>(
                        '[role="menu"] button:not(:disabled)',
                      )
                      ?.focus(),
                  );
                }
              }}
              onClick={(e) => {
                if (submenu) open(e.currentTarget);
                else {
                  close();
                  item.action?.();
                }
              }}
            >
              <span className="menu-leading" aria-hidden="true">
                {item.checked ? (
                  <Check size={13} />
                ) : (
                  <Icon size={13} strokeWidth={1.6} />
                )}
              </span>
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {!!submenu && <ChevronRight size={12} />}
            </button>
            {!!submenu && expanded === i && (
              <motion.div
                layout
                transition={transition}
                initial={{ opacity: 0, x: instant ? 0 : left ? 5 : -5 }}
                animate={{ opacity: 1, x: 0 }}
                className={`context-menu context-submenu ${left ? "opens-left" : ""}`}
                role="menu"
                aria-label={item.label}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpanded(null);
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(":scope > button")
                      ?.focus();
                  }
                  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const buttons = Array.from(
                        e.currentTarget.querySelectorAll<HTMLButtonElement>(
                          ":scope > .context-menu-entry > button:not(:disabled)",
                        ),
                      ),
                      index = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                    buttons[
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? buttons.length - 1
                          : (index +
                              (e.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                            buttons.length
                    ]?.focus();
                  }
                }}
              >
                <MenuEntries items={item.children!} close={close} />
              </motion.div>
            )}
          </div>
        );
      })}
    </>
  );
}
