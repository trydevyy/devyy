import { useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen, native } from "./native";
import { contextPrompt, type AIAttachment } from "./aiContext";

export interface AIProvider {
  id: string;
  name: string;
  kind: "chatgpt" | "codex" | "claude" | "openai" | "anthropic" | "custom";
  endpoint: string;
  model: string;
  executable: string;
  hasKey: boolean;
  enabled?: boolean;
}
export interface AIModel {
  id: string;
  name: string;
  description?: string;
  reasoningEfforts?: string[];
  defaultEffort?: string;
  isDefault?: boolean;
}
export interface AIChoice {
  model: string;
  effort: string;
}
export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: { path: string; content: string };
  error?: string;
  stopped?: boolean;
  attachments?: AIAttachment[];
  startedAt?: number;
  finishedAt?: number;
  model?: string;
  effort?: string;
}
export interface AIConversation {
  id: string;
  title: string;
  providerId: string;
  messages: AIMessage[];
  updatedAt: number;
  model?: string;
  effort?: string;
}
export interface AIUsage {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  limits?: Record<string, unknown>;
  observedAt?: number;
  costUSD?: number;
  requests?: number;
}
export interface AIState {
  providers: AIProvider[];
  conversations: AIConversation[];
  selected: string;
  active: Record<string, { requestId: string; messageId: string }>;
  usage: Record<string, AIUsage>;
  accounts: Record<string, Record<string, unknown>>;
  models: Record<string, AIModel[]>;
  choices: Record<string, AIChoice>;
  loaded: boolean;
  error: string;
}
const initialProviders: AIProvider[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    kind: "chatgpt",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "codex",
    name: "Codex CLI",
    kind: "codex",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "claude",
    name: "Claude Code",
    kind: "claude",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "openai",
    name: "OpenAI API",
    kind: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    kind: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    model: "",
    executable: "",
    hasKey: false,
  },
];
function savedConversations(): AIConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("devyy.ai.chats") ?? "[]",
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (c): c is AIConversation =>
          c &&
          typeof c.id === "string" &&
          typeof c.title === "string" &&
          typeof c.providerId === "string" &&
          Array.isArray(c.messages) &&
          c.messages.every(
            (m: AIMessage) =>
              m &&
              ["user", "assistant"].includes(m.role) &&
              typeof m.id === "string" &&
              typeof m.content === "string",
          ),
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}
function savedChoices(): Record<string, AIChoice> {
  if (typeof window === "undefined") return {};
  try {
    const values = JSON.parse(
      localStorage.getItem("devyy.ai.modelChoices") ?? "{}",
    );
    const result: Record<string, AIChoice> = {};
    for (const [key, value] of Object.entries(values)) {
      const choice = value as AIChoice;
      if (
        choice &&
        typeof choice.model === "string" &&
        typeof choice.effort === "string"
      )
        result[key] = { model: choice.model, effort: choice.effort };
    }
    return result;
  } catch {
    return {};
  }
}
let state: AIState = {
  providers: initialProviders,
  conversations: savedConversations(),
  selected: "",
  active: {},
  usage: {},
  accounts: {},
  models: {},
  choices: savedChoices(),
  loaded: false,
  error: "",
};
const listeners = new Set<() => void>();
function update(patch: Partial<AIState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export function useAI() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
}
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        "devyy.ai.chats",
        JSON.stringify(state.conversations.slice(0, 40)),
      );
    } catch {
      update({
        error:
          "Chat history could not be saved. Delete older conversations to free local storage.",
      });
    }
  }, 300);
}
let loading: Promise<void> | undefined;
export function loadAI(force = false): Promise<void> {
  if (loading && !force) return loading;
  if (state.loaded && !force) return Promise.resolve();
  loading = (async () => {
    if (!native) {
      update({ loaded: true });
      return;
    }
    try {
      const providers = await invoke<AIProvider[]>("ai_providers");
      update({
        providers: Array.isArray(providers) ? providers : initialProviders,
        loaded: true,
        error: "",
      });
    } catch (e) {
      update({ loaded: true, error: String(e) });
    }
  })().finally(() => {
    loading = undefined;
  });
  return loading;
}
export async function saveAIProvider(
  provider: AIProvider,
  apiKey: string,
  removeKey = false,
) {
  if (!native)
    throw new Error("Open the desktop app to configure AI providers.");
  const previous = state.providers.find((p) => p.id === provider.id);
  await invoke("ai_save_provider", {
    provider,
    apiKey: apiKey || null,
    removeKey,
  });
  if (
    apiKey ||
    removeKey ||
    previous?.endpoint !== provider.endpoint ||
    previous?.kind !== provider.kind ||
    previous?.executable !== provider.executable
  ) {
    const models = { ...state.models };
    delete models[provider.id];
    update({ models });
  }
  await loadAI(true);
}
export async function removeAIProvider(providerId: string) {
  await invoke("ai_delete_provider", { providerId });
  await loadAI(true);
}
export function newAIChat(providerId: string): string {
  const id = crypto.randomUUID();
  const chat: AIConversation = {
    id,
    title: "New conversation",
    providerId,
    messages: [],
    updatedAt: Date.now(),
    model:
      state.choices[providerId]?.model ??
      state.providers.find((p) => p.id === providerId)?.model ??
      "",
    effort: state.choices[providerId]?.effort ?? "",
  };
  update({ conversations: [chat, ...state.conversations], selected: id });
  persist();
  return id;
}
export function selectAIChat(id: string) {
  update({ selected: id });
}
export async function deleteAIChat(id: string) {
  await stopAIChat(id);
  update({
    conversations: state.conversations.filter((c) => c.id !== id),
    selected: state.selected === id ? "" : state.selected,
  });
  persist();
}
export function setChatProvider(id: string, providerId: string) {
  if (state.active[id]) return;
  update({
    conversations: state.conversations.map((c) =>
      c.id === id
        ? {
            ...c,
            providerId,
            model:
              state.choices[providerId]?.model ??
              state.providers.find((p) => p.id === providerId)?.model ??
              "",
            effort: state.choices[providerId]?.effort ?? "",
          }
        : c,
    ),
  });
  persist();
}
export function chooseAIModel(
  providerId: string,
  choice: AIChoice,
  chatId?: string,
) {
  if (chatId && state.active[chatId]) return;
  update({
    choices: { ...state.choices, [providerId]: choice },
    conversations: state.conversations.map((c) =>
      c.id === chatId ? { ...c, providerId, ...choice } : c,
    ),
  });
  try {
    localStorage.setItem(
      "devyy.ai.modelChoices",
      JSON.stringify(state.choices),
    );
  } catch {}
  persist();
}
export async function discoverAIModels(
  providerId: string,
  force = false,
): Promise<AIModel[]> {
  if (!force && state.models[providerId]) return state.models[providerId];
  if (!native) return [];
  const values = await invoke<(string | AIModel)[]>("ai_models", {
    providerId,
  });
  const models = (Array.isArray(values) ? values : [])
    .map((model) =>
      typeof model === "string" ? { id: model, name: model } : model,
    )
    .filter((model) => model && typeof model.id === "string");
  update({ models: { ...state.models, [providerId]: models } });
  return models;
}
export function renameAIChat(id: string, title: string) {
  update({
    conversations: state.conversations.map((c) =>
      c.id === id
        ? { ...c, title: title.trim().slice(0, 120) || "New conversation" }
        : c,
    ),
  });
  persist();
}
export function forkAIChat(id: string, messageId: string): string | null {
  const source = state.conversations.find((c) => c.id === id),
    index = source?.messages.findIndex((m) => m.id === messageId) ?? -1;
  if (!source || index < 0) return null;
  const chat = {
    ...source,
    id: crypto.randomUUID(),
    title: `${source.title} (branch)`,
    messages: source.messages.slice(0, index + 1).map((m) => ({ ...m })),
    updatedAt: Date.now(),
  };
  update({ conversations: [chat, ...state.conversations], selected: chat.id });
  persist();
  return chat.id;
}
function editMessage(
  chatId: string,
  messageId: string,
  patch: Partial<AIMessage>,
) {
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, ...patch } : m,
            ),
            updatedAt: Date.now(),
          }
        : c,
    ),
  });
  persist();
}
export async function editAIMessage(
  chatId: string,
  messageId: string,
  content: string,
  attachments: AIAttachment[],
  cwd?: string,
) {
  const chat = state.conversations.find((c) => c.id === chatId);
  if (!chat || state.active[chatId]) return;
  const index = chat.messages.findIndex(
    (m) => m.id === messageId && m.role === "user",
  );
  if (index < 0) return;
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: [
              ...c.messages.slice(0, index),
              {
                ...c.messages[index],
                content,
                attachments,
                context: undefined,
              },
            ],
          }
        : c,
    ),
  });
  persist();
  await sendAIMessage(chatId, "", undefined, cwd, true);
}
export async function stopAIChat(id: string) {
  const active = state.active[id];
  if (active && native)
    await invoke("ai_cancel", { requestId: active.requestId });
}
function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
export function tokenUsage(data: Record<string, unknown>): {
  input: number;
  output: number;
} {
  return {
    input:
      numeric(data.input_tokens ?? data.prompt_tokens ?? data.inputTokens) +
      numeric(data.cache_read_input_tokens) +
      numeric(data.cache_creation_input_tokens),
    output: numeric(
      data.output_tokens ?? data.completion_tokens ?? data.outputTokens,
    ),
  };
}
export async function sendAIMessage(
  chatId: string,
  content: string,
  context?: AIMessage["context"],
  cwd?: string,
  retry = false,
  attachments?: AIAttachment[],
) {
  if (!native) throw new Error("AI connects from the Devyy desktop app.");
  if (state.active[chatId]) return;
  let chat = state.conversations.find((c) => c.id === chatId);
  if (!chat) return;
  if (!retry) {
    const user: AIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      context,
      attachments,
    };
    chat = {
      ...chat,
      title: chat.messages.length ? chat.title : content.slice(0, 54),
      messages: [...chat.messages, user],
    };
  } else {
    let lastUser = chat.messages.length - 1;
    while (lastUser >= 0 && chat.messages[lastUser].role !== "user") lastUser--;
    if (lastUser < 0) return;
    chat = { ...chat, messages: chat.messages.slice(0, lastUser + 1) };
  }
  const assistant: AIMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    startedAt: Date.now(),
    model:
      chat.model ??
      state.providers.find((p) => p.id === chat!.providerId)?.model,
    effort: chat.effort,
  };
  const requestId = crypto.randomUUID();
  const providerId = chat.providerId;
  const messages = chat.messages.map((m) => ({
    role: m.role,
    content: contextPrompt(m),
  }));
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? { ...chat!, messages: [...chat!.messages, assistant] }
        : c,
    ),
    active: {
      ...state.active,
      [chatId]: { requestId, messageId: assistant.id },
    },
  });
  persist();
  let unlisten: (() => void) | undefined;
  let input = 0,
    output = 0,
    stopped = false,
    cost = 0;
  let pendingText = "",
    frame = 0;
  const flushText = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pendingText) return;
    const current = state.conversations
      .find((c) => c.id === chatId)
      ?.messages.find((m) => m.id === assistant.id);
    if (current)
      editMessage(chatId, assistant.id, {
        content: current.content + pendingText,
      });
    pendingText = "";
  };
  try {
    unlisten = await listen<{ requestId: string; kind: string; data: unknown }>(
      "devyy-ai",
      (event) => {
        const e = event.payload;
        if (e.requestId !== requestId) return;
        if (e.kind === "delta" && typeof e.data === "string") {
          pendingText += e.data;
          if (!frame) frame = requestAnimationFrame(flushText);
        }
        if (e.kind === "error")
          editMessage(chatId, assistant.id, { error: String(e.data) });
        if (e.kind === "cancelled") {
          stopped = true;
          editMessage(chatId, assistant.id, { stopped: true });
        }
        if (e.kind === "cost" && e.data && typeof e.data === "object") {
          const amount = numeric((e.data as Record<string, unknown>).amount);
          const old = state.usage[providerId] ?? {
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
          update({
            usage: {
              ...state.usage,
              [providerId]: {
                ...old,
                costUSD: (old.costUSD ?? 0) + Math.max(0, amount - cost),
              },
            },
          });
          cost = Math.max(cost, amount);
        }
        if (
          (e.kind === "usage" || e.kind === "limits") &&
          e.data &&
          typeof e.data === "object"
        ) {
          const old = state.usage[providerId] ?? {
            inputTokens: 0,
            outputTokens: 0,
            tokens: 0,
          };
          const data = e.data as Record<string, unknown>;
          if (e.kind === "usage") {
            const usage = tokenUsage(data);
            const nextInput = Math.max(input, usage.input),
              nextOutput = Math.max(output, usage.output);
            const usagePatch = {
              ...old,
              inputTokens: old.inputTokens + nextInput - input,
              outputTokens: old.outputTokens + nextOutput - output,
              tokens: old.tokens + nextInput - input + nextOutput - output,
            };
            input = nextInput;
            output = nextOutput;
            update({ usage: { ...state.usage, [providerId]: usagePatch } });
          } else
            update({
              usage: {
                ...state.usage,
                [providerId]: { ...old, limits: data, observedAt: Date.now() },
              },
            });
        }
      },
    );
    await invoke("ai_chat", {
      request: {
        requestId,
        providerId,
        messages,
        cwd: cwd ?? null,
        model: chat.model ?? null,
        effort: chat.effort || null,
      },
    });
    flushText();
    if (!stopped) {
      const reply = state.conversations
        .find((c) => c.id === chatId)
        ?.messages.find((m) => m.id === assistant.id);
      if (reply && !reply.content && !reply.error)
        editMessage(chatId, assistant.id, {
          error:
            "The provider returned an empty reply. Try a different model or retry.",
        });
    }
  } catch (e) {
    editMessage(chatId, assistant.id, { error: String(e) });
  } finally {
    flushText();
    editMessage(chatId, assistant.id, { finishedAt: Date.now() });
    const usage = state.usage[providerId] ?? {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    update({
      usage: {
        ...state.usage,
        [providerId]: { ...usage, requests: (usage.requests ?? 0) + 1 },
      },
    });
    unlisten?.();
    const active = { ...state.active };
    delete active[chatId];
    update({ active });
    persist();
  }
}
export async function aiAccount(
  providerId: string,
  action: "login" | "add" | "select" | "logout" | "status",
  requestId: string,
  accountId?: string,
) {
  if (!native)
    throw new Error("Account connections are available in the desktop app.");
  const unlisten = await listen<{
    requestId: string;
    kind: string;
    data: { authUrl?: string };
  }>("devyy-ai", (event) => {
    if (event.payload.requestId !== requestId || event.payload.kind !== "login")
      return;
    const url = event.payload.data.authUrl;
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
          parsed.hostname,
        )
      )
        return;
      void openUrl(url).catch(() =>
        update({
          error:
            "Could not open the sign-in browser. Check your default browser and try again.",
        }),
      );
    } catch {
      /* Ignore unexpected URLs from a CLI. */
    }
  });
  try {
    const account = await invoke<Record<string, unknown>>("ai_account", {
      providerId,
      action,
      requestId,
      accountId,
    });
    const models = { ...state.models };
    if (action !== "status") delete models[providerId];
    const usage = state.usage[providerId] ?? {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    update({
      accounts: { ...state.accounts, [providerId]: account },
      models,
      ...("limits" in account
        ? {
            usage: {
              ...state.usage,
              [providerId]: {
                ...usage,
                limits:
                  account.limits && typeof account.limits === "object"
                    ? (account.limits as Record<string, unknown>)
                    : undefined,
                observedAt: Date.now(),
              },
            },
          }
        : {}),
    });
    return account;
  } finally {
    unlisten();
  }
}
export function remainingLimits(
  raw?: Record<string, unknown>,
): { label: string; remaining: number; resetsAt?: number }[] {
  if (!raw) return [];
  const data = (raw.rateLimits ?? raw) as Record<string, unknown>;
  return (
    [
      ["primary", "Current window"],
      ["secondary", "Weekly window"],
    ] as const
  ).flatMap(([key, label]) => {
    const window = data[key] as Record<string, unknown> | undefined;
    if (
      !window ||
      typeof window.usedPercent !== "number" ||
      !Number.isFinite(window.usedPercent)
    )
      return [];
    return [
      {
        label,
        remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        resetsAt:
          typeof window.resetsAt === "number" ? window.resetsAt : undefined,
      },
    ];
  });
}
