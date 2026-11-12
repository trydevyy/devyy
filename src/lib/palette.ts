import type { Settings } from "./types";

export const accents = [
  { id: "neutral", name: "Neutral", dark: "#f2f2f2", light: "#252525" },
  { id: "blue", name: "Blue", dark: "#a7bcff", light: "#355ac4" },
  { id: "violet", name: "Violet", dark: "#c7b1ee", light: "#7853a8" },
  { id: "mint", name: "Mint", dark: "#9bd9be", light: "#287454" },
  { id: "amber", name: "Amber", dark: "#e8c58f", light: "#936010" },
] as const;

export function accentColor(settings: Settings, dark: boolean) {
  return settings.accent === "custom"
    ? settings.customAccent
    : (accents.find((a) => a.id === settings.accent) ?? accents[0])[
        dark ? "dark" : "light"
      ];
}
export function onAccent(hex: string) {
  const channels = [1, 3, 5]
    .map((p) => parseInt(hex.slice(p, p + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#171717" : "#ffffff";
}
