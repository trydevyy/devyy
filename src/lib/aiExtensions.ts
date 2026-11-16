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

export function isAIExtension(id: string): boolean {
  return ["openai.chatgpt", "anthropic.claude-code"].includes(id.toLowerCase());
}
export function aiMainView(id: string): string | undefined {
  return (
    {
      "openai.chatgpt": "chatgpt.sidebarView",
      "anthropic.claude-code": "claudeVSCodeSidebar",
    } as Record<string, string>
  )[id.toLowerCase()];
}

export function canonicalAIExtensionId(id?: string | null): string | undefined {
  if (!id) return undefined;
  const lower = id.toLowerCase();
  if (
    lower === "openai.chatgpt" ||
    lower === "codex" ||
    lower === "chatgpt" ||
    lower === "chatgpt.sidebarview"
  ) {
    return "openai.chatgpt";
  }
  if (
    lower === "anthropic.claude-code" ||
    lower === "claude" ||
    lower === "claudevscodesidebar" ||
    lower === "claude-sidebar" ||
    lower === "claude-sidebar-secondary" ||
    lower === "claudevscodesidebarsecondary"
  ) {
    return "anthropic.claude-code";
  }
  return undefined;
}
