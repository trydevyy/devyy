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
export const ACCOUNT_ORIGIN = "https://api.devyy.dev";
export interface SyncOptions {
  enabled: boolean;
  settings: boolean;
  extensions: boolean;
  excluded: string[];
  installExtensions: boolean;
}
const defaults: SyncOptions = {
  enabled: false,
  settings: true,
  extensions: true,
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
  };
}
export function accountRequest<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return invoke("account_request", { path, method, body: body ?? null });
}
function metadata() {
  try {
    return JSON.parse(
      localStorage.getItem("devyy.sync.meta:" + ACCOUNT_ORIGIN) ?? "null",
    ) as { revision: number; signature: string } | null;
  } catch {
    return null;
  }
}
function mark(revision: number, signature: string) {
  localStorage.setItem(
    "devyy.sync.meta:" + ACCOUNT_ORIGIN,
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
export async function pullCloud(
  cloud: Cloud,
  settings: Settings,
  setSettings: Dispatch<SetStateAction<Settings>>,
  extensions: InstalledExtension[],
  options: SyncOptions,
) {
  const patch = Object.fromEntries(
    Object.entries(cloud.data.settings ?? {}).filter(
      ([key]) =>
        options.settings &&
        allowed.includes(key) &&
        !options.excluded.includes(key),
    ),
  );
  const next = normalizeSettings({ ...settings, ...patch });
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
  mark(
    cloud.revision,
    JSON.stringify(
      syncSelection(
        next,
        await invoke<InstalledExtension[]>("list_extensions"),
        options,
      ),
    ),
  );
}
export async function pushCloud(
  settings: Settings,
  extensions: InstalledExtension[],
  options: SyncOptions,
) {
  const cloud = await accountRequest<Cloud>("/sync");
  const selected = syncSelection(settings, extensions, options);
  const remoteExtensions = new Map(
    (cloud.data.extensions ?? []).map((e) => [e.id, e]),
  );
  if (options.extensions)
    for (const e of selected.extensions) remoteExtensions.set(e.id, e);
  const data = {
    settings: { ...(cloud.data.settings ?? {}), ...selected.settings },
    extensions: Array.from(remoteExtensions.values()),
  };
  const result = await accountRequest<{ revision: number }>("/sync", "PUT", {
    revision: cloud.revision,
    data,
  });
  mark(result.revision, JSON.stringify(selected));
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
    let stop: (() => void) | undefined;
    let disposed = false;
    void listen<string>("devyy-account-callback", (event) => {
      void invoke("account_finish", { url: event.payload })
        .then(() => {
          saveSyncOptions({ ...syncOptions(), enabled: false });
          toast.success(
            "Signed in to Devyy. Choose what to synchronize in Account & sync.",
          );
          window.dispatchEvent(new Event("devyy-account-changed"));
        })
        .catch((error) => toast.error(String(error)));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
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
        const selected = syncSelection(
            current.settings,
            current.extensions,
            options,
          ),
          signature = JSON.stringify(selected),
          meta = metadata();
        const cloud = await accountRequest<Cloud>("/sync");
        if (!meta) {
          throw Error(
            "Choose Upload or Download in Account & sync before enabling automatic sync.",
          );
        }
        if (meta.revision !== cloud.revision && meta.signature !== signature) {
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
        } else if (meta.signature !== signature) {
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
