import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Search } from "lucide-react";
import DevyyLogo from "./DevyyLogo";
interface Credit {
  name: string;
  version: string;
  license: string;
  ecosystem?: string;
  url?: string;
  files: { name: string; text: string }[];
}
interface Notices {
  app: Credit;
  packages: Credit[];
  texts: Record<string, string>;
}
function Entry({
  entry,
  texts,
  project = false,
}: {
  entry: Credit;
  texts: Record<string, string>;
  project?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={`credit-entry${project ? " credit-project" : ""}`}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {project && <DevyyLogo size={22} />}
        <span>
          <strong>{entry.name}</strong>
          <small>
            {entry.version}
            {entry.ecosystem ? ` / ${entry.ecosystem}` : ""}
          </small>
        </span>
        <code>{entry.license}</code>
      </summary>
      {expanded && (
        <div className="credit-content">
          {entry.url && /^https:\/\//.test(entry.url) && (
            <button
              className="ai-text-action"
              onClick={() => void openUrl(entry.url!).catch(() => {})}
            >
              Project source <ExternalLink size={12} />
            </button>
          )}
          {entry.files.length ? (
            entry.files.map((file) => (
              <div key={file.text + file.name}>
                <h4>{file.name}</h4>
                <pre tabIndex={0}>{texts[file.text]}</pre>
              </div>
            ))
          ) : (
            <p>
              {project
                ? "This repository does not declare a project license."
                : "This package declares the license above but does not include a license text file. See its project source for the full terms."}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
export default function Credits() {
  const [notices, setNotices] = useState<Notices>(),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/third-party-licenses.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw Error("Could not load license notices");
        return response.json() as Promise<Notices>;
      })
      .then(setNotices)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="credits" aria-label="Open source credits">
      {error && <p role="alert">{error}</p>}
      {notices ? (
        <>
          <Entry entry={notices.app} texts={notices.texts} project />
          <label className="extensions-search">
            <Search size={14} />
            <input
              type="search"
              aria-label="Search open source licenses"
              placeholder="Search projects or licenses"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <p className="settings-note">
            Dependencies and artwork included in this build. Installed
            extensions retain their own licenses.
          </p>
          {notices.packages
            .filter((entry) =>
              `${entry.name} ${entry.license} ${entry.ecosystem}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((entry) => (
              <Entry
                key={`${entry.ecosystem}:${entry.name}@${entry.version}`}
                entry={entry}
                texts={notices.texts}
              />
            ))}
        </>
      ) : (
        !error && <p role="status">Loading licenses…</p>
      )}
    </section>
  );
}
