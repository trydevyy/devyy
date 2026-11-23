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
        setName(ghVal.gitName || ghVal.account?.name || "");
        setEmail(ghVal.gitEmail || ghVal.account?.email || "");
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
    setName(nextName);
    setEmail(nextEmail);
    setStatus((old) =>
      old ? { ...old, gitName: nextName, gitEmail: nextEmail } : old,
    );
    toast.success("Commit identity saved");
  }

  async function login() {
    const requestId = crypto.randomUUID();
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
      } else {
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

  const tools = [
    {
      name: "Git",
      available: status?.gitInstalled || vcsInfo.gitAvailable,
      version: vcsInfo.gitVersion,
      link: "https://git-scm.com/downloads",
    },
    {
      name: "GitHub CLI",
      available: status?.cliInstalled,
      version: null,
      link: "https://cli.github.com/",
    },
  ];

  return (
    <section className="workbench-settings" aria-label="Source control">
      <section
        className="workbench-settings-section"
        aria-labelledby="commit-author-heading"
      >
        <header>
          <div>
            <h3 id="commit-author-heading">Commit author</h3>
            <p>
              Applied to new commits unless a repository has its own author
              settings.
            </p>
          </div>
        </header>
        <form
          className="scm-identity-form"
          onSubmit={(event) => {
            event.preventDefault();
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
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>
          <label>
            Email
            <input
              aria-label="Commit author email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <button
            className="setting-action"
            disabled={!native || !!busy || !name.trim() || !email.includes("@")}
          >
            <Check size={13} /> Save commit author
          </button>
        </form>
      </section>
      <section
        className="workbench-settings-section"
        aria-labelledby="github-heading"
      >
        <header>
          <div className="workbench-section-title">
            <GitFork size={18} />
            <div>
              <h3 id="github-heading">GitHub</h3>
              <p>
                {status?.account?.login
                  ? `Signed in as ${status.account.login}`
                  : "Sign in to access GitHub repositories over HTTPS."}
              </p>
            </div>
          </div>
          <button
            className="icon-button"
            title="Check GitHub status"
            aria-label="Check status"
            disabled={!native || !!busy}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={14}
              className={busy === "status" ? "spinning" : ""}
            />
          </button>
        </header>
        {!status?.connected && busy !== "login" && (
          <div className="scm-github-connect">
            <label className="workbench-setting-line">
              <span>
                <strong>Use GitHub credentials for Git</strong>
                <small>Applies to HTTPS operations in Hit and Git.</small>
              </span>
              <input
                type="checkbox"
                checked={credentials}
                onChange={(event) => setCredentials(event.target.checked)}
                disabled={!!busy}
              />
            </label>
            <button
              className="setting-action"
              disabled={!native || !status?.cliInstalled || !!busy}
              onClick={() => void login()}
            >
              <GitFork size={14} /> Continue with GitHub
            </button>
            {native && status && !status.cliInstalled && (
              <p className="workbench-muted">
                Install GitHub CLI to enable browser sign-in.
              </p>
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
        className="workbench-settings-section"
        aria-labelledby="git-tools-heading"
      >
        <header>
          <div className="workbench-section-title">
            <GitBranch size={18} />
            <div>
              <h3 id="git-tools-heading">Git tools</h3>
              <p>
                Choose what Devyy uses to work with repositories on this device.
              </p>
            </div>
          </div>
        </header>
        <div className="workbench-setting-line">
          <span>
            <strong>Source control provider</strong>
            <small>
              {activeProvider === "hit"
                ? "Hit is included with Devyy."
                : "Uses your system Git installation."}
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
            <option value="git">Git</option>
          </Select>
        </div>
        {tools.map((tool) => (
          <div className="workbench-setting-line" key={tool.name}>
            <span>
              <strong>{tool.name}</strong>
              <small>
                {tool.version ||
                  (tool.available
                    ? "Installed"
                    : native && !status
                      ? "Checking installation"
                      : "Required for this integration")}
              </small>
            </span>
            {tool.available ? (
              <Check size={15} aria-label="Installed" />
            ) : (
              <button
                className="setting-action"
                disabled={!native}
                onClick={() => browse(tool.link)}
              >
                <Download size={13} /> Download {tool.name}
              </button>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
