import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke, native } from "./native";
import type { Settings } from "./types";
import { useExtensions } from "./extensions";
import { accentColor, onAccent } from "./palette";

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
