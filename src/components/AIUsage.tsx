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

import { ModalSurface, ModalBody, ModalHeader } from "./ui/ModalSurface";
import { requestId as newRequestId } from "../lib/requestId";
import ErrorToast from "./ui/ErrorToast";
import DisclosureSummary from "./ui/DisclosureSummary";
import ModalBackdrop from "./ui/ModalBackdrop";
import Select from "./ui/Select";
import { useIsPresent } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Clock3, ExternalLink, RefreshCw } from "lucide-react";
import {
  aiAccount,
  aiProviderReady,
  isChatGPTAccount,
  refreshAIPlanLimits,
  quotaDenied,
  remainingLimits,
  useAI,
  type AIProvider,
} from "../lib/ai";
import { invoke, native } from "../lib/native";
import { openUrl } from "@tauri-apps/plugin-opener";
import AIProviderIcon from "./AIProviderIcon";
type SpendingBudget = {
  limit: number | null;
  remaining: number | null;
  period: string | null;
  resetsAt?: string | null;
  scope?: string | null;
};

type KeyUsage = SpendingBudget & {
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  byokUsage: number | null;
  effective: SpendingBudget | null;
  freeRequests: { limit: number | null; remaining: number | null } | null;
};

const usd = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
const money = (value: number) =>
  value > 0 && value < 0.000001
    ? `< ${usd.format(0.000001)}`
    : usd.format(value);

function isOpenRouter(provider: AIProvider): boolean {
  try {
    const endpoint = new URL(provider.endpoint);
    return (
      provider.kind === "custom" &&
      endpoint.origin === "https://openrouter.ai" &&
      endpoint.pathname.replace(/\/+$/, "") === "/api/v1"
    );
  } catch {
    return false;
  }
}

function providerUsageHelp(provider: AIProvider) {
  if (isOpenRouter(provider))
    return {
      label: "OpenRouter activity",
      url: "https://openrouter.ai/activity",
      limits:
        "Refresh to check the configured key’s spending cap and remaining budget.",
    };
  switch (provider.kind) {
    case "codex-app":
      return {
        url: "https://chatgpt.com/settings/usage",
        label: "ChatGPT usage",
        limits:
          "Codex hasn’t reported plan limits for this account yet. Refresh to check again.",
      };
    case "codex-api":
      return {
        limits:
          "This endpoint handles API billing and quotas. Check the endpoint’s usage dashboard.",
      };
    case "chatgpt":
      return {
        url: "https://chatgpt.com/settings/usage",
        label: "ChatGPT usage",
        limits:
          "This ChatGPT connection does not expose remaining plan quota or reset times. Check ChatGPT Usage for allowance, app limits, and credits.",
      };
    case "claude":
      return {
        url: "https://claude.ai/settings/usage",
        label: "Claude plan usage",
        limits:
          "Refresh to check the plan allowance reported by Claude Code. Availability depends on the CLI version and sign-in method.",
      };
    case "openai":
      return {
        url: "https://platform.openai.com/usage",
        label: "OpenAI billing usage",
        limits:
          "API request and token limits are reported after inference. Check the provider dashboard for spend and organization limits.",
      };
    case "anthropic":
      return {
        url: "https://platform.claude.com/usage",
        label: "Claude Console usage",
        limits:
          "API request and token limits are reported after inference. Check Claude Console for spend and organization limits.",
      };
    case "antigravity":
      return {
        url: "https://antigravity.google/docs/cli/commands/usage",
        label: "Antigravity quota guide",
        limits:
          "Use /usage in Antigravity for model-group quotas and resets, or /credits for credit balance. Headless replies report token totals.",
      };
    case "opencode":
      return {
        url: "https://opencode.ai/docs/cli/commands/#stats",
        label: "OpenCode stats guide",
        limits:
          "Refresh to check Go allowances and Console budgets from the connected OpenCode workspace. Other upstream limits are managed by their providers.",
      };
    default:
      return {
        limits:
          "This connection hasn’t returned a supported limit. Check usage with the provider that supplies the model.",
      };
  }
}

function UsageLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      className="setting-action"
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (native) {
          event.preventDefault();
          void openUrl(url).catch(() => {});
        }
      }}
    >
      {label} <ExternalLink size={12} />
    </a>
  );
}

