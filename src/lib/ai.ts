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

import { requestId as newRequestId } from "./requestId";
import { supportedEffort } from "./aiReasoning";
import { useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, listen, native } from "./native";
import { contextPrompt, type AIAttachment } from "./aiContext";
import { getActiveSkillsPrompt } from "./aiSkills";

export type AIAgentMode = "ask" | "plan" | "agent" | "review";

export interface AISubagentTask {
  id: string;
  role: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: string;
  result?: string;
  toolsUsed?: string[];
}

export interface AIQAResult {
  tool: string;
  success: boolean;
  output: string;
}

export interface AICheckpoint {
  id: string;
  name: string;
  timestamp: number;
  sha?: string;
}

export const AGENT_MODE_PROMPTS: Record<AIAgentMode, string> = {
  ask: "You are Devyy in Ask Mode. Explore, understand, and explain the codebase or architectural questions clearly. Use search and read tools freely. Do not propose code modifications or execute destructive terminal operations.",
  plan: "You are Devyy in Plan Mode. Carefully evaluate options and produce a structured, step-by-step implementation plan. Define explicit milestones, dependencies, and testing verification checkpoints before any code is written.",
  agent:
    "You are Devyy in Agent Mode. Autonomously execute the task: read implementation, write and modify code with focused proposals, run non-interactive terminal commands (cargo, npm, tests), verify all changes, and resolve errors before completion.",
  review:
    "You are Devyy in Review Mode. Thoroughly inspect recent diffs and changes for potential regressions, bugs, type safety flaws, performance pitfalls, and missing test coverage. Deliver a clean, structured code review report.",
};

