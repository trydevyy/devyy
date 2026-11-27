const defaults = {
  closeAfterSelection: false,
  rememberReasoning: true,
};

export type AIPickerPreference = keyof typeof defaults;

export function aiPickerPreference(key: AIPickerPreference): boolean {
  try {
    const stored = localStorage.getItem(`devyy.ai.picker.${key}`);
    if (stored === "true" || stored === "false") return stored === "true";
  } catch {}
  return defaults[key];
}

export function setAIPickerPreference(key: AIPickerPreference, value: boolean) {
  localStorage.setItem(`devyy.ai.picker.${key}`, String(value));
}

export function modelReasoning(
  provider: string,
  model: string,
  effort?: string,
) {
  if (!aiPickerPreference("rememberReasoning")) return "";
  const key = `devyy.ai.reasoning.${JSON.stringify([provider, model])}`;
  try {
    if (effort !== undefined) localStorage.setItem(key, effort);
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
