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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Maximize2, Minus, MoreHorizontal, X } from "lucide-react";
import { native } from "../lib/native";
import type { MenuItem } from "./ContextMenu";
export interface HeaderMenu {
  label: string;
  items: MenuItem[];
}
export function DesktopMenuBar({
  menus,
  onMenu,
}: {
  menus: HeaderMenu[];
  onMenu: (event: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const container = useRef<HTMLElement>(null);
  const measures = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(menus.length);
  useLayoutEffect(() => {
    const node = container.current;
    const sample = measures.current;
    if (!node || !sample) return;
    const measure = () => {
      const widths = [...sample.children].map(
        (child) => child.getBoundingClientRect().width + 2,
      );
      const available = node.clientWidth;
      let used = 0,
        count = 0;
      for (let i = 0; i < widths.length; i++) {
        if (used + widths[i] + (i < widths.length - 1 ? 32 : 0) > available)
          break;
        used += widths[i];
        count++;
      }
      setVisible(count);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(sample);
    measure();
    return () => observer.disconnect();
  }, [menus.length]);
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
      {menus.slice(0, visible).map((menu) => (
        <button
          key={menu.label}
          aria-haspopup="menu"
          onClick={(event) => onMenu(event, menu.items)}
        >
          {menu.label}
        </button>
      ))}
      {visible < menus.length && (
        <button
          aria-label="More application menus"
          aria-haspopup="menu"
          onClick={(event) =>
            onMenu(
              event,
              menus
                .slice(visible)
                .map((menu) => ({ label: menu.label, children: menu.items })),
            )
          }
        >
          <MoreHorizontal size={16} />
        </button>
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
