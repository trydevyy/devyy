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

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Github,
  LoaderCircle,
  RefreshCw,
  Zap,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke, listen, native } from "../lib/native";
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState(true);
  const active = useRef<string | undefined>(undefined);
  const mounted = useRef(true);

  async function refresh() {
    if (!native) return;
    setBusy("status");
    setError("");
    try {
      const [ghVal, vcsVal] = await Promise.all([
        invoke<GitHubStatus>("github_status").catch(() => undefined),
        invoke<VcsInfo>("vcs_status").catch(() => undefined),
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
      if (mounted.current) setError(String(error));
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
    setError("");
    setNotice("");
    try {
      const active = await invoke<string>("vcs_set_provider", { provider });
      const nextProvider = active === "git" ? "git" : "hit";
      setVcsInfo((old) => ({ ...old, provider: nextProvider }));
      if (onChange) {
        onChange((prev) => ({ ...prev, vcsProvider: nextProvider }));
      }
      setNotice(
        nextProvider === "hit"
          ? "Switched to Hit (high-performance default)"
          : "Switched to Git (standard version control)",
      );
    } catch (err) {
      setError(String(err));
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
    setNotice("Commit identity saved");
  }

  async function login() {
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setBusy("login");
    setError("");
    setNotice("");
    setCode("");
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ requestId: string; code: string }>(
        "devyy-github-auth",
        ({ payload }) => {
          if (payload.requestId === requestId && mounted.current) {
            setCode(payload.code);
            void openUrl("https://github.com/login/device").catch((error) => {
              if (mounted.current) setError(String(error));
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
      setNotice("GitHub connected");
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
      if (mounted.current) setError(String(error));
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
    void openUrl(url).catch((error) => setError(String(error)));

  const activeProvider = settings?.vcsProvider ?? vcsInfo.provider;

  return (
    <section className="github-settings" aria-label="Source control">
      {/* Provider Switcher: Hit (Default, Faster) vs Git */}
      <div className="vcs-provider-card">
        <div className="vcs-provider-header">
          <GitBranch size={22} className="vcs-main-icon" />
          <span>
            <strong>Source control provider</strong>
            <small>
              Devyy uses Hit by default for accelerated filesystem caching, index preloading, and instant branch operations. You can switch between Hit and standard Git anytime.
            </small>
          </span>
          <span className={`vcs-active-pill ${activeProvider === "hit" ? "hit" : "git"}`}>
            {activeProvider === "hit" ? "Hit active" : "Git active"}
          </span>
        </div>
        <div className="vcs-provider-options">
          <button
            type="button"
            className={`vcs-provider-btn ${activeProvider === "hit" ? "selected" : ""}`}
            onClick={() => void selectVcsProvider("hit")}
            disabled={!!busy}
          >
            <div className="vcs-btn-title">
              <span className="vcs-indicator">{activeProvider === "hit" ? "●" : "○"}</span>
              <strong>Hit</strong>
              <span className="vcs-badge fast">
                <Zap size={11} /> Fast (Default)
              </span>
            </div>
            <p className="vcs-btn-desc">
              Next-generation VCS built in Rust. High-performance engine with index preloading, fscache, protocol v2 streaming, and helpful error diagnostics.
            </p>
          </button>
          <button
            type="button"
            className={`vcs-provider-btn ${activeProvider === "git" ? "selected" : ""}`}
            onClick={() => void selectVcsProvider("git")}
            disabled={!!busy}
          >
            <div className="vcs-btn-title">
              <span className="vcs-indicator">{activeProvider === "git" ? "●" : "○"}</span>
              <strong>Git</strong>
              <span className="vcs-badge standard">Standard</span>
            </div>
            <p className="vcs-btn-desc">
              Standard Git installation. Traditional command-line execution for existing Git toolchains and custom hooks.
            </p>
          </button>
        </div>
      </div>

      {/* GitHub Account Header */}
      <div className="github-account-header">
        <Github size={28} />
        <span>
          <strong>{status?.account?.login ?? "GitHub"}</strong>
          <small>
            {status?.connected
              ? "Connected through GitHub CLI"
              : "Connect repositories and authenticate over HTTPS"}
          </small>
        </span>
        <button
          className="icon-button"
          aria-label="Check status"
          disabled={!!busy || !native}
          onClick={() => void refresh()}
        >
          <RefreshCw
            size={15}
            className={busy === "status" ? "spinning" : ""}
          />
        </button>
      </div>
      {!native && (
        <p className="muted">
          Open the desktop app to connect GitHub and configure source control.
        </p>
      )}

      {/* System Tooling & Dependencies */}
      <div className="github-dependencies">
        {[
          {
            label: "Hit",
            installed: true,
            version: vcsInfo.hitVersion,
            description: "Compiled directly into Devyy — blazingly fast source control engine",
            active: activeProvider === "hit",
          },
          {
            label: "Git",
            installed: status?.gitInstalled || vcsInfo.gitAvailable,
            version: vcsInfo.gitVersion,
            url: "https://git-scm.com/downloads",
            description: "System Git binary for standard version control",
            active: activeProvider === "git",
          },
          {
            label: "GitHub CLI",
            installed: status?.cliInstalled,
            url: "https://cli.github.com/",
            description: "Browser sign-in and secure credential storage",
          },
        ].map((item) => (
          <div key={item.label}>
            <span>
              <strong>
                {item.label}
                {item.active && <span className="vcs-tag-active">Active</span>}
              </strong>
              <small>
                {item.description}
                {item.version && ` (${item.version})`}
              </small>
            </span>
            {!status && !vcsInfo ? (
              <span className="github-installed">
                {native ? "Checking…" : "Desktop app"}
              </span>
            ) : item.installed ? (
              <span className="github-installed">
                <Check size={13} /> Installed
              </span>
            ) : item.url ? (
              <button
                className="setting-action"
                onClick={() => browse(item.url!)}
                disabled={!native}
              >
                <Download size={13} /> Download {item.label}
              </button>
            ) : (
              <span className="github-installed">Built-in</span>
            )}
          </div>
        ))}
      </div>

      {/* Connect GitHub */}
      {!status?.connected && (
        <div className="github-connect">
          <label>
            <input
              type="checkbox"
              checked={credentials}
              onChange={(event) => setCredentials(event.target.checked)}
              disabled={!!busy}
            />
            Use this account for Git & Hit HTTPS authentication
          </label>
          <button
            className="primary"
            disabled={
              !native ||
              !status?.cliInstalled ||
              !!busy
            }
            onClick={() => void login()}
          >
            {busy === "login" ? (
              <LoaderCircle size={14} className="spinning" />
            ) : (
              <Github size={14} />
            )}{" "}
            Continue with GitHub
          </button>
          <small>
            GitHub CLI opens its official browser authorization. Source control also works
            locally without signing in.
          </small>
        </div>
      )}

      {busy === "login" && (
        <div className="github-device-flow" role="status">
          {code ? (
            <>
              <span>Enter this code on GitHub</span>
              <div>
                <code>{code}</code>
                <button
                  className="icon-button"
                  aria-label="Copy GitHub code"
                  onClick={() =>
                    void writeText(code).catch((error) =>
                      setError(String(error)),
                    )
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              <button
                className="setting-action"
                onClick={() => browse("https://github.com/login/device")}
              >
                Open GitHub <ExternalLink size={12} />
              </button>
            </>
          ) : (
            <span>Waiting for GitHub authorization…</span>
          )}
          <button
            className="secondary"
            onClick={() => {
              if (active.current)
                void invoke("ai_cancel", { requestId: active.current });
            }}
          >
            Cancel sign-in
          </button>
        </div>
      )}

      {/* Commit Identity */}
      {(status?.gitInstalled || vcsInfo.hitAvailable) && (
        <form
          className="github-identity"
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              setBusy("identity");
              setError("");
              try {
                await identity(name, email);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy("");
              }
            })();
          }}
        >
          <h4>Commit author identity</h4>
          <p className="muted">
            Used for commits in Hit and Git. Repository settings take precedence.
          </p>
          <label>
            Name
            <input
              aria-label="Commit author name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              aria-label="Commit author email"
              type="text"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            className="setting-action"
            disabled={!!busy || !name.trim() || !email.includes("@")}
          >
            <Check size={13} /> Save commit author
          </button>
        </form>
      )}

      {notice && (
        <p role="status" className="ai-provider-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
