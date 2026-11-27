import { installedThemesCache, themeDetailsCache } from "./catalogCache";
import defaults from "./default-themes.json";
import { useSyncExternalStore } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import type { RequestConfirmation } from "../components/ui/Confirm";
import { installExtension } from "./extensionInstall";
import { refreshLanguageServers } from "./languageServers";
import { clearLanguageServers, invoke, native } from "./native";

export const storeOrigin = "https://store.devyy.dev";
export type StoreSprite = {
  id: string;
  image: string;
  x: number;
  y: number;
  width: number;
  opacity: number;
  rotation: number;
  layer: "behind" | "above";
  anchor?: "titlebar";
};
export type StoreTheme = {
  id: string;
  name: string;
  author: string;
  copyright?: string;
  bundled?: boolean;
  creator?: {
    name: string;
    official?: boolean;
    verified?: boolean;
    avatarId?: string;
  };
  description: string;
  manifest: {
    version: 1;
    base: "midnight" | "paper" | "monochrome";
    colors: Record<string, string>;
    layout: {
      fontSize?: number;
      lineHeight?: number;
      fontFamily?: "system" | "menlo" | "monospace";
      radius?: number;
    };
    sprites: StoreSprite[];
    editorBackground?: {
      image: string;
      opacity: number;
      fit: "cover" | "contain";
      x: number;
      y: number;
      pixelated?: boolean;
    };
    /** OS dock/taskbar icon. Does not replace the fixed workbench mark. */
    appIcon?: string;
    /** @deprecated Use appIcon. Accepted for existing themes. */
    icon?: string;
  };
};
export type StoreThemeSummary = Omit<StoreTheme, "manifest"> & {
  colors: Record<string, string>;
};
export const defaultStoreThemes = defaults as (StoreTheme &
  StoreThemeSummary)[];
export type StoreLanguage = {
  id: string;
  name: string;
  icon: string;
  languages: string[];
  homepage: string;
  installer: "npm" | "pip" | "go" | "rustup" | "path";
  package?: string;
  version?: string;
};
type StoreLink = {
  kind: "language-server" | "extension" | "theme";
  id: string;
};

const themeKey = "devyy.store.theme";
let activeTheme: StoreTheme | undefined;
let revision = 0;
let running = false;
const listeners = new Set<() => void>();
const storeInstalls = { theme: "", language: "" };
const installListeners = new Set<() => void>();

