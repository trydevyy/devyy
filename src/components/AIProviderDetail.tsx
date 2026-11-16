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

import DisclosureSummary from "./ui/DisclosureSummary";
import ProviderSignIn from "./ProviderSignIn";
import Select from "./ui/Select";
import SuggestionInput from "./ui/SuggestionInput";
import { AnimatePresence, motion } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  ChartNoAxesColumn,
  Download,
} from "lucide-react";
import {
  aiAccount,
  discoverAIModels,
  removeAIProvider,
  saveAIProvider,
  useAI,
  type AIProvider,
} from "../lib/ai";
import { invoke, listen, native } from "../lib/native";
import AIProviderIcon from "./AIProviderIcon";

function CLIFields({
  provider,
  onChange,
  onError,
}: {
  provider: AIProvider;
  onChange: (patch: Partial<AIProvider>) => void;
  onError: (message: string) => void;
}) {
  const [args, setArgs] = useState(() => JSON.stringify(provider.args ?? []));
  const [error, setError] = useState("");
  useEffect(() => () => onError(""), []);
  return (
    <>
      <div className="ai-provider-field">
        <label htmlFor={`cli-executable-${provider.id}`}>CLI executable</label>
        <input
          id={`cli-executable-${provider.id}`}
          value={provider.executable}
          onChange={(e) => onChange({ executable: e.target.value })}
          placeholder="ollama or /path/to/your/cli"
          spellCheck={false}
        />
      </div>
      <div className="ai-provider-field">
        <label htmlFor={`cli-args-${provider.id}`}>
          Arguments (JSON array)
        </label>
        <input
          id={`cli-args-${provider.id}`}
          value={args}
          placeholder={'["run", "{model}"]'}
          spellCheck={false}
          aria-invalid={!!error}
          onChange={(e) => {
            setArgs(e.target.value);
            try {
              const value: unknown = JSON.parse(e.target.value);
              if (
                !Array.isArray(value) ||
                !value.every((arg) => typeof arg === "string")
              )
                throw Error();
              onChange({ args: value });
              setError("");
              onError("");
            } catch {
              const message =
                'Use a JSON array of strings, such as ["run", "{model}"].';
              setError(message);
              onError(message);
            }
          }}
        />
        {error && (
          <small className="ai-error" role="alert">
            {error}
          </small>
        )}
      </div>
      <div className="ai-provider-field">
        <label htmlFor={`cli-format-${provider.id}`}>Input & output</label>
        <Select
          id={`cli-format-${provider.id}`}
          value={provider.cliJson ? "json" : "text"}
          onChange={(e) => onChange({ cliJson: e.target.value === "json" })}
        >
          <option value="text">Prompt on stdin / text on stdout</option>
          <option value="json">JSON request / JSONL events</option>
        </Select>
      </div>
      <p className="ai-provider-notice">
        Arguments are passed directly, with no shell. <code>{"{model}"}</code>{" "}
        uses the selected model. Your CLI manages its own sign-in. Only attached
        conversation context is sent to CLI providers.
      </p>
      {provider.cliJson && (
        <details className="ai-cli-contract">
          <DisclosureSummary>JSONL format</DisclosureSummary>
          <p>
            Input includes system, messages and model. Write one event per line:
          </p>
          <pre>
            {
              '{"type":"delta","text":"Hello"}\n{"type":"usage","input_tokens":10,"output_tokens":2}\n{"type":"done"}'
            }
          </pre>
        </details>
      )}
    </>
  );
}
export function accountInfo(provider: AIProvider, account?: Record<string, unknown>) {
  const identity = (account?.account ?? account) as
    Record<string, unknown> | undefined;
  const connected = ["chatgpt"].includes(provider.kind)
    ? !!account?.account
    : account?.loggedIn === true;
  return {
    identity,
    connected,
    label:
      provider.enabled === false
        ? "Disabled"
        : connected
          ? `Connected${identity?.planType ? ` / ${identity.planType}` : ""}`
          : provider.kind === "cli"
            ? provider.executable
              ? "Application configured"
              : "Choose an application"
            : ["antigravity", "opencode"].includes(provider.kind)
              ? provider.executable
                ? "Application configured"
                : "Set up"
              : provider.hasKey
                ? "API key saved"
                : provider.kind === "custom" &&
                    provider.endpoint &&
                    provider.model
                  ? "Configured"
                  : account
                    ? "Signed out"
                    : ["chatgpt", "claude"].includes(provider.kind)
                      ? "Sign in"
                      : "Set up",
  };
}
export default function AIProviderDetail({
  provider,
  onRemoved,
  onUsage,
}: {
  provider: AIProvider;
  onRemoved: () => void;
  onUsage: (button: HTMLButtonElement) => void;
}) {
  const { transition } = useSurfaceMotion();
  const state = useAI(),
    [form, setForm] = useState(provider),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [runtime, setRuntime] = useState<Record<string, string>>(),
    [runtimeOpen, setRuntimeOpen] = useState(false),
    [runtimeMissing, setRuntimeMissing] = useState(false),
    [installPhase, setInstallPhase] = useState("");
  const [argsError, setArgsError] = useState("");
  const installCancelled = useRef(false);
  const request = useRef<string | null>(null),
    saved = useRef(provider);
  useEffect(() => {
    const previous = saved.current;
    saved.current = provider;
    const fields = [
      "id",
      "name",
      "kind",
      "endpoint",
      "model",
      "executable",
      "cliJson",
    ] as const;
    if (fields.some((field) => previous[field] !== provider[field]))
      setForm(provider);
    else setForm((current) => ({ ...current, enabled: provider.enabled }));
  }, [provider]);
  useEffect(
    () => () => {
      installCancelled.current = true;
      if (request.current)
        void invoke("ai_cancel", { requestId: request.current }).catch(
          () => {},
        );
    },
    [],
  );
  const { identity, connected, label } = accountInfo(
      provider,
      state.accounts[provider.id],
    ),
    accountProvider = ["chatgpt", "claude"].includes(form.kind),
    custom = ![
      "chatgpt",
      "claude",
      "antigravity",
      "opencode",
      "openai",
      "anthropic",
    ].includes(provider.id);
  async function action(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function refreshModels() {
    await saveAIProvider(form, key);
    setKey("");
    const models = await discoverAIModels(provider.id, true);
    const builtInCLI = ["antigravity", "opencode"].includes(form.kind);
    if (
      models.length &&
      (!form.model || (builtInCLI && !models.some((m) => m.id === form.model)))
    ) {
      const chosen = models.find((m) => m.isDefault) ?? models[0];
      const next = { ...form, model: chosen.id };
      await saveAIProvider(next, "");
      setForm(next);
    }
    setNotice(
      models.length
        ? `${models.length} models available`
        : "No models available yet. Check your connection and try again.",
    );
  }
  async function accountAction(
    action: "login" | "add" | "select" | "logout" | "status",
    accountId?: string,
  ) {
    request.current = crypto.randomUUID();
    try {
      if (action === "login" || action === "add")
        await saveAIProvider(form, "");
      const result = await aiAccount(
        form.id,
        action,
        request.current,
        accountId,
      );
      if (typeof result.notice === "string") setNotice(result.notice);
      if (form.kind === "claude" && action !== "status") {
        request.current = crypto.randomUUID();
        await aiAccount(form.id, "status", request.current);
      }
    } finally {
      request.current = null;
    }
  }
  useEffect(() => {
    if (provider.kind === "chatgpt" && native)
      void action("status", () => accountAction("status"));
    if (
      ["claude", "antigravity", "opencode"].includes(provider.kind) &&
      native
    ) {
      let current = true;
      void invoke<Record<string, string>>("ai_runtime", {
        providerId: provider.id,
      })
        .then((value) => {
          if (current) {
            setRuntime(value);
            setRuntimeMissing(false);
          }
        })
        .catch(() => {
          if (current) setRuntimeMissing(true);
        });
      return () => {
        current = false;
      };
    }
  }, [provider.id, provider.kind]);
  async function installRuntime() {
    const id = crypto.randomUUID();
    request.current = id;
    installCancelled.current = false;
    let unlisten: (() => void) | undefined;
    try {
      setInstallPhase("Downloading installer");
      unlisten = await listen<{
        requestId: string;
        kind: string;
        data: { phase?: string };
      }>("devyy-ai", (event: { payload: { requestId: string; kind: string; data: { phase?: string } } }) => {
        const payload = event.payload;
        if (payload.requestId !== id || payload.kind !== "install") return;
        setInstallPhase(
          payload.data.phase === "verifying"
            ? "Checking installation"
            : payload.data.phase === "installing"
              ? `Installing ${form.name}`
              : "Downloading installer",
        );
      });
      if (installCancelled.current) return;
      const result = await invoke<Record<string, string>>(
        "ai_install_runtime",
        { providerId: provider.id, requestId: id },
      );
      const installed = { ...form, executable: result.executable };
      await saveAIProvider(installed, "");
      setForm(installed);
      setRuntime(result);
      setRuntimeMissing(false);
      setNotice(
        form.kind === "claude"
          ? "Claude Code installed"
          : `${form.name} installed`,
      );
    } finally {
      unlisten?.();
      request.current = null;
      setInstallPhase("");
    }
  }
  function patch(patch: Partial<AIProvider>) {
    setForm((old) => ({ ...old, ...patch }));
    setNotice("");
  }
  return (
    <section className="ai-provider-detail" aria-label={provider.name}>
      <header>
        <AIProviderIcon kind={provider.kind} size={22} />
        <h3>{provider.name}</h3>
        <span className={connected ? "ai-provider-authenticated" : ""}>
          {connected && <Check size={12} />} {label}
        </span>
      </header>
      <div className="ai-provider-detail-scroll">
        <div className="ai-connection-card">
          <AIProviderIcon kind={provider.kind} size={28} />
          <div>
            <strong>
              {connected
                ? String(identity?.email ?? "Connected account")
                : accountProvider
                  ? "Connect your account"
                  : ["antigravity", "opencode"].includes(form.kind)
                    ? runtime?.version
                      ? `${form.name} v${runtime.version}`
                      : runtimeMissing
                        ? `${form.name} needs to be installed`
                        : `${form.name} account`
                    : "Add an API key"}
            </strong>
            <span>
              {connected
                ? String(identity?.planType ?? "Ready to use in Devyy")
                : form.kind === "chatgpt"
                  ? "Sign in securely in your browser"
                  : form.kind === "claude"
                    ? "Claude Code on this computer"
                    : form.kind === "antigravity"
                      ? "Google account"
                      : form.kind === "opencode"
                        ? "Open-source developer agent"
                        : "Connect to your AI service"}
            </span>
          </div>
          {connected && <Check size={16} />}
        </div>
        <ol className="ai-provider-steps" aria-label="Connection steps">
          <li
            className={
              runtime || provider.hasKey || connected || form.kind === "chatgpt"
                ? "complete"
                : ""
            }
          >
            <span>1</span>
            {["claude", "antigravity", "opencode"].includes(form.kind)
              ? "Install"
              : "Connect"}
          </li>
          <li className={connected || provider.hasKey ? "complete" : ""}>
            <span>2</span>
            {["chatgpt", "claude", "antigravity", "opencode"].includes(
              form.kind,
            )
              ? "Sign in"
              : "Add key"}
          </li>
          <li className={form.model ? "complete" : ""}>
            <span>3</span>Choose a model
          </li>
        </ol>
        <details className="ai-provider-name-details">
          <DisclosureSummary>Display name</DisclosureSummary>
          <div className="ai-provider-field">
            <label htmlFor={`ai-name-${provider.id}`}>Display name</label>
            <input
              id={`ai-name-${provider.id}`}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
        </details>
        <section className="ai-provider-section">
          <h4>Connection</h4>
          {["claude", "antigravity", "opencode"].includes(form.kind) &&
            runtimeMissing && (
              <div className="ai-runtime-install">
                <div>
                  <strong>Install {form.name} CLI</strong>
                  <span>
                    {form.kind === "antigravity"
                      ? "Install once, then sign in with Google"
                      : form.kind === "opencode"
                        ? "Install once, then connect an account"
                        : "Install once, then sign in with Claude"}
                  </span>
                </div>
                <button
                  className="setting-action"
                  disabled={!!busy || !native}
                  onClick={() => void action("install", installRuntime)}
                >
                  {busy === "install" ? (
                    <LoaderCircle className="spinning" size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {installPhase || "Install"}
                </button>
                {busy === "install" && (
                  <button
                    className="ai-text-action"
                    onClick={() => {
                      installCancelled.current = true;
                      if (request.current)
                        void invoke("ai_cancel", {
                          requestId: request.current,
                        });
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          {accountProvider ? (
            <>
              <div className="ai-provider-account-row">
                <span>
                  <strong>
                    {form.kind === "chatgpt"
                      ? "ChatGPT"
                      : "Claude Code account"}
                  </strong>
                  <small>
                    {connected
                      ? "Account connected"
                      : form.kind === "chatgpt"
                        ? "Authorize Devyy in your browser"
                        : "Uses Claude Code’s browser sign-in"}
                  </small>
                </span>
                <button
                  className="setting-action"
                  disabled={
                    !!busy ||
                    !native ||
                    (form.kind === "claude" && runtimeMissing)
                  }
                  onClick={() =>
                    void action("login", () => accountAction("login"))
                  }
                >
                  {busy === "login" ? (
                    <LoaderCircle className="spinning" size={12} />
                  ) : (
                    <ExternalLink size={12} />
                  )}{" "}
                  {form.kind === "chatgpt"
                    ? connected
                      ? "Reconnect"
                      : "Continue with ChatGPT"
                    : connected
                      ? "Change account"
                      : "Sign in"}
                </button>
                {connected && (
                  <button
                    className="ai-text-action"
                    disabled={!!busy}
                    onClick={() =>
                      void action("logout", () => accountAction("logout"))
                    }
                  >
                    Disconnect
                  </button>
                )}
                {busy === "login" && (
                  <button
                    className="ai-text-action"
                    onClick={() => {
                      if (request.current)
                        void invoke("ai_cancel", {
                          requestId: request.current,
                        }).catch(() => {});
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {form.kind === "chatgpt" && (
                <>
                  {Array.isArray(state.accounts[provider.id]?.accounts) &&
                    (
                      state.accounts[provider.id].accounts as {
                        id: string;
                        email?: string;
                        connected: boolean;
                        active: boolean;
                      }[]
                    ).length > 0 && (
                      <div className="ai-provider-field">
                        <label htmlFor={`ai-account-${provider.id}`}>
                          Saved accounts
                        </label>
                        <Select
                          id={`ai-account-${provider.id}`}
                          disabled={!!busy || !native}
                          value={
                            (
                              state.accounts[provider.id].accounts as {
                                id: string;
                                active: boolean;
                              }[]
                            ).find((a) => a.active)?.id ?? ""
                          }
                          onChange={(e) => {
                            const account = (
                              state.accounts[provider.id].accounts as {
                                id: string;
                                connected: boolean;
                              }[]
                            ).find((a) => a.id === e.target.value);
                            if (account)
                              void action("select", () =>
                                accountAction(
                                  account.connected ? "select" : "login",
                                  account.id,
                                ),
                              );
                          }}
                        >
                          <option value="" disabled>
                            Choose an account
                          </option>
                          {(
                            state.accounts[provider.id].accounts as {
                              id: string;
                              email?: string;
                              connected: boolean;
                            }[]
                          ).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.email ?? "ChatGPT account"} / {a.id.slice(-8)}
                              {a.connected ? "" : " / Signed out"}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  <button
                    className="ai-text-action"
                    disabled={!!busy || !native}
                    onClick={() =>
                      void action("login", () => accountAction("add"))
                    }
                  >
                    <Plus size={12} /> Add ChatGPT account or workspace
                  </button>
                  {connected &&
                    state.accounts[provider.id]?.planEnabled === false && (
                      <p className="ai-provider-notice" role="status">
                        ChatGPT plan access was not granted. Reconnect and
                        enable plan use on Devyy’s authorization screen.
                      </p>
                    )}
                </>
              )}
              {form.kind === "claude" && (
                <p className="ai-provider-notice">
                  For a direct Devyy connection, use an Anthropic API key.
                  Claude account access runs through the official Claude Code
                  app.
                </p>
              )}
            </>
          ) : (
            <>
              {custom && (
                <div className="ai-provider-field">
                  <label htmlFor={`ai-protocol-${provider.id}`}>Protocol</label>
                  <Select
                    id={`ai-protocol-${provider.id}`}
                    value={
                      form.kind === "cli"
                        ? "cli"
                        : form.kind === "anthropic"
                          ? "anthropic"
                          : "custom"
                    }
                    onChange={(e) =>
                      patch({ kind: e.target.value as AIProvider["kind"] })
                    }
                  >
                    <option value="custom">OpenAI compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                    <option value="cli">Command line (CLI)</option>
                  </Select>
                </div>
              )}
              {form.kind === "cli" ? (
                <CLIFields
                  provider={form}
                  onChange={patch}
                  onError={setArgsError}
                />
              ) : ["antigravity", "opencode"].includes(form.kind) ? (
                <>
                  <ProviderSignIn
                    provider={form}
                    executable={runtime?.executable}
                    disabled={!!busy || !native || runtimeMissing}
                    onDone={() => void action("models", refreshModels)}
                  />
                  {form.kind === "antigravity" && (
                    <p className="ai-provider-notice">
                      Sign in with Google to use the models available to your
                      Antigravity account.
                    </p>
                  )}
                  {form.kind === "opencode" && (
                    <p className="ai-provider-notice">
                      Connect an account in OpenCode, then choose one of its
                      available models.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="ai-provider-field">
                    <label htmlFor={`ai-endpoint-${provider.id}`}>
                      API base URL
                    </label>
                    <input
                      id={`ai-endpoint-${provider.id}`}
                      value={form.endpoint}
                      onChange={(e) => patch({ endpoint: e.target.value })}
                      spellCheck={false}
                      placeholder="https://api.example.com/v1"
                    />
                  </div>
                  <div className="ai-provider-field">
                    <label htmlFor={`ai-key-${provider.id}`}>API key</label>
                    <div>
                      <input
                        id={`ai-key-${provider.id}`}
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder={
                          provider.hasKey
                            ? "Saved in system credential store"
                            : "API key"
                        }
                        autoComplete="new-password"
                        spellCheck={false}
                      />
                      {provider.hasKey && (
                        <button
                          className="ai-text-action"
                          disabled={!!busy}
                          onClick={() =>
                            void action("remove-key", () =>
                              saveAIProvider(form, "", true),
                            )
                          }
                        >
                          Remove key
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
        <section className="ai-provider-section">
          <h4>Models</h4>
          <div className="ai-provider-field">
            <label htmlFor={`ai-model-${provider.id}`}>Default model</label>
            <SuggestionInput
              id={`ai-model-${provider.id}`}
              aria-label="Model"
              suggestions={state.models[provider.id] ?? []}
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={
                accountProvider || form.kind === "cli"
                  ? "Provider default"
                  : "Choose or enter a model"
              }
              spellCheck={false}
            />
          </div>
          <button
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() => void action("models", refreshModels)}
          >
            {busy === "models" ? (
              <LoaderCircle className="spinning" size={12} />
            ) : (
              <RefreshCw size={12} />
            )}{" "}
            Refresh models
          </button>
        </section>
        <section className="ai-provider-section ai-provider-runtime">
          <button
            className="ai-runtime-heading"
            aria-expanded={runtimeOpen}
            onClick={() => {
              setRuntimeOpen(!runtimeOpen);
              if (!runtimeOpen && !runtime && native)
                void action("runtime", async () =>
                  setRuntime(
                    await invoke<Record<string, string>>("ai_runtime", {
                      providerId: provider.id,
                    }),
                  ),
                );
            }}
          >
            <ChevronRight size={13} className={runtimeOpen ? "rotated" : ""} />
            <h4>Advanced connection settings</h4>
            {runtime?.version && <code>{runtime.version}</code>}
          </button>
          <AnimatePresence initial={false}>
            {runtimeOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={transition}
                style={{ overflow: "hidden" }}
              >
                {["claude", "antigravity", "opencode"].includes(form.kind) && (
                  <div className="ai-provider-field">
                    <label htmlFor={`ai-cli-${provider.id}`}>
                      CLI executable
                    </label>
                    <input
                      id={`ai-cli-${provider.id}`}
                      value={form.executable}
                      onChange={(e) => patch({ executable: e.target.value })}
                      placeholder={
                        form.kind === "antigravity"
                          ? "agy (auto-detect)"
                          : `${form.kind} (auto-detect)`
                      }
                      spellCheck={false}
                    />
                  </div>
                )}
                {runtime && (
                  <dl>
                    {Object.entries(runtime).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="ai-provider-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <footer>
        {custom && (
          <button
            className="ai-text-action ai-danger-action"
            disabled={!!busy || !native}
            onClick={() =>
              void action("delete", async () => {
                await removeAIProvider(provider.id);
                onRemoved();
              })
            }
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
        <button
          className="ai-text-action"
          onClick={(event) => onUsage(event.currentTarget)}
        >
          <ChartNoAxesColumn size={13} /> Usage
        </button>
        {accountProvider && (
          <button
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() => void action("status", () => accountAction("status"))}
          >
            <RefreshCw size={12} /> Check account & usage
          </button>
        )}
        <button
          className="setting-action ai-primary-action"
          disabled={!!busy || !native || !!argsError}
          onClick={() =>
            void action("save", async () => {
              await saveAIProvider(form, key);
              setKey("");
              setNotice("Provider saved");
            })
          }
        >
          {busy === "save" ? (
            <LoaderCircle size={12} className="spinning" />
          ) : (
            <Check size={12} />
          )}{" "}
          Save provider
        </button>
      </footer>
    </section>
  );
}
