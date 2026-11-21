import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, listen, native } from "../lib/native";
import { useConfirm } from "./ui/Confirm";
import { DialogToastHost, showError } from "./ui/ErrorToast";
import { toast } from "sonner";

interface SshServer {
  id: string;
  label: string;
  host: string;
  user: string;
  sshPort: number;
  localPort: number;
  remotePort: number;
  remotePath: string;
  identityFile?: string;
}
interface Connection {
  id: string;
  kind: string;
  label: string;
  localPort: number;
}
interface Auth {
  password?: string;
  passphrase?: string;
  fingerprint?: string;
}
type Action = "open" | "tunnel";
const storageKey = "devyy.ssh.servers";
const sessionAuth = new Map<string, Auth>();

function loadServers(): SshServer[] {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(rows)
      ? rows
          .filter((row) => row && typeof row.host === "string")
          .map(
            ({
              id,
              label,
              host,
              user,
              sshPort,
              localPort,
              remotePort,
              remotePath,
              identityFile,
            }) => ({
              id,
              label,
              host,
              user,
              sshPort,
              localPort,
              remotePort,
              remotePath,
              identityFile,
            }),
          )
      : [];
  } catch {
    return [];
  }
}

export default function RemoteExplorer({
  onOpenFolder,
  activeLabel,
}: {
  onOpenFolder: (path: string, label: string) => Promise<boolean>;
  activeLabel?: string;
}) {
  const confirm = useConfirm();
  const [servers, setServers] = useState(loadServers);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string>();
  const [editor, setEditor] = useState<{
    server?: SshServer;
    action?: Action;
  }>();
  const [keyPath, setKeyPath] = useState("");
  const [trust, setTrust] = useState<{
    server: SshServer;
    action: Action;
    auth: Auth;
    fingerprint: string;
  }>();
  const [busy, setBusy] = useState<string>();

  function refresh() {
    if (!native) return;
    void invoke<Connection[]>("remote_list").then(
      (list) => setConnections(Array.isArray(list) ? list : []),
      showError,
    );
  }
  useEffect(() => {
    if (!native) return;
    localStorage.setItem(storageKey, JSON.stringify(loadServers()));
    let disposed = false;
    let unlisten: (() => void) | undefined;
    refresh();
    void listen("devyy-remote-changed", refresh)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(showError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function persist(next: SshServer[]) {
    if (native) localStorage.setItem(storageKey, JSON.stringify(next));
    setServers(next);
  }

  function startEdit(server?: SshServer, action?: Action) {
    setKeyPath(server?.identityFile ?? "");
    setEditor({ server, action });
    setMenu(undefined);
  }

  function tunnelFor(server: SshServer) {
    return connections.find(
      (row) =>
        row.kind === "ssh" &&
        row.localPort === server.localPort &&
        row.label === `${server.user}@${server.host}`,
    );
  }

  async function connect(
    server: SshServer,
    action: Action,
    auth: Auth = sessionAuth.get(server.id) ?? {},
  ) {
    if (!native) {
      showError("Open the desktop app to connect to SSH.");
      return;
    }
    setBusy(server.id);
    try {
      const options = {
        host: server.host,
        user: server.user,
        sshPort: server.sshPort,
        identityFile: server.identityFile,
        ...auth,
      };
      if (action === "open") {
        const path = await invoke<string>("ssh_open_workspace", {
          options,
          remotePath: server.remotePath,
          label: server.label,
        });
        if (!(await onOpenFolder(path, server.label))) {
          await invoke("ssh_release_workspace", { path });
          return;
        }
        toast.success(`Opened ${server.label}`);
      } else {
        const tunnel = tunnelFor(server);
        if (tunnel) {
          await invoke("remote_stop", { id: tunnel.id });
          toast.success("SSH tunnel stopped");
        } else {
          await invoke("ssh_forward", {
            options: {
              ...options,
              localPort: server.localPort,
              remotePort: server.remotePort,
            },
          });
          toast.success(`Listening on localhost:${server.localPort}`);
        }
        refresh();
      }
      sessionAuth.set(server.id, {
        password: auth.password,
        passphrase: auth.passphrase,
      });
      setEditor(undefined);
      setTrust(undefined);
    } catch (cause) {
      const error = String(cause);
      if (error.startsWith("SSH_HOST_KEY:")) {
        setEditor(undefined);
        setTrust({
          server,
          action,
          auth,
          fingerprint: error.slice("SSH_HOST_KEY:".length),
        });
      } else if (error.startsWith("SSH_AUTH:")) {
        setTrust(undefined);
        if (editor?.action) showError(error.slice("SSH_AUTH:".length));
        else startEdit(server, action);
      } else {
        showError(cause);
      }
    } finally {
      setBusy(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const values = new FormData(event.currentTarget);
    const text = (key: string) => String(values.get(key) ?? "").trim();
    const previous = editor.server;
    const server: SshServer = {
      id: previous?.id ?? crypto.randomUUID(),
      label: text("label") || `${text("user")}@${text("host")}`,
      host: text("host"),
      user: text("user"),
      remotePath: text("folder") || "~",
      sshPort: Number(text("sshPort")) || 22,
      localPort: Number(text("localPort")) || 3000,
      remotePort: Number(text("remotePort")) || 3000,
      identityFile: keyPath || undefined,
    };
    if (editor.action && previous) {
      void connect(
        { ...previous, identityFile: server.identityFile },
        editor.action,
        {
          password: String(values.get("password") ?? "") || undefined,
          passphrase: String(values.get("passphrase") ?? "") || undefined,
        },
      );
      return;
    }
    if (!server.host || !server.user) {
      showError("Enter the hostname and SSH username.");
      return;
    }
    sessionAuth.delete(server.id);
    persist(
      previous
        ? servers.map((item) => (item.id === server.id ? server : item))
        : [...servers, server],
    );
    setEditor(undefined);
  }

  const filtered = servers.filter((server) =>
    `${server.label} ${server.user}@${server.host}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="ssh-explorer" aria-label="SSH servers">
      <div className="ssh-toolbar">
        <label className="ssh-filter">
          <Search size={14} />
          <input
            aria-label="Filter SSH servers"
            placeholder="Filter SSH servers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="icon-button"
          title="Add SSH server"
          aria-label="Add SSH server"
          onClick={() => startEdit()}
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          title="Refresh SSH tunnels"
          aria-label="Refresh SSH tunnels"
          onClick={refresh}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {!servers.length ? (
        <div className="ssh-empty">
          <p>Open files and a terminal on an SSH server.</p>
          <button className="setting-action" onClick={() => startEdit()}>
            <Plus size={13} /> Add server
          </button>
        </div>
      ) : !filtered.length ? (
        <p className="ssh-empty">No matching servers.</p>
      ) : (
        <ul className="ssh-list">
          {filtered.map((server) => (
            <li key={server.id}>
              <button
                className="ssh-server-link"
                aria-current={activeLabel === server.label ? "true" : undefined}
                disabled={!!busy}
                onClick={() => void connect(server, "open")}
                title={server.remotePath}
              >
                <Server size={15} />
                <span>
                  <strong>{server.label}</strong>
                  <small>
                    {server.user}@{server.host} · {server.remotePath}
                  </small>
                </span>
                {busy === server.id ? (
                  <RefreshCw size={13} className="spinning" />
                ) : (
                  <FolderOpen size={13} />
                )}
              </button>
              <button
                className="icon-button"
                aria-label={`Actions for ${server.label}`}
                aria-expanded={menu === server.id}
                onClick={() =>
                  setMenu(menu === server.id ? undefined : server.id)
                }
              >
                <MoreHorizontal size={16} />
              </button>
              {menu === server.id && (
                <div className="ssh-row-actions">
                  <button
                    className="setting-action"
                    disabled={!!busy}
                    onClick={() => {
                      setMenu(undefined);
                      void connect(server, "tunnel");
                    }}
                  >
                    <Radio size={13} />{" "}
                    {tunnelFor(server) ? "Stop tunnel" : "Start tunnel"}
                  </button>
                  <button
                    className="setting-action"
                    onClick={() => startEdit(server)}
                  >
                    Edit
                  </button>
                  <button
                    className="setting-action"
                    onClick={() =>
                      void (async () => {
                        if (
                          !(await confirm({
                            title: `Remove ${server.label}?`,
                            description:
                              "Remove this server from the saved list.",
                            confirmLabel: "Remove",
                            danger: true,
                          }))
                        )
                          return;
                        const tunnel = tunnelFor(server);
                        if (tunnel)
                          await invoke("remote_stop", { id: tunnel.id });
                        sessionAuth.delete(server.id);
                        persist(
                          servers.filter((item) => item.id !== server.id),
                        );
                      })().catch(showError)
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editor &&
        createPortal(
          <dialog
            className="devyy-confirm port-dialog"
            aria-labelledby="ssh-dialog-title"
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setEditor(undefined);
            }}
          >
            <form onSubmit={submit}>
              <div className="dialog-heading">
                <h2 id="ssh-dialog-title">
                  {editor.action
                    ? "Sign in to SSH"
                    : editor.server
                      ? "Edit SSH server"
                      : "Add SSH server"}
                </h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close"
                  disabled={!!busy}
                  onClick={() => setEditor(undefined)}
                >
                  <X size={16} />
                </button>
              </div>
              {editor.action ? (
                <>
                  <p>
                    {editor.server?.user}@{editor.server?.host}
                  </p>
                  <div className="port-dialog-fields">
                    <label>
                      Server password
                      <input
                        autoFocus
                        type="password"
                        name="password"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Key passphrase
                      <input
                        type="password"
                        name="passphrase"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="port-dialog-fields">
                  <label>
                    Host
                    <input
                      name="host"
                      autoFocus
                      required
                      defaultValue={editor.server?.host}
                      placeholder="server.example.com"
                    />
                  </label>
                  <label>
                    Username
                    <input
                      name="user"
                      required
                      defaultValue={editor.server?.user}
                    />
                  </label>
                  <label>
                    Project folder
                    <input
                      name="folder"
                      defaultValue={editor.server?.remotePath ?? "~"}
                    />
                  </label>
                  <label>
                    SSH port
                    <input
                      name="sshPort"
                      type="number"
                      min={1}
                      max={65535}
                      defaultValue={editor.server?.sshPort ?? 22}
                      required
                    />
                  </label>
                  <label>
                    Display name
                    <input
                      name="label"
                      defaultValue={editor.server?.label}
                      placeholder="Optional"
                    />
                  </label>
                </div>
              )}
              <div className="ssh-key-setting">
                <span title={keyPath}>
                  {keyPath
                    ? keyPath.replace(/.*[/\\]/, "")
                    : "Default SSH keys"}
                </span>
                <button
                  type="button"
                  className="setting-action"
                  onClick={() =>
                    void open({
                      title: "Choose a private SSH key",
                      multiple: false,
                    }).then((path) => {
                      if (typeof path === "string") setKeyPath(path);
                    }, showError)
                  }
                >
                  Choose key
                </button>
                {keyPath && (
                  <button
                    type="button"
                    className="setting-action"
                    onClick={() => setKeyPath("")}
                  >
                    Clear
                  </button>
                )}
              </div>
              {!editor.action && (
                <details className="workbench-exclusions">
                  <summary>Tunnel ports</summary>
                  <div className="port-dialog-fields">
                    <label>
                      Local port
                      <input
                        name="localPort"
                        type="number"
                        min={1}
                        max={65535}
                        defaultValue={editor.server?.localPort ?? 3000}
                        required
                      />
                    </label>
                    <label>
                      Remote port
                      <input
                        name="remotePort"
                        type="number"
                        min={1}
                        max={65535}
                        defaultValue={editor.server?.remotePort ?? 3000}
                        required
                      />
                    </label>
                  </div>
                </details>
              )}
              <div className="ports-inline-actions">
                <button
                  type="button"
                  className="button"
                  disabled={!!busy}
                  onClick={() => setEditor(undefined)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={!!busy}>
                  {busy
                    ? "Connecting…"
                    : editor.action
                      ? "Connect"
                      : "Save server"}
                </button>
              </div>
            </form>
            <DialogToastHost id="ssh-form" />
          </dialog>,
          document.body,
        )}
      {trust &&
        createPortal(
          <dialog
            className="devyy-confirm port-dialog"
            aria-labelledby="ssh-trust-title"
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setTrust(undefined);
            }}
          >
            <h2 id="ssh-trust-title">Verify the SSH server</h2>
            <p>
              Compare this fingerprint with the one from {trust.server.host}{" "}
              before connecting.
            </p>
            <code className="ssh-fingerprint">{trust.fingerprint}</code>
            <div className="ports-inline-actions">
              <button
                className="button"
                disabled={!!busy}
                onClick={() => setTrust(undefined)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  void connect(trust.server, trust.action, {
                    ...trust.auth,
                    fingerprint: trust.fingerprint,
                  })
                }
              >
                Trust and connect
              </button>
            </div>
            <DialogToastHost id="ssh-trust" />
          </dialog>,
          document.body,
        )}
    </section>
  );
}
