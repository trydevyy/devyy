import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, ExternalLink, LoaderCircle, RefreshCw, X } from "lucide-react";
import { aiAccount, remainingLimits, useAI } from "../lib/ai";
import { invoke, native } from "../lib/native";
import { openUrl } from "@tauri-apps/plugin-opener";
import AIProviderIcon from "./AIProviderIcon";
export function timeUntil(timestamp?: number, now = Date.now()): string {
  if (!timestamp) return "";
  const minutes = Math.max(0, Math.ceil((timestamp * 1000 - now) / 60000));
  if (!minutes) return "Reset due";
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
export default function AIUsage({
  providerId,
  onClose,
}: {
  providerId?: string;
  onClose: () => void;
}) {
  const state = useAI(),
    [filter, setFilter] = useState(providerId ?? "all"),
    [tab, setTab] = useState("limits"),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [now, setNow] = useState(Date.now()),
    [checked, setChecked] = useState<number>();
  const dialog = useRef<HTMLDivElement>(null),
    requests = useRef<string[]>([]),
    close = useRef(onClose);
  close.current = onClose;
  const providers = state.providers.filter((p) =>
    filter === "all"
      ? p.enabled !== false || !!state.usage[p.id] || !!state.accounts[p.id]
      : p.id === filter,
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>("select,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const buttons = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'select,button,a,[tabindex="0"]',
            ) ?? [],
          ).filter((el) => el.offsetParent !== null),
          first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", key, true);
      previous?.isConnected && previous.focus();
      for (const requestId of requests.current)
        void invoke("ai_cancel", { requestId }).catch(() => {});
    };
  }, []);
  async function refresh() {
    if (!native) return;
    setBusy(true);
    const failed: Record<string, string> = {};
    await Promise.allSettled(
      providers
        .filter((p) => ["codex", "claude"].includes(p.kind))
        .map(async (p) => {
          const id = crypto.randomUUID();
          requests.current.push(id);
          try {
            await aiAccount(p.id, "status", id);
          } catch (e) {
            failed[p.id] = String(e);
          } finally {
            requests.current = requests.current.filter((k) => k !== id);
          }
        }),
    );
    setErrors(failed);
    setChecked(Date.now());
    setBusy(false);
  }
  // Only the user-triggered refresh queries accounts; opening Usage also works offline.
  return createPortal(
    <div
      className="ai-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ai-usage-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="AI usage"
      >
        <header className="ai-usage-header">
          <strong>Usage</strong>
          <span className="ai-header-slash">/</span>
          <select
            aria-label="Usage provider"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All providers</option>
            {state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div role="tablist" aria-label="Usage metrics">
            {["cost", "tokens", "limits"].map((metric) => (
              <button
                role="tab"
                key={metric}
                aria-selected={tab === metric}
                onClick={() => setTab(metric)}
              >
                {metric}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="Refresh AI usage"
            onClick={() => void refresh()}
            disabled={busy || !native}
          >
            {busy ? (
              <LoaderCircle className="spinning" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Close AI usage"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="ai-usage-content" role="tabpanel" aria-label={tab}>
          {providers.map((provider) => {
            const usage = state.usage[provider.id],
              account = state.accounts[provider.id],
              raw = (usage?.limits ?? account?.limits) as
                Record<string, unknown> | undefined,
              limits = remainingLimits(raw),
              identity = (account?.account ?? account) as
                Record<string, unknown> | undefined;
            return (
              <section className="ai-usage-provider" key={provider.id}>
                <h3>
                  <AIProviderIcon kind={provider.kind} />
                  {provider.name}
                </h3>
                {tab === "limits" ? (
                  <>
                    {limits.length ? (
                      limits.map((limit) => (
                        <div className="ai-quota-card" key={limit.label}>
                          <div>
                            <span>
                              {limit.label === "Weekly window"
                                ? "Weekly"
                                : "Session"}
                            </span>
                            <strong>
                              {Math.round(limit.remaining)}% <small>left</small>
                            </strong>
                          </div>
                          <div
                            className="ai-quota-track"
                            role="meter"
                            aria-label={`${provider.name} ${limit.label === "Weekly window" ? "weekly" : "session"} remaining`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={limit.remaining}
                          >
                            <i style={{ width: `${limit.remaining}%` }} />
                            {limit.resetsAt && (
                              <span
                                title={`Resets ${new Date(limit.resetsAt * 1000).toLocaleString()}`}
                              >
                                <Clock3 size={11} />
                                {timeUntil(limit.resetsAt, now)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="ai-quota-unavailable">
                        <strong>—</strong>
                        <span>
                          {provider.kind === "claude"
                            ? "Remaining quota isn’t reported by Claude Code"
                            : ["chatgpt", "codex"].includes(provider.kind)
                              ? "Refresh to check account limits"
                              : "Account balance isn’t reported by this API"}
                        </span>
                      </div>
                    )}
                    {raw && !limits.length && (
                      <details className="ai-raw-limits">
                        <summary>Request limits</summary>
                        <pre>{JSON.stringify(raw, null, 2)}</pre>
                      </details>
                    )}
                    {identity && (
                      <div className="ai-usage-account">
                        <AIProviderIcon kind={provider.kind} />
                        <span>
                          <strong>
                            {String(
                              identity.email ??
                                identity.planType ??
                                provider.name,
                            )}
                          </strong>
                          <small>
                            {String(
                              identity.planType ??
                                identity.subscriptionType ??
                                (["chatgpt", "codex"].includes(provider.kind)
                                  ? "Account usage"
                                  : "Connected account"),
                            )}
                          </small>
                        </span>
                        <button
                          onClick={() =>
                            void openUrl(
                              ["chatgpt", "codex"].includes(provider.kind)
                                ? "https://chatgpt.com/settings/usage"
                                : "https://claude.ai",
                            ).catch(() => {})
                          }
                        >
                          Manage account <ExternalLink size={12} />
                        </button>
                      </div>
                    )}
                  </>
                ) : tab === "tokens" ? (
                  <div className="ai-token-card">
                    <div>
                      <span>Input</span>
                      <strong>
                        {(usage?.inputTokens ?? 0).toLocaleString()}
                      </strong>
                    </div>
                    <div>
                      <span>Output</span>
                      <strong>
                        {(usage?.outputTokens ?? 0).toLocaleString()}
                      </strong>
                    </div>
                    <div>
                      <span>Requests</span>
                      <strong>{usage?.requests ?? 0}</strong>
                    </div>
                    <div
                      className="ai-token-bar"
                      role="img"
                      aria-label={`${usage?.inputTokens ?? 0} input tokens, ${usage?.outputTokens ?? 0} output tokens`}
                    >
                      <i
                        style={{
                          width: `${usage?.tokens ? (usage.inputTokens / usage.tokens) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="ai-cost-card">
                    <span>Reported usage cost</span>
                    <strong>
                      {usage?.costUSD !== undefined
                        ? new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 4,
                          }).format(usage.costUSD)
                        : "—"}
                    </strong>
                    <small>
                      {usage?.costUSD !== undefined
                        ? "Provider-reported cost, separate from subscription billing"
                        : "Not reported by this provider"}
                    </small>
                  </div>
                )}
                {errors[provider.id] && (
                  <p className="ai-error" role="alert">
                    {errors[provider.id]}
                  </p>
                )}
              </section>
            );
          })}
          {tab !== "limits" && (
            <p className="ai-usage-scope">
              Current Devyy session
              {checked
                ? ` / Checked ${new Date(checked).toLocaleTimeString()}`
                : ""}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
