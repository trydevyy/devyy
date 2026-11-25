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

import ErrorToast from "./ui/ErrorToast";
import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { invoke, native } from "../lib/native";
import FileIcon from "./FileIcon";
interface Association {
  extension: string;
  mime: string;
  handler?: string;
  isDefault: boolean;
}
export default function DefaultApplications() {
  const [types, setTypes] = useState<Association[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    setBusy("refresh");
    try {
      setTypes((await invoke<Association[]>("default_app_status")) ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!native) return;
    const update = () => void refresh();
    update();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  async function change(extension: string) {
    setBusy(extension);
    setError("");
    setNotice("");
    try {
      const result = await invoke<{
        changed: boolean;
        openedSettings: boolean;
      }>("set_default_app", { extension });
      setNotice(
        result.openedSettings
          ? "Select Devyy in Windows Default apps to finish."
          : result.changed
            ? `Devyy is now the default for .${extension} files.`
            : "The system hasn’t confirmed the association. Install Devyy in Applications and try again.",
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function changeAll() {
    setBusy("all");
    setError("");
    setNotice("");
    try {
      const result = await invoke<{
        changed: boolean;
        openedSettings: boolean;
      }>("set_all_default_apps");
      setNotice(
        result.openedSettings
          ? "Select Devyy in Windows Default apps to finish setting all file types."
          : result.changed
            ? "Devyy is now the default application for supported file types."
            : "The system hasn’t confirmed the associations.",
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="default-applications">
      <header>
        <h3>Default applications</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            aria-busy={busy === "all"}
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() => void changeAll()}
          >
            <Check size={13} />
            Set all as default
          </button>
          <button
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </header>
      <p className="settings-note">
        Choose which file types open in Devyy.{" "}
        {/Win/.test(navigator.platform)
          ? "Finish the selection in Windows Default apps."
          : /Linux/.test(navigator.platform)
            ? "Defaults apply by MIME type."
            : ""}
      </p>
      {!native && (
        <p className="settings-note">
          Open the desktop app to configure file associations.
        </p>
      )}
      <div className="association-list">
        {types.map((type) => (
          <div className="association-row" key={type.extension}>
            <FileIcon path={`file.${type.extension}`} size={20} />
            <span className="association-label">
              <strong>.{type.extension}</strong>
              <small title={type.handler ?? ""}>
                {type.isDefault
                  ? "Opens in Devyy"
                  : type.handler || "System default"}
              </small>
            </span>
            <button
              className="setting-action"
              aria-busy={busy === type.extension}
              disabled={!!busy || type.isDefault}
              onClick={() => void change(type.extension)}
            >
              {type.isDefault ? (
                <Check size={13} />
              ) : (
                <ExternalLink size={13} />
              )}{" "}
              {type.isDefault ? "Default" : "Use Devyy"}
            </button>
          </div>
        ))}
      </div>
      {notice && (
        <p role="status" className="settings-note">
          {notice}
        </p>
      )}
      {error && <ErrorToast message={error} />}
    </div>
  );
}
