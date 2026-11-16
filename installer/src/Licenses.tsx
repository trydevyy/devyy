import { useEffect, useRef, useState } from "react";
import { ChevronRight, X, Search } from "lucide-react";
import license from "../LICENSE?raw";
interface Credit {
  name: string;
  version: string;
  license: string;
  files: { name: string; text: string }[];
}
export function LicenseContents() {
  const [notices, setNotices] = useState<{
    packages: Credit[];
    texts: Record<string, string>;
  }>();
  const [error, setError] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/third-party-licenses.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error("License notices could not be loaded.");
        return r.json();
      })
      .then(setNotices)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, []);
  return (
    <div className="license-contents">
      <details className="installer-credit own-license" open>
        <summary>
          <ChevronRight size={13} />
          <span>
            Devyy<small>Original source</small>
          </span>
          <small>GPLv3</small>
        </summary>
        <pre>{license}</pre>
      </details>
      <label className="license-search">
        <Search size={13} />
        <input
          aria-label="Search open-source licenses"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a project or license"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {notices?.packages
        .filter((entry) =>
          `${entry.name} ${entry.license}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((entry, index) => (
          <details
            className="installer-credit"
            key={`${entry.name}:${entry.version}:${index}`}
          >
            <summary>
              <ChevronRight size={12} />
              <span>
                {entry.name}
                <small>{entry.version}</small>
              </span>
              <small>{entry.license}</small>
            </summary>
            {entry.files.map((file) => (
              <pre key={file.text}>{notices.texts[file.text]}</pre>
            ))}
          </details>
        ))}
    </div>
  );
}
export default function Licenses({ onClose }: { onClose: () => void }) {
  const container = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const fields = [
          ...(container.current?.querySelectorAll<HTMLElement>(
            "button, summary, input",
          ) ?? []),
        ];
        const first = fields[0],
          last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      previous?.focus();
    };
  }, []);
  return (
    <section
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label="Devyy license"
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <strong>Licenses & credits</strong>
        <button aria-label="Close license" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="license-scroll">
        <LicenseContents />
      </div>
    </section>
  );
}
