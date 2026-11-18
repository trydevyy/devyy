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

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen, native } from "../lib/native";
import { accountRequest, syncOptions } from "../lib/account";

export interface ForwardedTunnel {
  id: string;
  port: number;
  label: string;
  url: string;
  visibility: "private" | "public";
  protocol: "http" | "https";
  connected: boolean;
}

export default function PortsPanel({
  onOpenAccount: _onOpenAccount,
}: {
  onOpenAccount?: () => void;
}) {
  const [tunnels, setTunnels] = useState<ForwardedTunnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // New port form state
  const [newPort, setNewPort] = useState<number | "">("");
  const [newProtocol, setNewProtocol] = useState<"http" | "https">("http");
  const [newVisibility, setNewVisibility] = useState<"private" | "public">("private");
  const [newLabel, setNewLabel] = useState("");

  async function refresh() {
    if (!native) return;
    setLoading(true);
    setError("");
    try {
      const list = await accountRequest<ForwardedTunnel[]>("/tunnels");
      setTunnels(list);
    } catch {
      setTunnels([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    let stops: (() => void)[] = [];
    let disposed = false;
    for (const event of ["devyy-remote-changed", "devyy-account-changed"]) {
      void listen(event, () => void refresh()).then((stop) =>
        disposed ? stop() : stops.push(stop),
      );
    }
    return () => {
      disposed = true;
      stops.forEach((s) => s());
    };
  }, []);

  async function work(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPort(e: React.FormEvent) {
    e.preventDefault();
    if (!newPort || typeof newPort !== "number") return;
    await work(async () => {
      let created: ForwardedTunnel;
      try {
        created = await accountRequest<ForwardedTunnel>("/tunnels", "POST", {
          port: newPort,
          label: newLabel.trim() || `localhost:${newPort}`,
          visibility: newVisibility,
          protocol: newProtocol,
        });
      } catch (err) {
        throw new Error(
          `Could not register port tunnel: ${String(err)}. Please verify your Devyy account sync is configured.`,
        );
      }

      const syncUrl = syncOptions().server.replace(/\/+$/, "");
      const wsUrl = syncUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:") + `/api/tunnels/${created.id}/ws`;

      await invoke("port_forward", {
        id: created.id,
        port: newPort,
        serverWsUrl: wsUrl,
        protocol: newProtocol,
      });

      setShowAdd(false);
      setNewPort("");
      setNewLabel("");
    });
  }

  async function toggleProtocol(t: ForwardedTunnel) {
    const nextProtocol = t.protocol === "http" ? "https" : "http";
    await work(async () => {
      await accountRequest(`/tunnels/${t.id}`, "PATCH", {
        protocol: nextProtocol,
      });
      await invoke("remote_stop", { id: t.id }).catch(() => {});
      const syncUrl = syncOptions().server.replace(/\/+$/, "");
      const wsUrl = syncUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:") + `/api/tunnels/${t.id}/ws`;
      await invoke("port_forward", {
        id: t.id,
        port: t.port,
        serverWsUrl: wsUrl,
        protocol: nextProtocol,
      });
    });
  }

  async function toggleVisibility(t: ForwardedTunnel) {
    const nextVisibility = t.visibility === "private" ? "public" : "private";
    await work(async () => {
      await accountRequest(`/tunnels/${t.id}`, "PATCH", {
        visibility: nextVisibility,
      });
    });
  }

  async function removeTunnel(t: ForwardedTunnel) {
    await work(async () => {
      await invoke("remote_stop", { id: t.id }).catch(() => {});
      await accountRequest(`/tunnels/${t.id}`, "DELETE").catch(() => {});
    });
  }

  async function reconnect(t: ForwardedTunnel) {
    await work(async () => {
      await invoke("remote_stop", { id: t.id }).catch(() => {});
      const syncUrl = syncOptions().server.replace(/\/+$/, "");
      const wsUrl = syncUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:") + `/api/tunnels/${t.id}/ws`;
      await invoke("port_forward", {
        id: t.id,
        port: t.port,
        serverWsUrl: wsUrl,
        protocol: t.protocol,
      });
    });
  }

  function copyAddress(id: string, url: string) {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  const filtered = tunnels.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      t.port.toString().includes(q) ||
      (t.label && t.label.toLowerCase().includes(q)) ||
      t.protocol.toLowerCase().includes(q) ||
      t.visibility.toLowerCase().includes(q) ||
      t.url.toLowerCase().includes(q)
    );
  });

  return (
    <div className="ports-panel">
      {/* Sub-header matching editor panel style */}
      <div className="ports-subbar">
        <div className="ports-subbar-left">
          <span className="ports-subbar-title">Forwarded Ports</span>
          <span className="ports-count-tag">{tunnels.length}</span>
          <div className="ports-filter-wrapper">
            <Search size={11} className="ports-filter-icon" />
            <input
              type="text"
              placeholder="Filter ports…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="ports-filter-input"
            />
            {filter && (
              <button
                type="button"
                className="ports-filter-clear"
                onClick={() => setFilter("")}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <div className="ports-subbar-actions">
          <button
            type="button"
            className="icon-button"
            title="Forward a Port"
            aria-label="Forward a Port"
            onClick={() => setShowAdd((v) => !v)}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Refresh"
            aria-label="Refresh ports"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Inline Add Port Form */}
      {showAdd && (
        <form className="ports-inline-form" onSubmit={handleAddPort}>
          <div className="ports-inline-inputs">
            <input
              type="number"
              placeholder="Port (e.g. 3000)"
              min={1}
              max={65535}
              autoFocus
              value={newPort}
              onChange={(e) =>
                setNewPort(e.target.value ? Number(e.target.value) : "")
              }
              className="ports-input port-number"
            />

            <select
              value={newProtocol}
              onChange={(e) => setNewProtocol(e.target.value as "http" | "https")}
              className="ports-select"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>

            <select
              value={newVisibility}
              onChange={(e) =>
                setNewVisibility(e.target.value as "private" | "public")
              }
              className="ports-select"
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>

            <input
              type="text"
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="ports-input port-label"
            />
          </div>

          <div className="ports-inline-actions">
            <button
              type="submit"
              className="ports-action-btn primary"
              disabled={busy || !newPort}
            >
              Forward Port
            </button>
            <button
              type="button"
              className="ports-action-btn ghost"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="ports-error-row">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {tunnels.length === 0 && !showAdd ? (
        <div className="panel-empty ports-empty">
          <span className="success-circle">
            <Radio size={14} />
          </span>
          <div>
            <strong>No forwarded ports</strong>
            <p>
              Forward local HTTP or HTTPS ports to access development servers remotely or share them with others.
            </p>
          </div>
          <button
            type="button"
            className="ports-empty-btn"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} /> Forward a Port
          </button>
        </div>
      ) : (
        <div className="ports-table-scroll">
          <table className="ports-table">
            <thead>
              <tr>
                <th style={{ width: "130px" }}>Port</th>
                <th style={{ width: "85px" }}>Protocol</th>
                <th>Forwarded Address</th>
                <th style={{ width: "110px" }}>Visibility</th>
                <th style={{ width: "100px" }}>Status</th>
                <th style={{ width: "80px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="ports-tr">
                  <td className="ports-td-port">
                    <span className="ports-mono-port">localhost:{t.port}</span>
                    {t.label && t.label !== `localhost:${t.port}` && (
                      <span className="ports-meta-label">{t.label}</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ports-tag-btn"
                      title={`Protocol: ${t.protocol.toUpperCase()}. Click to switch to ${t.protocol === "http" ? "HTTPS" : "HTTP"}`}
                      disabled={busy}
                      onClick={() => void toggleProtocol(t)}
                    >
                      {t.protocol.toUpperCase()}
                    </button>
                  </td>
                  <td className="ports-td-address">
                    <span className="ports-url" title={t.url}>
                      {t.url}
                    </span>
                    <button
                      type="button"
                      className="icon-button ports-mini-icon"
                      title="Copy Address"
                      aria-label="Copy Address"
                      onClick={() => copyAddress(t.id, t.url)}
                    >
                      {copiedId === t.id ? (
                        <Check size={12} className="ports-copied" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button ports-mini-icon"
                      title="Open in Browser"
                      aria-label="Open in Browser"
                      disabled={!t.connected}
                      onClick={() => void openUrl(t.url)}
                    >
                      <ExternalLink size={12} />
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`ports-vis-btn ${t.visibility}`}
                      title={`Visibility: ${t.visibility}. Click to switch to ${t.visibility === "private" ? "Public" : "Private"}`}
                      disabled={busy}
                      onClick={() => void toggleVisibility(t)}
                    >
                      {t.visibility === "private" ? (
                        <>
                          <Lock size={10} /> Private
                        </>
                      ) : (
                        <>
                          <Globe size={10} /> Public
                        </>
                      )}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`ports-dot-status ${t.connected ? "connected" : "offline"}`}
                    >
                      <span className="ports-status-dot" />
                      {t.connected ? "Connected" : "Offline"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="ports-cell-actions">
                      {!t.connected && (
                        <button
                          type="button"
                          className="ports-reconnect-btn"
                          disabled={busy}
                          onClick={() => void reconnect(t)}
                          title="Reconnect"
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button ports-delete-icon"
                        title={`Stop forwarding port ${t.port}`}
                        aria-label={`Stop forwarding port ${t.port}`}
                        disabled={busy}
                        onClick={() => void removeTunnel(t)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
