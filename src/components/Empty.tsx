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

import type React from "react";
import { ArrowUpRight } from "lucide-react";

export interface EmptyProps {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: () => void;
  actionLabel?: string;
}

export default function Empty({
  icon,
  title,
  text,
  action,
  actionLabel = "Open a folder",
}: EmptyProps) {
  return (
    <div className="sidebar-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="secondary" onClick={action}>
        {actionLabel}
        <ArrowUpRight size={13} />
      </button>
    </div>
  );
}
