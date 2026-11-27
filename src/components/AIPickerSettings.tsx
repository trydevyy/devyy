import { useState } from "react";
import {
  aiPickerPreference,
  setAIPickerPreference,
  type AIPickerPreference,
} from "../lib/aiPickerPreferences";
import { showError } from "./ui/ErrorToast";

export default function AIPickerSettings() {
  return (
    <>
      <PickerSwitch
        preference="closeAfterSelection"
        label="Close model picker after a selection"
        description="Close when you choose a model or reasoning level."
      />
      <PickerSwitch
        preference="rememberReasoning"
        label="Remember reasoning per model"
        description="Restore your last reasoning level when you return to a model."
      />
    </>
  );
}

function PickerSwitch({
  preference,
  label,
  description,
}: {
  preference: AIPickerPreference;
  label: string;
  description: string;
}) {
  const [checked, setChecked] = useState(() => aiPickerPreference(preference));
  return (
    <div className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <button
        type="button"
        role="switch"
        className={`switch ${checked ? "on" : ""}`}
        aria-label={label}
        aria-checked={checked}
        onClick={() => {
          try {
            setAIPickerPreference(preference, !checked);
            setChecked(!checked);
          } catch (error) {
            showError(error);
          }
        }}
      >
        <span />
      </button>
    </div>
  );
}
