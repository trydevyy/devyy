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

import { requestId as newRequestId } from "../lib/requestId";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  GitFork,
  LoaderCircle,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeClipboardText } from "../lib/clipboard";
import { invoke, listen, native } from "../lib/native";
import { showError } from "./ui/ErrorToast";
import { toast } from "sonner";
import Select from "./ui/Select";
import { useConfirm } from "./ui/Confirm";
import type { Settings } from "../lib/types";

interface GitHubStatus {
  gitInstalled: boolean;
  cliInstalled: boolean;
  connected: boolean;
  gitName: string;
  gitEmail: string;
  account?: { login: string; name: string; email: string; avatarUrl?: string };
}

interface VcsInfo {
  provider: "hit" | "git";
  hitAvailable: boolean;
  gitAvailable: boolean;
  hitVersion: string;
  gitVersion?: string | null;
}

export default function GitHubSettings({
  settings,
  onChange,
}: {
  settings?: Settings;
  onChange?: Dispatch<SetStateAction<Settings>>;
}) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<GitHubStatus>();
  const [vcsInfo, setVcsInfo] = useState<VcsInfo>({
    provider: settings?.vcsProvider ?? "hit",
    hitAvailable: true,
    gitAvailable: false,
    hitVersion: "0.1.0",
  });
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState(true);
  const active = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const editingAuthor = useRef(false);

  async function refresh() {
    if (!native) return;
    setBusy("status");
    try {
      const [ghVal, vcsVal] = await Promise.all([
        invoke<GitHubStatus>("github_status"),
        invoke<VcsInfo>("vcs_status"),
      ]);
      if (!mounted.current) return;
      if (ghVal) {
        setStatus(ghVal);
        if (!editingAuthor.current) {
          setName(ghVal.gitName || ghVal.account?.name || "");
          setEmail(ghVal.gitEmail || ghVal.account?.email || "");
        }
      }
      if (vcsVal) {
        setVcsInfo(vcsVal);
        if (onChange && settings && settings.vcsProvider !== vcsVal.provider) {
          onChange((prev) => ({ ...prev, vcsProvider: vcsVal.provider }));
        }
      }
    } catch (error) {
      if (mounted.current) showError(error);
    } finally {
      if (mounted.current) setBusy("");
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      if (active.current)
        void invoke("ai_cancel", { requestId: active.current }).catch(() => {});
    };
  }, []);

  async function selectVcsProvider(provider: "hit" | "git") {
    setBusy("vcs");
    try {
      const active = await invoke<string>("vcs_set_provider", { provider });
      const nextProvider = active === "git" ? "git" : "hit";
      setVcsInfo((old) => ({ ...old, provider: nextProvider }));
      if (onChange) {
        onChange((prev) => ({ ...prev, vcsProvider: nextProvider }));
      }
      toast.success(
        nextProvider === "hit"
          ? "Using Hit for source control"
          : "Using Git for source control",
      );
    } catch (err) {
      showError(err);
    } finally {
      setBusy("");
    }
  }

  async function identity(nextName: string, nextEmail: string) {
    await invoke("github_git_identity", { name: nextName, email: nextEmail });
    editingAuthor.current = false;
    setName(nextName);
    setEmail(nextEmail);
    setStatus((old) =>
      old ? { ...old, gitName: nextName, gitEmail: nextEmail } : old,
    );
    toast.success("Commit identity saved");
  }

  async function login() {
    const requestId = newRequestId();
    active.current = requestId;
    setBusy("login");
    setCode("");
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ requestId: string; code: string }>(
        "devyy-github-auth",
        ({ payload }) => {
          if (payload.requestId === requestId && mounted.current) {
            setCode(payload.code);
            void openUrl("https://github.com/login/device").catch((error) => {
              if (mounted.current) showError(error);
            });
          }
        },
      );
      if (!mounted.current) return;
      const value = await invoke<GitHubStatus>("github_login", {
        requestId,
        setupGit: credentials,
      });
      if (!mounted.current) return;
      setStatus(value);
      setCode("");
      toast.success("GitHub connected");
      if (
        value.gitInstalled &&
        value.account &&
        (await confirm({
          title: "Use your GitHub identity for commits?",
          description: `Set the global commit author name to ${value.account.name} and email to ${value.account.email}?${value.gitName || value.gitEmail ? ` This replaces your current identity (${value.gitName || "no name"}, ${value.gitEmail || "no email"}).` : " This applies to repositories on this machine unless they override it."}`,
          confirmLabel: "Set identity",
        }))
      ) {
        await identity(value.account.name, value.account.email);
      } else if (!editingAuthor.current) {
        setName(value.gitName || value.account?.name || "");
        setEmail(value.gitEmail || value.account?.email || "");
      }
    } catch (error) {
      if (mounted.current) showError(error);
    } finally {
      unlisten?.();
      active.current = undefined;
      if (mounted.current) {
        setBusy("");
        setCode("");
      }
    }
  }

  const browse = (url: string) =>
    void openUrl(url).catch((error) => showError(error));

  const activeProvider = settings?.vcsProvider ?? vcsInfo.provider;

  const gitInstalled = !!(status?.gitInstalled || vcsInfo.gitAvailable);
  const authorSaved =
    !!status?.gitName &&
    !!status.gitEmail &&
    name.trim() === status.gitName &&
    email.trim() === status.gitEmail;
  const canSaveAuthor =
    native &&
    gitInstalled &&
    !busy &&
    !authorSaved &&
    !!name.trim() &&
    email.includes("@");
  const connectionLabel = !native
    ? "Desktop app only"
    : busy === "login"
      ? "Connecting"
      : status?.connected
        ? "Connected"
        : busy === "status"
          ? "Checking"
          : !status
            ? "Status unavailable"
            : status.cliInstalled
              ? "Not connected"
              : "GitHub CLI needed";

  return (
    <section className="scm-settings" aria-label="Source control">
      <section
        className="scm-settings-card scm-connection"
        aria-labelledby="github-heading"
      >
        <header className="scm-connection-header">
          <div className="scm-card-heading">
            <span className="scm-card-icon">
              <GitFork size={17} />
            </span>
            <div>
              <h3 id="github-heading">GitHub connection</h3>
              <p>
                {status?.account?.login
                  ? `Signed in as @${status.account.login}`
                  : "Sign in to use private GitHub repositories over HTTPS."}
              </p>
            </div>
          </div>
          <div className="scm-connection-status">
            <span className="scm-status" role="status">
              {status?.connected && <Check size={13} />}
              {connectionLabel}
            </span>
            <button
              type="button"
              className="icon-button"
              title="Refresh Git and GitHub status"
              aria-label="Check status"
              aria-busy={busy === "status"}
              disabled={!native || !!busy}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={14}
                className={busy === "status" ? "spinning" : undefined}
              />
            </button>
          </div>
        </header>
        {native && status && !status.connected && busy !== "login" && (
          <div className="scm-connection-actions">
            {status.cliInstalled ? (
              <>
                <label className="scm-credentials">
                  <input
                    type="checkbox"
                    checked={credentials}
                    onChange={(event) => setCredentials(event.target.checked)}
                    disabled={!!busy}
                  />
                  Use this sign-in for GitHub pulls and pushes over HTTPS
                </label>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void login()}
                >
                  Continue with GitHub <ExternalLink size={13} />
                </button>
              </>
            ) : (
              <>
                <p>
                  Install GitHub CLI, then refresh to enable browser sign-in.
                </p>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => browse("https://cli.github.com/")}
                >
                  <Download size={13} /> Download GitHub CLI
                </button>
              </>
            )}
          </div>
        )}
        {busy === "login" && (
          <div className="scm-github-auth" role="status">
            {code ? (
              <>
                <span>Enter this code on GitHub</span>
                <code>{code}</code>
                <button
                  className="icon-button"
                  aria-label="Copy GitHub code"
                  onClick={() => void writeClipboardText(code).catch(showError)}
                >
                  <Copy size={14} />
                </button>
                <button
                  className="setting-action"
                  onClick={() => browse("https://github.com/login/device")}
                >
                  Open GitHub <ExternalLink size={12} />
                </button>
              </>
            ) : (
              <span>
                <LoaderCircle size={14} className="spinning" /> Waiting for
                browser authorization
              </span>
            )}
            <button
              className="setting-action"
              onClick={() => {
                if (active.current)
                  void invoke("ai_cancel", { requestId: active.current }).catch(
                    showError,
                  );
              }}
            >
              Cancel sign-in
            </button>
          </div>
        )}
      </section>

      <section
        className="scm-settings-card"
        aria-labelledby="commit-author-heading"
      >
        <header className="scm-card-heading">
          <span className="scm-card-icon">
            <UserRound size={17} />
          </span>
          <div>
            <h3 id="commit-author-heading">Commit author</h3>
            <p>
              The name and email collaborators see on new commits. Repositories
              can set their own.
            </p>
          </div>
        </header>
        <form
          className="scm-identity-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSaveAuthor) return;
            setBusy("identity");
            void identity(name.trim(), email.trim())
              .catch(showError)
              .finally(() => setBusy(""));
          }}
        >
          <label>
            Name
            <input
              aria-label="Commit author name"
              autoComplete="name"
              disabled={busy === "identity"}
              required
              value={name}
              onChange={(event) => {
                editingAuthor.current = true;
                setName(event.target.value);
              }}
              placeholder="Your name"
            />
          </label>
          <label>
            Email
            <input
              aria-label="Commit author email"
              autoComplete="email"
              disabled={busy === "identity"}
              required
              type="email"
              value={email}
              onChange={(event) => {
                editingAuthor.current = true;
                setEmail(event.target.value);
              }}
              placeholder="you@example.com"
            />
          </label>
          <div className="scm-save-author">
            <button
              className="setting-action"
              disabled={!canSaveAuthor}
              aria-busy={busy === "identity"}
            >
              <Check size={13} /> Save commit author
            </button>
            {authorSaved && <small role="status">Saved</small>}
            {native && status && !gitInstalled && (
              <small>Install Git to save an author.</small>
            )}
          </div>
        </form>
      </section>

      <section
        className="scm-settings-card"
        aria-labelledby="git-tools-heading"
      >
        <header className="scm-card-heading">
          <span className="scm-card-icon">
            <GitBranch size={17} />
          </span>
          <div>
            <h3 id="git-tools-heading">Repository tools</h3>
            <p>Choose what Devyy uses to work with repositories.</p>
          </div>
        </header>
        <div className="scm-tool-row">
          <span>
            <strong>Source control provider</strong>
            <small>
              {activeProvider === "hit"
                ? "Included with Devyy."
                : "Uses the Git installed on this device."}
            </small>
          </span>
          <Select
            aria-label="Source control provider"
            value={activeProvider}
            disabled={!native || !!busy}
            onChange={(event) =>
              void selectVcsProvider(event.target.value as "git" | "hit")
            }
          >
            <option value="hit">Hit</option>
            <option
              value="git"
              disabled={!gitInstalled && activeProvider !== "git"}
            >
              Git
            </option>
          </Select>
        </div>
        <div className="scm-tool-row">
          <span>
            <strong>System Git</strong>
            <small>
              {vcsInfo.gitVersion ||
                (gitInstalled
                  ? "Installed"
                  : status
                    ? "Needed to save a commit author."
                    : native
                      ? "Installation status unavailable"
                      : "Available in the desktop app")}
            </small>
          </span>
          {gitInstalled ? (
            <Check size={15} aria-label="Installed" />
          ) : native && status ? (
            <button
              className="setting-action"
              onClick={() => browse("https://git-scm.com/downloads")}
            >
              <Download size={13} /> Download Git
            </button>
          ) : null}
        </div>
      </section>
    </section>
  );
}
