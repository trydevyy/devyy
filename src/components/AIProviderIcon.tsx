import { Server } from "lucide-react";
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
        : undefined;
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
