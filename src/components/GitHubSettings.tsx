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
  Check,
  Copy,
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke, listen, native } from "../lib/native";
import { useConfirm } from "./ui/Confirm";
interface GitHubStatus {
  gitInstalled: boolean;
  cliInstalled: boolean;
  connected: boolean;
  gitName: string;
  gitEmail: string;
  account?: { login: string; name: string; email: string; avatarUrl?: string };
}
export default function GitHubSettings() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<GitHubStatus>();
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
      const value = await invoke<GitHubStatus>("github_status");
      if (!mounted.current) return;
      setStatus(value);
      setName(value.gitName || value.account?.name || "");
      setEmail(value.gitEmail || value.account?.email || "");
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
  async function identity(nextName: string, nextEmail: string) {
    await invoke("github_git_identity", { name: nextName, email: nextEmail });
    setName(nextName);
    setEmail(nextEmail);
    setStatus((old) =>
      old ? { ...old, gitName: nextName, gitEmail: nextEmail } : old,
    );
    setNotice("Git commit identity saved");
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
          title: "Use your GitHub identity for Git?",
          description: `Set the global Git name to ${value.account.name} and email to ${value.account.email}?${value.gitName || value.gitEmail ? ` This replaces your current global identity (${value.gitName || "no name"}, ${value.gitEmail || "no email"}).` : " This applies to repositories on this machine unless they override it."}`,
          confirmLabel: "Set Git identity",
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
  return (
    <section className="github-settings" aria-label="GitHub and Git">
      <div className="github-account-header">
        <Github size={28} />
        <span>
          <strong>{status?.account?.login ?? "GitHub"}</strong>
          <small>
            {status?.connected
              ? "Connected through GitHub CLI"
              : "Connect repositories and authenticate Git over HTTPS"}
          </small>
        </span>
        <button
          className="icon-button"
          aria-label="Check GitHub and Git"
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
          Open the desktop app to connect GitHub and configure Git.
        </p>
      )}
      <div className="github-dependencies">
        {[
          {
            label: "Git",
            installed: status?.gitInstalled,
            url: "https://git-scm.com/downloads",
            description: "Local branches, commits and diffs",
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
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            {!status ? (
              <span className="github-installed">
                {native ? "Checking…" : "Desktop app"}
              </span>
            ) : item.installed ? (
              <span className="github-installed">
                <Check size={13} /> Installed
              </span>
            ) : (
              <button
                className="setting-action"
                onClick={() => browse(item.url)}
                disabled={!native}
              >
                <Download size={13} /> Download {item.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {!status?.connected && (
        <div className="github-connect">
          <label>
            <input
              type="checkbox"
              checked={credentials}
              onChange={(event) => setCredentials(event.target.checked)}
              disabled={!!busy}
            />
            Use this account for Git HTTPS authentication
          </label>
          <button
            className="primary"
            disabled={
              !native ||
              !status?.cliInstalled ||
              !status?.gitInstalled ||
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
            GitHub CLI opens its official browser authorization. Git also works
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
      {status?.gitInstalled && (
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
          <h4>Git commit identity</h4>
          <p className="muted">
            Saved globally for this machine. Repository settings take
            precedence.
          </p>
          <label>
            Name
            <input
              aria-label="Git name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              aria-label="Git email"
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
            <Check size={13} /> Save Git name & email
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
