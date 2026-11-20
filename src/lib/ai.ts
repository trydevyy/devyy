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
  agent: "You are Devyy in Agent Mode. Autonomously execute the task: read implementation, write and modify code with focused proposals, run non-interactive terminal commands (cargo, npm, tests), verify all changes, and resolve errors before completion.",
  review: "You are Devyy in Review Mode. Thoroughly inspect recent diffs and changes for potential regressions, bugs, type safety flaws, performance pitfalls, and missing test coverage. Deliver a clean, structured code review report.",
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
    id: "claude",
    name: "Claude Code",
    kind: "claude",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "antigravity",
    endpoint: "",
    model: "",
    executable: "",
    hasKey: false,
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "opencode",
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
      } catch {
      }
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
              ...(typeof usage.costUSD === "number" && usage.costUSD >= 0
                ? { costUSD: usage.costUSD }
                : {}),
            },
          ];
        }),
    );
  } catch {
    return {};
  }
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
              ([id, { limits: _limits, observedAt: _observed, ...usage }]) => [
                id,
                usage,
              ],
            ),
          ),
        ),
      );
    } catch {
    }
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
const modelVersions = new Map<string, number>();
export async function discoverAIModels(
  providerId: string,
  force = false,
): Promise<AIModel[]> {
  if (!force && state.models[providerId]) return state.models[providerId];
  if (!native) return [];
  const version = modelVersions.get(providerId) ?? 0;
  const values = await invoke<(string | AIModel)[]>("ai_models", {
    providerId,
  });
  const models = (Array.isArray(values) ? values : [])
    .map((model) =>
      typeof model === "string" ? { id: model, name: model } : model,
    )
    .filter((model) => model && typeof model.id === "string");
  if ((modelVersions.get(providerId) ?? 0) !== version) return [];
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
    output: numeric(
      data.output_tokens ?? data.completion_tokens ?? data.outputTokens,
    ),
  };
}
export function usageRecorder(providerId: string) {
  let input = 0,
    output = 0,
    cached = 0,
    reasoning = 0,
    cost = 0,
    counted = false;
  return (kind: string, value?: unknown) => {
    if (!["usage", "cost", "limits", "request"].includes(kind)) return;
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
    if (kind === "limits")
      next = { ...old, limits: data, observedAt: Date.now() };
    if (kind === "cost") {
      if (
        typeof data.amount !== "number" ||
        !Number.isFinite(data.amount) ||
        data.amount < 0
      )
        return;
      next.costUSD = (old.costUSD ?? 0) + Math.max(0, data.amount - cost);
      cost = Math.max(cost, data.amount);
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
  const currentMode = chat.mode ?? "agent";
  assistant.mode = currentMode;
  const modeInstruction = AGENT_MODE_PROMPTS[currentMode];
  const lastUserMsg = chat.messages[chat.messages.length - 1];
  const skillsContext = getActiveSkillsPrompt(lastUserMsg?.content ?? "", chatId);

  const requestId = crypto.randomUUID();
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
    } catch {
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
    id: crypto.randomUUID(),
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
  const subagentId = crypto.randomUUID();
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
