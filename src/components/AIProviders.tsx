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
} from "lucide-react";
import {
  aiAccount,
  discoverAIModels,
  loadAI,
  removeAIProvider,
  saveAIProvider,
  useAI,
  type AIProvider,
} from "../lib/ai";
import { invoke, native } from "../lib/native";
import AIProviderIcon from "./AIProviderIcon";
import AIUsage from "./AIUsage";
function accountInfo(provider: AIProvider, account?: Record<string, unknown>) {
  const identity = (account?.account ?? account) as
    Record<string, unknown> | undefined;
  const connected = ["chatgpt", "codex"].includes(provider.kind)
    ? !!account?.account
    : account?.loggedIn === true;
  return {
    identity,
    connected,
    label:
      provider.enabled === false
        ? "Disabled"
        : connected
          ? `Authenticated${identity?.planType ? ` / ${identity.planType}` : ""}`
          : provider.hasKey
            ? "API key saved"
            : provider.kind === "custom" && provider.endpoint && provider.model
              ? "Configured"
              : account
                ? "Signed out"
                : ["chatgpt", "codex", "claude"].includes(provider.kind)
                  ? "Not checked"
                  : "Not configured",
  };
}
function ProviderDetail({
  provider,
  onRemoved,
  onUsage,
}: {
  provider: AIProvider;
  onRemoved: () => void;
  onUsage: () => void;
}) {
  const state = useAI(),
    [form, setForm] = useState(provider),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [runtime, setRuntime] = useState<Record<string, string>>(),
    [runtimeOpen, setRuntimeOpen] = useState(false);
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
    ] as const;
    if (fields.some((field) => previous[field] !== provider[field]))
      setForm(provider);
    else setForm((current) => ({ ...current, enabled: provider.enabled }));
  }, [provider]);
  useEffect(
    () => () => {
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
    accountProvider = ["chatgpt", "codex", "claude"].includes(form.kind),
    custom = !["chatgpt", "codex", "claude", "openai", "anthropic"].includes(
      provider.id,
    );
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
        <div className="ai-provider-status">
          <h4>Status</h4>
          <p>
            {connected
              ? `Authenticated as ${String(identity?.email ?? identity?.type ?? "account")}`
              : label}
          </p>
        </div>
        <div className="ai-provider-field">
          <label htmlFor={`ai-name-${provider.id}`}>Display name</label>
          <input
            id={`ai-name-${provider.id}`}
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <section className="ai-provider-section">
          <h4>Setup</h4>
          {accountProvider ? (
            <>
              <div className="ai-provider-account-row">
                <span>
                  <strong>
                    {form.kind === "chatgpt"
                      ? "ChatGPT"
                      : form.kind === "codex"
                        ? "Codex CLI account"
                        : "Claude Code account"}
                  </strong>
                  <small>
                    {connected
                      ? String(identity?.email ?? "Signed in")
                      : form.kind === "chatgpt"
                        ? "Authorize Devyy in your browser"
                        : form.kind === "claude"
                          ? "Uses Claude Code’s browser sign-in"
                          : "Uses the Codex CLI account on this computer"}
                  </small>
                </span>
                <button
                  className="setting-action"
                  disabled={!!busy || !native}
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
                        <select
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
                        </select>
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
                  <select
                    id={`ai-protocol-${provider.id}`}
                    value={form.kind === "anthropic" ? "anthropic" : "custom"}
                    onChange={(e) =>
                      patch({ kind: e.target.value as AIProvider["kind"] })
                    }
                  >
                    <option value="custom">OpenAI compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </div>
              )}
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
        </section>
        <section className="ai-provider-section">
          <h4>Models</h4>
          <div className="ai-provider-field">
            <label htmlFor={`ai-model-${provider.id}`}>Default model</label>
            <input
              id={`ai-model-${provider.id}`}
              aria-label="Model"
              list={`ai-models-${provider.id}`}
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={accountProvider ? "Provider default" : "Model ID"}
              spellCheck={false}
            />
            <datalist id={`ai-models-${provider.id}`}>
              {state.models[provider.id]?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </datalist>
          </div>
          <button
            className="setting-action"
            disabled={!!busy || !native}
            onClick={() =>
              void action("models", async () => {
                await saveAIProvider(form, key);
                setKey("");
                const models = await discoverAIModels(provider.id, true);
                setNotice(`${models.length} models available`);
              })
            }
          >
            {busy === "models" ? (
              <LoaderCircle className="spinning" size={12} />
            ) : (
              <RefreshCw size={12} />
            )}{" "}
            Discover models
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
            <h4>Runtime</h4>
            {runtime?.version && <code>{runtime.version}</code>}
          </button>
          {runtimeOpen && (
            <div>
              {["codex", "claude"].includes(form.kind) && (
                <div className="ai-provider-field">
                  <label htmlFor={`ai-cli-${provider.id}`}>
                    CLI executable
                  </label>
                  <input
                    id={`ai-cli-${provider.id}`}
                    value={form.executable}
                    onChange={(e) => patch({ executable: e.target.value })}
                    placeholder={`${form.kind} (auto-detect)`}
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
            </div>
          )}
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
        <button className="ai-text-action" onClick={onUsage}>
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
          disabled={!!busy || !native}
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
export default function AIProviders() {
  const state = useAI(),
    [selected, setSelected] = useState(() => state.providers[0]?.id ?? "codex"),
    [draft, setDraft] = useState<AIProvider>(),
    [usage, setUsage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState<number>();
  useEffect(() => {
    void loadAI();
  }, []);
  const providers =
    draft && !state.providers.some((p) => p.id === draft.id)
      ? [...state.providers, draft]
      : state.providers;
  const chosen = providers.some((p) => p.id === selected)
    ? selected
    : providers[0]?.id;
  async function refresh() {
    setBusy(true);
    setError("");
    const results = await Promise.allSettled(
      state.providers
        .filter(
          (p) =>
            p.enabled !== false &&
            ["chatgpt", "codex", "claude"].includes(p.kind),
        )
        .map((p) => aiAccount(p.id, "status", crypto.randomUUID())),
    );
    const failures = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];
    if (failures.length)
      setError(failures.map((r) => String(r.reason)).join("\n"));
    setChecked(Date.now());
    setBusy(false);
  }
  async function toggle(provider: AIProvider) {
    try {
      await saveAIProvider(
        { ...provider, enabled: provider.enabled === false },
        "",
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function add() {
    const provider: AIProvider = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: "Custom provider",
      kind: "custom",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "",
      executable: "",
      hasKey: false,
      enabled: true,
    };
    setDraft(provider);
    setSelected(provider.id);
  }
  return (
    <div className="ai-provider-settings">
      <header className="ai-providers-toolbar">
        <strong>Providers</strong>
        <button
          className="icon-button"
          aria-label="Add AI provider"
          onClick={add}
        >
          <Plus size={15} />
        </button>
        <span />
        {checked && (
          <small>
            Checked{" "}
            {new Date(checked).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
        <button
          className="ai-text-action"
          disabled={busy || !native}
          onClick={() => void refresh()}
        >
          {busy ? (
            <LoaderCircle className="spinning" size={13} />
          ) : (
            <RefreshCw size={13} />
          )}{" "}
          Refresh all
        </button>
      </header>
      {(error || state.error) && (
        <p className="ai-error" role="alert">
          {error || state.error}
        </p>
      )}
      <div className="ai-provider-workspace">
        <nav className="ai-provider-list" aria-label="AI providers">
          <div
            role="tablist"
            aria-label="Provider connections"
            aria-orientation="vertical"
            onKeyDown={(event) => {
              const tabs = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  ),
                ),
                index = providers.findIndex((p) => p.id === chosen),
                next =
                  event.key === "ArrowDown"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowUp"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
              if (next >= 0) {
                event.preventDefault();
                setSelected(providers[next].id);
                tabs[next]?.focus();
              }
            }}
          >
            {providers.map((provider) => {
              const { label } = accountInfo(
                provider,
                state.accounts[provider.id],
              );
              return (
                <div
                  key={provider.id}
                  className={provider.id === chosen ? "selected" : ""}
                >
                  <button
                    role="tab"
                    aria-selected={provider.id === chosen}
                    aria-controls={`provider-${provider.id}`}
                    tabIndex={provider.id === chosen ? 0 : -1}
                    onClick={() => setSelected(provider.id)}
                  >
                    <AIProviderIcon kind={provider.kind} />
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{label}</small>
                    </span>
                  </button>
                  <button
                    role="switch"
                    aria-checked={provider.enabled !== false}
                    aria-label={`Enable ${provider.name}`}
                    className="ai-provider-toggle"
                    disabled={!native}
                    onClick={() => void toggle(provider)}
                  >
                    <i />
                  </button>
                </div>
              );
            })}
          </div>
          <button className="ai-add-provider" onClick={add}>
            <Plus size={15} /> Add provider
          </button>
        </nav>
        <div className="ai-provider-details">
          {providers.map((provider) => (
            <div
              key={provider.id}
              id={`provider-${provider.id}`}
              role="tabpanel"
              aria-label={provider.name}
              hidden={provider.id !== chosen}
            >
              <ProviderDetail
                provider={provider}
                onRemoved={() => {
                  setDraft(undefined);
                  setSelected(state.providers[0]?.id ?? "codex");
                }}
                onUsage={() => setUsage(true)}
              />
            </div>
          ))}
        </div>
      </div>
      {usage && <AIUsage providerId={chosen} onClose={() => setUsage(false)} />}
    </div>
  );
}
