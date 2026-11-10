// Set the initial palette before the stylesheet loads; respect saved preferences.
try {
  const saved = JSON.parse(
    localStorage.getItem("devyy.settings") ||
      localStorage.getItem("devvy.settings") ||
      "{}",
  );
  const root = document.documentElement;
  root.dataset.theme = saved.theme === "paper" ? "paper" : "midnight";
  root.dataset.vibrancy =
    saved.vibrancy === false ||
    matchMedia("(prefers-reduced-transparency: reduce)").matches
      ? "off"
      : "on";
  const clamp = (value, fallback) =>
    Number.isFinite(value) ? Math.max(0, Math.min(90, value)) : fallback;
  root.style.setProperty(
    "--window-opacity",
    String(1 - clamp(saved.windowTransparency, 26) / 100),
  );
  root.style.setProperty(
    "--editor-opacity",
    String(1 - clamp(saved.editorTransparency, 0) / 100),
  );
  root.style.setProperty(
    "--overlay-opacity",
    String(1 - Math.min(75, clamp(saved.overlayTransparency, 26)) / 100),
  );
  root.style.setProperty(
    "--glass-blur",
    `${Number.isFinite(saved.glassBlur) ? Math.max(0, Math.min(40, saved.glassBlur)) : 24}px`,
  );
  root.style.setProperty(
    "--duration",
    saved.animationSpeed === "instant"
      ? "0ms"
      : saved.animationSpeed === "smooth"
        ? "180ms"
        : "110ms",
  );
  root.style.setProperty(
    "--enter-duration",
    saved.animationSpeed === "instant"
      ? "0ms"
      : saved.animationSpeed === "smooth"
        ? "200ms"
        : "140ms",
  );
  root.dataset.motion =
    saved.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduced"
      : "full";
  root.dataset.runtime = window.__TAURI_INTERNALS__ ? "native" : "browser";
} catch {
  document.documentElement.dataset.theme = "midnight";
}
