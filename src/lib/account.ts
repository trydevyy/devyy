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

import type { RequestConfirmation } from "../components/ui/Confirm";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke, listen, native } from "./native";
import { normalizeSettings, type Settings } from "./types";
import {
  useExtensions,
  refreshExtensions,
  type InstalledExtension,
} from "./extensions";
import allowed from "./accountSyncKeys.json";
import { toast } from "sonner";
import {
  defaultStoreThemes,
  installedThemes,
  installStoreLanguage,
  languageCatalog,
  restoreSyncedThemes,
  type StoreTheme,
} from "./store";
import { refreshLanguageServers } from "./languageServers";
export const ACCOUNT_ORIGIN = "https://api.devyy.dev";
let origin: Promise<string> | undefined;
export function accountOrigin() {
  return (origin ??= native
    ? invoke<string>("account_origin").then(
        (value) => value || ACCOUNT_ORIGIN,
        () => ACCOUNT_ORIGIN,
      )
    : Promise.resolve(ACCOUNT_ORIGIN));
}
export interface SyncOptions {
  enabled: boolean;
  settings: boolean;
  extensions: boolean;
  themes: boolean;
  languageServers: boolean;
  excluded: string[];
  installExtensions: boolean;
}
const defaults: SyncOptions = {
  enabled: false,
  settings: true,
  extensions: true,
  themes: false,
  languageServers: false,
  excluded: [],
  installExtensions: false,
};
const event = "devyy-sync-options";
export function syncOptions(): SyncOptions {
  try {
    const { server, ...saved } = JSON.parse(
      localStorage.getItem("devyy.account.options") ?? "{}",
    );
    return {
      ...defaults,
      ...saved,
      enabled: (!server || server === ACCOUNT_ORIGIN) && !!saved.enabled,
    };
  } catch {
    return defaults;
  }
}
export function saveSyncOptions(value: SyncOptions) {
  localStorage.setItem("devyy.account.options", JSON.stringify(value));
  window.dispatchEvent(new Event(event));
}
const subscribe = (callback: () => void) => {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", callback);
  };
};
const snapshot = () => localStorage.getItem("devyy.account.options") ?? "";
export function useSyncOptions() {
  useSyncExternalStore(subscribe, snapshot);
  return syncOptions();
}
export interface Cloud {
  revision: number;
  data: {
    settings: Record<string, unknown>;
    extensions: { id: string; enabled: boolean }[];
    themes?: { entries: StoreTheme[]; activeId: string | null };
    languageServers?: string[];
  };
}
export function accountRequest<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return invoke("account_request", { path, method, body: body ?? null });
}
export interface AccountProfile {
  id?: string;
  name: string;
  email: string;
  avatar?: boolean;
}

interface ProfileState {
  profile: AccountProfile | null | undefined;
  error?: string;
  avatarVersion: number;
}

let profileState: ProfileState = {
  profile: native ? undefined : null,
  avatarVersion: 0,
};
const profileListeners = new Set<() => void>();
let pendingProfile: Promise<void> | undefined;
let profileEpoch = 0;
let profileCheckedAt = 0;

function publishProfile(next: ProfileState) {
  profileState = next;
  profileListeners.forEach((listener) => listener());
}

export function refreshAccountProfile(force = false) {
  if (!native) return;
  if (pendingProfile && !force) return pendingProfile;
  const epoch = ++profileEpoch;
  const request = accountRequest<AccountProfile>("/me")
    .then((profile) => {
      if (epoch !== profileEpoch) return;
      if (profile === null) {
        publishProfile({ profile: null, avatarVersion: 0 });
        return;
      }
      if (
        !profile ||
        typeof profile.name !== "string" ||
        typeof profile.email !== "string"
      ) {
        throw Error("The Devyy API returned an invalid profile");
      }
      const previous = profileState.profile;
      const same =
        previous &&
        previous.id === profile.id &&
        previous.name === profile.name &&
        previous.email === profile.email &&
        previous.avatar === profile.avatar;
      if (!same || force || profileState.error)
        publishProfile({
          profile,
          avatarVersion:
            !same || force ? Date.now() : profileState.avatarVersion,
        });
    })
    .catch((error) => {
      if (epoch !== profileEpoch) return;
      const message = String(error);
      const signedOut =
        message === "Sign in to your Devyy account first" ||
        message === "Sign in to continue";
      publishProfile(
        signedOut
          ? { profile: null, avatarVersion: 0 }
          : { ...profileState, error: message },
      );
    })
    .finally(() => {
      if (epoch !== profileEpoch) return;
      pendingProfile = undefined;
      profileCheckedAt = Date.now();
    });
  pendingProfile = request;
  return request;
}

