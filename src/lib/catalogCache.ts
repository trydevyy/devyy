import { createReadCache } from "./readCache";
import { invoke } from "./native";
import type { RegistryExtension } from "./extensions";
import type { StoreLanguage, StoreThemeSummary, StoreTheme } from "./store";

const minute = 60_000;
function catalog<T>(name: string, limit: number, ttl = 5 * minute) {
  return createReadCache<T>({
    ttl,
    limit,
    maxAge: 7 * 24 * 60 * minute,
    storageKey: `devyy.catalog.v1.${name}`,
    shouldPersist: (key) => key === "" || key.startsWith('["",'),
  });
}

export const extensionCatalogCache = catalog<{
  extensions: RegistryExtension[];
  totalSize: number;
}>("extensions", 20);
export const themeCatalogCache = catalog<StoreThemeSummary[]>("themes", 12);
export const languageCatalogCache = catalog<StoreLanguage[]>(
  "languages",
  1,
  15 * minute,
);

export const themeDetailsCache = createReadCache<StoreTheme>({
  ttl: 5 * minute,
  limit: 8,
});
export const installedThemesCache = createReadCache<StoreTheme[]>({
  ttl: 30_000,
  limit: 1,
});

export function loadExtensionCatalog(query: string, offset: number) {
  return invoke<{ extensions: RegistryExtension[]; totalSize: number }>(
    "search_extensions",
    { query, offset },
  ).then((response) => ({
    extensions: response.extensions ?? [],
    totalSize: response.totalSize ?? 0,
  }));
}
