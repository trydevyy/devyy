import { useEffect, useState } from "react";
import { invoke, native } from "../lib/native";
import { showError } from "./ui/ErrorToast";

export default function HardwareAcceleration() {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const mac = document.documentElement.dataset.platform === "macos";

  useEffect(() => {
    if (native && !mac)
      void invoke<boolean>("hardware_acceleration")
        .then(setEnabled)
        .catch(showError);
  }, [mac]);

  if (!native) return null;
  return (
    <div className="setting-row">
      <span>
        <strong>Hardware acceleration</strong>
        <small>
          {mac
            ? "macOS manages the graphics renderer for Devyy."
            : changed
              ? "Restart Devyy to apply this change."
              : "Use the GPU for rendering when supported. Changes take effect after restart."}
        </small>
      </span>
      {mac ? (
        <span>System managed</span>
      ) : (
        <button
          className={`switch ${enabled ? "on" : ""}`}
          role="switch"
          aria-label="Hardware acceleration"
          aria-checked={enabled ?? true}
          disabled={busy || enabled === undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke("set_hardware_acceleration", { enabled: !enabled });
              setEnabled(!enabled);
              setChanged(true);
            } catch (error) {
              showError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span />
        </button>
      )}
    </div>
  );
}
