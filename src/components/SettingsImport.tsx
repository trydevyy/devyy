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

import IDEIcon from "./IDEIcon";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FileCode2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { invoke, native } from "../lib/native";
import {
  translateSettings,
  type ImportData,
  type ImportSource,
} from "../lib/settingsImport";
import { controls } from "../lib/settingsCatalog";
import type { Settings } from "../lib/types";
export default function SettingsImport({
  settings,
  onChange,
  onSuggestions,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onSuggestions?: (ids: string[]) => void;
}) {
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ImportData | null>(null);
  const [applied, setApplied] = useState(false);
  async function discover() {
    setBusy(true);
    setError("");
    try {
      setSources(
        native ? await invoke<ImportSource[]>("detect_ide_settings") : [],
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void discover();
  }, []);
  const preview = data ? translateSettings(data, settings) : null;
  return (
    <div className="settings-import">
      <p className="settings-note">
        Bring over compatible appearance, editor, saving, terminal, and keyboard
        preferences. Review and apply the settings you want to keep.
      </p>
      {busy ? (
        <p className="import-progress">
          <LoaderCircle size={14} className="spinning" /> Looking for installed
          editors…
        </p>
      ) : (
        <div className="import-sources">
          {sources.map((source) => (
            <button
              disabled={busy}
              className={data?.name === source.name ? "selected" : ""}
              key={source.id}
              onClick={() => {
                setBusy(true);
                setError("");
                setApplied(false);
                void invoke<ImportData>("read_ide_settings", { id: source.id })
                  .then(setData)
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <IDEIcon id={source.id} />
              <span>
                <strong>{source.name}</strong>
                <small>{source.path}</small>
              </span>
              <ArrowDownToLine size={15} />
            </button>
          ))}
        </div>
      )}
      {!busy && !sources.length && (
        <div className="import-empty">
          <FileCode2 size={24} />
          <strong>
            {native
              ? "No editor settings found"
              : "Available in the desktop app"}
          </strong>
          <p>
            Looks for VS Code, VS Code Insiders, Cursor, Windsurf, VSCodium, and
            Zed in their standard user configuration folders.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {preview && data && (
        <section className="import-preview" aria-label="Import preview">
          <h4>{data.name} preferences</h4>
          {preview.changes.length ? (
            <dl>
              {preview.changes.map((key) => (
                <div key={key}>
                  <dt>
                    {controls.find((c) => c.key === key)?.label ??
                      (key === "bindings" ? "Keyboard shortcuts" : key)}
                  </dt>
                  <dd>
                    {key === "bindings"
                      ? `${Object.keys(preview.patch.bindings ?? {}).length} assignments`
                      : String(preview.patch[key as keyof Settings])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>
              {applied
                ? "Preferences imported."
                : "Your compatible preferences already match."}
            </p>
          )}
          {preview.notes.map((note) => (
            <p className="settings-note" key={note}>
              {note}
            </p>
          ))}
          {!!data.extensions.length && (
            <p className="settings-note">
              {data.extensions.length} extensions found. You can browse matching
              packages on Open VSX in the next step.
            </p>
          )}
          <button
            className="primary"
            disabled={!preview.changes.length || applied}
            onClick={() => {
              onChange(preview.patch);
              onSuggestions?.(data.extensions);
              setApplied(true);
              toast.success(`Imported ${data.name} preferences`);
            }}
          >
            {applied ? <Check size={13} /> : <ArrowDownToLine size={13} />}{" "}
            {applied
              ? "Imported"
              : `Import ${preview.changes.length} preferences`}
          </button>
        </section>
      )}
      {!busy && (
        <button
          className="setting-action import-rescan"
          onClick={() => void discover()}
        >
          <RefreshCw size={13} /> Scan again
        </button>
      )}
    </div>
  );
}
