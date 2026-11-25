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

import ErrorToast from "./ui/ErrorToast";
import DisclosureSummary from "./ui/DisclosureSummary";
import ModalBackdrop from "./ui/ModalBackdrop";
import Select from "./ui/Select";
import { useIsPresent } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Clock3, ExternalLink, RefreshCw, X } from "lucide-react";
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
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", key, true);
      if (!embedded && previous?.isConnected) previous.focus();
      for (const requestId of requests.current)
        void invoke("ai_cancel", { requestId }).catch(() => {});
    };
  }, [present]);
  async function refresh() {
    if (!native) return;
    setBusy(true);
    const failed: Record<string, string> = {};
    await Promise.allSettled(
      providers
        .filter((p) => ["chatgpt", "claude"].includes(p.kind))
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
  const content = (
    <div
      className={`ai-usage-dialog ${embedded ? "ai-usage-embedded" : ""}`}
      ref={dialog}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label="AI usage"
      data-escape-scope={present ? "active" : undefined}
    >
      <header className="ai-usage-header">
        {embedded && (
          <button
            className="icon-button"
            aria-label="Back to providers"
            onClick={onClose}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <strong>Usage</strong>
        <span className="ai-header-slash">/</span>
        <Select
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
          disabled={busy || !native}
        >
          <RefreshCw size={15} />
        </button>
        {!embedded && (
          <button
            className="icon-button"
            aria-label="Close AI usage"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        )}
      </header>
      <div className="ai-usage-content" role="tabpanel" aria-label={tab}>
        {providers.map((provider) => {
          const usage = state.usage[provider.id],
            account = state.accounts[provider.id],
            raw = (usage?.limits ?? account?.limits) as
              Record<string, unknown> | undefined,
            limits = remainingLimits(raw),
            identity = (
              ["chatgpt"].includes(provider.kind)
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
                  {limits.length ? (
                    limits.map((limit, index) => (
                      <div
                        className="ai-quota-card"
                        key={`${limit.label}:${index}`}
                      >
                        <div>
                          <span>
                            {limit.label === "Weekly window"
                              ? "Weekly"
                              : limit.label === "Current window"
                                ? "Session"
                                : limit.label}
                          </span>
                          <strong>
                            {Math.round(limit.remaining)}% <small>left</small>
                          </strong>
                        </div>
                        <div
                          className="ai-quota-track"
                          role="meter"
                          aria-label={`${provider.name} ${limit.label === "Weekly window" ? "weekly" : limit.label === "Current window" ? "session" : limit.label} remaining`}
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
                      <strong>
                        {provider.kind === "chatgpt"
                          ? "ChatGPT plan usage"
                          : "No reported limits"}
                      </strong>
                      <span>
                        {provider.kind === "claude"
                          ? "Remaining quota isn’t reported by Claude Code"
                          : ["chatgpt"].includes(provider.kind)
                            ? "Review your remaining allowance, app limits, and credits in ChatGPT."
                            : "Account balance isn’t reported by this API"}
                      </span>
                      {provider.kind === "chatgpt" && (
                        <a
                          className="setting-action"
                          href="https://chatgpt.com/settings/usage"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            if (!native) return;
                            event.preventDefault();
                            void openUrl(
                              "https://chatgpt.com/settings/usage",
                            ).catch((error) =>
                              setErrors((previous) => ({
                                ...previous,
                                [provider.id]: String(error),
                              })),
                            );
                          }}
                        >
                          Manage ChatGPT usage <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  )}
                  {raw && usage?.observedAt && limits.length > 0 && (
                    <small className="settings-note">
                      Last reported at{" "}
                      {new Date(usage.observedAt).toLocaleTimeString()}
                      {provider.kind === "chatgpt" &&
                        limits.some(({ label }) =>
                          label.includes("rate limit"),
                        ) &&
                        ". Request rate limits are separate from your ChatGPT plan allowance."}
                    </small>
                  )}
                  {raw && !limits.length && (
                    <details className="ai-raw-limits">
                      <DisclosureSummary>Request limits</DisclosureSummary>
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
                              (["chatgpt"].includes(provider.kind)
                                ? "Account usage"
                                : "Connected account"),
                          )}
                        </small>
                      </span>
                      <button
                        onClick={() =>
                          void openUrl(
                            ["chatgpt"].includes(provider.kind)
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
                      <strong>{usage.reasoningTokens.toLocaleString()}</strong>
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
                <div className="ai-cost-card">
                  <span>
                    {provider.kind === "chatgpt"
                      ? "ChatGPT plan usage"
                      : "Reported usage cost"}
                  </span>
                  <strong>
                    {provider.kind === "chatgpt"
                      ? identity
                        ? account?.planEnabled === false
                          ? "Plan access off"
                          : "Plan allowance"
                        : "Not connected"
                      : usage?.costUSD !== undefined
                        ? new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 4,
                          }).format(usage.costUSD)
                        : "Unavailable"}
                  </strong>
                  <small>
                    {provider.kind === "chatgpt"
                      ? "Authorized ChatGPT requests use your plan allowance. This connection does not report a dollar cost; token totals appear under Tokens."
                      : usage?.costUSD !== undefined
                        ? "Provider-reported cost, separate from subscription billing"
                        : "Not reported by this provider"}
                  </small>
                </div>
              )}
              {errors[provider.id] && (
                <ErrorToast message={errors[provider.id]} />
              )}
            </section>
          );
        })}
        {tab !== "limits" && (
          <p className="ai-usage-scope">
            Recorded by Devyy on this device
            {checked
              ? ` / Checked ${new Date(checked).toLocaleTimeString()}`
              : ""}
          </p>
        )}
      </div>
    </div>
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
