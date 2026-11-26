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

import { NativeModal, ModalHeader } from "./ui/ModalSurface";
import { requestId as newRequestId } from "../lib/requestId";
import ErrorToast, { DialogToastHost } from "./ui/ErrorToast";
import { AnimatePresence, motion } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  aiAccount,
  aiProviderReady,
  loadAI,
  saveAIProvider,
  useAI,
  type AIProvider,
} from "../lib/ai";
import { native } from "../lib/native";
import AIProviderIcon from "./AIProviderIcon";
import AIUsage from "./AIUsage";
import AIProviderDetail, { accountInfo } from "./AIProviderDetail";

export default function AIProviders() {
  const { transition, instant } = useSurfaceMotion();
  const usageTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreUsageFocus = useRef(false);
  const state = useAI(),
    [selected, setSelected] = useState(
      () => state.providers[0]?.id ?? "chatgpt",
    ),
    [draft, setDraft] = useState<AIProvider>(),
    [usage, setUsage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState<number>();
  useEffect(() => {
    void loadAI();
  }, []);
  const providers = state.providers;
  const chosen = providers.some((p) => p.id === selected)
    ? selected
    : providers[0]?.id;
  async function refresh() {
    setBusy(true);
    setError("");
    const results = await Promise.allSettled(
      state.providers
        .filter(
          (p) => p.enabled !== false && ["chatgpt", "claude"].includes(p.kind),
        )
        .map((p) => aiAccount(p.id, "status", newRequestId())),
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
      id: `custom-${newRequestId().slice(0, 8)}`,
      name: "Custom provider",
      kind: "custom",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "",
      executable: "",
      hasKey: false,
      enabled: true,
    };
    setDraft(provider);
  }
  return (
    <div className="ai-provider-settings">
      {draft && (
        <NativeModal
          className="devyy-modal-form provider-add-dialog"
          aria-labelledby="provider-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            setDraft(undefined);
          }}
        >
          <ModalHeader
            id="provider-dialog-title"
            title="Add custom provider"
            description="Connect an API endpoint or a local command."
            icon={<AIProviderIcon kind={draft.kind} size={18} />}
            closeLabel="Close provider form"
            onClose={() => setDraft(undefined)}
          />
          <AIProviderDetail
            provider={draft}
            onRemoved={() => setDraft(undefined)}
            onSaved={() => {
              setSelected(draft.id);
              setDraft(undefined);
            }}
          />
          <DialogToastHost id="aiproviders" />
        </NativeModal>
      )}
      <div className="ai-provider-pages">
        <motion.div
          className="ai-provider-page"
          inert={usage || Boolean(draft)}
          aria-hidden={usage || Boolean(draft)}
          animate={
            usage
              ? {
                  x: instant ? 0 : -55,
                  opacity: 0,
                  transitionEnd: { visibility: "hidden" },
                }
              : { x: 0, opacity: 1, visibility: "visible" }
          }
          transition={transition}
          onAnimationComplete={() => {
            if (!usage && restoreUsageFocus.current) {
              restoreUsageFocus.current = false;
              requestAnimationFrame(() => usageTrigger.current?.focus());
            }
          }}
        >
          <header className="ai-providers-toolbar">
            <div className="ai-providers-title">
              <strong>AI providers</strong>
              <small>Manage sign-ins and models.</small>
            </div>
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
              aria-busy={busy}
              className="ai-text-action"
              disabled={busy || !native}
              onClick={() => void refresh()}
            >
              <RefreshCw size={13} /> Refresh sign-ins
            </button>
          </header>
          {(error || state.error) && (
            <ErrorToast message={error || state.error} />
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
                    next = ["ArrowDown", "ArrowRight"].includes(event.key)
                      ? (index + 1) % tabs.length
                      : ["ArrowUp", "ArrowLeft"].includes(event.key)
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
                          <small>
                            {aiProviderReady(provider, state) &&
                            !["chatgpt", "claude"].includes(provider.kind)
                              ? "Connection verified"
                              : label}
                          </small>
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
              <button
                className="ai-add-provider"
                aria-label="Add AI provider"
                onClick={add}
              >
                <Plus size={15} /> Add provider
              </button>
            </nav>
            <div className="ai-provider-details">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  id={`provider-${provider.id}`}
                  role="tabpanel"
                  hidden={provider.id !== chosen}
                  aria-label={provider.name}
                >
                  <AIProviderDetail
                    provider={provider}
                    active={provider.id === chosen}
                    onRemoved={() => {
                      setDraft(undefined);
                      setSelected(state.providers[0]?.id ?? "chatgpt");
                    }}
                    onUsage={(button) => {
                      usageTrigger.current = button;
                      setUsage(true);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </motion.div>
        <AnimatePresence initial={false}>
          {usage && (
            <motion.div
              key="usage"
              className="ai-provider-page ai-provider-usage-page"
              initial={{ x: instant ? 0 : 55, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: instant ? 0 : 55, opacity: 0 }}
              transition={transition}
            >
              <AIUsage
                embedded
                providerId={chosen}
                onClose={() => {
                  restoreUsageFocus.current = true;
                  setUsage(false);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
