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

import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
export default function AIPanelToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const changed = (event: Event) =>
      setOpen((event as CustomEvent<boolean>).detail);
    window.addEventListener("devyy-ai-visibility", changed);
    return () => window.removeEventListener("devyy-ai-visibility", changed);
  }, []);
  return (
    <button
      aria-label="Toggle AI workspace"
      title="Toggle AI workspace"
      aria-pressed={open}
      onClick={() => window.dispatchEvent(new CustomEvent("devyy-ai-toggle"))}
    >
      <PanelRight size={16} />
    </button>
  );
}
