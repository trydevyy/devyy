import { useEffect, useState, type ReactNode } from "react";
import Skeleton from "./ui/Skeleton";
import { ArrowUpRight, Download, Search, Plug } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  installStoreLanguage,
  languageCatalog,
  useStoreInstallId,
  storeOrigin,
  type StoreLanguage,
} from "../lib/store";
import { InstallProgress } from "./ExtensionProgress";
import { native } from "../lib/native";

const pageSize = 12;

export default function StoreBrowser({
  configured,
}: {
  configured: ReactNode;
}) {
  const [tab, setTab] = useState<"browse" | "local">("browse");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [languages, setLanguages] = useState<StoreLanguage[]>([]);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const installing = useStoreInstallId("language");
  useEffect(() => {
    if (!native) return;
    let current = true;
    setLoading(true);
    setError("");
    void languageCatalog()
      .then((items) => {
        if (current) setLanguages(items);
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [retry]);

  const matching = languages.filter((item) =>
    `${item.name} ${item.languages.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const url = `${storeOrigin}/?view=language-servers`;
  return (
    <section className="settings-store" aria-label="Language server store">
      <div className="extensions-toolbar">
        <div
          className="segmented"
          role="tablist"
          aria-label="Language server store"
        >
          <button
            role="tab"
            aria-selected={tab === "browse"}
            onClick={() => setTab("browse")}
          >
            Browse
          </button>
          <button
            role="tab"
            aria-selected={tab === "local"}
            onClick={() => setTab("local")}
          >
            Configured
          </button>
        </div>
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
      {error && (
        <p className="settings-note" role="alert">
          {error}
        </p>
      )}
      {tab === "local" ? (
        configured
      ) : !native ? (
        <p className="settings-note">
          Open the desktop app to install from the Store.
        </p>
      ) : (
        <>
          <label className="extensions-search">
            <Search size={14} />
            <input
              type="search"
              value={query}
              placeholder="Search languages and servers"
              aria-label="Search languages and servers"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          {error && (
            <button
              className="setting-action"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          )}
          {loading ? (
            <Skeleton variant="cards" label="Loading language servers" />
          ) : (
            <ul className="settings-store-list">
              {matching
                .slice(page * pageSize, (page + 1) * pageSize)
                .map((item) => (
                  <li className="desktop-store-card" key={item.id}>
                    <div className="desktop-store-card-heading">
                      <Plug size={20} aria-hidden="true" />
                      <img
                        className="settings-store-icon"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                        src={`${import.meta.env.BASE_URL}file-icons/${item.icon === "code" ? "file" : encodeURIComponent(item.icon)}.svg`}
                        alt=""
                        loading="lazy"
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.languages.join(", ")}</small>
                      </span>
                    </div>
                    <p className="settings-note">
                      {item.installer === "path"
                        ? "Use an existing installation"
                        : `Install with ${item.installer}`}
                    </p>
                    <button
                      className="setting-action"
                      aria-busy={installing === item.id}
                      disabled={busy || !!installing}
                      onClick={() => void run(() => installStoreLanguage(item))}
                    >
                      <Download size={13} />{" "}
                      {item.installer === "path" ? "Configure" : "Install"}
                    </button>
                    {installing === item.id && (
                      <InstallProgress
                        name={item.name}
                        status={
                          item.installer === "path"
                            ? "Configuring…"
                            : "Installing…"
                        }
                      />
                    )}
                  </li>
                ))}
            </ul>
          )}
          {!loading && !error && !matching.length && (
            <p className="settings-note">No matching entries.</p>
          )}
          {(page > 0 || matching.length > (page + 1) * pageSize) && (
            <div className="settings-store-pages">
              <button
                className="setting-action"
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <button
                className="setting-action"
                disabled={loading || matching.length <= (page + 1) * pageSize}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
