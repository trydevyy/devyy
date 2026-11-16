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

import { useSyncExternalStore } from "react";
export type AIContextKind =
  | "file"
  | "folder"
  | "selection"
  | "terminal"
  | "problems"
  | "problem"
  | "output"
  | "diff"
  | "text";
export interface AIContextRef {
  kind: AIContextKind;
  id: string;
}
export interface AIAttachment extends AIContextRef {
  title: string;
  content: string;
  path?: string;
  description?: string;
  truncated?: boolean;
  startLine?: number;
  endLine?: number;
}
export function formatAttachmentLabel(item: AIAttachment): string {
  if (item.startLine != null && item.endLine != null) {
    const range =
      item.startLine === item.endLine
        ? `#L${item.startLine}`
        : `#L${item.startLine}-L${item.endLine}`;
    if (!item.title.includes("#L")) {
      return `${item.title} ${range}`;
    }
  }
  return item.title;
}
export interface AIContextSource extends AIContextRef {
  title: string;
  description?: string;
  read: () => AIAttachment | Promise<AIAttachment>;
}
export const AI_CONTEXT_MIME = "application/x-devyy-context";
export const MAX_ATTACHMENT_BYTES = 160 * 1024;
export const MAX_ATTACHMENTS_BYTES = 350 * 1024;
const owners = new Map<string, AIContextSource[]>(),
  listeners = new Set<() => void>();
let sources: AIContextSource[] = [];
function changed() {
  sources = [...owners.values()].flat();
  listeners.forEach((fn) => fn());
}
export function registerAIContext(owner: string, entries: AIContextSource[]) {
  owners.set(owner, entries);
  changed();
  return () => {
    if (owners.get(owner) === entries) {
      owners.delete(owner);
      changed();
    }
  };
}
export function useAIContext() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => sources,
  );
}
export function writeAIContextDrag(
  transfer: DataTransfer,
  items: AIContextRef[],
) {
  transfer.setData(AI_CONTEXT_MIME, JSON.stringify({ version: 1, items }));
  transfer.effectAllowed = "copyMove";
}
export function readAIContextDrag(transfer: DataTransfer): AIContextRef[] {
  try {
    const data = JSON.parse(transfer.getData(AI_CONTEXT_MIME));
    if (
      data.version !== 1 ||
      !Array.isArray(data.items) ||
      data.items.length > 64
    )
      return [];
    return data.items.filter(
      (item: AIContextRef) =>
        item &&
        typeof item.id === "string" &&
        item.id.length < 4096 &&
        [
          "file",
          "folder",
          "selection",
          "terminal",
          "problems",
          "problem",
          "output",
          "diff",
          "text",
        ].includes(item.kind),
    );
  } catch {
    return [];
  }
}
export function hasAIContextDrag(transfer: DataTransfer) {
  return (
    Array.from(transfer.types).includes(AI_CONTEXT_MIME) ||
    Array.from(transfer.types).includes("Files")
  );
}
export function boundedContext(
  text: string,
  max = MAX_ATTACHMENT_BYTES,
): { content: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return { content: text, truncated: false };
  let content = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, max),
  );
  if (content.endsWith("\uFFFD")) content = content.slice(0, -1);
  return { content: `${content}\n[Snapshot truncated]`, truncated: true };
}
export async function resolveAIContext(
  refs: AIContextRef[],
): Promise<AIAttachment[]> {
  const resolved: AIAttachment[] = [];
  for (const ref of refs) {
    const source = sources.find(
      (source) => source.kind === ref.kind && source.id === ref.id,
    );
    if (!source)
      throw new Error("That context is no longer available. Drag it again.");
    const item = await source.read();
    if (!item.content.trim()) throw new Error(`${source.title} is empty.`);
    const bounded = boundedContext(item.content);
    resolved.push({
      ...item,
      ...bounded,
      truncated: item.truncated || bounded.truncated,
    });
  }
  return resolved;
}
export function mergeAttachments(
  existing: AIAttachment[],
  incoming: AIAttachment[],
): AIAttachment[] {
  const map = new Map(
    existing.map((item) => [`${item.kind}:${item.id}`, item]),
  );
  for (const item of incoming) map.set(`${item.kind}:${item.id}`, item);
  const result = [...map.values()];
  if (result.length > 32) throw new Error("Attach up to 32 items per message.");
  if (
    result.reduce(
      (size, item) => size + new TextEncoder().encode(item.content).length,
      0,
    ) > MAX_ATTACHMENTS_BYTES
  )
    throw new Error(
      "Attachments exceed 350 KB. Remove an item or attach a selection.",
    );
  return result;
}
export function messageAttachments(message: {
  attachments?: AIAttachment[];
  context?: { path: string; content: string };
}): AIAttachment[] {
  if (message.attachments?.length) return message.attachments;
  return message.context
    ? [
        {
          kind: "file",
          id: message.context.path,
          path: message.context.path,
          title:
            message.context.path.split(/[\\/]/).at(-1) ?? message.context.path,
          content: message.context.content,
        },
      ]
    : [];
}
export function contextPrompt(message: {
  content: string;
  attachments?: AIAttachment[];
  context?: { path: string; content: string };
}) {
  const attachments = messageAttachments(message);
  if (!attachments.length) return message.content;
  return `${message.content}\n\n${attachments.map((item) => `Attached ${item.kind}: ${JSON.stringify(item.path ?? item.title)}\n<devyy_file_context>\n${item.content}\n</devyy_file_context>`).join("\n\n")}`;
}
