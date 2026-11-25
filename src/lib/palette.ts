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
export function onAccent(hex: string, backdrop = "#000000") {
  const opacity = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  const channels = [1, 3, 5]
    .map((p) => {
      const track = parseInt(hex.slice(p, p + 2), 16);
      const background = parseInt(backdrop.slice(p, p + 2), 16);
      return (track * opacity + background * (1 - opacity)) / 255;
    })
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#171717" : "#ffffff";
}
