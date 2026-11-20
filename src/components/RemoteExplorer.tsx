import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Server,
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
}

interface Connection {
  id: string;
  kind: string;
  label: string;
  localPort: number;
}
const storageKey = "devyy.ssh.servers";
const example: SshServer = {
  id: "example",
  label: "Development server",
  host: "dev.example.com",
  user: "dev",
  sshPort: 22,
  localPort: 3000,
  remotePort: 3000,
  remotePath: "~/workspace",
};
const sessionPasswords = new Map<string, string>();

function storedServers(): SshServer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(
      ({
        id,
        label,
        host,
        user,
        sshPort,
        localPort,
        remotePort,
        remotePath,
      }) => ({
        id,
        label,
        host,
        user,
        sshPort,
        localPort,
        remotePort,
        remotePath,
      }),
    );
  } catch {
    return [];
  }
}

export default function RemoteExplorer({
  onOpenFolder,
}: {
  onAccount?: () => void;
  onOpenPorts?: () => void;
  onOpenFolder?: (path: string, label: string) => void;
}) {
  const showcase =
    !native &&
    new URLSearchParams(location.search).get("showcase") === "remote";
  const [servers, setServers] = useState<SshServer[]>(() =>
    showcase ? [example] : storedServers(),
  );
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editor, setEditor] = useState<{
    server?: SshServer;
    action: "save" | "open" | "tunnel";
  }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    if (!native) return;
    const list = await invoke<Connection[]>("remote_list");
    setConnections(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    if (!native) return;
    // Rewrite old entries without stored plaintext passwords.
    localStorage.setItem(storageKey, JSON.stringify(storedServers()));
    let disposed = false;
    let stop: (() => void) | undefined;
    const update = () =>
      void refresh().catch((cause) => setError(String(cause)));
    update();
    void listen("devyy-remote-changed", update).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  function persist(next: SshServer[]) {
    if (native) localStorage.setItem(storageKey, JSON.stringify(next));
    setServers(next);
  }

  function connection(server: SshServer) {
    return connections.find(
      (item) =>
        item.kind === "ssh" &&
        item.localPort === server.localPort &&
        item.label === `${server.user}@${server.host}`,
    );
  }

  async function connect(
    server: SshServer,
    action: "open" | "tunnel",
    password?: string,
  ) {
    if (!native) return;
    setError("");
    setBusy(server.id);
    try {
      if (action === "open") {
        const path = await invoke<string>("ssh_mount_workspace", {
          host: server.host,
          user: server.user,
          sshPort: server.sshPort,
          remotePath: server.remotePath,
          password,
        });
        onOpenFolder?.(path, server.label);
      } else {
        const active = connection(server);
        if (active) await invoke("remote_stop", { id: active.id });
        else await invoke("ssh_forward", { options: { ...server, password } });
        await refresh();
      }
      setEditor(undefined);
    } catch (cause) {
      const message = String(cause);
      setError(message);
      if (
        !password &&
        /permission denied|AUTH_PASSWORD_REQUIRED/i.test(message)
      )
        setEditor({ server, action });
    } finally {
      setBusy("");
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const values = new FormData(event.currentTarget);
    const value = (key: string) => String(values.get(key) ?? "").trim();
    const server: SshServer = {
      id: editor.server?.id ?? crypto.randomUUID(),
      host: value("host"),
      user: value("user"),
      label: value("label") || `${value("user")}@${value("host")}`,
      remotePath: value("remotePath") || "~",
      sshPort: Number(value("sshPort")),
      localPort: Number(value("localPort")),
      remotePort: Number(value("remotePort")),
    };
    if (!server.host || !server.user) {
      setError("Enter both a hostname and SSH username.");
      return;
    }
    const password = String(values.get("password") ?? "");
    if (password) sessionPasswords.set(server.id, password);
    else if (editor.action === "save") sessionPasswords.delete(server.id);
    if (editor.action !== "save") {
      void connect(
        server,
        editor.action,
        password || sessionPasswords.get(server.id),
      );
      return;
    }
    persist(
      editor.server
        ? servers.map((item) => (item.id === server.id ? server : item))
        : [...servers, server],
    );
    setEditor(undefined);
  }

  return (
    <section className="remote-explorer" aria-label="SSH servers">
      <div className="remote-intro">
        <div className="workbench-symbol">
          <Server size={18} />
        </div>
        <div>
          <strong>SSH workspaces</strong>
          <p>Open and edit files on a server.</p>
        </div>
      </div>
      <div className="remote-subbar">
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setEditor({ action: "save" });
          }}
        >
          <Plus size={14} /> Add server
        </button>
        <button
          className="icon-button"
          aria-label="Refresh SSH status"
          onClick={() =>
            void refresh().catch((cause) => setError(String(cause)))
          }
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="remote-servers-list">
        {servers.map((server) => (
          <article className="remote-server-card" key={server.id}>
            <div className="remote-server-top">
              <span>
                <strong>{server.label}</strong>
                <code>
                  {server.user}@{server.host}:{server.sshPort}
                </code>
              </span>
              <div className="remote-server-top-actions">
                <button
                  className="icon-button"
                  aria-label="Edit server"
                  onClick={() => {
                    setError("");
                    setEditor({ server, action: "save" });
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Remove server"
                  disabled={!!busy}
                  onClick={async () => {
                    try {
                      const active = connection(server);
                      if (active)
                        await invoke("remote_stop", { id: active.id });
                      sessionPasswords.delete(server.id);
                      persist(servers.filter((item) => item.id !== server.id));
                    } catch (cause) {
                      setError(String(cause));
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="remote-path">
              <FolderOpen size={13} /> <code>{server.remotePath}</code>
            </div>
            <div className="remote-server-actions">
              <button
                className="remote-action-btn primary"
                disabled={!!busy}
                onClick={() =>
                  void connect(server, "open", sessionPasswords.get(server.id))
                }
              >
                <FolderOpen size={13} />{" "}
                {busy === server.id ? "Connecting…" : "Open workspace"}
              </button>
              <button
                aria-label={connection(server) ? "Stop tunnel" : "Start tunnel"}
                className="remote-action-btn"
                disabled={!!busy}
                onClick={() =>
                  void connect(
                    server,
                    "tunnel",
                    sessionPasswords.get(server.id),
                  )
                }
              >
                {connection(server) ? (
                  <Square size={13} />
                ) : (
                  <Radio size={13} />
                )}{" "}
                {connection(server) ? `:${server.localPort}` : "Tunnel"}
              </button>
            </div>
          </article>
        ))}
        {!servers.length && (
          <p className="remote-empty-card">Saved servers will appear here.</p>
        )}
      </div>
      {!editor && error && (
        <p className="remote-error-banner" role="alert">
          {error}
        </p>
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
            <form onSubmit={save}>
              <div className="dialog-heading">
                <div className="devyy-dialog-symbol">
                  <Server size={19} />
                </div>
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
              <h2 id="ssh-dialog-title">
                {editor.action !== "save"
                  ? "Authenticate to SSH"
                  : editor.server
                    ? "Edit SSH server"
                    : "Add SSH server"}
              </h2>
              <p>Use an SSH key or enter a password for this session.</p>
              <div className="port-dialog-fields">
                <label>
                  Hostname
                  <input
                    name="host"
                    required
                    autoFocus
                    defaultValue={editor.server?.host}
                    placeholder="dev.example.com"
                  />
                </label>
                <label>
                  SSH user
                  <input
                    name="user"
                    required
                    autoComplete="username"
                    defaultValue={editor.server?.user}
                  />
                </label>
                <label>
                  Workspace folder
                  <input
                    name="remotePath"
                    defaultValue={editor.server?.remotePath ?? "~"}
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
                <label>
                  SSH port
                  <input
                    type="number"
                    name="sshPort"
                    min={1}
                    max={65535}
                    required
                    defaultValue={editor.server?.sshPort ?? 22}
                  />
                </label>
                <label>
                  Password
                  <input type="password" name="password" autoComplete="off" />
                </label>
                <label>
                  Local tunnel port
                  <input
                    type="number"
                    name="localPort"
                    min={1}
                    max={65535}
                    required
                    defaultValue={editor.server?.localPort ?? 3000}
                  />
                </label>
                <label>
                  Remote tunnel port
                  <input
                    type="number"
                    name="remotePort"
                    min={1}
                    max={65535}
                    required
                    defaultValue={editor.server?.remotePort ?? 3000}
                  />
                </label>
              </div>
              {error && (
                <p className="ai-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ports-inline-actions">
                <button
                  className="button"
                  type="button"
                  disabled={!!busy}
                  onClick={() => setEditor(undefined)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={!!busy}>
                  {editor.action === "save" ? "Save server" : "Connect"}
                </button>
              </div>
            </form>
          </dialog>,
          document.body,
        )}
    </section>
  );
}
