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
import Skeleton from "./ui/Skeleton";
import { InstallProgress } from "./ExtensionProgress";
import DisclosureSummary from "./ui/DisclosureSummary";
import ErrorToast from "./ui/ErrorToast";
import ProviderSignIn from "./ProviderSignIn";
import Select from "./ui/Select";
import { AnimatePresence, motion } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  ChartNoAxesColumn,
  Download,
} from "lucide-react";
import {
  aiProviderReady,
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
        {error && <ErrorToast message={error} />}
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
export function accountInfo(
  provider: AIProvider,
  account?: Record<string, unknown>,
) {
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
  active = true,
  onRemoved,
  onSaved,
  onUsage,
}: {
  provider: AIProvider;
  active?: boolean;
  onRemoved: () => void;
  onSaved?: () => void;
  onUsage?: (button: HTMLButtonElement) => void;
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
    [runtimeError, setRuntimeError] = useState(""),
    [runtimeChecking, setRuntimeChecking] = useState(false),
    [installPhase, setInstallPhase] = useState("");
  const [argsError, setArgsError] = useState("");
  const [enterModel, setEnterModel] = useState(false);
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
  const builtInCLI = ["claude", "antigravity", "opencode"].includes(form.kind);
  const runtimeMissing = builtInCLI && Boolean(runtimeError);
  const providerDefault = builtInCLI || form.kind === "cli";

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
  async function refreshModels(confirmedSignIn = false) {
    await saveAIProvider(form, key);
    setKey("");
    const models = await discoverAIModels(provider.id, true, confirmedSignIn);
    if (
      models.length &&
      (!form.model ||
        (["antigravity", "opencode"].includes(form.kind) &&
          !models.some((m) => m.id === form.model)))
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
    request.current = newRequestId();
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
        request.current = newRequestId();
        await aiAccount(form.id, "status", request.current);
      }
    } finally {
      request.current = null;
    }
  }
  useEffect(() => {
    if (
      !active ||
      !["claude", "antigravity", "opencode"].includes(provider.kind) ||
      !native
    )
      return;
    let current = true;
    setRuntimeChecking(true);
    setRuntimeError("");
    setRuntime(undefined);
    void invoke<Record<string, string>>("ai_runtime", {
      providerId: provider.id,
      probeOnly: true,
    })
      .then((value) => {
        if (current) setRuntime(value);
      })
      .catch((error) => {
        if (current) setRuntimeError(String(error));
      })
      .finally(() => {
        if (current) setRuntimeChecking(false);
      });
    return () => {
      current = false;
    };
  }, [active, provider.id, provider.kind, provider.executable]);

  async function checkRuntime() {
    setRuntimeError("");
    try {
      const result = await invoke<Record<string, string>>("ai_runtime", {
        providerId: provider.id,
        executable: form.executable,
      });
      const version = form.kind === "antigravity" ? undefined : result.version;
      setRuntime(version ? result : { executable: result.executable });
      setNotice(
        version
          ? `${form.name} version ${version}`
          : `${form.name} executable found.`,
      );
    } catch (error) {
      setRuntime(undefined);
      setRuntimeError(String(error));
      throw error;
    }
  }

  async function installRuntime() {
    const id = newRequestId();
    request.current = id;
    installCancelled.current = false;
    let unlisten: (() => void) | undefined;
    try {
      setInstallPhase("Downloading installer");
      unlisten = await listen<{
        requestId: string;
        kind: string;
        data: { phase?: string };
      }>(
        "devyy-ai",
        (event: {
          payload: {
            requestId: string;
            kind: string;
            data: { phase?: string };
          };
        }) => {
          const payload = event.payload;
          if (payload.requestId !== id || payload.kind !== "install") return;
          setInstallPhase(
            payload.data.phase === "verifying"
              ? "Checking installation"
              : payload.data.phase === "installing"
                ? `Installing ${form.name}`
                : "Downloading installer",
          );
        },
      );
      if (installCancelled.current) return;
      const result = await invoke<Record<string, string>>(
        "ai_install_runtime",
        { providerId: provider.id, requestId: id },
      );
      const installed = { ...form, executable: result.executable };
      await saveAIProvider(installed, "");
      setForm(installed);
      setRuntime(result);
      setRuntimeError("");
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
      {!onSaved && (
        <header>
          <AIProviderIcon kind={provider.kind} size={22} />
          <h3>{provider.name}</h3>
          <span
            className={
              aiProviderReady(provider, state)
                ? "ai-provider-authenticated"
                : ""
            }
          >
            {connected && <Check size={12} />} {label}
          </span>
        </header>
      )}
      <div className="ai-provider-detail-scroll">
        <section className="ai-provider-section">
          {!onSaved && <h4>Connection</h4>}
          {custom && (
            <div className="ai-provider-field">
              <label htmlFor={`ai-name-${provider.id}`}>Display name</label>
              <input
                id={`ai-name-${provider.id}`}
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
          )}
          {runtimeChecking && (
            <p className="ai-provider-notice" role="status">
              Looking for {form.name} on this computer...
            </p>
          )}
          {runtimeMissing && (
            <div className="ai-runtime-install">
              <div>
                <strong>{form.name} could not start</strong>
                <span>
                  {form.kind === "antigravity"
                    ? "Install once, then sign in with Google"
                    : form.kind === "opencode"
                      ? "Install once, then connect an account"
                      : "Install once, then sign in with Claude"}
                </span>
              </div>
              <button
                aria-busy={busy === "install"}
                className="setting-action"
                disabled={!!busy || !native}
                onClick={() => void action("install", installRuntime)}
              >
                <Download size={14} />
                Install
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
              {busy === "install" && (
                <InstallProgress
                  name={form.name}
                  status={installPhase || "Installing…"}
                />
              )}
            </div>
          )}
          {runtimeMissing && (
            <div className="ai-provider-runtime-error">
              <small>{runtimeError}</small>
              <button
                className="ai-text-action"
                type="button"
                onClick={() => setRuntimeOpen(true)}
              >
                Configure executable
              </button>
            </div>
          )}
          {accountProvider ? (
            <>
              <div className="ai-provider-account-row">
                <span>
                  <strong>
                    {form.kind === "chatgpt"
                      ? "ChatGPT account"
                      : "Claude Code account"}
                  </strong>
                  <small>
                    {connected
                      ? String(identity?.email ?? "Account connected")
                      : form.kind === "chatgpt"
                        ? "Authorize Devyy in your browser"
                        : "Uses Claude Code’s browser sign-in"}
                  </small>
                </span>
                <button
                  aria-busy={busy === "login"}
                  className="setting-action"
                  disabled={
                    !!busy ||
                    !native ||
                    (form.kind === "claude" &&
                      (runtimeChecking || runtimeMissing))
                  }
                  onClick={() =>
                    void action("login", () => accountAction("login"))
                  }
                >
                  <ExternalLink size={12} />{" "}
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
                  <label htmlFor={`ai-protocol-${provider.id}`}>
                    Connection type
                  </label>
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
                    disabled={
                      !!busy || !native || runtimeChecking || runtimeMissing
                    }
                    onDone={() =>
                      void action("models", () => refreshModels(true))
                    }
                  />
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
                            ? "Key saved"
                            : form.kind === "custom"
                              ? "Optional for some providers"
                              : "Enter API key"
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
        {onSaved ? (
          <section className="ai-provider-section">
            <div className="ai-provider-field">
              <label htmlFor={`ai-model-${provider.id}`}>
                Default model <small>Optional</small>
              </label>
              <input
                id={`ai-model-${provider.id}`}
                aria-label="Model ID"
                value={form.model}
                onChange={(event) => patch({ model: event.target.value })}
                placeholder="Enter a model ID"
                spellCheck={false}
              />
            </div>
            <p className="ai-provider-section-help">
              You can load the model list after saving.
            </p>
          </section>
        ) : (
          <section className="ai-provider-section">
            <h4>Model</h4>
            <p className="ai-provider-section-help">
              {providerDefault
                ? "Leave this blank to use the provider's default model."
                : "Load the models available from this provider, or enter a model ID."}
            </p>
            <div className="ai-provider-field">
              <label htmlFor={`ai-model-${provider.id}`}>Default model</label>
              {enterModel ? (
                <input
                  id={`ai-model-${provider.id}`}
                  aria-label="Model ID"
                  value={form.model}
                  onChange={(event) => patch({ model: event.target.value })}
                  spellCheck={false}
                />
              ) : (
                <Select
                  id={`ai-model-${provider.id}`}
                  aria-label="Model"
                  value={form.model}
                  onOpenChange={(open) => {
                    if (
                      open &&
                      native &&
                      !busy &&
                      !runtimeMissing &&
                      !runtimeChecking &&
                      (!accountProvider || connected) &&
                      !state.models[provider.id]
                    ) {
                      void action("catalog", () =>
                        discoverAIModels(provider.id),
                      );
                    }
                  }}
                  onChange={(event) => patch({ model: event.target.value })}
                >
                  <option value="">
                    {providerDefault ? "Provider default" : "Choose a model"}
                  </option>
                  {form.model &&
                    !state.models[provider.id]?.some(
                      (model) => model.id === form.model,
                    ) && <option value={form.model}>{form.model}</option>}
                  {(state.models[provider.id] ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name || model.id}
                    </option>
                  ))}
                </Select>
              )}
              {busy === "catalog" && (
                <Skeleton variant="inline" label="Loading models" />
              )}
              <button
                type="button"
                className="ai-text-action"
                onClick={() => setEnterModel(!enterModel)}
              >
                {enterModel ? "Use model list" : "Enter model ID"}
              </button>
            </div>
            <button
              aria-busy={busy === "models"}
              className="setting-action"
              disabled={!!busy || !native || runtimeChecking || runtimeMissing}
              onClick={() => void action("models", refreshModels)}
            >
              <RefreshCw size={12} /> Load models
            </button>
          </section>
        )}
        {builtInCLI && (
          <section className="ai-provider-section ai-provider-runtime">
            <button
              className="ai-runtime-heading"
              aria-expanded={runtimeOpen}
              onClick={() => setRuntimeOpen(!runtimeOpen)}
            >
              <ChevronRight
                size={13}
                className={runtimeOpen ? "rotated" : ""}
              />
              <h4>Troubleshooting</h4>
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
                  {builtInCLI && (
                    <div className="ai-provider-field">
                      <label htmlFor={`ai-cli-${provider.id}`}>
                        Executable path
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
                  {builtInCLI && (
                    <button
                      className="setting-action"
                      aria-busy={busy === "runtime"}
                      disabled={!!busy || runtimeChecking || !native}
                      onClick={() => void action("runtime", checkRuntime)}
                    >
                      <RefreshCw size={12} /> Check executable
                    </button>
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
        )}
        {error && <ErrorToast message={error} />}
        {notice && (
          <p className="ai-provider-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <footer>
        {onSaved && (
          <button className="secondary" onClick={onRemoved}>
            Cancel
          </button>
        )}
        {custom && !onSaved && (
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
        {onUsage && (
          <button
            className="ai-text-action"
            onClick={(event) => onUsage(event.currentTarget)}
          >
            <ChartNoAxesColumn size={13} /> Usage
          </button>
        )}
        {accountProvider && (
          <button
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() => void action("status", () => accountAction("status"))}
          >
            <RefreshCw size={12} /> Check sign-in
          </button>
        )}
        <button
          aria-busy={busy === "save"}
          className="setting-action ai-primary-action"
          disabled={!!busy || !native || !!argsError}
          onClick={() =>
            void action("save", async () => {
              await saveAIProvider(form, key);
              setKey("");
              setNotice("Provider saved");
              onSaved?.();
            })
          }
        >
          <Check size={12} /> Save provider
        </button>
      </footer>
    </section>
  );
}
