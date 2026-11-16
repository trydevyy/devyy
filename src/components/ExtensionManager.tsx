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

import { useEffect, useRef, useState } from "react";
import {
  Blocks,
  Check,
  Download,
  FolderOpen,
  LoaderCircle,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import ExtensionProgress, { ExtensionInstallLabel } from "./ExtensionProgress";
import {
  installExtension,
  installLocalExtension,
  repairExtensionDependencies,
  useExtensionInstallId,
} from "../lib/extensionInstall";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useExtensionHost, syncExtensionHost } from "../lib/extensionHost";
import { invoke, native } from "../lib/native";
import {
  capabilities,
  refreshExtensions,
  useExtensions,
  type RegistryExtension,
} from "../lib/extensions";
export default function ExtensionManager({
  suggested = [],
}: {
  suggested?: string[];
}) {
  const installed = useExtensions();
  const host = useExtensionHost();
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryExtension[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [localBusy, setBusy] = useState("");
  const installId = useExtensionInstallId();
  const busy = localBusy || installId;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    void refreshExtensions().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (tab !== "browse" || !native) return;
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void invoke<{ extensions: RegistryExtension[]; totalSize: number }>(
        "search_extensions",
        { query, offset },
      )
        .then((data) => {
          if (current === sequence.current) {
            setResults(data.extensions ?? []);
            setTotal(data.totalSize ?? 0);
          }
        })
        .catch((e) => {
          if (current === sequence.current) setError(String(e));
        })
        .finally(() => {
          if (current === sequence.current) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [query, tab, offset, retry]);
  async function action(
    id: string,
    command: string,
    args: Record<string, unknown> = {},
  ) {
    if (command !== "install_extension") setBusy(id);
    try {
      if (command === "install_extension") await installExtension(id);
      else if (command === "repair_dependencies")
        await repairExtensionDependencies(id);
      else if (command === "install_vsix")
        await installLocalExtension(String(args.path));
      else {
        await invoke(command, { id, ...args });
        await refreshExtensions();
      }
      toast.success(
        command === "uninstall_extension"
          ? "Extension removed"
          : command === "repair_dependencies"
            ? "Dependencies repaired"
            : command === "set_extension_enabled"
              ? "Extension updated"
              : "Extension installed",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  const filtered = installed.filter((e) =>
    `${e.id} ${e.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="extensions-manager">
      <div className="extensions-toolbar">
        <div className="segmented" role="tablist" aria-label="Extension source">
          <button
            role="tab"
            aria-selected={tab === "browse"}
            onClick={() => {
              setTab("browse");
              setOffset(0);
            }}
          >
            Open VSX
          </button>
          <button
            role="tab"
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >
            Installed <span>{installed.length}</span>
          </button>
        </div>
        <button
          className="setting-action"
          disabled={!native || !!busy}
          onClick={() => {
            void open({
              multiple: false,
              filters: [{ name: "VS Code extension", extensions: ["vsix"] }],
            })
              .then((path) => {
                if (typeof path === "string")
                  void action("local-vsix", "install_vsix", { path });
              })
              .catch((e) => toast.error(String(e)));
          }}
        >
          <FolderOpen size={13} /> Install VSIX
        </button>
      </div>
      <label className="extensions-search">
        <Search size={15} />
        <input
          type="search"
          aria-label="Search extensions"
          placeholder={
            tab === "browse"
              ? "Search Open VSX…"
              : "Filter installed extensions…"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        {loading && <LoaderCircle size={14} className="spinning" />}
        {query && (
          <button
            aria-label="Clear extension search"
            onClick={() => {
              setQuery("");
              setOffset(0);
            }}
          >
            <X size={13} />
          </button>
        )}
      </label>
      {tab === "browse" && !!suggested.length && (
        <div className="extension-suggestions">
          <span>From your editor</span>
          {suggested.slice(0, 8).map((id) => (
            <button
              key={id}
              onClick={() => {
                setQuery(id);
                setOffset(0);
              }}
            >
              {id}
            </button>
          ))}
        </div>
      )}
      {!native ? (
        <div className="extensions-empty">
          <Blocks size={28} />
          <strong>Extensions live on your machine</strong>
          <p>
            Open the desktop app to browse Open VSX and install extension
            packages.
          </p>
        </div>
      ) : error ? (
        <div className="extensions-error" role="status">
          <p>{error}</p>
          <button
            className="setting-action"
            onClick={() => setRetry((n) => n + 1)}
          >
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : null}
      {tab === "browse" && native && !error && (
        <div
          className={`extensions-list ${loading ? "is-loading" : ""}`}
          aria-busy={loading}
        >
          {results.map((extension) => {
            const id = `${extension.namespace}.${extension.name}`;
            const local = installed.find(
              (e) => e.id.toLowerCase() === id.toLowerCase(),
            );
            const update = local && local.version !== extension.version;
            return (
              <article className="extension-row" key={id}>
                <div className="extension-icon">
                  {extension.files?.icon?.startsWith(
                    "https://open-vsx.org/",
                  ) ? (
                    <img
                      src={extension.files.icon}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Blocks size={20} />
                  )}
                </div>
                <div className="extension-description">
                  <strong>{extension.displayName ?? extension.name}</strong>
                  <span>
                    {extension.namespace} <small>v{extension.version}</small>
                  </span>
                  <p>{extension.description}</p>
                  <small>
                    {extension.downloadCount === undefined
                      ? "Downloads unavailable"
                      : `${extension.downloadCount.toLocaleString()} downloads`}
                  </small>
                  <ExtensionProgress
                    id={id}
                    name={extension.displayName ?? extension.name}
                  />
                </div>
                <button
                  className={`extension-install ${local && !update ? "installed" : ""}`}
                  disabled={!!busy || (!!local && !update)}
                  onClick={() => void action(id, "install_extension")}
                >
                  {busy.toLowerCase() === id.toLowerCase() ? (
                    <LoaderCircle size={13} className="spinning" />
                  ) : local && !update ? (
                    <Check size={13} />
                  ) : (
                    <Download size={13} />
                  )}
                  {busy.toLowerCase() === id.toLowerCase() ? (
                    <ExtensionInstallLabel id={id} />
                  ) : update ? (
                    "Update"
                  ) : local ? (
                    "Installed"
                  ) : (
                    "Install"
                  )}
                </button>
              </article>
            );
          })}
          {!results.length && !loading && (
            <p className="muted">
              No extensions found. Try a language or publisher.
            </p>
          )}
          {total > 24 && (
            <div className="extension-pagination">
              <button
                disabled={loading || offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 24))}
              >
                Previous
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 24, total)} of{" "}
                {total.toLocaleString()}
              </span>
              <button
                disabled={loading || offset + 24 >= total}
                onClick={() => setOffset((n) => n + 24)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "installed" && (
        <div className="extensions-list">
          {filtered.map((extension) => {
            const support = capabilities(extension);
            const runtime = host.statuses.find(
              (s) => s.id.toLowerCase() === extension.id.toLowerCase(),
            );
            return (
              <article className="extension-row" key={extension.id}>
                <div className="extension-icon">
                  <Blocks size={20} />
                  {extension.icon?.startsWith("data:image/") && (
                    <img
                      src={extension.icon}
                      alt={`${extension.name} icon`}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.hidden = true;
                      }}
                    />
                  )}
                </div>
                <div className="extension-description">
                  <strong>
                    {extension.name}
                    {!extension.enabled && <em>Disabled</em>}
                  </strong>
                  <span>
                    {extension.id} <small>v{extension.version}</small>
                  </span>
                  <p>{extension.description}</p>
                  <ExtensionProgress id={extension.id} name={extension.name} />
                  <div className="extension-capabilities">
                    {support.supported.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  {support.requiresHost && (
                    <small className="extension-runtime-note">
                      {runtime?.status === "error"
                        ? runtime.error
                        : runtime?.status === "active"
                          ? "Running"
                          : "Starts when you use its language, commands, or views. Some features may require APIs Devyy does not support yet."}
                    </small>
                  )}
                </div>
                <div className="extension-actions">
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void action(extension.id, "set_extension_enabled", {
                        enabled: !extension.enabled,
                      })
                    }
                  >
                    {extension.enabled ? "Disable" : "Enable"}
                  </button>
                  {!!(
                    extension.extensionDependencies?.length ||
                    extension.extensionPack?.length
                  ) && (
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void action(extension.id, "repair_dependencies")
                      }
                    >
                      Repair dependencies
                    </button>
                  )}
                  {extension.enabled && runtime?.status === "error" && (
                    <button
                      disabled={!!busy}
                      onClick={() => {
                        void syncExtensionHost().catch((e) =>
                          toast.error(String(e)),
                        );
                      }}
                    >
                      Restart host
                    </button>
                  )}
                  {extension.installPath && (
                    <button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(extension.installPath!)
                          .then(() => toast.success("Extension path copied"))
                          .catch(() => toast.error("Could not copy path"))
                      }
                    >
                      Copy path
                    </button>
                  )}
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void action(extension.id, "uninstall_extension")
                    }
                  >
                    Uninstall
                  </button>
                </div>
              </article>
            );
          })}
          {!filtered.length && (
            <div className="extensions-empty">
              <Blocks size={28} />
              <strong>
                {installed.length
                  ? "No matching extensions"
                  : "No extensions installed"}
              </strong>
              <p>Browse Open VSX or install a local .vsix package.</p>
            </div>
          )}
        </div>
      )}
      <p className="extensions-footnote">
        Bundled language servers are detected automatically. Commands, tree
        views, and webviews use the Devyy API adapter. JavaScript extensions
        require Node.js 20 or newer and run with your local account’s
        permissions.
      </p>
    </div>
  );
}
