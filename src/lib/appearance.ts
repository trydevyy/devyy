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

import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke, native } from "./native";
import type { Settings } from "./types";
import { useExtensions } from "./extensions";
import { accentColor, onAccent } from "./palette";
import { getCurrentWebview } from "@tauri-apps/api/webview";

function mediaPreference(query: string) {
  return {
    subscribe: (callback: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    snapshot: () => window.matchMedia(query).matches,
  };
}
const transparency = mediaPreference("(prefers-reduced-transparency: reduce)");
const motion = mediaPreference("(prefers-reduced-motion: reduce)");

export function useAppearance(
  settings: Settings,
  onError: (error: unknown) => void,
) {
  const extensions = useExtensions();
  useEffect(() => {
    void import("./textmate")
      .then((m) => m.applyExtensionTheme(settings))
      .catch((error) =>
        onError(`Could not load extension theme: ${String(error)}`),
      );
  }, [settings.extensionTheme, settings.theme, extensions]);
  const reducedTransparency = useSyncExternalStore(
    transparency.subscribe,
    transparency.snapshot,
  );
  const reducedMotion = useSyncExternalStore(motion.subscribe, motion.snapshot);
  const callback = useRef(onError);
  callback.current = onError;
  const vibrancy = settings.vibrancy && !reducedTransparency;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-text-scale", String(settings.uiTextSize / 13));
    root.style.fontSize = `${settings.uiTextSize}px`;
    root.style.setProperty(
      "--preview-ui-scale",
      native ? "1" : String(settings.uiScale / 100),
    );
    if (!native && settings.uiScale !== 100)
      root.style.setProperty("zoom", String(settings.uiScale / 100));
    else root.style.removeProperty("zoom");
    if (native)
      void getCurrentWebview()
        .setZoom(settings.uiScale / 100)
        .then(() => window.dispatchEvent(new Event("resize")))
        .catch((error) =>
          callback.current(`Could not change interface scale: ${error}`),
        );
    window.dispatchEvent(new Event("resize"));
  }, [settings.uiScale, settings.uiTextSize]);
  useEffect(() => {
    const root = document.documentElement;
    const color = accentColor(settings, settings.theme === "midnight");
    root.dataset.platform = /Mac/.test(navigator.platform)
      ? "macos"
      : /Win/.test(navigator.platform)
        ? "windows"
        : "linux";
    root.style.setProperty("--accent", color);
    root.style.setProperty("--accent-line", color);
    root.style.setProperty(
      "--accent-soft",
      `color-mix(in srgb, ${color} 11%, transparent)`,
    );
    root.style.setProperty(
      "--selection",
      `color-mix(in srgb, ${color} 23%, transparent)`,
    );
    root.style.setProperty("--primary", color);
    root.style.setProperty("--primary-ink", onAccent(color));
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon)
      favicon.href =
        settings.theme === "paper" ? "/devyy-light.svg" : "/devyy.svg";
  }, [settings.accent, settings.customAccent, settings.theme]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.runtime = native ? "native" : "browser";
    root.dataset.vibrancy = vibrancy ? "on" : "off";
    if (!native) return;
    let current = true;
    void invoke<{ material: string }>("set_appearance", {
      theme: settings.theme,
      vibrancy,
    })
      .then((result) => {
        if (current) root.dataset.material = result.material;
      })
      .catch((error) => {
        if (current) {
          root.dataset.material = "solid";
          callback.current(
            `Vibrancy is unavailable. Using a solid window. ${String(error)}`,
          );
        }
      });
    return () => {
      current = false;
    };
  }, [settings.theme, vibrancy]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--window-opacity",
      String(vibrancy ? 1 - settings.windowTransparency / 100 : 1),
    );
    root.style.setProperty(
      "--editor-opacity",
      String(vibrancy ? 1 - settings.editorTransparency / 100 : 1),
    );
    root.style.setProperty(
      "--overlay-opacity",
      String(vibrancy ? 1 - settings.overlayTransparency / 100 : 1),
    );
    root.style.setProperty(
      "--glass-blur",
      `${vibrancy ? settings.glassBlur : 0}px`,
    );
    root.style.setProperty(
      "--duration",
      settings.animationSpeed === "instant"
        ? "0ms"
        : settings.animationSpeed === "smooth"
          ? "180ms"
          : "110ms",
    );
    root.style.setProperty(
      "--enter-duration",
      settings.animationSpeed === "instant"
        ? "0ms"
        : settings.animationSpeed === "smooth"
          ? "200ms"
          : "140ms",
    );
    root.style.setProperty("--editor-line-height", String(settings.lineHeight));
    root.style.setProperty(
      "--editor-mono",
      settings.fontFamily === "menlo"
        ? "Menlo, Monaco, monospace"
        : settings.fontFamily === "monospace"
          ? "monospace"
          : '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    );
  }, [
    vibrancy,
    settings.windowTransparency,
    settings.editorTransparency,
    settings.lineHeight,
    settings.fontFamily,
    settings.overlayTransparency,
    settings.glassBlur,
    settings.animationSpeed,
  ]);
  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.reduceMotion || reducedMotion ? "reduced" : "full";
  }, [settings.reduceMotion, reducedMotion]);
}
