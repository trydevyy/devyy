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

import { Check } from "lucide-react";
import { accents } from "../lib/palette";
import type { Settings } from "../lib/types";
import ColorPicker from "./ui/ColorPicker";

export default function AccentPicker({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="accent-picker" role="group" aria-label="Accent color">
      {accents.map((accent) => (
        <button
          key={accent.id}
          title={accent.name}
          aria-label={`${accent.name} accent`}
          aria-pressed={settings.accent === accent.id}
          style={
            {
              "--swatch": accent[settings.theme === "paper" ? "light" : "dark"],
            } as React.CSSProperties
          }
          onClick={() => onChange({ accent: accent.id })}
        >
          {settings.accent === accent.id && <Check size={13} />}
        </button>
      ))}
      <ColorPicker
        value={settings.customAccent}
        onChange={(value) =>
          onChange({ accent: "custom", customAccent: value })
        }
      />
    </div>
  );
}
