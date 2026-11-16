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

import { Server, TerminalSquare } from "lucide-react";
import type { AIProvider } from "../lib/ai";
export default function AIProviderIcon({
  kind,
  size = 18,
}: {
  kind: AIProvider["kind"];
  size?: number;
}) {
  const logo =
    kind === "chatgpt" || kind === "codex" || kind === "openai"
      ? "codex"
      : kind === "claude" || kind === "anthropic"
        ? "claude"
        : kind === "antigravity"
          ? "antigravity"
          : kind === "opencode"
            ? "opencode"
            : undefined;
  if (kind === "cli")
    return <TerminalSquare size={size} strokeWidth={1.65} aria-hidden="true" />;
  if (!logo)
    return <Server size={size} strokeWidth={1.65} aria-hidden="true" />;
  return (
    <img
      src={`/providers/${logo}.png`}
      className={`ai-provider-logo ai-provider-logo-${logo}`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
