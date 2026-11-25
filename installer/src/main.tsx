import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowRight,
  Check,
  Copy,
  FolderOpen,
  LoaderCircle,
  Minus,
  Monitor,
  Pencil,
  X,
} from "lucide-react";
import Licenses from "./Licenses";
import Mark from "./Mark";
import MacInstall from "./MacInstall";
import "./style.css";
interface Info {
  platform: "windows" | "linux" | "macos";
  version: string;
  directory: string;
  uninstall: boolean;
  hasPayload: boolean;
  feedbackAvailable?: boolean;
  explorerContextMenu?: boolean;
  installed: boolean;
  macSource?: string;
}
interface Progress {
  phase: string;
  detail: string;
  percent: number;
}
type Step = "configure" | "remove" | "features" | "working" | "done";
function App() {
  const native = isTauri(),
    reduced = useReducedMotion();
  const [systemTheme, setSystemTheme] = useState(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [info, setInfo] = useState<Info>();
  const [directory, setDirectory] = useState("");
  const [desktop, setDesktop] = useState(true),
    [menu, setMenu] = useState(true),
    [explorerContextMenu, setExplorerContextMenu] = useState(true),
    [editing, setEditing] = useState(false),
    [validating, setValidating] = useState(false);
  const pathInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("configure"),
    [direction, setDirection] = useState(1);
  const [progress, setProgress] = useState<Progress>({
      phase: "prepare",
      detail: "Preparing Devyy",
      percent: 0,
    }),
    [error, setError] = useState("");
  const [reason, setReason] = useState(""),
    [feedback, setFeedback] = useState(""),
    [copied, setCopied] = useState(false),
    [sendingFeedback, setSendingFeedback] = useState(false),
    [license, setLicense] = useState(false);
  const busy = step === "working";
  const isMac = info?.platform === "macos";
  const theme = isMac ? systemTheme : "dark";
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (native && info)
      void invoke("installer_appearance", { theme }).catch(() => {});
  }, [theme, native, info]);
  useEffect(() => {
    document.documentElement.dataset.platform =
      info?.platform ??
      (/Mac/.test(navigator.platform)
        ? "macos"
        : /Win/.test(navigator.platform)
          ? "windows"
          : "linux");
  }, [info?.platform]);
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    if (!native) {
      const requested = new URLSearchParams(location.search).get("platform");
      const platform =
        requested === "windows" ||
        requested === "linux" ||
        requested === "macos"
          ? requested
          : /Mac/.test(navigator.platform)
            ? "macos"
            : /Win/.test(navigator.platform)
              ? "windows"
              : "linux";
      setDirectory(
        platform === "windows"
          ? "C:\\Users\\You\\AppData\\Local\\Programs\\Devyy"
          : "~/.local/opt/devyy",
      );
      setInfo({
        platform,
        version: "0.1.0",
        directory:
          platform === "windows"
            ? "C:\\Users\\You\\AppData\\Local\\Programs\\Devyy"
            : "~/.local/opt/devyy",
        uninstall: false,
        hasPayload: false,
        installed: false,
      });
      return;
    }
    void invoke<Info>("installer_info")
      .then((value) => {
        if (active) {
          setInfo(value);
          setDirectory(value.directory);
          setExplorerContextMenu(value.explorerContextMenu ?? true);
          setStep(value.uninstall ? "remove" : "configure");
        }
      })
      .catch((e) => setError(String(e)));
    void listen<Progress>("installer-progress", ({ payload }) => {
      if (active) setProgress(payload);
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [native]);
  const operating = useRef(false);
  async function operate() {
    if (!info || busy || operating.current) return;
    operating.current = true;
    setError("");
    try {
      if (!info.uninstall && !isMac) {
        setValidating(true);
        await invoke("installer_validate_directory", { directory });
        setValidating(false);
      }
      setProgress({
        phase: "prepare",
        detail: info.uninstall
          ? "Preparing to remove Devyy"
          : "Preparing Devyy",
        percent: 0,
      });
      setDirection(1);
      setStep("working");
      if (info?.uninstall) await invoke("installer_uninstall");
      else if (isMac) await invoke("installer_macos_install");
      else
        await invoke("installer_install", {
          options: {
            directory,
            desktop,
            menu,
            ...(info?.platform === "windows" && { explorerContextMenu }),
          },
        });
      setProgress({
        phase: "done",
        detail: info?.uninstall ? "Devyy has been removed" : "Devyy is ready",
        percent: 100,
      });
      setStep("done");
    } catch (error) {
      setError(String(error));
      setDirection(-1);
      setStep(info.uninstall ? "remove" : "configure");
    } finally {
      setValidating(false);
      operating.current = false;
    }
  }
  const close = () => {
    if (native && !operating.current) void getCurrentWindow().close();
  };
  const feedbackText = `Devyy ${info?.version}\nPlatform: ${info?.platform}\nReason: ${reason || "Not specified"}\n\n${feedback.trim()}`;
  const transition = reduced
    ? { duration: 0 }
    : {
        type: "tween" as const,
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      };
  const stage = step === "done" || busy ? 3 : step === "features" ? 2 : 1;

  async function continueSetup() {
    if (!info || validating) return;
    setError("");
    setValidating(true);
    try {
      if (!info.uninstall)
        await invoke("installer_validate_directory", { directory });
      setDirection(1);
      setStep("features");
    } catch (error) {
      setError(String(error));
    } finally {
      setValidating(false);
    }
  }
  async function browse() {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: directory,
        title: "Choose an empty folder for Devyy",
      });
      if (typeof path === "string") setDirectory(path);
    } catch (error) {
      setError(String(error));
    }
  }
  const actions = (
    <div className="footer-actions">
      {busy || !info ? null : step === "done" && !info.uninstall ? (
        <button className="primary" onClick={close}>
          Close setup
        </button>
      ) : step === "done" ? (
        <>
          <button className="secondary" onClick={close}>
            Skip feedback
          </button>
          {info.feedbackAvailable && (
            <button
              className="primary"
              disabled={sendingFeedback || (!reason && !feedback.trim())}
              onClick={() => {
                setSendingFeedback(true);
                setError("");
                void invoke("installer_send_feedback", { reason, feedback })
                  .then(close)
                  .catch((error) => setError(String(error)))
                  .finally(() => setSendingFeedback(false));
              }}
            >
              {sendingFeedback ? "Sending..." : "Send feedback"}
              <ArrowRight size={15} />
            </button>
          )}
        </>
      ) : step === "features" ? (
        <>
          <button
            className="secondary"
            disabled={validating}
            onClick={() => {
              setDirection(-1);
              setError("");
              setStep(info.uninstall ? "remove" : "configure");
            }}
          >
            Back
          </button>
          <button
            className="primary"
            disabled={validating}
            onClick={() => void operate()}
          >
            {info.uninstall
              ? "Uninstall Devyy"
              : info.installed
                ? "Update Devyy"
                : "Install Devyy"}
            <ArrowRight size={15} />
          </button>
        </>
      ) : isMac ? (
        <>
          <button
            className="secondary"
            onClick={() =>
              void invoke("installer_open_applications").catch((error) =>
                setError(String(error)),
              )
            }
          >
            Open Applications
          </button>
          <button
            className="primary"
            disabled={!info?.hasPayload}
            onClick={() => void operate()}
          >
            Install Devyy
            <ArrowRight size={15} />
          </button>
        </>
      ) : (
        <>
          <button className="secondary" disabled={validating} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              !native ||
              validating ||
              (info.uninstall
                ? !info.installed
                : !info.hasPayload || !directory.trim())
            }
            onClick={() => void continueSetup()}
          >
            {validating ? <LoaderCircle className="spin" size={14} /> : null}
            Continue
            <ArrowRight size={15} />
          </button>
        </>
      )}
    </div>
  );
  return (
    <div className={`installer ${isMac ? "mac-shell" : "desktop-shell"}`}>
      <header data-tauri-drag-region>
        {isMac && (
          <div className="brand" data-tauri-drag-region>
            <Mark />
            <span>devyy</span>
            <small>{info?.uninstall ? "Uninstaller" : "Setup"}</small>
          </div>
        )}
        {!isMac && info && (
          <div
            className="setup-progress"
            role="progressbar"
            aria-label={info.uninstall ? "Removal steps" : "Setup steps"}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={stage}
          >
            {[1, 2, 3].map((index) => (
              <i key={index} className={index <= stage ? "complete" : ""} />
            ))}
          </div>
        )}
        <div className="window-buttons">
          <button
            aria-label="Minimize installer"
            onClick={() => {
              if (native) void getCurrentWindow().minimize();
            }}
          >
            <Minus size={16} />
          </button>
          <button
            aria-label="Close installer"
            disabled={busy || validating}
            onClick={close}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="installer-body">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.main
            key={step}
            custom={direction}
            variants={{
              enter: (d: number) => ({
                opacity: 0,
                x: reduced ? 0 : d * 24,
                filter: reduced ? "none" : "blur(5px)",
              }),
              visible: { opacity: 1, x: 0, filter: "blur(0px)" },
              exit: (d: number) => ({
                opacity: 0,
                x: reduced ? 0 : -d * 20,
                filter: reduced ? "none" : "blur(4px)",
                transition: {
                  type: "tween",
                  duration: reduced ? 0 : 0.2,
                  ease: "easeOut",
                },
              }),
            }}
            initial="enter"
            animate="visible"
            exit="exit"
            transition={transition}
          >
            <div className={isMac ? "mac-page" : "desktop-page"}>
              {!isMac && !busy && <Mark className="page-mark" />}
              {!info ? (
                <div className="center">
                  <LoaderCircle className="spin" />
                  <h1>Getting ready</h1>
                </div>
              ) : isMac && !info.uninstall && step === "configure" ? (
                <MacInstall
                  source={info.macSource}
                  dark={theme === "dark"}
                  onInstall={() => void operate()}
                  onInstalled={() => {
                    setProgress({
                      phase: "done",
                      detail: "Devyy is in Applications",
                      percent: 100,
                    });
                    setStep("done");
                  }}
                  onError={setError}
                />
              ) : step === "configure" ? (
                <>
                  <div className="page-heading">
                    <h1>{info.installed ? "Update Devyy" : "Install Devyy"}</h1>
                    <p>Choose an installation folder.</p>
                  </div>
                  <label className="path-label" htmlFor="installation-path">
                    Installation folder
                  </label>
                  <div className={`path-bar ${editing ? "editing" : ""}`}>
                    <FolderOpen size={17} />
                    <input
                      ref={pathInput}
                      id="installation-path"
                      aria-label="Installation folder"
                      value={directory}
                      title={directory}
                      readOnly={!editing || validating}
                      onChange={(event) => setDirectory(event.target.value)}
                      onBlur={() => setEditing(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setEditing(false);
                      }}
                    />
                    <button
                      aria-label="Edit installation path"
                      disabled={!native || validating}
                      onClick={() => {
                        setEditing(true);
                        requestAnimationFrame(() => pathInput.current?.focus());
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="browse-path"
                      disabled={!native || validating}
                      onClick={() => void browse()}
                    >
                      Choose folder…
                    </button>
                  </div>
                  <div className="location-note">
                    {directory !== info.directory && (
                      <button
                        className="text-action"
                        onClick={() => setDirectory(info.directory)}
                      >
                        Use default folder
                      </button>
                    )}
                  </div>
                  {info.installed && (
                    <p className="notice">
                      This will update your existing Devyy installation.
                    </p>
                  )}
                </>
              ) : step === "features" ? (
                <>
                  <div className="page-heading">
                    <h1>
                      {info.uninstall ? "Review removal" : "Choose features"}
                    </h1>
                    <p>
                      {info.uninstall
                        ? "Devyy will remove the application, its shortcuts, and its system integrations. Your settings will stay on this computer."
                        : "Choose where Devyy appears on this computer."}
                    </p>
                  </div>
                  {info.uninstall ? (
                    <ul className="removal-options">
                      <li>Devyy application files</li>
                      <li>Desktop and app menu shortcuts added by Setup</li>
                      {info.platform === "windows" && (
                        <li>File Explorer integration added by Setup</li>
                      )}
                    </ul>
                  ) : (
                    <div
                      className="shortcut-options"
                      role="group"
                      aria-label="Shortcuts"
                    >
                      <label>
                        <span>
                          <strong>Desktop shortcut</strong>
                          <small>Add Devyy to your desktop</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={desktop}
                          onChange={(event) => setDesktop(event.target.checked)}
                        />
                      </label>
                      <label>
                        <span>
                          <strong>
                            {info.platform === "windows"
                              ? "Start menu"
                              : "Application menu"}
                          </strong>
                          <small>Find Devyy in your app list</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={menu}
                          onChange={(event) => setMenu(event.target.checked)}
                        />
                      </label>
                      {info.platform === "windows" && (
                        <label>
                          <span>
                            <strong>Open in Devyy</strong>
                            <small>
                              Show in the File Explorer context menu
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            role="switch"
                            checked={explorerContextMenu}
                            onChange={(event) =>
                              setExplorerContextMenu(event.target.checked)
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                </>
              ) : step === "remove" ? (
                <>
                  <div className="page-heading">
                    <h1>Installation to remove</h1>
                    <p>Review the location of the Devyy installation.</p>
                  </div>
                  <p className="install-destination" title={directory}>
                    {directory}
                  </p>
                  {!info.installed && (
                    <p className="notice">
                      We couldn’t find a Devyy installation at this location.
                    </p>
                  )}
                </>
              ) : step === "working" ? (
                <div className="working">
                  <Mark className="progress-mark" />
                  <progress
                    aria-label={
                      info.uninstall ? "Uninstall progress" : "Install progress"
                    }
                    max={100}
                    value={progress.percent}
                  />
                  <h1>
                    {info.uninstall ? "Removing Devyy" : "Installing Devyy"}
                  </h1>
                  <p role="status">
                    {progress.detail} · {Math.floor(progress.percent)}%
                  </p>
                </div>
              ) : info.uninstall ? (
                <>
                  <div className="page-heading">
                    <h1>Devyy was removed</h1>
                    <p>What could we do better?</p>
                  </div>
                  <div className="reasons" aria-label="Reason for uninstalling">
                    {[
                      "Performance",
                      "Missing features",
                      "Bugs",
                      "Just trying it",
                      "Something else",
                    ].map((value) => (
                      <button
                        key={value}
                        aria-pressed={reason === value}
                        onClick={() => {
                          setReason(value);
                          setCopied(false);
                        }}
                      >
                        {reason === value && <Check size={12} />} {value}
                      </button>
                    ))}
                  </div>
                  <textarea
                    aria-label="How can we improve Devyy?"
                    value={feedback}
                    onChange={(event) => {
                      setFeedback(event.target.value);
                      setCopied(false);
                    }}
                    maxLength={800}
                    placeholder="What would make Devyy better for you?"
                  />
                  <div className="feedback-actions">
                    <button
                      className="text-action"
                      onClick={() =>
                        void writeText(feedbackText)
                          .then(() => setCopied(true))
                          .catch((error) => setError(String(error)))
                      }
                    >
                      <Copy size={13} />
                      {copied ? "Copied" : "Copy feedback"}
                    </button>
                    <span>
                      {info.feedbackAvailable
                        ? "Send your feedback to the Devyy team."
                        : "You can copy your feedback from this build."}
                    </span>
                  </div>
                </>
              ) : (
                <div className="done">
                  <Mark className="progress-mark" />
                  <h1>Devyy is installed</h1>
                </div>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {!isMac && !busy && actions}
            </div>
          </motion.main>
        </AnimatePresence>
      </div>
      {isMac && (
        <footer>
          <div className="footer-meta">
            <Monitor size={13} />
            <span>macOS</span>
            <button className="text-action" onClick={() => setLicense(true)}>
              Licenses
            </button>
          </div>
          {actions}
        </footer>
      )}
      <AnimatePresence>
        {license && (
          <motion.div
            className="license-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLicense(false)}
          >
            <Licenses onClose={() => setLicense(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
