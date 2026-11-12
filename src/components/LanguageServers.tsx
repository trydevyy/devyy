import { useEffect, useState } from "react";
import { Check, Plus, RotateCcw, Save, Search, X } from "lucide-react";
import { toast } from "sonner";
import { native } from "../lib/native";
import {
  refreshLanguageServers,
  saveServer,
  type ServerConfig,
} from "../lib/languageServers";
const empty: ServerConfig = {
  language: "",
  command: "",
  args: [],
  initializationOptions: null,
  settings: null,
  enabled: true,
  custom: true,
};
export default function LanguageServers() {
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [edit, setEdit] = useState<ServerConfig | null>(null);
  const [args, setArgs] = useState("[]");
  const [options, setOptions] = useState("{}");
  const [config, setConfig] = useState("{}");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void refreshLanguageServers()
      .then(setServers)
      .catch((e) => setError(String(e)));
  }, []);
  function choose(server: ServerConfig) {
    setEdit({ ...server });
    setArgs(JSON.stringify(server.args));
    setOptions(JSON.stringify(server.initializationOptions ?? {}, null, 2));
    setConfig(JSON.stringify(server.settings ?? {}, null, 2));
    setError("");
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string"))
        throw new Error("Arguments must be a JSON array of strings.");
      await saveServer(edit.language, {
        ...edit,
        args: parsed,
        initializationOptions: JSON.parse(options),
        settings: JSON.parse(config),
      });
      setServers(await refreshLanguageServers());
      setEdit(null);
      toast.success("Language server saved");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="language-servers">
      <p className="settings-note">
        Compatible bundled servers and servers registered by extensions are
        added automatically. Your configuration takes priority. Other servers
        can run from your PATH or an absolute path using LSP over standard input
        and output.
      </p>
      {!native && (
        <p className="settings-note">
          Language server configuration is available in the desktop app.
        </p>
      )}
      <div className="extensions-toolbar">
        <label className="extensions-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="Filter languages…"
            aria-label="Filter language servers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="setting-action"
          disabled={!native || !!edit}
          onClick={() => choose(empty)}
        >
          <Plus size={13} /> Add server
        </button>
      </div>
      {edit ? (
        <form
          className="server-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="server-edit-heading">
            <h4>
              {edit.language
                ? `${edit.language} server`
                : "New language server"}
            </h4>
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel server editing"
              onClick={() => setEdit(null)}
            >
              <X size={15} />
            </button>
          </div>
          <label>
            Language identifier
            <input
              autoFocus
              required
              placeholder="e.g. rust, go, python"
              value={edit.language}
              onChange={(e) => setEdit({ ...edit, language: e.target.value })}
            />
          </label>
          <label>
            Executable
            <input
              required
              placeholder="gopls or /path/to/server"
              value={edit.command}
              onChange={(e) => setEdit({ ...edit, command: e.target.value })}
            />
          </label>
          <label>
            Arguments <small>JSON array</small>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={'["--stdio"]'}
            />
          </label>
          <details>
            <summary>Server configuration</summary>
            <label>
              Initialization options
              <textarea
                rows={5}
                spellCheck={false}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </label>
            <label>
              Workspace settings
              <textarea
                rows={5}
                spellCheck={false}
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </label>
          </details>
          <label className="server-checkbox">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />{" "}
            Enable this language server
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="server-edit-actions">
            <button className="primary" disabled={busy} type="submit">
              <Save size={13} /> Save server
            </button>
            <button
              type="button"
              className="setting-action"
              onClick={() => setEdit(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          {error && <p role="alert">{error}</p>}
          {servers
            .filter((s) =>
              `${s.language} ${s.command}`.includes(query.toLowerCase()),
            )
            .map((server) => (
              <div className="server-row" key={server.language}>
                <span>
                  <strong>{server.language}</strong>
                  {server.source && (
                    <small className="server-source">
                      From {server.source}
                      {server.custom ? " (customized)" : ""}
                    </small>
                  )}
                  <code>
                    {server.command}
                    {server.args.length ? ` ${server.args.join(" ")}` : ""}
                  </code>
                </span>
                <small>
                  {server.enabled ? (
                    <>
                      <Check size={11} /> Enabled
                    </>
                  ) : (
                    "Disabled"
                  )}
                </small>
                <button
                  className="setting-action"
                  onClick={() => choose(server)}
                >
                  Configure
                </button>
                {server.custom && (
                  <button
                    className="icon-button"
                    title="Reset server"
                    aria-label={`Reset ${server.language} server`}
                    onClick={() => {
                      void saveServer(server.language, null)
                        .then(() => refreshLanguageServers())
                        .then(setServers)
                        .catch((e) => setError(String(e)));
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
