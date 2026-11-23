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
import { categories, controls } from "../lib/settingsCatalog";
import DisclosureSummary from "./ui/DisclosureSummary";
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

const localPreferences = keys.map((key) => {
  const control = controls.find((item) => item.key === key);
  const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return {
    key,
    label:
      control?.label ??
      (key === "bindings"
        ? "Keyboard shortcuts"
        : label[0].toUpperCase() + label.slice(1)),
    category: control?.category ?? (key === "bindings" ? "shortcuts" : "other"),
  };
});

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
  const [filter, setFilter] = useState("");
  const visible = localPreferences.filter((item) =>
    item.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const groups = [...categories, { id: "other", label: "Other preferences" }]
    .map(({ id, label }) => ({
      label,
      items: visible.filter((item) => item.category === id),
    }))
    .filter(({ items }) => items.length > 0);
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
              <DisclosureSummary>
                Keep specific preferences on this device
                {!!options.excluded.length && (
                  <small>{options.excluded.length} selected</small>
                )}
              </DisclosureSummary>
              <div className="sync-exclusions">
                <input
                  className="text-input"
                  type="search"
                  aria-label="Find a preference"
                  placeholder="Find a preference"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
                {!options.settings && (
                  <p className="muted">
                    Turn on Editor preferences to choose what stays on this
                    device.
                  </p>
                )}
                {!groups.length && (
                  <p className="muted">No matching preferences.</p>
                )}
                {groups.map(({ label, items }) => (
                  <fieldset key={label} disabled={busy || !options.settings}>
                    <legend>{label}</legend>
                    <div>
                      {items.map(({ key, label }) => (
                        <label key={key} className="sync-check">
                          <input
                            type="checkbox"
                            checked={options.excluded.includes(key)}
                            onChange={(event) =>
                              update({
                                enabled: false,
                                excluded: event.target.checked
                                  ? [...options.excluded, key]
                                  : options.excluded.filter(
                                      (item) => item !== key,
                                    ),
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
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