function KeyBudget({
  budget,
  name,
  now,
}: {
  budget: SpendingBudget;
  name: string;
  now: number;
}) {
  const { limit, remaining, period, resetsAt } = budget;
  const reset = resetsAt ? Date.parse(resetsAt) : NaN;
  const expired = reset <= now;
  const capped = limit !== null && remaining !== null;
  const percent =
    capped && limit > 0
      ? Math.max(0, Math.min(100, (remaining / limit) * 100))
      : 0;
  return (
    <div className="ai-cost-card">
      <span>{period ? `${name} (${period})` : name}</span>
      <strong>
        {expired
          ? "Reset due"
          : limit === null
            ? "No spending cap"
            : remaining === null
              ? "Remaining unavailable"
              : `${money(remaining)} left`}
      </strong>
      {capped && !expired && (
        <div
          className="ai-quota-track ai-usage-budget-meter"
          role="meter"
          aria-label={`${name} remaining`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${money(remaining)} of ${money(limit)} left`}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      {limit !== null && <small>Key spending cap {money(limit)}</small>}
      {Number.isFinite(reset) && (
        <small>
          {expired
            ? "Refresh to check the new window"
            : `Resets in ${timeUntil(reset / 1000, now)}`}
        </small>
      )}
    </div>
  );
}

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
  embedded = false,
}: {
  providerId?: string;
  embedded?: boolean;
  onClose: () => void;
}) {
  const present = useIsPresent();
  const state = useAI(),
    [filter, setFilter] = useState(providerId ?? "all"),
    [tab, setTab] = useState("limits"),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [now, setNow] = useState(Date.now()),
    [keyUsage, setKeyUsage] = useState<
      Record<
        string,
        {
          snapshot: KeyUsage;
          observedAt: number;
          provider: AIProvider;
        }
      >
    >({});
  const dialog = useRef<HTMLDivElement>(null),
    requests = useRef<string[]>([]),
    planRequests = useRef(new Map<string, Promise<void>>()),
    checked = useRef(new WeakSet<AIProvider>()),
    close = useRef(onClose);
  close.current = onClose;
  const connected = state.providers.filter((p) => aiProviderReady(p, state));
  const connectedIds = new Set(connected.map(({ id }) => id));
  const selection = connectedIds.has(filter) ? filter : "all";
  const providers = state.providers.filter((p) =>
    selection === "all"
      ? connectedIds.has(p.id) || !!state.usage[p.id]
      : p.id === selection,
  );
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>("select,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (!embedded && event.key === "Tab") {
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", key, true);
      if (!embedded && previous?.isConnected) previous.focus();
      for (const requestId of requests.current)
        void invoke("ai_cancel", { requestId }).catch(() => {});
    };
  }, [present]);
  const refreshable = providers.filter(
    (p) =>
      connectedIds.has(p.id) &&
      (["chatgpt", "codex-app", "claude", "opencode"].includes(p.kind) ||
        (isOpenRouter(p) && p.hasKey)),
  );
  const checkPlan = useCallback((providerId: string) => {
    const active = planRequests.current.get(providerId);
    if (active) return active;
    const id = newRequestId();
    requests.current.push(id);
    const request = refreshAIPlanLimits(providerId, id).finally(() => {
      planRequests.current.delete(providerId);
      requests.current = requests.current.filter((key) => key !== id);
    });
    planRequests.current.set(providerId, request);
    return request;
  }, []);

  useEffect(() => {
    if (!native || !present || tab !== "limits") return;
    for (const provider of state.providers) {
      if (
        !["claude", "opencode"].includes(provider.kind) ||
        (selection !== "all" && provider.id !== selection) ||
        !aiProviderReady(provider, state) ||
        checked.current.has(provider)
      )
        continue;
      checked.current.add(provider);
      if (Date.now() - (state.usage[provider.id]?.observedAt ?? 0) < 60_000)
        continue;
      void checkPlan(provider.id).catch(() => {});
    }
  }, [checkPlan, present, selection, state, tab]);

  const largestCost = Math.max(
    0,
    ...providers.flatMap(({ id }) => [
      state.usage[id]?.costUSD ?? 0,
      state.usage[id]?.estimatedCostUSD ?? 0,
    ]),
  );
  const comparableCosts =
    providers.filter(
      ({ id }) =>
        state.usage[id]?.costUSD !== undefined ||
        state.usage[id]?.estimatedCostUSD !== undefined,
    ).length > 1;

  async function refresh() {
    if (!native) return;
    setBusy(true);
    const failed: Record<string, string> = {};
    await Promise.allSettled(
      refreshable.map(async (p) => {
        if (p.kind === "claude" || p.kind === "opencode") {
          await checkPlan(p.id).catch((error) => {
            failed[p.id] = String(error);
          });
          return;
        }
        const id = newRequestId();
        requests.current.push(id);
        try {
          if (isOpenRouter(p)) {
            const snapshot = await invoke<KeyUsage>("ai_billing_snapshot", {
              providerId: p.id,
              requestId: id,
            });
            setKeyUsage((prev) => ({
              ...prev,
              [p.id]: { snapshot, observedAt: Date.now(), provider: p },
            }));
          } else {
            await aiAccount(p.id, "status", id);
          }
        } catch (e) {
          failed[p.id] = String(e);
        } finally {
          requests.current = requests.current.filter((k) => k !== id);
        }
      }),
    );
    setErrors(failed);
    setNow(Date.now());
    setBusy(false);
  }
  const Surface = embedded ? "div" : ModalSurface;
  const Body = embedded ? "div" : ModalBody;
  const controls = (
    <>
      <Select
        aria-label="Usage provider"
        value={selection}
        disabled={connected.length === 0}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="all">All providers</option>
        {connected.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
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
        aria-busy={busy}
        className="icon-button"
        aria-label="Refresh AI usage"
        onClick={() => void refresh()}
        title="Check connections and supported live budgets"
        disabled={busy || !native || !refreshable.length}
      >
        <RefreshCw size={15} />
      </button>
    </>
  );
  const content = (
    <Surface
      className={`ai-usage-dialog ${embedded ? "ai-usage-embedded" : ""}`}
      ref={dialog}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label="AI usage"
      data-escape-scope={present ? "active" : undefined}
    >
      {!embedded && (
        <ModalHeader
          title="AI usage"
          onClose={onClose}
          closeLabel="Close AI usage"
          actions={<div className="ai-usage-toolbar">{controls}</div>}
        />
      )}
      <Body
        className={
          embedded ? "ai-usage-embedded-body" : "devyy-modal-body-flush"
        }
      >
        {embedded && (
          <header className="ai-usage-header">
            <button
              className="icon-button"
              aria-label="Back to providers"
              onClick={onClose}
            >
              <ArrowLeft size={16} />
            </button>
            <strong>Usage</strong>
            {controls}
          </header>
        )}
        <div className="ai-usage-content" role="tabpanel" aria-label={tab}>
          {providers.length === 0 && (
            <div className="ai-quota-unavailable">
              <strong>No connected AI providers</strong>
              <span>Connect a provider in Settings to see its usage here.</span>
            </div>
          )}
          {providers.map((provider) => {
            const usage = state.usage[provider.id],
              account = state.accounts[provider.id],
              raw = (usage?.limits ?? account?.limits) as
                Record<string, unknown> | undefined,
              limits = remainingLimits(raw, usage?.observedAt),
              guide = providerUsageHelp(provider),
              claudeRejection =
                provider.kind === "claude" && quotaDenied(raw, now),
              keyResult = keyUsage[provider.id],
              keySnapshot =
                keyResult?.provider === provider
                  ? keyResult.snapshot
                  : undefined,
              identity = (
                isChatGPTAccount(provider.kind)
                  ? account?.account
                  : account?.loggedIn
                    ? account
                    : undefined
              ) as Record<string, unknown> | undefined;
            return (
              <section className="ai-usage-provider" key={provider.id}>
                <h3>
                  <AIProviderIcon kind={provider.kind} />
                  {provider.name}
                </h3>
                {tab === "limits" ? (
                  <>
                    {provider.kind === "chatgpt" &&
                      !limits.some(({ total }) => total === undefined) && (
                        <div className="ai-quota-unavailable">
                          <strong>ChatGPT plan allowance</strong>
                          <span>
                            {!identity
                              ? "Connect a ChatGPT account in AI Providers."
                              : account?.planEnabled === false
                                ? "Plan access is off for Devyy."
                                : usage?.planLimitHitAt
                                  ? `ChatGPT reported a usage limit for Devyy at ${new Date(usage.planLimitHitAt).toLocaleTimeString()}.`
                                  : guide.limits}
                          </span>
                          {guide.url && (
                            <UsageLink url={guide.url} label={guide.label} />
                          )}
                        </div>
                      )}
                    {keySnapshot && (
                      <>
                        <KeyBudget
                          budget={keySnapshot}
                          name="OpenRouter key budget"
                          now={now}
                        />
                        {keySnapshot.effective && (
                          <KeyBudget
                            budget={keySnapshot.effective}
                            name={
                              keySnapshot.effective.scope
                                ? `Effective OpenRouter budget (${keySnapshot.effective.scope})`
                                : "Effective OpenRouter budget"
                            }
                            now={now}
                          />
                        )}
                        {keySnapshot.freeRequests?.remaining != null &&
                          keySnapshot.freeRequests.limit != null && (
                            <div className="ai-quota-unavailable">
                              <strong>Daily free-model requests</strong>
                              <span>
                                {keySnapshot.freeRequests.remaining.toLocaleString()}{" "}
                                /{" "}
                                {keySnapshot.freeRequests.limit.toLocaleString()}{" "}
                                remaining
                              </span>
                            </div>
                          )}
                        <small className="ai-usage-observed">
                          Checked{" "}
                          {new Date(keyResult.observedAt).toLocaleTimeString()}{" "}
                          · Across apps using the configured key
                        </small>
                      </>
                    )}
                    {claudeRejection && (
                      <div className="ai-quota-unavailable">
                        <strong>Claude Code reported a limit</strong>
                        <span>
                          Open Claude usage for the remaining allowance and
                          reset information.
                        </span>
                      </div>
                    )}
                    {limits.length > 0 ? (
                      limits.map((limit, index) => {
                        const expired =
                          limit.resetsAt !== undefined &&
                          limit.resetsAt * 1000 <= now;
                        const observedAt =
                          limit.observedAt ?? usage?.observedAt;
                        const displayPercent =
                          limit.remaining >= 99.95 && limit.remaining < 100
                            ? "<100"
                            : limit.remaining > 0 && limit.remaining < 0.05
                              ? "<0.1"
                              : limit.remaining.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                });
                        return (
                          <div
                            className="ai-quota-card"
                            key={`${limit.label}:${index}`}
                          >
                            <div>
                              <span>{limit.label}</span>
                              <strong>
                                {expired ? (
                                  "Reset due"
                                ) : (
                                  <>
                                    {displayPercent}% <small>left</small>
                                  </>
                                )}
                              </strong>
                              {limit.total !== undefined && !expired && (
                                <small>
                                  {limit.approximate ? "≈ " : ""}
                                  {limit.available?.toLocaleString()} /{" "}
                                  {limit.total.toLocaleString()}
                                </small>
                              )}
                              {limit.status && !expired && (
                                <small>{limit.status}</small>
                              )}
                              {observedAt && (
                                <small className="ai-usage-observed">
                                  Observed{" "}
                                  {new Date(observedAt).toLocaleTimeString()}
                                </small>
                              )}
                            </div>
                            <div
                              className="ai-quota-track"
                              role={expired ? undefined : "meter"}
                              aria-label={`${provider.name} ${limit.label} remaining`}
                              aria-valuemin={expired ? undefined : 0}
                              aria-valuemax={expired ? undefined : 100}
                              aria-valuenow={
                                expired ? undefined : limit.remaining
                              }
                            >
                              {!expired && (
                                <i style={{ width: `${limit.remaining}%` }} />
                              )}
                              {limit.resetsAt !== undefined && (
                                <span
                                  title={`Reset time ${new Date(limit.resetsAt * 1000).toLocaleString()}`}
                                >
                                  <Clock3 size={11} />
                                  {expired
                                    ? "Awaiting next report"
                                    : timeUntil(limit.resetsAt, now)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : provider.kind !== "chatgpt" &&
                      !keySnapshot &&
                      !claudeRejection ? (
                      <div className="ai-quota-unavailable">
                        <strong>Limit data unavailable</strong>
                        <span>{guide.limits}</span>
                      </div>
                    ) : null}
                    {provider.kind === "chatgpt" &&
                      limits.some(({ total }) => total !== undefined) && (
                        <small className="settings-note">
                          API request limits apply separately from the ChatGPT
                          plan allowance.
                        </small>
                      )}
                    {raw && !limits.length && (
                      <details className="ai-raw-limits">
                        <DisclosureSummary>
                          Provider limit report
                        </DisclosureSummary>
                        <pre>{JSON.stringify(raw, null, 2)}</pre>
                      </details>
                    )}
                    {provider.kind !== "chatgpt" && guide.url && (
                      <UsageLink url={guide.url} label={guide.label} />
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
                                (isChatGPTAccount(provider.kind)
                                  ? "Account usage"
                                  : "Connected account"),
                            )}
                          </small>
                        </span>
                        <button
                          onClick={() =>
                            void openUrl(
                              isChatGPTAccount(provider.kind)
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
                  usage?.tokens ? (
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
                      {!!usage?.cachedInputTokens && (
                        <div>
                          <span>Cached input (included)</span>
                          <strong>
                            {usage.cachedInputTokens.toLocaleString()}
                          </strong>
                        </div>
                      )}
                      {!!usage?.reasoningTokens && (
                        <div>
                          <span>Reasoning (included in output)</span>
                          <strong>
                            {usage.reasoningTokens.toLocaleString()}
                          </strong>
                        </div>
                      )}
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
                    <div className="ai-quota-unavailable">
                      <strong>No token data recorded</strong>
                      <span>
                        {usage?.requests
                          ? `${usage.requests.toLocaleString()} Devyy requests without recorded token totals.`
                          : "Token totals appear after a provider reports usage."}
                      </span>
                    </div>
                  )
                ) : (
                  <>
                    {keySnapshot && (
                      <div className="ai-cost-card">
                        <span>OpenRouter key spending</span>
                        <strong>
                          {keySnapshot.usage === null
                            ? "Unavailable"
                            : money(keySnapshot.usage)}
                        </strong>
                        <div className="ai-usage-periods">
                          {(
                            [
                              ["Today", keySnapshot.usageDaily],
                              ["This week", keySnapshot.usageWeekly],
                              ["This month", keySnapshot.usageMonthly],
                            ] as const
                          ).map(
                            ([label, amount]) =>
                              amount !== null && (
                                <div key={label}>
                                  <span>{label}</span>
                                  <b>{money(amount)}</b>
                                </div>
                              ),
                          )}
                        </div>
                        {keySnapshot.byokUsage !== null &&
                          keySnapshot.byokUsage > 0 && (
                            <small>
                              Separate bring-your-own-key usage reported by
                              OpenRouter {money(keySnapshot.byokUsage)}
                            </small>
                          )}
                        <small>
                          Across apps using this key · Checked{" "}
                          {new Date(keyResult.observedAt).toLocaleTimeString()}
                        </small>
                      </div>
                    )}
                    {isChatGPTAccount(provider.kind) ? (
                      <div className="ai-cost-card">
                        <span>ChatGPT plan billing</span>
                        <strong>
                          {identity
                            ? account?.planEnabled === false
                              ? "Plan access off"
                              : "Plan and credits"
                            : "Not connected"}
                        </strong>
                        <small>
                          Devyy can record request tokens. ChatGPT Settings
                          shows your allowance, credit use, and billing.
                        </small>
                      </div>
                    ) : (
                      <div className="ai-cost-card">
                        {(
                          [
                            [
                              provider.kind === "claude" ||
                              provider.kind === "opencode"
                                ? "CLI cost estimate"
                                : "Reported request cost",
                              usage?.costUSD,
                            ],
                            [
                              "Estimated standard token cost",
                              usage?.estimatedCostUSD,
                            ],
                          ] as const
                        ).map(
                          ([label, amount]) =>
                            amount !== undefined && (
                              <div className="ai-usage-spend" key={label}>
                                <span>{label}</span>
                                <strong>{money(amount)}</strong>
                                {comparableCosts && largestCost > 0 && (
                                  <div
                                    className="ai-quota-track"
                                    aria-hidden="true"
                                  >
                                    <i
                                      style={{
                                        width: `${(amount / largestCost) * 100}%`,
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            ),
                        )}
                        {usage?.estimatedCostUSD !== undefined ||
                        usage?.costUSD !== undefined ? (
                          <small>
                            {usage?.estimatedCostUSD !== undefined
                              ? "Standard text-token estimates for supported models. Other models, usage, fees and discounts may be absent."
                              : "Total from cost events recorded by Devyy. Subscription billing and requests without cost data are excluded."}
                          </small>
                        ) : (
                          <>
                            <span>Cost</span>
                            <strong>Unavailable</strong>
                            <small>
                              No cost data has been recorded for this
                              connection.
                            </small>
                          </>
                        )}
                      </div>
                    )}
                    {guide.url && (
                      <UsageLink url={guide.url} label={guide.label} />
                    )}
                  </>
                )}
                {errors[provider.id] && (
                  <ErrorToast message={errors[provider.id]} />
                )}
              </section>
            );
          })}
          {tab !== "limits" && (
            <p className="ai-usage-scope">Recorded by Devyy on this device</p>
          )}
        </div>
      </Body>
    </Surface>
  );
  return embedded
    ? content
    : createPortal(
        <ModalBackdrop
          className="ai-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {content}
        </ModalBackdrop>,
        document.body,
      );
}
