// Use publisher IDs, not display names: unrelated extensions can share a title.
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
