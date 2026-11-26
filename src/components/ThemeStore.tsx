import { useEffect, useState } from "react";
import Skeleton from "./ui/Skeleton";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Download,
  FolderOpen,
  Search,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  applyStoreTheme,
  defaultStoreThemes,
  importStoreTheme,
  installedThemes,
  installStoreTheme,
  removeInstalledTheme,
  storeOrigin,
  subscribeInstalled,
  themeCatalog,
  useStoreTheme,
  useStoreInstallId,
  type StoreTheme,
  type StoreThemeSummary,
} from "../lib/store";
import { native } from "../lib/native";
import type { Settings } from "../lib/types";
import { InstallProgress } from "./ExtensionProgress";
import ThemeStorePreview from "./ThemeStorePreview";

const pageSize = 24;
function filterThemes<
  T extends { name: string; description: string; author: string },
>(themes: T[], query: string) {
  return themes.filter((theme) =>
    [theme.name, theme.description, theme.author].some((text) =>
      text.toLowerCase().includes(query.toLowerCase()),
    ),
  );
}

export default function ThemeStore({
  base,
  followSystem,
}: {
  base: Settings["theme"];
  followSystem: boolean;
}) {
  const active = useStoreTheme();
  const installing = useStoreInstallId("theme");
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [installed, setInstalled] = useState<StoreTheme[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(native);
  const [remote, setRemote] = useState<StoreThemeSummary[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(native);
  const [catalogError, setCatalogError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StoreTheme | StoreThemeSummary>();

  useEffect(() => {
    if (!native) return;
    let current = true;
    function refresh() {
      void installedThemes().then(
        (themes) => {
          if (current) {
            setInstalled(themes);
            setLoadingInstalled(false);
          }
        },
        (error) => {
          if (current) {
            setActionError(String(error));
            setLoadingInstalled(false);
          }
        },
      );
    }
    const unsubscribe = subscribeInstalled(refresh);
    refresh();
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  const search = query.trim();
  useEffect(() => {
    if (!native || tab !== "browse") return;
    let current = true;
    setLoading(true);
    setCatalogError("");
    setRemote([]);
    const timer = window.setTimeout(
      () => {
        void themeCatalog(search, offset)
          .then((themes) => {
            if (current) setRemote(themes);
          })
          .catch((error) => {
            if (current) setCatalogError(String(error));
          })
          .finally(() => {
            if (current) setLoading(false);
          });
      },
      search ? 180 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      current = false;
    };
  }, [search, offset, tab, retry]);

  const defaults = filterThemes(defaultStoreThemes, search);
  const downloaded = filterThemes(installed, search);
  const themes =
    tab === "installed"
      ? [
          ...defaults,
          ...downloaded.map((entry) => ({
            ...entry,
            colors: entry.manifest.colors,
          })),
        ]
      : [
          ...(offset === 0 ? defaults : []),
          ...remote.filter(
            (entry) =>
              !defaultStoreThemes.some((theme) => theme.id === entry.id),
          ),
        ];
  const pending = tab === "browse" ? loading : loadingInstalled;
  const selected =
    active?.id ??
    defaultStoreThemes.find((theme) => theme.manifest.base === base)?.id;
  function changeTab(next: typeof tab) {
    setTab(next);
    setOffset(0);
    setQuery("");
  }
  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusy(false);
    }
  }
  function localTheme(id: string) {
    return [...defaultStoreThemes, ...installed].find(
      (entry) => entry.id === id,
    );
  }
  async function apply(entry: StoreTheme | StoreThemeSummary) {
    const local = localTheme(entry.id);
    if (local) applyStoreTheme(local);
    else await installStoreTheme(entry.id);
  }

  const url = `${storeOrigin}/?view=themes`;
  return (
    <section className="settings-theme-store" aria-label="Theme store">
      <div className="extensions-toolbar">
        <div className="segmented" role="tablist" aria-label="Themes">
          <button
            role="tab"
            aria-selected={tab === "browse"}
            onClick={() => changeTab("browse")}
          >
            Browse
          </button>
          <button
            role="tab"
            aria-selected={tab === "installed"}
            onClick={() => changeTab("installed")}
          >
            Installed{" "}
            <small>{installed.length + defaultStoreThemes.length}</small>
          </button>
        </div>
        <div className="theme-store-actions">
          {native && (
            <button
              className="setting-action"
              aria-busy={installing === "import"}
              disabled={busy || !!installing}
              onClick={() => void run(importStoreTheme)}
            >
              <FolderOpen size={14} /> Import theme JSON
            </button>
          )}
          <button
            className="setting-action"
            onClick={() =>
              native
                ? void run(() => openUrl(url))
                : window.open(url, "_blank", "noopener,noreferrer")
            }
          >
            Open website <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      <label className="extensions-search">
        <Search size={14} />
        <input
          type="search"
          value={query}
          placeholder={
            tab === "browse"
              ? "Search the theme store…"
              : "Filter installed themes…"
          }
          aria-label={
            tab === "browse"
              ? "Search the theme store"
              : "Filter installed themes"
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
      </label>
      {actionError && (
        <p className="settings-note" role="alert">
          {actionError}
        </p>
      )}
      {catalogError && tab === "browse" && (
        <div className="theme-store-actions">
          <p className="settings-note" role="status">
            {catalogError}
          </p>
          <button
            className="setting-action"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      <div className="extensions-list extension-catalog" aria-busy={pending}>
        {themes.map((entry) => {
          const local = localTheme(entry.id);
          const applied = selected === entry.id;
          const canApply = !applied || (entry.bundled && followSystem);
          return (
            <article className="extension-row theme-store-card" key={entry.id}>
              <button
                className="theme-store-thumbnail"
                aria-label={`Preview ${entry.name}`}
                onClick={() => setPreview(local ?? entry)}
              >
                <ThemeSwatch colors={entry.colors} />
              </button>
              <div className="extension-description">
                <strong>{entry.name}</strong>
                <span>
                  {entry.author}{" "}
                  {entry.creator?.verified && (
                    <BadgeCheck
                      size={13}
                      aria-label="Verified creator"
                      role="img"
                    />
                  )}
                </span>
                <p className="extension-card-summary" title={entry.description}>
                  {entry.description}
                </p>
                {entry.bundled && (
                  <small>
                    {applied && followSystem
                      ? "Following system"
                      : "Default theme"}
                  </small>
                )}
              </div>
              <div className="theme-store-actions">
                <button
                  className={`extension-install ${applied ? "installed" : ""}`}
                  aria-busy={installing === entry.id}
                  disabled={!canApply || busy || !!installing}
                  onClick={() => void run(() => apply(entry))}
                >
                  {applied ? (
                    <Check size={13} />
                  ) : (
                    !local && <Download size={13} />
                  )}
                  {applied && !canApply
                    ? "Active"
                    : local
                      ? "Apply"
                      : "Install"}
                </button>
                {tab === "installed" && !entry.bundled && (
                  <button
                    className="setting-action"
                    aria-label={`Remove ${entry.name}`}
                    disabled={busy}
                    onClick={() =>
                      void run(() => removeInstalledTheme(entry.id))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
              {installing === entry.id && (
                <InstallProgress name={entry.name} status="Installing…" />
              )}
            </article>
          );
        })}
        {pending && <Skeleton variant="cards" label="Loading themes" />}
      </div>
      {!themes.length && !pending && (
        <p className="settings-note">No matching themes.</p>
      )}
      {tab === "browse" && (offset > 0 || remote.length === pageSize) && (
        <div className="settings-store-pages">
          <button
            className="setting-action"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(offset - pageSize)}
          >
            Previous
          </button>
          <button
            className="setting-action"
            disabled={remote.length < pageSize || loading}
            onClick={() => setOffset(offset + pageSize)}
          >
            Next
          </button>
        </div>
      )}
      {preview && (
        <ThemeStorePreview
          key={preview.id}
          entry={preview}
          active={selected === preview.id && !(preview.bundled && followSystem)}
          installed={!!localTheme(preview.id)}
          busy={busy || !!installing}
          onClose={() => setPreview(undefined)}
          onApply={apply}
        />
      )}
    </section>
  );
}

function ThemeSwatch({ colors }: { colors: Record<string, string> }) {
  return (
    <div
      className="desktop-theme-swatch"
      aria-hidden="true"
      style={
        {
          "--swatch-shell": colors.shell ?? "#18191b",
          "--swatch-panel": colors.surface ?? "#292b30",
          "--swatch-editor": colors.paper ?? "#212226",
          "--swatch-accent": colors.accent ?? "#ebebeb",
        } as React.CSSProperties
      }
    >
      <span />
      <div>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
