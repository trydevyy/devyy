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
import { invoke, native, nativeLinux } from "./native";
import type { Settings } from "./types";
import { useExtensions } from "./extensions";
import { accentColor, onAccent } from "./palette";
import type { StoreTheme } from "./store";
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

export const supportsWindowVibrancy = !nativeLinux;

export function useAppearance(
  settings: Settings,
  onError: (error: unknown) => void,
  storeTheme?: StoreTheme,
) {
  const extensions = useExtensions();
  useEffect(() => {
    void import("./textmate")
      .then((m) => m.applyExtensionTheme(settings, storeTheme?.manifest.colors))
      .catch((error) =>
        onError(`Could not load extension theme: ${String(error)}`),
      );
  }, [settings.extensionTheme, settings.theme, extensions, storeTheme]);
  const reducedTransparency = useSyncExternalStore(
    transparency.subscribe,
    transparency.snapshot,
  );
  const reducedMotion = useSyncExternalStore(motion.subscribe, motion.snapshot);
  const callback = useRef(onError);
  callback.current = onError;
  const vibrancy =
    supportsWindowVibrancy && settings.vibrancy && !reducedTransparency;
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
    const color = accentColor(settings, settings.theme !== "paper");
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
      favicon.href = `${import.meta.env.BASE_URL}${settings.theme === "paper" ? "devyy-light.svg" : "devyy.svg"}`;
  }, [settings.accent, settings.customAccent, settings.theme, storeTheme]);
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
      .then(async (result) => {
        if (!current) return;
        root.dataset.material = result.material;
        const appIcon =
          storeTheme?.manifest.appIcon ?? storeTheme?.manifest.icon;
        if (appIcon) {
          await invoke("set_theme_icon", {
            icon: appIcon,
          }).catch((error) =>
            callback.current(`Could not set the theme icon: ${String(error)}`),
          );
        }
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
  }, [settings.theme, vibrancy, storeTheme]);
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
    if (!storeTheme) return;
    const root = document.documentElement;
    const previous = new Map<string, string>();
    function write(key: string, value: string) {
      previous.set(key, root.style.getPropertyValue(key));
      root.style.setProperty(key, value);
    }
    for (const [key, value] of Object.entries(storeTheme.manifest.colors)) {
      if (key.startsWith("syntax-") || key === "editor-foreground") continue;
      write(`--${key}`, value);
      if (key === "paper" || key === "shell") {
        const rgb = value
          .slice(1, 7)
          .match(/../g)
          ?.map((channel) => parseInt(channel, 16));
        if (rgb) write(`--${key}-rgb`, rgb.join(", "));
      }
    }
    if (storeTheme.manifest.layout.radius !== undefined) {
      write("--store-radius", `${storeTheme.manifest.layout.radius}px`);
      root.dataset.storeRadius = "";
    }
    return () => {
      delete root.dataset.storeRadius;
      for (const [key, value] of previous) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
    };
  }, [storeTheme, settings.accent, settings.customAccent, settings.theme]);
  useEffect(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const backdrop = style.getPropertyValue("--paper").trim();
    const off = style.getPropertyValue("--faint").trim();
    const on = style.getPropertyValue("--accent-line").trim();
    root.style.setProperty("--switch-off-ink", onAccent(off, backdrop));
    root.style.setProperty("--switch-on-ink", onAccent(on, backdrop));
  }, [settings.theme, settings.accent, settings.customAccent, storeTheme]);
  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.reduceMotion || reducedMotion ? "reduced" : "full";
  }, [settings.reduceMotion, reducedMotion]);
}
