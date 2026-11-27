import { themeDetailsCache } from "../lib/catalogCache";
import { NativeModal, ModalBody, ModalHeader } from "./ui/ModalSurface";
import { InstallProgress } from "./ExtensionProgress";
import Skeleton from "./ui/Skeleton";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Copyright, Download } from "lucide-react";
import { matchesPreviewOrigin, previewTargetOrigin } from "../lib/previewMode";
import { ACCOUNT_ORIGIN } from "../lib/account";
import {
  storeThemeDetails,
  type StoreTheme,
  type StoreThemeSummary,
} from "../lib/store";

export default function ThemeStorePreview({
  entry,
  active,
  installed,
  busy,
  onClose,
  onApply,
}: {
  entry: StoreTheme | StoreThemeSummary;
  active: boolean;
  installed: boolean;
  busy: boolean;
  onClose: () => void;
  onApply: (theme: StoreTheme) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState(() =>
    "manifest" in entry ? entry : themeDetailsCache.peek(entry.id),
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if ("manifest" in entry) return;
    let current = true;
    setError("");
    void storeThemeDetails(entry.id, retry > 0)
      .then((detail) => {
        if (current) setTheme(detail);
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [entry, retry]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.source === frame.current?.contentWindow &&
        matchesPreviewOrigin(event.origin) &&
        event.data?.type === "devyy:preview-ready"
      )
        setReady(true);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (theme && ready) {
      frame.current?.contentWindow?.postMessage(
        {
          type: "devyy:preview-theme",
          preview: { theme, editable: false },
        },
        previewTargetOrigin,
      );
    }
  }, [theme, ready]);

  function close() {
    dialog.current?.close();
    onClose();
  }

  const creator = theme?.creator ?? entry.creator;
  const name = creator?.name || entry.author;
  return (
    <NativeModal
      ref={dialog}
      className="desktop-theme-preview"
      data-escape-scope="active"
      aria-labelledby="desktop-theme-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <ModalHeader
        id="desktop-theme-preview-title"
        title={entry.name}
        onClose={close}
        closeLabel="Close theme preview"
      />
      <ModalBody flush>
        <div className="desktop-theme-preview-layout">
          <div className="desktop-theme-preview-editor">
            {(!theme || !ready) && !error && (
              <Skeleton variant="workbench" label="Loading the theme preview" />
            )}
            {theme && (
              <iframe
                ref={frame}
                data-ready={ready || undefined}
                title="Devyy workbench preview"
                src={`${import.meta.env.BASE_URL}index.html?playground=1&showcase=theme`}
              />
            )}
          </div>
          <div className="desktop-theme-preview-details">
            <p>{entry.description}</p>
            <p className="theme-preview-creator">
              <Copyright size={14} aria-label="Copyright" />{" "}
              {theme?.copyright || entry.copyright || name}
            </p>
            <div className="theme-preview-creator">
              {creator?.official || creator?.avatarId ? (
                <img
                  alt=""
                  src={
                    creator.official
                      ? `${import.meta.env.BASE_URL}devyy.svg`
                      : `${ACCOUNT_ORIGIN}/api/avatar/${encodeURIComponent(creator.avatarId!)}`
                  }
                />
              ) : (
                <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
              )}
              {name}
              {creator?.verified && (
                <BadgeCheck
                  size={17}
                  role="img"
                  aria-label="Verified creator"
                />
              )}
            </div>
            {error && <p role="alert">{error}</p>}
            {!theme && error && (
              <button
                className="setting-action"
                onClick={() => {
                  setError("");
                  setRetry((value) => value + 1);
                }}
              >
                Try again
              </button>
            )}
            <button
              className="extension-install"
              aria-busy={working}
              disabled={!theme || active || busy || working}
              onClick={async () => {
                if (!theme) return;
                setWorking(true);
                setError("");
                try {
                  await onApply(theme);
                  close();
                } catch (cause) {
                  setError(String(cause));
                } finally {
                  setWorking(false);
                }
              }}
            >
              {!installed && <Download size={14} />}
              {active
                ? "Active theme"
                : installed
                  ? "Apply theme"
                  : "Install theme"}
            </button>
            {working && !installed && (
              <InstallProgress name={entry.name} status="Installing…" />
            )}
          </div>
        </div>
      </ModalBody>
    </NativeModal>
  );
}
