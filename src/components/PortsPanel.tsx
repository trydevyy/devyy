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

import Empty from "./Empty";
import { writeClipboardText } from "../lib/clipboard";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { toast } from "sonner";
import ActionMenu, { ActionMenuItem } from "./ui/ActionMenu";
import Select from "./ui/Select";
import { DialogToastHost, showError } from "./ui/ErrorToast";
import { useConfirm } from "./ui/Confirm";
import { useAccountProfile } from "./AccountSignIn";
import { accountRequest } from "../lib/account";

export interface ForwardedTunnel {
  id: string;
  port: number;
  label: string;
  url: string;
  visibility: "private" | "public";
  protocol: "http" | "https";
  connected: boolean;
}

const PORT_STATUS_INTERVAL_MS = 10_000;

export default function PortsPanel({
  onOpenAccount,
  active = true,
}: {
  onOpenAccount?: () => void;
  active?: boolean;
}) {
  const [tunnels, setTunnels] = useState<ForwardedTunnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const profile = useAccountProfile();
  const account = profile?.email;
  const signedIn = Boolean(account);
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // New port form state
  const [newPort, setNewPort] = useState<number | "">("");
  const [newProtocol, setNewProtocol] = useState<"http" | "https">("http");
  const [newVisibility, setNewVisibility] = useState<"private" | "public">(
    "private",
  );
  const [newLabel, setNewLabel] = useState("");

  const refreshVersion = useRef(0);
  const polling = useRef(false);
  const refresh = useCallback(
    async (quiet = false) => {
      const version = ++refreshVersion.current;
      if (!native || !account) {
        setTunnels([]);
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      polling.current = true;
      try {
        const list = await accountRequest<ForwardedTunnel[]>("/tunnels");
        if (version === refreshVersion.current)
          setTunnels(Array.isArray(list) ? list : []);
      } catch (cause) {
        if (!quiet && version === refreshVersion.current) showError(cause);
      } finally {
        if (version === refreshVersion.current) {
          polling.current = false;
          setLoading(false);
        }
      }
    },
    [account],
  );

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    // Opening the panel mounts it for the first time. Defer the initial read
    // so an immediately disposed setup cannot issue a duplicate request.
    queueMicrotask(() => {
      if (!disposed) void refresh();
    });
    if (!native || !signedIn)
      return () => {
        disposed = true;
      };
    let stop: (() => void) | undefined;
    void listen("devyy-remote-changed", () => void refresh(true))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(showError);
    const interval = window.setInterval(() => {
      if (!polling.current && document.visibilityState === "visible")
        void refresh(true);
    }, PORT_STATUS_INTERVAL_MS);
    return () => {
      disposed = true;
      refreshVersion.current++;
      polling.current = false;
      window.clearInterval(interval);
      stop?.();
    };
  }, [active, refresh, signedIn]);

  async function work(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPort(e: React.FormEvent) {
    e.preventDefault();
    if (!newPort || typeof newPort !== "number") return;
    if (!native) {
      showError("Open Devyy on your desktop to forward a port.");
      return;
    }
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

      try {
        await invoke("port_forward", {
          tunnelId: created.id,
          port: newPort,
          protocol: newProtocol,
        });
      } catch (cause) {
        try {
          await accountRequest(`/tunnels/${created.id}`, "DELETE");
        } catch {
          throw new Error(
            "The port could not connect. Refresh the list to manage the registered tunnel.",
          );
        }
        throw cause;
      }

      setShowAdd(false);
      setNewPort("");
      setNewLabel("");
      setNewVisibility("private");
      setNewProtocol("http");
      toast.success(`Forwarding localhost:${newPort}`);
    });
  }

  async function toggleProtocol(t: ForwardedTunnel) {
    const nextProtocol = t.protocol === "http" ? "https" : "http";
    await work(async () => {
      await accountRequest(`/tunnels/${t.id}`, "PATCH", {
        protocol: nextProtocol,
      });
      await invoke("remote_stop", { id: `port-${t.id}` });
      await invoke("port_forward", {
        tunnelId: t.id,
        port: t.port,
        protocol: nextProtocol,
      });
    });
  }

  async function toggleVisibility(t: ForwardedTunnel) {
    const nextVisibility = t.visibility === "private" ? "public" : "private";
    if (
      nextVisibility === "public" &&
      !(await confirm({
        title: "Make this port public?",
        description:
          "Anyone with the forwarded address will be able to open it.",
        confirmLabel: "Make public",
      }))
    )
      return;
    await work(async () => {
      await accountRequest(`/tunnels/${t.id}`, "PATCH", {
        visibility: nextVisibility,
      });
    });
  }

  async function removeTunnel(t: ForwardedTunnel) {
    if (
      !(await confirm({
        title: `Stop sharing port ${t.port}?`,
        description: "Its forwarded address will stop working.",
        confirmLabel: "Stop sharing",
        danger: true,
      }))
    )
      return;
    await work(async () => {
      await invoke("remote_stop", { id: `port-${t.id}` });
      await accountRequest(`/tunnels/${t.id}`, "DELETE");
    });
  }

  async function reconnect(t: ForwardedTunnel) {
    await work(async () => {
      await invoke("remote_stop", { id: `port-${t.id}` });
      await invoke("port_forward", {
        tunnelId: t.id,
        port: t.port,
        protocol: t.protocol,
      });
    });
  }

  function copyAddress(id: string, url: string) {
    void writeClipboardText(url)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1800);
      })
      .catch(showError);
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
    <section
      className="ports-panel ports-workbench"
      aria-label="Forwarded ports"
    >
      {tunnels.length > 0 && (
        <div className="ports-workbench-toolbar">
          <label className="ssh-filter">
            <Search size={14} />
            <input
              aria-label="Filter ports"
              placeholder="Filter ports"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {(!native || signedIn) && (
            <button className="setting-action" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> Forward a port
            </button>
          )}
          <button
            className="icon-button"
            title="Refresh ports"
            aria-label="Refresh ports"
            aria-busy={loading}
            disabled={loading || !signedIn}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {!tunnels.length ? (
        <Empty
          panel
          icon={<Radio size={28} />}
          title={loading ? "Loading ports…" : "No forwarded ports"}
          text={
            native && !signedIn
              ? "Sign in to your Devyy account to forward a local port."
              : "Forward a local HTTP or HTTPS service to share it from Devyy."
          }
          action={
            loading
              ? undefined
              : native && !signedIn
                ? onOpenAccount
                : () => setShowAdd(true)
          }
          actionLabel={
            native && !signedIn ? "Open Account & sync" : "Forward a port"
          }
          actionIcon={native && !signedIn ? undefined : <Plus size={13} />}
        />
      ) : (
        !filtered.length && (
          <Empty
            panel
            icon={<Search size={28} />}
            title="No matching ports"
            text="Try a different port number, label, or address."
            action={() => setFilter("")}
            actionLabel="Clear filter"
            actionIcon={<X size={13} />}
          />
        )
      )}
      {filtered.length > 0 && (
        <ul className="ports-workbench-list">
          {filtered.map((port) => (
            <li key={port.id}>
              <div className="port-endpoint" title={`localhost:${port.port}`}>
                <strong>{port.label || `localhost:${port.port}`}</strong>
                <small>
                  {port.protocol.toUpperCase()},{" "}
                  {port.visibility === "private" ? "Private" : "Public"}
                </small>
              </div>
              <button
                className="port-address"
                disabled={!port.connected}
                title={
                  port.visibility === "private"
                    ? "Open in a browser signed in to your Devyy account"
                    : port.url
                }
                onClick={() => void openUrl(port.url).catch(showError)}
              >
                <span>{port.url}</span>
                <ExternalLink size={12} />
              </button>
              <span className="port-availability">
                {port.connected ? <Check size={13} /> : <X size={13} />}
                {port.connected ? "Connected" : "Offline"}
              </span>
              <button
                className="icon-button"
                title="Copy address"
                aria-label="Copy address"
                onClick={() => copyAddress(port.id, port.url)}
              >
                {copiedId === port.id ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
              </button>
              <ActionMenu label={`Actions for port ${port.port}`}>
                {!port.connected && (
                  <ActionMenuItem
                    disabled={busy}
                    onClick={() => void reconnect(port)}
                  >
                    <RefreshCw size={13} /> Reconnect
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  disabled={busy}
                  onClick={() => void toggleVisibility(port)}
                >
                  {port.visibility === "private" ? (
                    <Globe size={13} />
                  ) : (
                    <Lock size={13} />
                  )}
                  {port.visibility === "private"
                    ? "Make public"
                    : "Make private"}
                </ActionMenuItem>
                <ActionMenuItem
                  disabled={busy}
                  onClick={() => void toggleProtocol(port)}
                >
                  <Radio size={13} />{" "}
                  {port.protocol === "http"
                    ? "Switch to HTTPS"
                    : "Switch to HTTP"}
                </ActionMenuItem>
                <ActionMenuItem
                  danger
                  disabled={busy}
                  onClick={() => void removeTunnel(port)}
                >
                  <Trash2 size={13} /> Stop sharing
                </ActionMenuItem>
              </ActionMenu>
            </li>
          ))}
        </ul>
      )}
      {showAdd &&
        createPortal(
          <dialog
            className="devyy-confirm port-dialog"
            aria-labelledby="port-dialog-title"
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setShowAdd(false);
            }}
          >
            <form onSubmit={handleAddPort}>
              <h2 id="port-dialog-title">Forward a port</h2>
              <p>Enter the port your local service is listening on.</p>
              <div className="port-dialog-fields">
                <label>
                  Local port
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    autoFocus
                    placeholder="3000"
                    value={newPort}
                    onChange={(event) =>
                      setNewPort(
                        event.target.value ? Number(event.target.value) : "",
                      )
                    }
                  />
                </label>
                <label>
                  Label
                  <input
                    placeholder="Optional"
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                  />
                </label>
                <label>
                  Protocol
                  <Select
                    aria-label="Protocol"
                    value={newProtocol}
                    onChange={(event) =>
                      setNewProtocol(event.target.value as "http" | "https")
                    }
                  >
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </Select>
                </label>
                <label>
                  Access
                  <Select
                    aria-label="Access"
                    value={newVisibility}
                    onChange={(event) =>
                      setNewVisibility(
                        event.target.value as "private" | "public",
                      )
                    }
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </Select>
                </label>
              </div>
              <p>
                {newVisibility === "private"
                  ? "Only your Devyy account can open this address."
                  : "Anyone with the address can open this service."}
              </p>
              <div className="ports-inline-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  aria-busy={busy}
                  disabled={busy || !newPort}
                >
                  Forward port
                </button>
              </div>
            </form>
            <DialogToastHost id="port-form" />
          </dialog>,
          document.body,
        )}
    </section>
  );
}
