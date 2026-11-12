import { Check } from "lucide-react";
import { accents } from "../lib/palette";
import type { Settings } from "../lib/types";

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
      <label
        className="custom-accent"
        title="Custom accent"
        data-selected={settings.accent === "custom"}
      >
        <input
          type="color"
          aria-label="Custom accent color"
          value={settings.customAccent}
          onChange={(e) =>
            onChange({ accent: "custom", customAccent: e.target.value })
          }
        />
      </label>
    </div>
  );
}
