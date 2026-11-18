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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ChevronRight, Copy, Maximize2, Minus, MoreHorizontal, X } from "lucide-react";
import { native } from "../lib/native";
import type { MenuItem } from "./ContextMenu";

export interface HeaderMenu {
  label: string;
  items: MenuItem[];
}

function HeaderMenuItemRow({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setSubmenuOpen(true);
  };

  const handleLeave = () => {
    leaveTimer.current = setTimeout(() => {
      setSubmenuOpen(false);
    }, 120);
  };

  if (item.separator) {
    return <div className="header-menu-separator" role="separator" />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <Popover.Root open={submenuOpen} onOpenChange={setSubmenuOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="header-menu-item header-menu-parent"
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            <span className="header-menu-check-slot" />
            <span className="header-menu-item-label">{item.label}</span>
            <ChevronRight size={13} className="header-menu-arrow" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="header-popover-content header-subpopover-content"
            side="right"
            align="start"
            sideOffset={4}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {item.children.map((sub, idx) => (
              <HeaderMenuItemRow key={idx} item={sub} onClose={onClose} />
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <button
      type="button"
      className={`header-menu-item ${item.danger ? "danger" : ""}`}
      disabled={item.disabled}
      onClick={() => {
        if (!item.disabled) {
          onClose();
          item.action?.();
        }
      }}
    >
      <span className="header-menu-check-slot">
        {item.checked && <Check size={13} className="header-menu-checked" />}
      </span>
      <span className="header-menu-item-label">{item.label}</span>
      {item.shortcut && (
        <kbd className="header-menu-shortcut">{item.shortcut}</kbd>
      )}
    </button>
  );
}

export function DesktopMenuBar({
  menus,
  onMenu: _onMenu,
}: {
  menus: HeaderMenu[];
  onMenu?: (event: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const container = useRef<HTMLElement>(null);
  const measures = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(menus.length);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  useLayoutEffect(() => {
    const node = container.current;
    const sample = measures.current;
    if (!node || !sample) return;

    const measure = () => {
      // Calculate item widths from sample buttons or fallback to estimated width
      const widths = [...sample.children].map((child) => {
        const w = child.getBoundingClientRect().width;
        return w > 0 ? Math.ceil(w) + 6 : 48;
      });

      // Measure available width inside container
      let available = node.clientWidth;
      if (available <= 0 && node.parentElement) {
        available = node.parentElement.clientWidth - 180;
      }

      // If available width is not yet properly measured, show all menus by default
      if (available <= 60) {
        setVisible(menus.length);
        return;
      }

      const totalAllWidth = widths.reduce((a, b) => a + b, 0);
      if (available >= totalAllWidth) {
        setVisible(menus.length);
        return;
      }

      let used = 0;
      let count = 0;
      const moreReserve = 32;
      for (let i = 0; i < widths.length; i++) {
        if (used + widths[i] + moreReserve > available) {
          break;
        }
        used += widths[i];
        count++;
      }
      setVisible(Math.max(1, count));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.parentElement) {
      observer.observe(node.parentElement);
    }
    measure();
    return () => observer.disconnect();
  }, [menus]);

  const visibleMenus = menus.slice(0, visible);
  const overflowMenus = menus.slice(visible);

  return (
    <nav
      ref={container}
      className="desktop-menu-bar"
      aria-label="Application menu"
    >
      <div
        ref={measures}
        className="header-menu-measure"
        aria-hidden="true"
        inert
      >
        {menus.map((menu) => (
          <button key={menu.label}>{menu.label}</button>
        ))}
      </div>

      {visibleMenus.map((menu) => {
        const isOpen = activeMenu === menu.label;
        return (
          <Popover.Root
            key={menu.label}
            open={isOpen}
            onOpenChange={(open) => {
              setActiveMenu(open ? menu.label : null);
            }}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                className="desktop-menu-button"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onMouseEnter={() => {
                  if (activeMenu !== null) {
                    setActiveMenu(menu.label);
                  }
                }}
                onClick={() => {
                  setActiveMenu(isOpen ? null : menu.label);
                }}
              >
                {menu.label}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="header-popover-content"
                side="bottom"
                align="start"
                sideOffset={6}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {menu.items.map((item, idx) => (
                  <HeaderMenuItemRow
                    key={idx}
                    item={item}
                    onClose={() => setActiveMenu(null)}
                  />
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        );
      })}

      {overflowMenus.length > 0 && (
        <Popover.Root
          open={activeMenu === "more"}
          onOpenChange={(open) => {
            setActiveMenu(open ? "more" : null);
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="desktop-menu-button header-more-button"
              aria-label="More application menus"
              aria-haspopup="menu"
              aria-expanded={activeMenu === "more"}
              onMouseEnter={() => {
                if (activeMenu !== null) {
                  setActiveMenu("more");
                }
              }}
              onClick={() => {
                setActiveMenu(activeMenu === "more" ? null : "more");
              }}
            >
              <MoreHorizontal size={15} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="header-popover-content"
              side="bottom"
              align="start"
              sideOffset={6}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {overflowMenus.map((menu) => (
                <HeaderMenuItemRow
                  key={menu.label}
                  item={{
                    label: menu.label,
                    children: menu.items,
                  }}
                  onClose={() => setActiveMenu(null)}
                />
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </nav>
  );
}

export function NativeWindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!native) return;
    const current = getCurrentWindow();
    let stopped = false,
      stop: (() => void) | undefined;
    const sync = () =>
      void current.isMaximized().then((value) => {
        if (!stopped) setMaximized(value);
      });
    sync();
    void current.onResized(sync).then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }, []);
  const action = (name: "minimize" | "toggleMaximize" | "close") => {
    if (native) void getCurrentWindow()[name]();
  };
  return (
    <div className="native-window-controls" aria-label="Window controls">
      <button aria-label="Minimize window" onClick={() => action("minimize")}>
        <Minus size={15} />
      </button>
      <button
        aria-label={maximized ? "Restore window" : "Maximize window"}
        onClick={() => action("toggleMaximize")}
      >
        {maximized ? <Copy size={13} /> : <Maximize2 size={13} />}
      </button>
      <button
        aria-label="Close window"
        className="native-window-close"
        onClick={() => action("close")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
