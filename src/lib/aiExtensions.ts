// Use publisher IDs, not display names: unrelated extensions can share a title.
export function isAIExtension(id: string): boolean {
  return ["openai.chatgpt", "anthropic.claude-code"].includes(id.toLowerCase());
}