const profileSnapshot = () => profileState;
function refreshProfileOnFocus() {
  if (Date.now() - profileCheckedAt >= 30_000) void refreshAccountProfile();
}
function invalidateProfile() {
  // A connection change can point to a different account. Drop the old
  // identity immediately and discard any outstanding response.
  publishProfile({ profile: undefined, avatarVersion: 0 });
  void refreshAccountProfile(true);
}
function subscribeProfile(listener: () => void) {
  profileListeners.add(listener);
  if (native && profileListeners.size === 1) {
    window.addEventListener("devyy-account-changed", invalidateProfile);
    window.addEventListener("focus", refreshProfileOnFocus);
    refreshProfileOnFocus();
  }
  return () => {
    profileListeners.delete(listener);
    if (!profileListeners.size) {
      window.removeEventListener("devyy-account-changed", invalidateProfile);
      window.removeEventListener("focus", refreshProfileOnFocus);
      profileCheckedAt = 0;
    }
  };
}
export function useAccountProfileState() {
  return useSyncExternalStore(subscribeProfile, profileSnapshot);
}
async function metadata() {
  const server = await accountOrigin();
  try {
    return JSON.parse(
      localStorage.getItem("devyy.sync.meta:" + server) ?? "null",
    ) as { revision: number; signature: string } | null;
  } catch {
    return null;
  }
}
async function mark(revision: number, signature: string) {
  const server = await accountOrigin();
  localStorage.setItem(
    "devyy.sync.meta:" + server,
    JSON.stringify({ revision, signature }),
  );
  window.dispatchEvent(
    new CustomEvent("devyy-sync-status", { detail: "Up to date" }),
  );
}
export function syncSelection(
  settings: Settings,
  extensions: InstalledExtension[],
  options: SyncOptions,
) {
  return {
    settings: options.settings
      ? Object.fromEntries(
          allowed
            .filter((key) => !options.excluded.includes(key) && key in settings)
            .map((key) => [key, settings[key as keyof Settings]]),
        )
      : {},
    extensions: options.extensions
      ? extensions.map((e) => ({ id: e.id, enabled: e.enabled }))
      : [],
  };
}
async function localStoreSync(options: SyncOptions, settings: Settings) {
  const [entries, servers] = await Promise.all([
    options.themes ? installedThemes() : undefined,
    options.languageServers ? refreshLanguageServers() : undefined,
  ]);
  const old = servers?.filter(
    (server) => !server.storeId && server.source?.startsWith("Store: "),
  );
  const catalog = old?.length ? await languageCatalog() : [];
  const legacyIds = new Map(
    catalog.map((listing) => [`Store: ${listing.name}`, listing.id]),
  );
  const activeId = localStorage.getItem("devyy.store.theme");
  const custom = entries?.find((entry) => entry.id === activeId);
  const bundled =
    entries &&
    !custom &&
    !settings.followSystemTheme &&
    !settings.extensionTheme
      ? defaultStoreThemes.find(
          (theme) => theme.manifest.base === settings.theme,
        )
      : undefined;
  return {
    themes: entries && {
      entries,
      activeId: custom?.id ?? bundled?.id ?? null,
    },
    languageServers:
      servers &&
      [
        ...new Set(
          servers.flatMap((server) => {
            const id = server.storeId ?? legacyIds.get(server.source ?? "");
            return id ? [id] : [];
          }),
        ),
      ].sort(),
  };
}

