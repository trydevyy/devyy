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

import { useSyncExternalStore } from "react";
import { parse } from "jsonc-parser";
import { invoke, native } from "./native";
import { syncExtensionHost } from "./extensionHost";
export interface ContributedLanguage {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  configuration?: string;
}
export interface InstalledExtension {
  id: string;
  name: string;
  publisher: string;
  version: string;
  description: string;
  installPath?: string;
  enabled: boolean;
  hasRuntime: boolean;
  extensionDependencies?: string[];
  extensionPack?: string[];
  icon?: string;
  contributes: {
    commands?: {
      command: string;
      title: string;
      category?: string;
      enablement?: string;
      toggled?: string | { condition: string };
    }[];
    keybindings?: {
      command: string;
      key: string;
      mac?: string;
      win?: string;
      linux?: string;
      when?: string;
      args?: unknown;
    }[];
    views?: Record<
      string,
      { id: string; name: string; type?: "webview"; when?: string }[]
    >;
    viewsContainers?: Record<
      string,
      { id: string; title: string; icon: string }[]
    >;
    languages?: ContributedLanguage[];
    grammars?: {
      language?: string;
      scopeName: string;
      path: string;
      injectTo?: string[];
    }[];
    snippets?: { language: string; path: string }[];
    themes?: { id?: string; label: string; uiTheme: string; path: string }[];
    [key: string]: unknown;
  };
}
export interface RegistryExtension {
  namespace: string;
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  downloadCount?: number;
  averageRating?: number;
  files?: { icon?: string };
}
let installed: InstalledExtension[] = [];
let generation = 0;
const listeners = new Set<() => void>();
const assets = new Map<string, Promise<string>>();
let load: Promise<void> | undefined;
let appliedSignature: string | undefined;
let refreshQueue: Promise<void> = Promise.resolve();
export function useExtensions() {
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => generation,
  );
  return installed;
}
export function allExtensions() {
  return installed.filter((e) => e.enabled);
}
export function refreshExtensions(force = false): Promise<void> {
  const work = refreshQueue
    .catch(() => {})
    .then(() => applyExtensionRefresh(force));
  refreshQueue = work;
  return work;
}
async function applyExtensionRefresh(force = false) {
  if (!native) return;
  const result = await invoke<InstalledExtension[]>("list_extensions");
  const signature = JSON.stringify(result ?? []);
  if (signature === appliedSignature && !force) return;
  installed = result ?? [];
  assets.clear();
  const { resetTextmate } = await import("./textmate");
  resetTextmate();
  generation++;
  listeners.forEach((f) => f());
  await syncExtensionHost();
  appliedSignature = signature;
  window.dispatchEvent(new Event("devyy-extensions-changed"));
}
export function initializeExtensions() {
  return (load ??= refreshExtensions().catch((e) => {
    load = undefined;
    throw e;
  }));
}
export function extensionAsset(id: string, path: string) {
  const key = `${id}:${path}`;
  if (!assets.has(key))
    assets.set(
      key,
      invoke<string>("extension_asset", { id, path }).catch((e) => {
        assets.delete(key);
        throw e;
      }),
    );
  return assets.get(key)!;
}
export function extensionLanguage(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  for (const ext of allExtensions())
    for (const language of ext.contributes.languages ?? []) {
      if (
        language.filenames?.includes(name) ||
        language.extensions?.some((suffix) =>
          name.toLowerCase().endsWith(suffix.toLowerCase()),
        ) ||
        language.filenamePatterns?.some((pattern) => {
          try {
            return new RegExp(
              `^${pattern
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".")}$`,
              "i",
            ).test(name);
          } catch {
            return false;
          }
        })
      )
        return { ...language, extension: ext.id };
    }
  return null;
}
export function extensionThemes() {
  return allExtensions().flatMap((ext) =>
    (ext.contributes.themes ?? []).map((theme) => ({
      ...theme,
      extension: ext.id,
      key: `${ext.id}:${theme.path}`,
    })),
  );
}
export async function readExtensionTheme(key: string) {
  const theme = extensionThemes().find((t) => t.key === key);
  if (!theme) return null;
  async function read(
    path: string,
    depth = 0,
  ): Promise<Record<string, unknown>> {
    if (depth > 6) throw new Error("Theme includes are too deeply nested");
    const value = parse(await extensionAsset(theme!.extension, path));
    if (!value || typeof value !== "object") throw new Error("Invalid theme");
    if (typeof value.include === "string") {
      const pieces = path.split("/").slice(0, -1);
      for (const part of value.include.split("/"))
        if (part === "..") pieces.pop();
        else if (part !== ".") pieces.push(part);
      const parent = await read(pieces.join("/"), depth + 1);
      return {
        ...parent,
        ...value,
        tokenColors: [
          ...((parent.tokenColors as unknown[]) ?? []),
          ...(value.tokenColors ?? []),
        ],
      };
    }
    return value;
  }
  return read(theme.path);
}
export async function extensionSnippets(language: string) {
  const snippets: { label: string; template: string; detail: string }[] = [];
  for (const extension of allExtensions())
    for (const entry of extension.contributes.snippets ?? []) {
      if (entry.language !== language) continue;
      try {
        const data = parse(await extensionAsset(extension.id, entry.path));
        for (const [name, item] of Object.entries(data ?? {}) as [
          string,
          {
            prefix?: string | string[];
            body?: string | string[];
            description?: string;
            scope?: string;
          },
        ][]) {
          if (
            item.scope &&
            !item.scope
              .split(",")
              .map((s) => s.trim())
              .includes(language)
          )
            continue;
          const body = Array.isArray(item.body)
            ? item.body.join("\n")
            : item.body;
          if (typeof body !== "string") continue;
          for (const prefix of Array.isArray(item.prefix)
            ? item.prefix
            : [item.prefix ?? name])
            snippets.push({
              label: prefix,
              template: body,
              detail: item.description ?? name,
            });
        }
      } catch {}
    }
  return snippets;
}
export function capabilities(extension: InstalledExtension) {
  const c = extension.contributes;
  const supported = [
    c.languages?.length && "Languages",
    c.grammars?.length && "Syntax",
    c.snippets?.length && "Snippets",
    c.themes?.length && "Themes",
    c.commands?.length && "Commands",
    c.views && "Views",
    c["devyy.languageServers"] && "Language servers",
  ].filter(Boolean) as string[];
  return {
    supported,
    requiresHost:
      extension.hasRuntime ||
      Object.keys(c).some(
        (key) =>
          ![
            "languages",
            "grammars",
            "snippets",
            "themes",
            "configuration",
            "configurationDefaults",
          ].includes(key),
      ),
  };
}
