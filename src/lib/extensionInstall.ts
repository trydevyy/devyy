import { useSyncExternalStore } from "react";
import { invoke, listen } from "./native";
import { refreshExtensions, type InstalledExtension } from "./extensions";
import { installExtensionDependencies } from "./extensionDependencies";
export interface ExtensionInstallProgress {
  id: string;
  requestId: string;
  packageId?: string;
  phase: "resolving" | "downloading" | "installing" | "activating";
  downloaded: number;
  total: number | null;
}
// Module lifetime keeps the operation and its listener alive when Settings closes.
let active: ExtensionInstallProgress | null = null;
let listening: Promise<void> | undefined;
const subscribers = new Set<() => void>();
const phases = { resolving: 0, downloading: 1, installing: 2, activating: 3 };
function publish() {
  subscribers.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
export function useExtensionInstallId() {
  return useSyncExternalStore(subscribe, () => active?.id ?? "");
}
export function useExtensionInstall(id: string) {
  return useSyncExternalStore(subscribe, () =>
    active?.id === id.toLowerCase() ? active : null,
  );
}
async function listenForProgress() {
  await (listening ??= listen<ExtensionInstallProgress>(
    "extension-install-progress",
    ({ payload }) => {
      if (
        !active ||
        payload.requestId !== active.requestId ||
        payload.id.toLowerCase() !== (active.packageId ?? active.id) ||
        !(payload.phase in phases) ||
        phases[payload.phase] < phases[active.phase]
      )
        return;
      active = {
        ...payload,
        id: active.id,
        packageId: active.packageId,
        downloaded: Math.max(active.downloaded, payload.downloaded),
      };
      publish();
    },
  )
    .then(() => {})
    .catch((error) => {
      listening = undefined;
      throw error;
    }));
}
async function installBundle(id: string, localPath?: string, repair = false) {
  if (active)
    throw new Error("Wait for the current extension installation to finish.");
  active = {
    id: id.toLowerCase(),
    requestId: crypto.randomUUID(),
    phase: localPath ? "installing" : "resolving",
    downloaded: 0,
    total: null,
  };
  publish();
  let changed = false;
  try {
    await listenForProgress();
    const installed =
      (await invoke<InstalledExtension[]>("list_extensions")) ?? [];
    const existing = repair
      ? installed.find(
          (extension) => extension.id.toLowerCase() === id.toLowerCase(),
        )
      : undefined;
    const root =
      existing ??
      (await invoke<InstalledExtension>(
        localPath ? "install_vsix" : "install_extension",
        localPath ? { path: localPath } : { id, requestId: active.requestId },
      ));
    changed = true;
    if (!root?.id)
      throw new Error(
        "The installed extension did not return its package identity.",
      );
    active = { ...active, id: root.id.toLowerCase() };
    await installExtensionDependencies(root, installed, async (packageId) => {
      if (!active) throw new Error("Extension installation was interrupted.");
      // Each package has its own request token; late events from a previous download are ignored.
      active = {
        id: root.id.toLowerCase(),
        packageId,
        requestId: crypto.randomUUID(),
        phase: "resolving",
        downloaded: 0,
        total: null,
      };
      publish();
      return invoke<InstalledExtension>("install_extension", {
        id: packageId,
        requestId: active.requestId,
      });
    });
    active = { ...active, packageId: undefined, phase: "activating" };
    publish();
    await refreshExtensions(true);
    changed = false;
  } catch (error) {
    // A failed bundle may have installed individual packages. Show their real state without hiding the original failure.
    if (changed) await refreshExtensions(true).catch(() => {});
    throw error;
  } finally {
    active = null;
    publish();
  }
}
export function installExtension(id: string) {
  return installBundle(id);
}
export function installLocalExtension(path: string) {
  return installBundle("local-vsix", path);
}

export function repairExtensionDependencies(id: string) {
  return installBundle(id, undefined, true);
}
