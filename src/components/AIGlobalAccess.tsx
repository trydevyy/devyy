import { useEffect, useState } from "react";
import { invoke, native } from "../lib/native";
import { useConfirm } from "./ui/Confirm";
import { showError } from "./ui/ErrorToast";

export default function AIGlobalAccess() {
  const [full, setFull] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    if (!native) return;
    let mounted = true;
    void invoke<boolean>("ai_workspace_default", { full: null })
      .then((value) => {
        if (mounted) setFull(value === true);
      })
      .catch((error) => {
        if (mounted) showError(error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function change() {
    const next = !full;
    setBusy(true);
    try {
      if (
        next &&
        !(await confirm({
          title: "Allow full agent access in all workspaces?",
          description:
            "The agent can read workspace files, including secrets, and run workspace commands where supported. You can still restrict access from the agent menu for an individual workspace. This preference is stored on this device.",
          confirmLabel: "Allow full access",
        }))
      )
        return;
      setFull(await invoke<boolean>("ai_workspace_default", { full: next }));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setting-row">
      <span>
        <strong>Full workspace access by default</strong>
        <small>
          Applies on this device. Workspace-specific permissions take
          precedence.
        </small>
      </span>
      <button
        type="button"
        role="switch"
        className={`switch ${full ? "on" : ""}`}
        aria-label="Full workspace access by default"
        aria-checked={full === true}
        disabled={!native || full === undefined || busy}
        onClick={() => void change()}
      >
        <span />
      </button>
    </div>
  );
}
