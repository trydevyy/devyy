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

import Skeleton from "./ui/Skeleton";
import ErrorToast from "./ui/ErrorToast";
import {
  effortLabel,
  reasoningOptions,
  supportedEffort,
} from "../lib/aiReasoning";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  RefreshCw,
  Search,
  Settings2,
  Star,
} from "lucide-react";
import {
  aiProviderReady,
  chooseAIModel,
  discoverAIModels,
  setChatProvider,
  useAI,
  type AIChoice,
} from "../lib/ai";
import AIProviderIcon from "./AIProviderIcon";
import AIPopover from "./AIPopover";
import { modelLabel } from "../lib/aiModels";
function favorites(): string[] {
  try {
    const values = JSON.parse(
      localStorage.getItem("devyy.ai.favoriteModels") ?? "[]",
    );
    return Array.isArray(values)
      ? values
          .filter(
            (value) => typeof value === "string" && !value.startsWith("codex:"),
          )
          .slice(0, 256)
      : [];
  } catch {
    return [];
  }
}
export default function AIModelPicker({
  providerId,
  chatId,
  choice,
  onChoose,
  disabled,
  onSettings,
}: {
  providerId: string;
  chatId?: string;
  choice: AIChoice;
  onChoose: (providerId: string, choice: AIChoice) => void;
  disabled: boolean;
  onSettings: () => void;
}) {
  const state = useAI(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(providerId),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stars, setStars] = useState<string[]>(favorites),
    [onlyFavorites, setOnlyFavorites] = useState(false);
  const providers = state.providers.filter((p) => aiProviderReady(p, state)),
    provider = providers.find((p) => p.id === providerId),
    inspected = providers.find((p) => p.id === selected);
  const current = provider
    ? (state.models[providerId]?.find(
        (m) => m.id === (choice.model || provider.model),
      ) ??
      (!choice.model
        ? state.models[providerId]?.find((m) => m.isDefault)
        : undefined))
    : undefined;
  const display =
    current?.name && current.name !== current.id
      ? current.name
      : provider
        ? modelLabel(choice.model || provider.model || "")
        : "Choose a model";
  const options = (
    onlyFavorites ? providers : providers.filter((p) => p.id === selected)
  )
    .flatMap((p) =>
      (state.models[p.id] ?? []).map((model) => ({
        ...model,
        name:
          model.name && model.name !== model.id
            ? model.name
            : modelLabel(model.id),
        provider: p,
      })),
    )
    .filter(
      (m) =>
        `${m.name} ${m.id} ${m.provider.name}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!onlyFavorites || stars.includes(`${m.provider.id}:${m.id}`)),
    );
  const reasoningOwner = onlyFavorites ? providerId : selected;
  const inspectedChoice =
    reasoningOwner === providerId
      ? choice
      : (state.choices[reasoningOwner] ?? {
          model: inspected?.model ?? "",
          effort: "",
        });
  const inspectedModel = onlyFavorites
    ? current
    : (state.models[selected]?.find(
        (m) => m.id === (inspectedChoice.model || inspected?.model),
      ) ??
      (!inspectedChoice.model
        ? state.models[selected]?.find((m) => m.isDefault)
        : undefined));
  const efforts = reasoningOptions(inspectedModel);
  const selectedEffort = supportedEffort(
    inspectedModel,
    inspectedChoice.effort,
  );
  const activeEffort = reasoningOptions(current).find(
    (o) => o.id === supportedEffort(current, choice.effort),
  );
  const discovery = useRef(0);
  async function refresh(force = false) {
    const ticket = ++discovery.current;
    const owners = onlyFavorites
      ? providers
      : providers.filter((p) => p.id === selected);
    setBusy(true);
    setError("");
    const results = await Promise.allSettled(
      owners.map((p) => discoverAIModels(p.id, force)),
    );
    if (ticket !== discovery.current) return;
    setError(
      results
        .flatMap((result, index) =>
          result.status === "rejected"
            ? [`${owners[index].name}: ${String(result.reason)}`]
            : [],
        )
        .join("\n"),
    );
    setBusy(false);
  }
  useEffect(() => {
    if (open) {
      setSelected(
        providers.some((p) => p.id === providerId)
          ? providerId
          : (providers[0]?.id ?? ""),
      );
      setQuery("");
    }
  }, [open, providerId, providers.map((p) => p.id).join(",")]);
  useEffect(() => {
    if (open) void refresh();
  }, [open, selected, onlyFavorites]);
  useEffect(() => {
    if (provider && choice.effort && state.loaded && !state.models[providerId])
      void discoverAIModels(providerId).catch(() => {});
  }, [provider, providerId, choice.effort, state.loaded]);
  function choose(id: string, effort = "", keepOpen = false, owner = selected) {
    const model = state.models[owner]?.find((m) => m.id === id);
    const next = { model: id, effort: supportedEffort(model, effort) };
    if (chatId && providerId !== owner) setChatProvider(chatId, owner);
    chooseAIModel(owner, next, chatId);
    onChoose(owner, next);
    if (!keepOpen) setOpen(false);
  }
  function toggleStar(id: string, owner = selected) {
    const key = `${owner}:${id}`,
      next = stars.includes(key)
        ? stars.filter((k) => k !== key)
        : [...stars, key];
    setStars(next);
    try {
      localStorage.setItem("devyy.ai.favoriteModels", JSON.stringify(next));
    } catch {}
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="ai-model-trigger"
        aria-label="Choose AI model"
        title={display}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <AIProviderIcon kind={provider?.kind ?? "custom"} size={14} />
        <span>{display}</span>
        {activeEffort && <small>{activeEffort.label}</small>}
        <ChevronDown size={11} />
      </button>
      {open && (
        <AIPopover
          anchor={anchor}
          label="Choose AI model"
          onClose={() => setOpen(false)}
        >
          <div className="ai-model-picker">
            <nav
              className="ai-model-provider-rail"
              aria-label="Model providers"
            >
              <button
                title="Favorites"
                aria-label="Favorite models"
                aria-pressed={onlyFavorites}
                onClick={() => setOnlyFavorites(!onlyFavorites)}
              >
                <Star
                  size={18}
                  fill={onlyFavorites ? "currentColor" : "none"}
                />
              </button>
              {providers.map((p) => (
                <button
                  key={p.id}
                  title={p.name}
                  aria-label={`Models from ${p.name}`}
                  aria-pressed={!onlyFavorites && selected === p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setOnlyFavorites(false);
                  }}
                >
                  <AIProviderIcon kind={p.kind} />
                  <small>
                    {p.kind === "chatgpt"
                      ? "GPT"
                      : p.kind === "codex"
                        ? "CX"
                        : p.kind === "claude"
                          ? "CL"
                          : p.kind === "custom"
                            ? "API"
                            : ""}
                  </small>
                </button>
              ))}
            </nav>
            <div className="ai-model-main">
              <div className="ai-model-search">
                <Search size={14} />
                <input
                  aria-label="Search models"
                  placeholder="Search models…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  aria-busy={busy}
                  aria-label="Refresh models"
                  onClick={() => void refresh(true)}
                  disabled={busy}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              <div
                className="ai-model-options"
                role="listbox"
                aria-label="Available models"
                onKeyDown={(event) => {
                  const buttons = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        '[role="option"]',
                      ),
                    ),
                    index = buttons.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % buttons.length
                      : event.key === "ArrowUp"
                        ? (index - 1 + buttons.length) % buttons.length
                        : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    buttons[next]?.focus();
                  }
                }}
              >
                {!query &&
                  !onlyFavorites &&
                  (inspected?.kind === "codex" ||
                    inspected?.kind === "claude" ||
                    inspected?.kind === "cli" ||
                    !!inspected?.model) && (
                    <button
                      role="option"
                      aria-selected={selected === providerId && !choice.model}
                      onClick={() =>
                        choose(
                          ["codex", "claude"].includes(inspected?.kind ?? "")
                            ? ""
                            : (inspected?.model ?? ""),
                        )
                      }
                    >
                      <span>Provider default</span>
                      {selected === providerId && !choice.model && (
                        <Check size={13} />
                      )}
                    </button>
                  )}
                {options.map((model) => (
                  <div
                    className="ai-model-option"
                    key={`${model.provider.id}:${model.id}`}
                  >
                    <button
                      role="option"
                      aria-label={`${model.name} / ${model.provider.name}`}
                      aria-selected={
                        providerId === model.provider.id &&
                        choice.model === model.id
                      }
                      onClick={() =>
                        choose(
                          model.id,
                          supportedEffort(
                            model,
                            model.provider.id === providerId
                              ? choice.effort
                              : (state.choices[model.provider.id]?.effort ??
                                  ""),
                          ),
                          false,
                          model.provider.id,
                        )
                      }
                    >
                      <span
                        className="ai-model-brand"
                        title={model.provider.name}
                      >
                        <AIProviderIcon kind={model.provider.kind} size={20} />
                        <small aria-label={`Provider: ${model.provider.name}`}>
                          {model.provider.kind === "chatgpt"
                            ? "GPT"
                            : model.provider.kind === "claude"
                              ? "CC"
                              : model.provider.kind === "antigravity"
                                ? "AG"
                                : model.provider.kind === "opencode"
                                  ? "OC"
                                  : model.provider.kind === "openai" ||
                                      model.provider.kind === "anthropic"
                                    ? "API"
                                    : model.provider.name
                                        .slice(0, 2)
                                        .toUpperCase()}
                        </small>
                      </span>
                      <span>
                        <strong>
                          {model.name && model.name !== model.id
                            ? model.name
                            : modelLabel(model.id)}
                        </strong>
                        {onlyFavorites && <small>{model.provider.name}</small>}
                      </span>
                      {providerId === model.provider.id &&
                        choice.model === model.id && <Check size={13} />}
                    </button>
                    <button
                      aria-label={`${stars.includes(`${model.provider.id}:${model.id}`) ? "Unfavorite" : "Favorite"} ${model.name}`}
                      onClick={() => toggleStar(model.id, model.provider.id)}
                    >
                      <Star
                        size={12}
                        fill={
                          stars.includes(`${model.provider.id}:${model.id}`)
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  </div>
                ))}
                {busy && !options.length && (
                  <div className="ai-picker-status">
                    <Skeleton label="Loading models" />
                  </div>
                )}
                {error && <ErrorToast message={error} />}
                {!busy && !error && !options.length && (
                  <p className="ai-picker-status">
                    {onlyFavorites ? "No favorite models" : "No models found"}
                  </p>
                )}
              </div>
              <footer>
                {onlyFavorites ? (
                  <Star size={13} />
                ) : (
                  <AIProviderIcon
                    kind={inspected?.kind ?? "custom"}
                    size={13}
                  />
                )}
                <span>{onlyFavorites ? "Favorites" : inspected?.name}</span>
                <button
                  onClick={() => {
                    setOpen(false);
                    onSettings();
                  }}
                  aria-label="Manage AI providers"
                >
                  <Settings2 size={13} />
                </button>
              </footer>
            </div>
            {!!efforts.length && !!inspectedModel && (
              <section
                className="ai-reasoning-picker"
                aria-label="Reasoning effort"
              >
                <header>{inspectedModel.reasoningLabel || "Reasoning"}</header>
                <div role="radiogroup" aria-label="Reasoning effort">
                  <button
                    role="radio"
                    aria-checked={!selectedEffort}
                    onClick={() =>
                      choose(inspectedModel.id, "", true, reasoningOwner)
                    }
                  >
                    Default
                    {inspectedModel.defaultEffort
                      ? ` (${efforts.find((o) => o.id === inspectedModel.defaultEffort)?.label ?? effortLabel(inspectedModel.defaultEffort)})`
                      : ""}
                    {!selectedEffort && <Check size={12} />}
                  </button>
                  {efforts.map((effort) => (
                    <button
                      key={effort.id}
                      role="radio"
                      aria-checked={selectedEffort === effort.id}
                      title={effort.description}
                      onClick={() =>
                        choose(
                          inspectedModel.id,
                          effort.id,
                          true,
                          reasoningOwner,
                        )
                      }
                    >
                      {effort.label}
                      {selectedEffort === effort.id && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </AIPopover>
      )}
    </>
  );
}