function subscribeInstalls(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export function useStoreInstallId(kind: keyof typeof storeInstalls) {
  return useSyncExternalStore(subscribeInstalls, () => storeInstalls[kind]);
}

async function trackStoreInstall<T>(
  kind: keyof typeof storeInstalls,
  id: string,
  install: () => Promise<T>,
) {
  if (storeInstalls[kind])
    throw Error("Wait for the current installation to finish.");
  storeInstalls[kind] = id;
  installListeners.forEach((listener) => listener());
  try {
    return await install();
  } finally {
    storeInstalls[kind] = "";
    installListeners.forEach((listener) => listener());
  }
}
const installedListeners = new Set<() => void>();
export function subscribeInstalled(listener: () => void) {
  installedListeners.add(listener);
  return () => {
    installedListeners.delete(listener);
  };
}
function changedInstalled() {
  installedThemesCache.invalidate("");
  for (const listener of installedListeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getTheme() {
  return activeTheme;
}
export function useStoreTheme() {
  return useSyncExternalStore(subscribe, getTheme);
}
export function applyStoreTheme(theme: StoreTheme) {
  if (theme.bundled) {
    activateStoreTheme(undefined);
    window.dispatchEvent(
      new CustomEvent("devyy-default-theme", { detail: theme.manifest.base }),
    );
  } else {
    activateStoreTheme(theme);
  }
}

export function activateStoreTheme(theme: StoreTheme | undefined) {
  ++revision;
  activeTheme = theme;
  if (theme) localStorage.setItem(themeKey, theme.id);
  else localStorage.removeItem(themeKey);
  for (const listener of listeners) listener();
}
export async function restoreStoreTheme() {
  if (!native) return;
  const id = localStorage.getItem(themeKey);
  if (!id) return;
  const bundled = defaultStoreThemes.find((theme) => theme.id === id);
  if (bundled) {
    applyStoreTheme(bundled);
    return;
  }
  const current = revision;
  try {
    const theme = await invoke<StoreTheme>("store_local_theme", { id });
    if (current === revision) activateStoreTheme(theme);
  } catch {
    if (current === revision) activateStoreTheme(undefined);
  }
}
export function installedThemes() {
  return installedThemesCache.read("", loadInstalledThemes);
}
async function loadInstalledThemes() {
  const ids = await invoke<string[]>("store_installed_themes");
  const themes = await Promise.allSettled(
    ids
      .filter((id) => !defaultStoreThemes.some((theme) => theme.id === id))
      .map((id) => invoke<StoreTheme>("store_local_theme", { id })),
  );
  return themes.flatMap((theme) =>
    theme.status === "fulfilled" ? [theme.value] : [],
  );
}
export async function restoreSyncedThemes(
  entries: StoreTheme[],
  activeId: string | null,
) {
  const custom = entries.filter(
    (entry) => !defaultStoreThemes.some((theme) => theme.id === entry.id),
  );
  await invoke("store_restore_themes", { entries: custom });
  activateStoreTheme(custom.find((theme) => theme.id === activeId));
  changedInstalled();
  return defaultStoreThemes.find((theme) => theme.id === activeId)?.manifest
    .base;
}

export async function removeInstalledTheme(id: string) {
  await invoke("store_remove_theme", { id });
  if (activeTheme?.id === id) activateStoreTheme(undefined);
  changedInstalled();
}
export async function importStoreTheme() {
  const path = await open({
    filters: [{ name: "Devyy theme", extensions: ["json"] }],
  });
  if (typeof path !== "string") return;
  await trackStoreInstall("theme", "import", async () => {
    activateStoreTheme(
      await invoke<StoreTheme>("store_import_theme", { path }),
    );
    changedInstalled();
  });
}
export async function installStoreTheme(id: string) {
  const bundled = defaultStoreThemes.find((theme) => theme.id === id);
  if (bundled) {
    applyStoreTheme(bundled);
    return;
  }
  await trackStoreInstall("theme", id, async () => {
    activateStoreTheme(await invoke<StoreTheme>("store_install_theme", { id }));
    changedInstalled();
  });
}

export function storeThemeDetails(id: string, force = false) {
  return themeDetailsCache.read(
    id,
    () => invoke<StoreTheme>("store_theme_details", { id }),
    force,
  );
}

export function languageCatalog() {
  return invoke<StoreLanguage[]>("store_catalog", {
    kind: "language-servers",
    query: "",
    offset: 0,
  });
}
export function themeCatalog(query: string, offset: number) {
  return invoke<StoreThemeSummary[]>("store_catalog", {
    kind: "themes",
    query,
    offset,
  });
}
export async function installStoreLanguage(
  language: StoreLanguage,
  confirm: RequestConfirmation,
) {
  if (running)
    throw Error("A language server installation is already in progress.");
  running = true;
  try {
    const configured = (await refreshLanguageServers()).filter(
      (entry) => entry.custom && language.languages.includes(entry.language),
    );
    const recipe = language.package
      ? `Package ${language.package}${language.version ? ` @ ${language.version}` : ""}. `
      : "";
    const explanation =
      language.installer === "path"
        ? "Use the installation already available on your PATH. "
        : recipe;
    const replace = configured.length > 0;
    if (
      !(await confirm({
        title:
          language.installer === "path"
            ? "Configure language server"
            : "Install language server",
        description: `${explanation}Configure ${language.name} for ${language.languages.join(", ")}.${replace ? " This replaces existing custom server settings for those languages." : ""}`,
        confirmLabel: language.installer === "path" ? "Configure" : "Install",
      }))
    )
      return;
    const pending = toast.loading(`Setting up ${language.name}…`);
    try {
      await trackStoreInstall("language", language.id, async () => {
        await invoke("store_install_language", { id: language.id, replace });
        await invoke("lsp_stop");
        clearLanguageServers();
        await refreshLanguageServers();
        window.dispatchEvent(new Event("devyy-language-servers-changed"));
      });
      toast.success(`${language.name} is ready.`, { id: pending });
    } catch (error) {
      toast.error(String(error), { id: pending });
    }
  } finally {
    running = false;
  }
}

function allowId(value: string) {
  return /^[a-z0-9_-]{1,100}$/i.test(value);
}
export function readStoreLink(uri: string): StoreLink | undefined {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return;
  }
  if (
    url.protocol !== "devyy:" ||
    url.host !== "store" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return;
  const [, kind, id, ...extra] = url.pathname.split("/");
  if (!id || extra.length) return;
  if (kind === "extension" && /^[\w-]{1,100}\.[\w-]{1,100}$/i.test(id))
    return { kind, id };
  if ((kind === "language-server" || kind === "theme") && allowId(id))
    return { kind, id };
}
export async function handleStoreLink(
  link: StoreLink,
  confirm: RequestConfirmation,
) {
  if (link.kind === "language-server") {
    const language = (await languageCatalog()).find(
      (item) => item.id === link.id,
    );
    if (!language)
      throw Error("This language server is no longer in the store.");
    await installStoreLanguage(language, confirm);
  } else if (link.kind === "theme") {
    const bundled = defaultStoreThemes.find((theme) => theme.id === link.id);
    if (
      await confirm({
        title: bundled ? `Apply ${bundled.name}?` : "Install theme?",
        description: bundled
          ? "This changes the appearance of your workspace."
          : "Devyy will download this theme from the store and apply it.",
        confirmLabel: bundled ? "Apply" : "Install and apply",
      })
    ) {
      await installStoreTheme(link.id);
      toast.success(bundled ? "Theme applied." : "Theme installed.");
    }
  } else if (
    await confirm({
      title: `Install ${link.id}?`,
      description:
        "This extension comes from Open VSX and can run code on your machine.",
      confirmLabel: "Install extension",
    })
  ) {
    await installExtension(link.id);
    toast.success("Extension installed.");
  }
}
