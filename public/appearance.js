// Set the initial palette before the stylesheet loads; respect saved preferences.
try {
  const root = document.documentElement;
  root.dataset.platform = /Mac/.test(navigator.platform)
    ? "macos"
    : /Win/.test(navigator.platform)
      ? "windows"
      : "linux";
  root.dataset.runtime = window.__TAURI_INTERNALS__ ? "native" : "browser";
  const solidLinux =
    root.dataset.runtime === "native" && root.dataset.platform === "linux";
  if (solidLinux) {
    root.dataset.material = "solid";
    root.dataset.vibrancy = "off";
  }

  const saved = JSON.parse(
    localStorage.getItem("devyy.settings") ||
      localStorage.getItem("devvy.settings") ||
      "{}",
  );
  root.dataset.theme = saved.followSystemTheme
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "midnight"
      : "paper"
    : saved.theme === "paper" || saved.theme === "monochrome"
      ? saved.theme
      : "midnight";
  root.dataset.vibrancy =
    solidLinux ||
    saved.vibrancy === false ||
    matchMedia("(prefers-reduced-transparency: reduce)").matches
      ? "off"
      : "on";
  const clamp = (value, fallback, max = 90) =>
    Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
  const glass = root.dataset.vibrancy === "on";
  root.style.setProperty(
    "--window-opacity",
    String(glass ? 1 - clamp(saved.windowTransparency, 26) / 100 : 1),
  );
  root.style.setProperty(
    "--editor-opacity",
    String(glass ? 1 - clamp(saved.editorTransparency, 0) / 100 : 1),
  );
  root.style.setProperty(
    "--overlay-opacity",
    String(glass ? 1 - clamp(saved.overlayTransparency, 26, 75) / 100 : 1),
  );
  root.style.setProperty(
    "--glass-blur",
    `${glass ? clamp(saved.glassBlur, 24, 40) : 0}px`,
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
} catch {
  document.documentElement.dataset.theme = "midnight";
}