export interface AIProvider {
  id: string;
  name: string;
  kind:
    | "chatgpt"
    | "codex"
    | "claude"
    | "antigravity"
    | "opencode"
    | "openai"
    | "anthropic"
    | "custom"
    | "cli";
  endpoint: string;
  model: string;
  executable: string;
  args?: string[];
  cliJson?: boolean;
  hasKey: boolean;
  enabled?: boolean;
}
export interface AIModel {
  id: string;
  name: string;
  description?: string;
  reasoningEfforts?: string[];
  reasoningOptions?: { id: string; label: string; description?: string }[];
  reasoningLabel?: string;
  defaultEffort?: string;
  isDefault?: boolean;
}
export interface AIChoice {
  model: string;
  effort: string;
}
export interface AIProposal {
  id: string;
  path: string;
  original: string;
  modified: string;
  create?: boolean;
  workspace: string;
  status: "pending" | "reviewed" | "applied" | "dismissed";
}
export interface AITool {
  id: string;
  name: string;
  path: string;
  status: "running" | "complete" | "error" | "cancelled";
  args?: Record<string, unknown>;
  detail?: string;
}
export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: AIAgentMode;
  context?: { path: string; content: string };
  error?: string;
  stopped?: boolean;
  reasoning?: string;
  proposals?: AIProposal[];
  tools?: AITool[];
  subagents?: AISubagentTask[];
  qaResults?: AIQAResult[];
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
  mode?: AIAgentMode;
  checkpoints?: AICheckpoint[];
}
export interface AIUsage {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  limits?: Record<string, unknown>;
  observedAt?: number;
  costUSD?: number;
  estimatedCostUSD?: number;
  planLimitHitAt?: number;
  requests?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
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
  verified: Record<string, string>;
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
    enabled: false,
  },
  {
    id: "claude",
    name: "Claude Code",
    kind: "claude",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
    enabled: false,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "antigravity",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
    enabled: false,
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "opencode",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
    enabled: false,
  },
  {
    id: "openai",
    name: "OpenAI API",
    kind: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "",
    executable: "",
    hasKey: false,
    enabled: false,
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    kind: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    model: "",
    executable: "",
    hasKey: false,
    enabled: false,
  },
];
function savedConversations(): AIConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("devyy.ai.chats") ?? "[]",
    );
    if (!Array.isArray(data)) return [];
    const chats = data
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
      .slice(0, 40)
      .map((chat) =>
        chat.providerId === "codex"
          ? { ...chat, providerId: "chatgpt", model: "", effort: "" }
          : chat,
      )
      .map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => ({
          ...message,
          reasoning:
            typeof message.reasoning === "string"
              ? message.reasoning.slice(0, 256 * 1024)
              : undefined,
        })),
      }));
    if (data.some((chat) => chat?.providerId === "codex")) {
      try {
        localStorage.setItem("devyy.ai.chats", JSON.stringify(chats));
      } catch {}
    }
    return chats;
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
        if (key !== "codex")
          result[key] = { model: choice.model, effort: choice.effort };
    }
    return result;
  } catch {
    return {};
  }
}
function savedUsage(): Record<string, AIUsage> {
  try {
    const values = JSON.parse(localStorage.getItem("devyy.ai.usage") ?? "{}");
    if (!values || typeof values !== "object" || Array.isArray(values))
      return {};
    return Object.fromEntries(
      Object.entries(values)
        .slice(0, 64)
        .filter(([, value]) => value && typeof value === "object")
        .map(([id, value]) => {
          const usage = value as AIUsage;
          const inputTokens = numeric(usage.inputTokens),
            outputTokens = numeric(usage.outputTokens);
          return [
            id,
            {
              inputTokens,
              outputTokens,
              tokens: inputTokens + outputTokens,
              requests: numeric(usage.requests),
              cachedInputTokens: numeric(usage.cachedInputTokens),
              reasoningTokens: numeric(usage.reasoningTokens),
              ...(typeof usage.costUSD === "number" &&
              Number.isFinite(usage.costUSD) &&
              usage.costUSD >= 0
                ? { costUSD: usage.costUSD }
                : {}),
              ...(typeof usage.estimatedCostUSD === "number" &&
              Number.isFinite(usage.estimatedCostUSD) &&
              usage.estimatedCostUSD >= 0
                ? { estimatedCostUSD: usage.estimatedCostUSD }
                : {}),
            },
          ];
        }),
    );
  } catch {
    return {};
  }
}
function savedVerification(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("devyy.ai.verified") ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function connectionSignature(provider: AIProvider) {
  return JSON.stringify([
    provider.kind,
    provider.endpoint,
    provider.executable,
    provider.args ?? [],
    !!provider.cliJson,
    provider.hasKey,
    provider.kind === "cli" ? provider.model : "",
  ]);
}

export function aiProviderReady(provider: AIProvider, state: AIState) {
  if (provider.enabled === false) return false;
  const account = state.accounts[provider.id];
  if (provider.kind === "chatgpt")
    return !!account?.account && account.planEnabled !== false;
  if (provider.kind === "claude") return account?.loggedIn === true;
  if (
    ["custom", "openai", "anthropic"].includes(provider.kind) &&
    !provider.hasKey
  ) {
    try {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(provider.endpoint).hostname,
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  return state.verified[provider.id] === connectionSignature(provider);
}

function setVerified(provider: AIProvider, connected: boolean) {
  const verified = { ...state.verified };
  if (connected) verified[provider.id] = connectionSignature(provider);
  else delete verified[provider.id];
  update({ verified });
  try {
    localStorage.setItem("devyy.ai.verified", JSON.stringify(verified));
  } catch {}
}

let state: AIState = {
  providers: initialProviders,
  conversations: [],
  selected: "",
  active: {},
  usage: savedUsage(),
  accounts: {},
  models: {},
  choices: savedChoices(),
  verified: savedVerification(),
  loaded: false,
  error: "",
};
const listeners = new Set<() => void>();
function update(patch: Partial<AIState>) {
  state = { ...state, ...patch };
  if (patch.usage)
    try {
      localStorage.setItem(
        "devyy.ai.usage",
        JSON.stringify(
          Object.fromEntries(
            Object.entries(state.usage).map(
              ([
                id,
                {
                  limits: _limits,
                  observedAt: _observed,
                  planLimitHitAt: _hit,
                  ...usage
                },
              ]) => [id, usage],
            ),
          ),
        ),
      );
    } catch {}
  listeners.forEach((fn) => fn());
}
export const aiSnapshot = () => state;
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
let historyHydrated = false;
export function loadAI(force = false): Promise<void> {
  if (!historyHydrated) {
    historyHydrated = true;
    update({ conversations: savedConversations() });
  }
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
        providers: Array.isArray(providers)
          ? providers.filter((p) => p.kind !== "codex")
          : initialProviders,
        loaded: true,
        error: "",
      });
      if (!force) {
        await Promise.allSettled(
          state.providers
            .filter(
              (p) =>
                p.enabled !== false && ["chatgpt", "claude"].includes(p.kind),
            )
            .map((p) => aiAccount(p.id, "status", newRequestId())),
        );
      }
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
    previous?.executable !== provider.executable ||
    (previous?.model !== provider.model && provider.kind === "cli") ||
    previous?.cliJson !== provider.cliJson ||
    JSON.stringify(previous?.args ?? []) !== JSON.stringify(provider.args ?? [])
  ) {
    setVerified(provider, false);
    modelVersions.set(provider.id, (modelVersions.get(provider.id) ?? 0) + 1);
    const models = { ...state.models };
    delete models[provider.id];
    update({ models });
  }
  if (previous && previous.model !== provider.model) {
    const choice = state.choices[provider.id];
    if (choice?.model === previous.model)
      chooseAIModel(provider.id, { model: provider.model, effort: "" });
    update({
      conversations: state.conversations.map((chat) =>
        chat.providerId === provider.id &&
        !state.active[chat.id] &&
        chat.model === previous.model
          ? { ...chat, model: provider.model, effort: "" }
          : chat,
      ),
    });
    persist();
  }
  await loadAI(true);
}
export async function removeAIProvider(providerId: string) {
  await invoke("ai_delete_provider", { providerId });
  const provider = state.providers.find((p) => p.id === providerId);
  if (provider) setVerified(provider, false);
  await loadAI(true);
}
export function newAIChat(providerId: string): string {
  const id = newRequestId();
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
const modelVersions = new Map<string, number>();
export async function discoverAIModels(
  providerId: string,
  force = false,
  confirmedSignIn = false,
): Promise<AIModel[]> {
  if (!force && state.models[providerId]) return state.models[providerId];
  if (!native) return [];
  const version = modelVersions.get(providerId) ?? 0;
  const provider = state.providers.find((p) => p.id === providerId);
  const values = await invoke<(string | AIModel)[]>("ai_models", {
    providerId,
  }).catch((error) => {
    if (provider && (modelVersions.get(providerId) ?? 0) === version)
      setVerified(provider, false);
    throw error;
  });
  const models = (Array.isArray(values) ? values : [])
    .map((model) =>
      typeof model === "string" ? { id: model, name: model } : model,
    )
    .filter((model) => model && typeof model.id === "string");
  if ((modelVersions.get(providerId) ?? 0) !== version) return [];
  if (provider && !["chatgpt", "claude", "codex"].includes(provider.kind)) {
    const signedIn = ["antigravity", "opencode"].includes(provider.kind)
      ? confirmedSignIn || aiProviderReady(provider, state)
      : true;
    setVerified(provider, models.length > 0 && signedIn);
  }
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
    id: newRequestId(),
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
export function getPendingAIProposals(chatId?: string): AIProposal[] {
  const chats = chatId
    ? state.conversations.filter((c) => c.id === chatId)
    : state.conversations;
  const pending: AIProposal[] = [];
  for (const c of chats) {
    for (const m of c.messages) {
      if (m.proposals) {
        for (const p of m.proposals) {
          if (p.status !== "applied" && p.status !== "dismissed") {
            pending.push(p);
          }
        }
      }
    }
  }
  return pending;
}
export function setAIProposalStatus(id: string, status: AIProposal["status"]) {
  update({
    conversations: state.conversations.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.proposals?.some((p) => p.id === id)
          ? {
              ...message,
              proposals: message.proposals.map((proposal) =>
                proposal.id === id ? { ...proposal, status } : proposal,
              ),
            }
          : message,
      ),
    })),
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
  const nested =
    data.usage ??
    (data.response as Record<string, unknown> | undefined)?.usage ??
    (data.info as Record<string, unknown> | undefined)?.total_token_usage;
  if (nested && typeof nested === "object")
    data = nested as Record<string, unknown>;
  return {
    input:
      numeric(data.input_tokens ?? data.prompt_tokens ?? data.inputTokens) +
      numeric(data.cache_read_input_tokens) +
      numeric(data.cache_creation_input_tokens),
    output:
      numeric(
        data.output_tokens ?? data.completion_tokens ?? data.outputTokens,
      ) + numeric(data.thinking_tokens),
  };
}
export function usageRecorder(providerId: string) {
  let input = 0,
    output = 0,
    cached = 0,
    reasoning = 0,
    cost = 0,
    estimatedCost = 0,
    counted = false;
  return (kind: string, value?: unknown) => {
    if (!["usage", "cost", "limits", "plan-limit", "request"].includes(kind))
      return;
    const old = state.usage[providerId] ?? {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    const data =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    let next: AIUsage = { ...old };
    if (kind === "request") {
      if (counted) return;
      counted = true;
      next.requests = (old.requests ?? 0) + 1;
    }
    if (
      kind === "plan-limit" &&
      state.providers.some((p) => p.id === providerId && p.kind === "chatgpt")
    )
      next.planLimitHitAt = data.exceeded === true ? Date.now() : undefined;
    if (kind === "limits") {
      if (!Object.keys(data).length) return;
      const window = claudeQuota(data);
      if (window) {
        const windows = old.limits?.claudeWindows as
          Record<string, unknown> | undefined;
        next.limits = {
          claudeWindows: {
            ...windows,
            [window.rateLimitType]: { ...window, observedAt: Date.now() },
          },
        };
      } else next.limits = data;
      next.observedAt = Date.now();
    }
    if (kind === "cost") {
      if (
        typeof data.amount !== "number" ||
        !Number.isFinite(data.amount) ||
        data.amount < 0 ||
        (data.currency !== undefined && data.currency !== "USD")
      )
        return;
      if (data.estimated === true) {
        next.estimatedCostUSD =
          (old.estimatedCostUSD ?? 0) +
          Math.max(0, data.amount - estimatedCost);
        estimatedCost = Math.max(estimatedCost, data.amount);
      } else {
        next.costUSD = (old.costUSD ?? 0) + Math.max(0, data.amount - cost);
        cost = Math.max(cost, data.amount);
      }
    }
    if (kind === "usage") {
      const normalized = tokenUsage(data),
        nextInput = Math.max(input, normalized.input),
        nextOutput = Math.max(output, normalized.output);
      const raw = (data.usage ??
        (data.response as Record<string, unknown> | undefined)?.usage ??
        data) as Record<string, unknown>;
      const nextCached = Math.max(
        cached,
        numeric(
          (raw.input_tokens_details as Record<string, unknown> | undefined)
            ?.cached_tokens ??
            (raw.prompt_tokens_details as Record<string, unknown> | undefined)
              ?.cached_tokens ??
            raw.cached_input_tokens ??
            raw.cache_read_input_tokens ??
            raw.cache_read_tokens,
        ),
      );
      const nextReasoning = Math.max(
        reasoning,
        numeric(
          (raw.output_tokens_details as Record<string, unknown> | undefined)
            ?.reasoning_tokens ??
            (
              raw.completion_tokens_details as
                Record<string, unknown> | undefined
            )?.reasoning_tokens ??
            raw.reasoning_output_tokens ??
            raw.reasoning_tokens ??
            raw.thinking_tokens,
        ),
      );
      next = {
        ...old,
        inputTokens: old.inputTokens + nextInput - input,
        outputTokens: old.outputTokens + nextOutput - output,
        tokens: old.tokens + nextInput - input + nextOutput - output,
        cachedInputTokens: (old.cachedInputTokens ?? 0) + nextCached - cached,
        reasoningTokens: (old.reasoningTokens ?? 0) + nextReasoning - reasoning,
      };
      input = nextInput;
      output = nextOutput;
      cached = nextCached;
      reasoning = nextReasoning;
    }
    update({ usage: { ...state.usage, [providerId]: next } });
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
      id: newRequestId(),
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
    id: newRequestId(),
    role: "assistant",
    content: "",
    startedAt: Date.now(),
    model:
      chat.model ??
      state.providers.find((p) => p.id === chat!.providerId)?.model,
    effort: chat.effort,
  };
  const currentMode = chat.mode ?? "agent";
  assistant.mode = currentMode;
  const modeInstruction = AGENT_MODE_PROMPTS[currentMode];
  const lastUserMsg = chat.messages[chat.messages.length - 1];
  const skillsContext = getActiveSkillsPrompt(
    lastUserMsg?.content ?? "",
    chatId,
  );

  const requestId = newRequestId();
  const providerId = chat.providerId;
  const messages = chat.messages.map((m, idx) => {
    let text = contextPrompt(m);
    if (idx === chat!.messages.length - 1 && m.role === "user") {
      text = `[Current Agent Mode: ${currentMode.toUpperCase()}]\n${modeInstruction}${skillsContext}\n\n${text}`;
    }
    return {
      role: m.role,
      content: text,
    };
  });
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
  let stopped = false;
  const recordUsage = usageRecorder(providerId);
  let pendingReasoning = "";
  let pendingText = "",
    frame = 0;
  const flushText = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pendingText && !pendingReasoning) return;
    const current = state.conversations
      .find((c) => c.id === chatId)
      ?.messages.find((m) => m.id === assistant.id);
    if (current)
      editMessage(chatId, assistant.id, {
        content: current.content + pendingText,
        reasoning: ((current.reasoning ?? "") + pendingReasoning).slice(
          0,
          256 * 1024,
        ),
      });
    pendingText = "";
    pendingReasoning = "";
  };
  try {
    unlisten = await listen<{ requestId: string; kind: string; data: unknown }>(
      "devyy-ai",
      (event) => {
        const e = event.payload;
        if (e.requestId !== requestId) return;
        if (e.kind === "delta" && typeof e.data === "string") {
          let text = e.data;
          if (
            text.includes("<ctrl94>") ||
            text.includes("<ctrl95>") ||
            text.includes("\u001e") ||
            text.includes("\u001f")
          ) {
            const thoughtMatch = text.match(
              /(?:<ctrl94>(?:thought)?|\u001e(?:thought)?)([\s\S]*?)(?:<ctrl95>|\u001f|$)/,
            );
            if (thoughtMatch) {
              pendingReasoning = (pendingReasoning + thoughtMatch[1]).slice(
                0,
                256 * 1024,
              );
              text = text.replace(
                /(?:<ctrl94>(?:thought)?|\u001e(?:thought)?)([\s\S]*?)(?:<ctrl95>|\u001f|$)/g,
                "",
              );
            }
          }
          if (text) {
            pendingText += text;
            if (!frame) frame = requestAnimationFrame(flushText);
          }
        }
        if (e.kind === "reasoning" && typeof e.data === "string") {
          pendingReasoning = (pendingReasoning + e.data).slice(0, 256 * 1024);
          if (!frame) frame = requestAnimationFrame(flushText);
        }
        if (
          (e.kind === "proposal" || e.kind === "tool") &&
          e.data &&
          typeof e.data === "object"
        ) {
          const data = e.data as Record<string, unknown>;
          const message = state.conversations
            .find((c) => c.id === chatId)
            ?.messages.find((m) => m.id === assistant.id);
          if (
            message &&
            e.kind === "proposal" &&
            typeof data.id === "string" &&
            typeof data.path === "string" &&
            typeof data.original === "string" &&
            typeof data.modified === "string" &&
            typeof data.workspace === "string"
          ) {
            const proposals = message.proposals ?? [];
            if (
              proposals.length < 32 &&
              !proposals.some((p) => p.id === data.id)
            )
              editMessage(chatId, assistant.id, {
                proposals: [
                  ...proposals,
                  { ...data, status: "pending" } as unknown as AIProposal,
                ],
              });
          } else if (
            message &&
            e.kind === "tool" &&
            typeof data.id === "string" &&
            typeof data.name === "string"
          ) {
            const tools = message.tools ?? [];
            const exists = tools.some((t) => t.id === data.id);
            const nextTools = exists
              ? tools.map((t) =>
                  t.id === data.id
                    ? ({ ...t, ...data } as unknown as AITool)
                    : t,
                )
              : [...tools, data as unknown as AITool];
            editMessage(chatId, assistant.id, {
              tools: nextTools.slice(-96),
            });
          }
        }
        if (e.kind === "error")
          editMessage(chatId, assistant.id, { error: String(e.data) });
        if (e.kind === "cancelled") {
          stopped = true;
          editMessage(chatId, assistant.id, { stopped: true });
        }
        recordUsage(e.kind, e.data);
      },
    );
    await invoke("ai_chat", {
      request: {
        requestId,
        providerId,
        messages,
        cwd: cwd ?? null,
        agentMode: currentMode,
        model: chat.model ?? null,
        effort:
          supportedEffort(
            state.models[providerId]?.find(
              (m) =>
                m.id ===
                (chat.model ||
                  state.providers.find((p) => p.id === providerId)?.model),
            ),
            chat.effort || "",
          ) || null,
      },
    });
    flushText();
    if (!stopped) {
      const reply = state.conversations
        .find((c) => c.id === chatId)
        ?.messages.find((m) => m.id === assistant.id);
      if (
        reply &&
        !reply.content.trim() &&
        !reply.error &&
        !reply.proposals?.length
      )
        editMessage(chatId, assistant.id, {
          error:
            "The provider returned an empty reply. Try a different model or retry.",
        });
    }
  } catch (e) {
    editMessage(chatId, assistant.id, { error: String(e) });
  } finally {
    flushText();
    const completed = state.conversations
      .find((c) => c.id === chatId)
      ?.messages.find((m) => m.id === assistant.id);
    editMessage(chatId, assistant.id, {
      finishedAt: Date.now(),
      tools: completed?.tools?.map((tool) =>
        tool.status === "running"
          ? { ...tool, status: stopped ? "cancelled" : "error" }
          : tool,
      ),
    });
    recordUsage("request");
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
  const unlisten =
    action === "login" || action === "add"
      ? await listen<{
          requestId: string;
          kind: string;
          data: { authUrl?: string };
        }>("devyy-ai", (event) => {
          if (
            event.payload.requestId !== requestId ||
            event.payload.kind !== "login"
          )
            return;
          const url = event.payload.data.authUrl;
          if (!url) return;
          try {
            const parsed = new URL(url);
            if (
              parsed.protocol !== "https:" ||
              parsed.username ||
              parsed.password ||
              (parsed.port && parsed.port !== "443") ||
              !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
                parsed.hostname,
              )
            )
              return;
            void openUrl(url).catch(() => {
              void invoke("ai_cancel", { requestId }).catch(() => {});
              update({
                error:
                  "Could not open the sign-in browser. Check your default browser and try again.",
              });
            });
          } catch {}
        })
      : undefined;
  try {
    const account = await invoke<Record<string, unknown>>("ai_account", {
      providerId,
      action,
      requestId,
      accountId,
    });
    const models = { ...state.models };
    const identity = (value: Record<string, unknown> | undefined) =>
      (value?.account as { clientId?: string } | undefined)?.clientId;
    if (
      action !== "status" ||
      identity(account) !== identity(state.accounts[providerId])
    ) {
      delete models[providerId];
      modelVersions.set(providerId, (modelVersions.get(providerId) ?? 0) + 1);
    }
    const usage = state.usage[providerId] ?? {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    const changedAccount =
      action !== "status" ||
      identity(account) !== identity(state.accounts[providerId]) ||
      account.loggedIn !== state.accounts[providerId]?.loggedIn;
    const reported =
      account.limits && typeof account.limits === "object"
        ? (account.limits as Record<string, unknown>)
        : undefined;
    update({
      accounts: { ...state.accounts, [providerId]: account },
      models,
      ...(reported || changedAccount
        ? {
            usage: {
              ...state.usage,
              [providerId]: {
                ...usage,
                limits: reported,
                observedAt: reported ? Date.now() : undefined,
                planLimitHitAt: changedAccount
                  ? undefined
                  : usage.planLimitHitAt,
              },
            },
          }
        : {}),
    });
    return account;
  } finally {
    unlisten?.();
  }
}
export async function refreshAIPlanLimits(
  providerId: string,
  requestId: string,
) {
  const provider = state.providers.find((p) => p.id === providerId);
  const account = state.accounts[providerId];
  const startedAt = Date.now();
  const limits = await invoke<Record<string, unknown> | null>("ai_account", {
    providerId,
    requestId,
    action: "usage",
  });
  if (
    !limits ||
    !provider ||
    !state.providers.includes(provider) ||
    state.accounts[providerId] !== account ||
    !aiProviderReady(provider, state)
  )
    return;
  const observedAt = Date.now();
  const usage = state.usage[providerId] ?? {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (limits.claudeWindows && typeof limits.claudeWindows === "object") {
    const windows = limits.claudeWindows as Record<
      string,
      Record<string, unknown>
    >;
    for (const window of Object.values(windows)) window.observedAt = observedAt;
    for (const [key, window] of Object.entries(
      usage.limits?.claudeWindows ?? {},
    )) {
      if (
        typeof window.observedAt === "number" &&
        window.observedAt > startedAt
      )
        windows[key] = window;
    }
  }
  update({
    usage: { ...state.usage, [providerId]: { ...usage, limits, observedAt } },
  });
}

type RemainingLimit = {
  label: string;
  remaining: number;
  resetsAt?: number;
  observedAt?: number;
  total?: number;
  available?: number;
  approximate?: boolean;
  status?: string;
};

function quotaNumber(value: unknown): number | undefined {
  const n =
    typeof value === "number" || (typeof value === "string" && !!value.trim())
      ? Number(value)
      : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function claudeQuota(raw: Record<string, unknown>) {
  const nested = raw.rate_limit_info ?? raw.rateLimitInfo;
  if (nested && typeof nested === "object")
    raw = nested as Record<string, unknown>;
  const type = raw.rateLimitType ?? raw.rate_limit_type;
  if (typeof type !== "string" || !/^[a-z0-9_]{1,64}$/i.test(type)) return;
  return {
    rateLimitType: type,
    utilization: quotaNumber(raw.utilization),
    resetsAt: resetTime(raw.resetsAt ?? raw.resets_at),
    status: raw.status,
    isUsingOverage: raw.isUsingOverage ?? raw.is_using_overage,
  };
}

export function quotaDenied(
  raw: Record<string, unknown> | undefined,
  now: number,
): boolean {
  if (!raw) return false;
  if (raw.claudeWindows && typeof raw.claudeWindows === "object")
    return Object.values(raw.claudeWindows).some((window) =>
      quotaDenied(window, now),
    );
  const window = claudeQuota(raw);
  const reset = window?.resetsAt ?? resetTime(raw.resetsAt ?? raw.resets_at);
  return (
    (window?.status ?? raw.status) === "rejected" &&
    (window?.utilization ?? quotaNumber(raw.utilization)) === undefined &&
    (reset === undefined || reset * 1000 > now)
  );
}

function resetTime(value: unknown, observedAt?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value;
  if (typeof value !== "string") return;
  if (/^\d{9,10}$/.test(value)) return Number(value);
  if (/^\d{4}-/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : undefined;
  }
  // OpenAI reset headers contain durations (e.g. 1m30s or 125ms).
  if (!observedAt || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value)) return;
  const unitSeconds: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return (
    observedAt / 1000 +
    Array.from(value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)).reduce(
      (sum, [, count, unit]) => sum + Number(count) * unitSeconds[unit],
      0,
    )
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function remainingLimits(
  raw?: Record<string, unknown>,
  observedAt?: number,
): RemainingLimit[] {
  if (!raw) return [];
  if (raw.claudeWindows && typeof raw.claudeWindows === "object")
    return Object.values(raw.claudeWindows).flatMap((value) =>
      remainingLimits(value, value.observedAt ?? observedAt),
    );
  if (Array.isArray(raw.planWindows))
    return raw.planWindows.flatMap((window) => {
      if (typeof window?.label !== "string") return [];
      const used = quotaNumber(window.usedPercent);
      if (used === undefined) return [];
      return [
        {
          label: window.label,
          remaining: clampPercent(100 - used),
          resetsAt: resetTime(window.resetsAt),
          observedAt,
        },
      ];
    });
  const data = (raw.rateLimits ?? raw.rate_limits ?? raw) as Record<
    string,
    unknown
  >;
  const windows = (
    [
      ["primary", "Primary window"],
      ["secondary", "Secondary window"],
    ] as const
  ).flatMap(([key, fallback]) => {
    const window = data[key] as Record<string, unknown> | undefined;
    if (!window) return [];
    const used = quotaNumber(window.usedPercent ?? window.used_percent);
    if (used === undefined) return [];
    const minutes =
      quotaNumber(window.windowDurationMins ?? window.window_duration_mins) ??
      (quotaNumber(window.limit_window_seconds) ?? 0) / 60;
    const label =
      minutes === 10080
        ? "Weekly"
        : minutes === 1440
          ? "Daily"
          : typeof minutes === "number" &&
              minutes > 0 &&
              Number.isFinite(minutes)
            ? minutes % 60 === 0
              ? `${minutes / 60}-hour window`
              : `${minutes}-minute window`
            : fallback;
    return [
      {
        label,
        remaining: clampPercent(100 - used),
        resetsAt: resetTime(window.resetsAt ?? window.resets_at),
      },
    ];
  });
  if (windows.length) return windows;
  const claude = claudeQuota(raw);
  const utilization = claude?.utilization ?? quotaNumber(raw.utilization);
  if (utilization !== undefined && utilization >= 0) {
    const labels: Record<string, string> = {
      five_hour: "5-hour allowance",
      seven_day: "Weekly allowance",
      seven_day_sonnet: "Weekly Sonnet allowance",
      seven_day_opus: "Weekly Opus allowance",
      overage: "Extra usage",
    };
    return [
      {
        label:
          typeof raw.label === "string"
            ? raw.label
            : claude
              ? (labels[claude.rateLimitType] ??
                claude.rateLimitType.replaceAll("_", " "))
              : "Reported allowance",
        remaining: clampPercent((1 - utilization) * 100),
        resetsAt: claude?.resetsAt ?? resetTime(raw.resetsAt ?? raw.resets_at),
        ...(observedAt ? { observedAt } : {}),
        ...((claude?.status ?? raw.status) === "rejected"
          ? { status: "Limit reached" }
          : claude?.isUsingOverage === true
            ? { status: "Using extra usage" }
            : {}),
      },
    ];
  }
  return [
    ["x-ratelimit", "requests", "Request rate limit"],
    ["x-ratelimit", "tokens", "Token rate limit"],
    ["x-ratelimit", "project-tokens", "Project token rate limit"],
    ["anthropic-ratelimit", "requests", "Request rate limit"],
    ["anthropic-ratelimit", "tokens", "Token rate limit"],
    ["anthropic-ratelimit", "input-tokens", "Input token rate limit"],
    ["anthropic-ratelimit", "output-tokens", "Output token rate limit"],
  ].flatMap(([prefix, key, label]) => {
    const anthropic = prefix === "anthropic-ratelimit";
    const header = (field: string) =>
      anthropic
        ? raw[`${prefix}-${key}-${field}`]
        : raw[`${prefix}-${field}-${key}`];
    const parse = (field: string) => {
      const value = header(field);
      return typeof value === "number" ||
        (typeof value === "string" && !!value.trim())
        ? Number(value)
        : NaN;
    };
    const total = parse("limit"),
      available = parse("remaining");
    if (
      !Number.isFinite(total) ||
      total <= 0 ||
      !Number.isFinite(available) ||
      available < 0
    )
      return [];
    const resetsAt = resetTime(header("reset"), observedAt);
    return [
      {
        label,
        remaining: clampPercent((available / total) * 100),
        total,
        available,
        ...(resetsAt !== undefined ? { resetsAt } : {}),
        ...(anthropic && key !== "requests" ? { approximate: true } : {}),
      },
    ];
  });
}

export function setAIMode(chatId: string, mode: AIAgentMode) {
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId ? { ...c, mode } : c,
    ),
  });
  persist();
}

export function addAICheckpoint(chatId: string, name: string, sha?: string) {
  const checkpoint: AICheckpoint = {
    id: newRequestId(),
    name,
    timestamp: Date.now(),
    sha,
  };
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? {
            ...c,
            checkpoints: [...(c.checkpoints ?? []), checkpoint],
          }
        : c,
    ),
  });
  persist();
}

export function spawnAISubagent(
  chatId: string,
  messageId: string,
  role: string,
  task: string,
): string {
  const subagentId = newRequestId();
  const subagent: AISubagentTask = {
    id: subagentId,
    role,
    task,
    status: "running",
    progress: "Started subagent task...",
  };
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    subagents: [...(m.subagents ?? []), subagent],
                  }
                : m,
            ),
          }
        : c,
    ),
  });
  persist();
  return subagentId;
}

export function updateAISubagent(
  chatId: string,
  messageId: string,
  subagentId: string,
  patch: Partial<AISubagentTask>,
) {
  update({
    conversations: state.conversations.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    subagents: m.subagents?.map((s) =>
                      s.id === subagentId ? { ...s, ...patch } : s,
                    ),
                  }
                : m,
            ),
          }
        : c,
    ),
  });
  persist();
}
