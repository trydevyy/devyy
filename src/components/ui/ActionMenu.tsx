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

import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export default function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
      >
        <MoreHorizontal size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="header-popover-content workbench-action-menu"
          aria-label={label}
          data-escape-scope="active"
          align="end"
          sideOffset={5}
          collisionPadding={8}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ActionMenuItem({
  children,
  label,
  disabled,
  danger,
  onClick,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Popover.Close
      type="button"
      className={`header-menu-item${danger ? " danger" : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Popover.Close>
  );
}
