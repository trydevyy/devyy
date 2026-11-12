/** Friendly fallback for a provider that supplies an ID without a display name. */
export function modelLabel(id: string): string {
  if (!id) return "Default model";
  return id
    .replace(/[-_]\d{8}$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\bgpt\b/gi, "GPT")
    .replace(
      /\b(claude|sonnet|opus|haiku|gemini|llama)\b/gi,
      (word) => word[0].toUpperCase() + word.slice(1),
    );
}
