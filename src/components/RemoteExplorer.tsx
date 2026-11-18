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
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Shield,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { invoke, listen, native } from "../lib/native";

export interface SshServer {
  id: string;
  label: string;
  host: string;
  user: string;
  sshPort: number;
  localPort: number;
  remotePort: number;
  remotePath: string;
  password?: string;
}

interface Connection {
  id: string;
  kind: string;
  label: string;
  localPort: number;
}

const STORAGE_KEY = "devyy.ssh.servers";

function loadServers(): SshServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  // Default seed if no servers exist yet
  return [
    {
      id: "server-45-82-121-241",
      label: "Remote VPS",
      host: "45.82.121.241",
      user: "root",
      sshPort: 22,
      localPort: 3000,
      remotePort: 3000,
      remotePath: "/root",
    },
  ];
}

function saveServers(servers: SshServer[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {}
}

export default function RemoteExplorer({
  onAccount: _onAccount,
  onOpenFolder,
}: {
  onAccount?: () => void;
  onOpenPorts?: () => void;
  onOpenFolder?: (path: string) => void;
}) {
  const [servers, setServers] = useState<SshServer[]>(loadServers);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [direction, setDirection] = useState<number>(1);

  // Form State
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [localPort, setLocalPort] = useState(3000);
  const [remotePort, setRemotePort] = useState(3000);
  const [remotePath, setRemotePath] = useState("/root");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [step1Error, setStep1Error] = useState("");
  const [authError, setAuthError] = useState("");

  async function refresh() {
    if (!native) return;
    try {
      const list = await invoke<Connection[]>("remote_list");
      setConnections(list);
    } catch {
      setConnections([]);
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

  function openAddModal() {
    setEditingId(null);
    setHost("");
    setUser("root");
    setSshPort(22);
    setLocalPort(3000);
    setRemotePort(3000);
    setRemotePath("/root");
    setLabel("");
    setPassword("");
    setShowPassword(false);
    setStep(1);
    setDirection(1);
    setStep1Error("");
    setAuthError("");
    setIsModalOpen(true);
  }

  function openEditModal(srv: SshServer) {
    setEditingId(srv.id);
    setHost(srv.host);
    setUser(srv.user);
    setSshPort(srv.sshPort);
    setLocalPort(srv.localPort);
    setRemotePort(srv.remotePort);
    setRemotePath(srv.remotePath || "/root");
    setLabel(srv.label || "");
    setPassword(srv.password || "");
    setShowPassword(false);
    setStep(1);
    setDirection(1);
    setStep1Error("");
    setAuthError("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setStep(1);
    setStep1Error("");
    setAuthError("");
  }

  function handleNextStep() {
    if (!host.trim()) {
      setStep1Error("Remote host or IP address is required.");
      return;
    }
    if (!user.trim()) {
      setStep1Error("SSH username is required.");
      return;
    }
    setStep1Error("");
    setDirection(1);
    setStep(2);
  }

  function handlePrevStep() {
    setDirection(-1);
    setStep(1);
    setAuthError("");
  }

  async function handleSaveAndConnect() {
    setBusy(true);
    setAuthError("");
    try {
      // Attempt connection to test credentials / start tunnel
      await invoke("ssh_forward", {
        options: {
          host: host.trim(),
          user: user.trim(),
          sshPort,
          localPort,
          remotePort,
          password: password ? password : undefined,
        },
      });

      // Save server to list
      const updatedServer: SshServer = {
        id: editingId || `server-${Date.now()}`,
        label: label.trim() || `${user.trim()}@${host.trim()}`,
        host: host.trim(),
        user: user.trim(),
        sshPort,
        localPort,
        remotePort,
        remotePath: remotePath.trim() || "/root",
        password: rememberPassword && password ? password : undefined,
      };

      let newServers: SshServer[];
      if (editingId) {
        newServers = servers.map((s) => (s.id === editingId ? updatedServer : s));
      } else {
        newServers = [...servers, updatedServer];
      }
      setServers(newServers);
      saveServers(newServers);

      closeModal();
      await refresh();
    } catch (err: unknown) {
      const errStr = String(err);
      if (
        errStr.includes("AUTH_PASSWORD_REQUIRED") ||
        errStr.includes("Permission denied")
      ) {
        setAuthError("Permission denied: Invalid password. Please try again.");
      } else {
        setAuthError(`Connection error: ${errStr}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function removeServer(id: string) {
    const srv = servers.find((s) => s.id === id);
    if (!srv) return;
    const active = connections.find(
      (c) => c.kind === "ssh" && c.localPort === srv.localPort,
    );
    if (active) {
      void invoke("remote_stop", { id: active.id });
    }
    const newServers = servers.filter((s) => s.id !== id);
    setServers(newServers);
    saveServers(newServers);
  }

  async function toggleTunnel(srv: SshServer) {
    const active = connections.find(
      (c) => c.kind === "ssh" && c.localPort === srv.localPort,
    );
    if (active) {
      setBusy(true);
      try {
        await invoke("remote_stop", { id: active.id });
        await refresh();
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      setError("");
      try {
        await invoke("ssh_forward", {
          options: {
            host: srv.host,
            user: srv.user,
            sshPort: srv.sshPort,
            localPort: srv.localPort,
            remotePort: srv.remotePort,
            password: srv.password,
          },
        });
        await refresh();
      } catch (err) {
        const errStr = String(err);
        if (
          errStr.includes("AUTH_PASSWORD_REQUIRED") ||
          errStr.includes("Permission denied")
        ) {
          openEditModal(srv);
          setDirection(1);
          setStep(2);
        } else {
          setError(errStr);
        }
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleOpenInIde(srv: SshServer) {
    if (!onOpenFolder) return;
    setFetchingId(srv.id);
    setError("");
    try {
      const localPath = await invoke<string>("ssh_fetch_workspace", {
        host: srv.host,
        user: srv.user,
        sshPort: srv.sshPort,
        remotePath: srv.remotePath || "/root",
        password: srv.password || null,
      });
      onOpenFolder(localPath);
    } catch (err) {
      const errStr = String(err);
      if (
        errStr.includes("AUTH_PASSWORD_REQUIRED") ||
        errStr.includes("Permission denied")
      ) {
        openEditModal(srv);
        setDirection(1);
        setStep(2);
      } else {
        setError(errStr);
      }
    } finally {
      setFetchingId(null);
    }
  }

  // Animation variants for smooth vertical slide
  const stepVariants = {
    enter: (d: number) => ({
      opacity: 0,
      y: d * 20,
      filter: "blur(4px)",
    }),
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        type: "tween" as const,
        duration: 0.22,
        ease: [0.16, 1, 0.3, 1] as const,
      },
    },
    leave: (d: number) => ({
      opacity: 0,
      y: -d * 20,
      filter: "blur(4px)",
      transition: {
        type: "tween" as const,
        duration: 0.16,
        ease: "easeOut" as const,
      },
    }),
  };

  return (
    <div className="remote-explorer">
      {/* Subbar Header */}
      <div className="remote-subbar">
        <div className="remote-subbar-title">
          <Server size={13} className="remote-icon" />
          <span>SSH Servers</span>
          <span className="remote-count-tag">{servers.length}</span>
        </div>
        <div className="remote-subbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Add SSH server"
            title="Add SSH Server"
            onClick={openAddModal}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh SSH status"
            title="Refresh"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Server Cards List */}
      <div className="remote-servers-list">
        {servers.map((srv) => {
          const isTunnelActive = connections.some(
            (c) => c.kind === "ssh" && c.localPort === srv.localPort,
          );
          const isFetching = fetchingId === srv.id;

          return (
            <div className="remote-server-card" key={srv.id}>
              <div className="remote-server-top">
                <div className="remote-server-header-left">
                  <span
                    className={`remote-status-dot ${isTunnelActive ? "active" : ""}`}
                    title={isTunnelActive ? "Tunnel connected" : "Idle"}
                  />
                  <span className="remote-server-title" title={srv.label}>
                    {srv.label || `${srv.user}@${srv.host}`}
                  </span>
                </div>
                <div className="remote-server-top-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Edit server configuration"
                    title="Edit Configuration"
                    onClick={() => openEditModal(srv)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button remote-trash-btn"
                    aria-label="Remove server"
                    title="Remove Server"
                    onClick={() => removeServer(srv.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Specs & info badges */}
              <div className="remote-server-badges">
                <span className="remote-chip" title="SSH Host">
                  {srv.user}@{srv.host}:{srv.sshPort}
                </span>
                <span className="remote-chip" title="Port Forwarding">
                  {srv.remotePort} ➔ {srv.localPort}
                </span>
                <span className="remote-chip" title="Remote Directory">
                  {srv.remotePath || "/root"}
                </span>
              </div>

              {/* Card Action Buttons */}
              <div className="remote-server-actions">
                <button
                  type="button"
                  className="remote-action-btn primary"
                  disabled={isFetching || busy}
                  title="Download and open remote files in Devyy IDE"
                  onClick={() => void handleOpenInIde(srv)}
                >
                  <FolderOpen size={12} />
                  <span>{isFetching ? "Fetching files…" : "Open in IDE"}</span>
                </button>

                <button
                  type="button"
                  className={`remote-action-btn ${isTunnelActive ? "active" : "secondary"}`}
                  disabled={busy}
                  title={
                    isTunnelActive
                      ? "Stop SSH port forward tunnel"
                      : "Start SSH port forward tunnel"
                  }
                  onClick={() => void toggleTunnel(srv)}
                >
                  {isTunnelActive ? <Square size={11} /> : <Radio size={11} />}
                  <span>{isTunnelActive ? `Tunnel :${srv.localPort}` : "Tunnel"}</span>
                </button>
              </div>
            </div>
          );
        })}

        {servers.length === 0 && (
          <div className="remote-empty-card">
            <Server size={24} className="remote-empty-icon" />
            <p>No SSH servers configured</p>
            <button
              type="button"
              className="button primary remote-empty-add-btn"
              onClick={openAddModal}
            >
              <Plus size={13} />
              <span>Add SSH Server</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="remote-error-banner" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setError("")}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* 2-Step Animated Modal */}
      {isModalOpen && (
        <div className="devyy-dialog-overlay" onClick={closeModal}>
          <div
            className="devyy-confirm ssh-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="ssh-modal-header">
              <div className="ssh-modal-header-info">
                <div className="devyy-dialog-symbol">
                  {step === 1 ? <Server size={18} /> : <KeyRound size={18} />}
                </div>
                <div>
                  <h2 className="ssh-modal-title">
                    {editingId ? "Edit SSH Server" : "Connect SSH Server"}
                  </h2>
                  <p className="ssh-modal-subtitle">
                    {step === 1
                      ? "Configure connection credentials and port forwarding"
                      : `Password required for ${user}@${host}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={closeModal}
              >
                <X size={16} />
              </button>
            </div>

            {/* Stepper Indicator */}
            <div className="ssh-modal-stepper">
              <div className={`ssh-step-pill ${step >= 1 ? "active" : ""}`}>
                <span className="ssh-step-num">1</span>
                <span>Connection</span>
              </div>
              <div className="ssh-step-line" />
              <div className={`ssh-step-pill ${step === 2 ? "active" : ""}`}>
                <span className="ssh-step-num">2</span>
                <span>Authentication</span>
              </div>
            </div>

            {/* Animated Step Content (Vertical slide) */}
            <div className="ssh-modal-body">
              <AnimatePresence mode="wait" custom={direction}>
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="visible"
                    exit="leave"
                    className="ssh-step-container"
                  >
                    <div className="ssh-form-grid">
                      <label className="remote-label">
                        <span>Remote Host / IP *</span>
                        <input
                          type="text"
                          placeholder="45.82.121.241 or server.example.com"
                          value={host}
                          autoFocus
                          onChange={(e) => setHost(e.target.value)}
                          className="remote-input"
                        />
                      </label>

                      <label className="remote-label">
                        <span>SSH User *</span>
                        <input
                          type="text"
                          placeholder="root or ubuntu"
                          value={user}
                          onChange={(e) => setUser(e.target.value)}
                          autoComplete="username"
                          className="remote-input"
                        />
                      </label>

                      <label className="remote-label">
                        <span>Remote Workspace Directory</span>
                        <input
                          type="text"
                          placeholder="/root or /var/www"
                          value={remotePath}
                          onChange={(e) => setRemotePath(e.target.value)}
                          className="remote-input"
                        />
                      </label>

                      <div className="remote-ports-row">
                        <label className="remote-label">
                          <span>SSH Port</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={sshPort}
                            onChange={(e) => setSshPort(Number(e.target.value))}
                            className="remote-input"
                          />
                        </label>

                        <label className="remote-label">
                          <span>Remote Port</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={remotePort}
                            onChange={(e) => setRemotePort(Number(e.target.value))}
                            className="remote-input"
                          />
                        </label>

                        <label className="remote-label">
                          <span>Local Port</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={localPort}
                            onChange={(e) => setLocalPort(Number(e.target.value))}
                            className="remote-input"
                          />
                        </label>
                      </div>

                      <label className="remote-label">
                        <span>Server Label (Optional)</span>
                        <input
                          type="text"
                          placeholder="e.g. Production VPS"
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                          className="remote-input"
                        />
                      </label>
                    </div>

                    {step1Error && (
                      <div className="ssh-password-error">{step1Error}</div>
                    )}

                    <footer className="ssh-modal-footer">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={closeModal}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button primary"
                        onClick={handleNextStep}
                      >
                        <span>Next</span>
                        <ArrowRight size={13} />
                      </button>
                    </footer>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step-2"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="visible"
                    exit="leave"
                    className="ssh-step-container"
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveAndConnect();
                      }}
                    >
                      <label className="remote-label">
                        <span>SSH Password</span>
                        <div className="ssh-password-input-wrapper">
                          <input
                            type={showPassword ? "text" : "password"}
                            className="ssh-password-input"
                            placeholder="Enter password"
                            value={password}
                            autoFocus
                            onChange={(e) => {
                              setPassword(e.target.value);
                              setAuthError("");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") closeModal();
                            }}
                          />
                          <button
                            type="button"
                            className="ssh-password-eye-btn"
                            onClick={() => setShowPassword((v) => !v)}
                            title={showPassword ? "Hide password" : "Show password"}
                            aria-label={
                              showPassword ? "Hide password" : "Show password"
                            }
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                        </div>
                      </label>

                      <label className="confirm-remember ssh-remember-checkbox">
                        <input
                          type="checkbox"
                          checked={rememberPassword}
                          onChange={(e) => setRememberPassword(e.target.checked)}
                        />
                        <span>Remember password for this server</span>
                      </label>

                      {authError && (
                        <div className="ssh-password-error">{authError}</div>
                      )}

                      <footer className="ssh-modal-footer">
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={handlePrevStep}
                        >
                          <ArrowLeft size={13} />
                          <span>Back</span>
                        </button>
                        <button
                          type="submit"
                          className="button primary"
                          disabled={busy}
                        >
                          {busy ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <Shield size={12} />
                          )}
                          <span>{busy ? "Connecting…" : "Save & Connect"}</span>
                        </button>
                      </footer>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
