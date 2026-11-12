import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Star,
} from "lucide-react";
import {
  chooseAIModel,
  discoverAIModels,
  setChatProvider,
  useAI,
  type AIChoice,
} from "../lib/ai";
import AIProviderIcon from "./AIProviderIcon";
import AIPopover from "./AIPopover";
function favorites(): string[] {
  try {
    const values = JSON.parse(
      localStorage.getItem("devyy.ai.favoriteModels") ?? "[]",
    );
    return Array.isArray(values)
      ? values.filter((value) => typeof value === "string").slice(0, 256)
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
  const providers = state.providers.filter((p) => p.enabled !== false),
    provider = state.providers.find((p) => p.id === providerId),
    inspected = state.providers.find((p) => p.id === selected);
  const current = state.models[providerId]?.find((m) => m.id === choice.model);
  const display =
    current?.name || choice.model || provider?.model || "Default model";
  const options = (state.models[selected] ?? []).filter(
    (m) =>
      `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()) &&
      (!onlyFavorites || stars.includes(`${selected}:${m.id}`)),
  );
  const inspectedModel = state.models[selected]?.find(
    (m) =>
      m.id ===
      (selected === providerId ? choice.model : state.choices[selected]?.model),
  );
  const discovery = useRef(0);
  async function refresh(id = selected, force = false) {
    const ticket = ++discovery.current;
    setBusy(true);
    setError("");
    try {
      await discoverAIModels(id, force);
    } catch (e) {
      if (ticket === discovery.current) setError(String(e));
    } finally {
      if (ticket === discovery.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (open) {
      setSelected(providerId);
      setQuery("");
    }
  }, [open, providerId]);
  useEffect(() => {
    if (open) void refresh(selected);
  }, [open, selected]);
  function choose(id: string, effort = "", keepOpen = false) {
    const next = { model: id, effort };
    if (chatId && providerId !== selected) setChatProvider(chatId, selected);
    chooseAIModel(selected, next, chatId);
    onChoose(selected, next);
    if (!keepOpen) setOpen(false);
  }
  function toggleStar(id: string) {
    const key = `${selected}:${id}`,
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
        {choice.effort && <small>{choice.effort}</small>}
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
                  aria-pressed={selected === p.id}
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
                  aria-label="Refresh models"
                  onClick={() => void refresh(selected, true)}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle size={13} className="spinning" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
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
                  <div className="ai-model-option" key={model.id}>
                    <button
                      role="option"
                      aria-selected={
                        providerId === selected && choice.model === model.id
                      }
                      onClick={() =>
                        choose(
                          model.id,
                          model.reasoningEfforts?.includes(choice.effort)
                            ? choice.effort
                            : "",
                        )
                      }
                    >
                      <span>
                        <strong>{model.name}</strong>
                        {model.name !== model.id && <small>{model.id}</small>}
                      </span>
                      {providerId === selected && choice.model === model.id && (
                        <Check size={13} />
                      )}
                    </button>
                    <button
                      aria-label={`${stars.includes(`${selected}:${model.id}`) ? "Unfavorite" : "Favorite"} ${model.name}`}
                      onClick={() => toggleStar(model.id)}
                    >
                      <Star
                        size={12}
                        fill={
                          stars.includes(`${selected}:${model.id}`)
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  </div>
                ))}
                {busy && !options.length && (
                  <div className="ai-picker-status">
                    <LoaderCircle className="spinning" size={14} /> Loading
                    models
                  </div>
                )}
                {error && (
                  <p className="ai-error" role="alert">
                    {error}
                  </p>
                )}
                {!busy &&
                  query &&
                  !options.some((m) => m.id === query.trim()) && (
                    <button
                      role="option"
                      aria-selected={false}
                      onClick={() => choose(query.trim())}
                    >
                      Use model ID <code>{query.trim()}</code>
                    </button>
                  )}
              </div>
              <footer>
                <AIProviderIcon kind={inspected?.kind ?? "custom"} size={13} />
                <span>{inspected?.name}</span>
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
            {!!inspectedModel?.reasoningEfforts?.length && (
              <section
                className="ai-reasoning-picker"
                aria-label="Reasoning effort"
              >
                <header>Reasoning</header>
                <div role="radiogroup" aria-label="Reasoning effort">
                  <button
                    role="radio"
                    aria-checked={!choice.effort}
                    onClick={() => choose(inspectedModel.id, "", true)}
                  >
                    Default{!choice.effort && <Check size={12} />}
                  </button>
                  {inspectedModel.reasoningEfforts.map((effort) => (
                    <button
                      key={effort}
                      role="radio"
                      aria-checked={choice.effort === effort}
                      onClick={() => choose(inspectedModel.id, effort, true)}
                    >
                      {effort === "xhigh"
                        ? "Extra high"
                        : effort.charAt(0).toUpperCase() + effort.slice(1)}
                      {choice.effort === effort && <Check size={12} />}
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
