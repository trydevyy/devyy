import { useState, type Dispatch, type SetStateAction } from "react";
import { ExternalLink, LogOut, CloudDownload, CloudUpload } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  accountRequest,
  pullCloud,
  pushCloud,
  useSyncOptions,
  saveSyncOptions,
  type Cloud,
} from "../lib/account";
import { invoke, native } from "../lib/native";
import { useExtensions } from "../lib/extensions";
import type { Settings } from "../lib/types";
import keys from "../lib/accountSyncKeys.json";
import AccountSignIn, { useAccountProfile } from "./AccountSignIn";
import { showError } from "./ui/ErrorToast";

const choices = [
  [
    "settings",
    "Editor preferences",
    "Appearance, keyboard shortcuts, and editor settings.",
  ],
  ["extensions", "Extensions", "Installed extensions and their enabled state."],
  [
    "installExtensions",
    "Install missing extensions",
    "Install extensions when applying settings from your account.",
  ],
] as const;

export default function AccountSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: Dispatch<SetStateAction<Settings>>;
}) {
  const profile = useAccountProfile();
  const options = useSyncOptions();
  const extensions = useExtensions();
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<typeof options>) =>
    saveSyncOptions({ ...options, ...patch });
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workbench-settings" aria-label="Devyy account">
      <AccountSignIn profile={profile} />
      {!native && (
        <p className="workbench-muted">
          Sign-in is available in the desktop app.
        </p>
      )}
      {profile && (
        <>
          <div className="workbench-actions">
            <button
              className="setting-action"
              onClick={() =>
                void perform(() => openUrl("https://www.devyy.dev/account/"))
              }
            >
              Manage account <ExternalLink size={13} />
            </button>
            <button
              className="setting-action"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await invoke("account_disconnect");
                  update({ enabled: false });
                  window.dispatchEvent(new Event("devyy-account-changed"));
                  toast.success("Signed out of Devyy");
                })
              }
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
          <section
            className="workbench-settings-section"
            aria-labelledby="sync-title"
          >
            <header>
              <div>
                <h3 id="sync-title">Sync this device</h3>
                <p>
                  {options.enabled
                    ? "Automatic sync is on."
                    : "Choose which settings to keep in sync."}
                </p>
              </div>
              {options.enabled && (
                <button
                  className="setting-action"
                  disabled={busy}
                  onClick={() => update({ enabled: false })}
                >
                  Pause sync
                </button>
              )}
            </header>
            {choices.map(([key, label, help]) => (
              <label key={key} className="workbench-setting-line">
                <span>
                  <strong>{label}</strong>
                  <small>{help}</small>
                </span>
                <input
                  type="checkbox"
                  checked={options[key]}
                  disabled={
                    busy || (key === "installExtensions" && !options.extensions)
                  }
                  onChange={(event) =>
                    update({ [key]: event.target.checked, enabled: false })
                  }
                />
              </label>
            ))}
            <details className="workbench-exclusions">
              <summary>Keep specific preferences on this device</summary>
              <div className="sync-exclusions">
                {keys.map((key) => (
                  <label key={key} className="sync-check">
                    <input
                      type="checkbox"
                      checked={options.excluded.includes(key)}
                      disabled={busy || !options.settings}
                      onChange={(event) =>
                        update({
                          enabled: false,
                          excluded: event.target.checked
                            ? [...options.excluded, key]
                            : options.excluded.filter((item) => item !== key),
                        })
                      }
                    />{" "}
                    {key.replace(/([A-Z])/g, " $1")}
                  </label>
                ))}
              </div>
            </details>
            <footer className="workbench-actions">
              <button
                className="setting-action"
                disabled={busy || !(options.settings || options.extensions)}
                onClick={() =>
                  void perform(async () => {
                    await pushCloud(settings, extensions, options);
                    update({ enabled: true });
                    toast.success(
                      "Device settings uploaded. Automatic sync is on.",
                    );
                  })
                }
              >
                <CloudUpload size={14} /> Upload from this device
              </button>
              <button
                className="setting-action"
                disabled={busy || !(options.settings || options.extensions)}
                onClick={() =>
                  void perform(async () => {
                    const cloud = await accountRequest<Cloud>("/sync");
                    await pullCloud(
                      cloud,
                      settings,
                      onChange,
                      extensions,
                      options,
                    );
                    update({ enabled: true });
                    toast.success(
                      "Account settings applied. Automatic sync is on.",
                    );
                  })
                }
              >
                <CloudDownload size={14} /> Apply account settings
              </button>
            </footer>
          </section>
        </>
      )}
    </section>
  );
}
