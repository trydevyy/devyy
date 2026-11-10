import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke, native } from "./native";
import type { Settings } from "./types";

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