async function signature(data: unknown) {
  const bytes = new TextEncoder().encode(
    typeof data === "string" ? data : JSON.stringify(data),
  );
  // Some desktop webviews do not expose Web Crypto on the app's custom origin.
  if (!globalThis.crypto?.subtle) {
    let first = 0x811c9dc5;
    let second = 0;
    for (const byte of bytes) {
      first = Math.imul(first ^ byte, 0x01000193);
      second = (Math.imul(second, 31) + byte) | 0;
    }
    return [first, second]
      .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
      .join("");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function pullCloud(
  cloud: Cloud,
  settings: Settings,
  setSettings: Dispatch<SetStateAction<Settings>>,
  extensions: InstalledExtension[],
  options: SyncOptions,
  confirmLanguageInstall?: RequestConfirmation,
) {
  const patch = Object.fromEntries(
    Object.entries(cloud.data.settings ?? {}).filter(
      ([key]) =>
        options.settings &&
        allowed.includes(key) &&
        !options.excluded.includes(key),
    ),
  );
  let next = normalizeSettings({ ...settings, ...patch });
  setSettings(next);
  if (options.extensions) {
    for (const extension of cloud.data.extensions ?? []) {
      const local = extensions.find((e) => e.id === extension.id);
      if (!local && options.installExtensions) {
        await invoke("install_extension", { id: extension.id });
      }
      if (local || options.installExtensions) {
        if (local?.enabled !== extension.enabled)
          await invoke("set_extension_enabled", {
            id: extension.id,
            enabled: extension.enabled,
          });
      }
    }
    await refreshExtensions();
  }
  if (options.themes && cloud.data.themes) {
    const base = await restoreSyncedThemes(
      cloud.data.themes.entries,
      cloud.data.themes.activeId,
    );
    if (base) {
      next = {
        ...next,
        theme: base,
        followSystemTheme: false,
        extensionTheme: "",
      };
      setSettings(next);
    }
  }
  if (
    options.languageServers &&
    confirmLanguageInstall &&
    cloud.data.languageServers?.length
  ) {
    const local =
      (await localStoreSync({ ...options, themes: false }, next))
        .languageServers ?? [];
    const wanted = new Set(
      cloud.data.languageServers.filter((id) => !local.includes(id)),
    );
    if (wanted.size) {
      for (const listing of await languageCatalog()) {
        if (wanted.has(listing.id))
          await installStoreLanguage(listing, confirmLanguageInstall);
      }
    }
  }
  await mark(
    cloud.revision,
    await signature({
      ...syncSelection(
        next,
        await invoke<InstalledExtension[]>("list_extensions"),
        options,
      ),
      ...(await localStoreSync(options, next)),
    }),
  );
}
export async function pushCloud(
  settings: Settings,
  extensions: InstalledExtension[],
  options: SyncOptions,
) {
  const cloud = await accountRequest<Cloud>("/sync");
  const selected = {
    ...syncSelection(settings, extensions, options),
    ...(await localStoreSync(options, settings)),
  };
  const remoteExtensions = new Map(
    (cloud.data.extensions ?? []).map((e) => [e.id, e]),
  );
  if (options.extensions)
    for (const e of selected.extensions) remoteExtensions.set(e.id, e);
  const data = {
    settings: { ...(cloud.data.settings ?? {}), ...selected.settings },
    extensions: Array.from(remoteExtensions.values()),
    themes: selected.themes && {
      entries: Array.from(
        new Map(
          [
            ...(cloud.data.themes?.entries ?? []).filter(
              (theme) =>
                !defaultStoreThemes.some((entry) => entry.id === theme.id),
            ),
            ...selected.themes.entries,
          ].map((theme) => [theme.id, theme]),
        ).values(),
      ),
      activeId: selected.themes.activeId,
    },
    languageServers:
      selected.languageServers &&
      [
        ...new Set([
          ...(cloud.data.languageServers ?? []),
          ...selected.languageServers,
        ]),
      ].sort(),
  };
  const result = await accountRequest<{ revision: number }>("/sync", "PUT", {
    revision: cloud.revision,
    data,
  });
  await mark(result.revision, await signature(selected));
}
export function useAccountSync(
  settings: Settings,
  setSettings: Dispatch<SetStateAction<Settings>>,
) {
  const options = useSyncOptions(),
    extensions = useExtensions(),
    latest = useRef({ settings, extensions }),
    busy = useRef(false);
  latest.current = { settings, extensions };
  useEffect(() => {
    if (!native) return;
    const subscriptions = [
      listen("devyy-account-changed", () => {
        saveSyncOptions({ ...syncOptions(), enabled: false });
        toast.success("Signed in to Devyy.");
        window.dispatchEvent(new Event("devyy-account-changed"));
      }),
      listen<string>("devyy-account-error", (event) =>
        toast.error(event.payload),
      ),
    ];
    return () => {
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!native || !options.enabled) return;
    let disposed = false;
    async function tick() {
      if (busy.current || disposed) return;
      busy.current = true;
      try {
        const current = latest.current;
        const selected = {
          ...syncSelection(current.settings, current.extensions, options),
          ...(await localStoreSync(options, current.settings)),
        };
        const localSignature = await signature(selected);
        const meta = await metadata();
        const previous = meta?.signature.startsWith("{")
          ? await signature(meta.signature)
          : meta?.signature;
        const cloud = await accountRequest<Cloud>("/sync");
        if (!meta) {
          throw Error(
            "Choose Upload or Download in Account & sync before enabling automatic sync.",
          );
        }
        if (meta.revision !== cloud.revision && previous !== localSignature) {
          throw Error(
            "Sync conflict: account and device both changed. Choose Upload or Download in Account & sync.",
          );
        }
        if (cloud.revision !== meta.revision) {
          await pullCloud(
            cloud,
            current.settings,
            setSettings,
            current.extensions,
            options,
          );
        } else if (previous !== localSignature) {
          await pushCloud(current.settings, current.extensions, options);
        }
      } catch (error) {
        toast.error(String(error), { id: "account-sync" });
      } finally {
        busy.current = false;
      }
    }
    const timer = setTimeout(() => void tick(), 1500),
      interval = setInterval(() => void tick(), 30000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [JSON.stringify(options), settings, extensions, setSettings]);
}
