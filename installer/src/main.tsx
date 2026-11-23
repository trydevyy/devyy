import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  FolderOpen,
  LoaderCircle,
  Minus,
  Monitor,
  Pencil,
  Pointer,
  Trash2,
  X,
} from "lucide-react";
import Licenses, { LicenseContents } from "./Licenses";
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
type Step =
  "location" | "shortcuts" | "licenses" | "remove" | "working" | "done";
const pages: Step[] = ["location", "shortcuts", "licenses", "working"];
function App() {
  const native = isTauri(),
    reduced = useReducedMotion();
  const [theme, setTheme] = useState(() =>
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
  const [step, setStep] = useState<Step>("location"),
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
  const busy = step === "working",
    isMac = info?.platform === "macos" && !info.uninstall;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (native) void invoke("installer_appearance", { theme }).catch(() => {});
  }, [theme, native]);
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
          setStep(value.uninstall ? "remove" : "location");
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
  async function navigate(next: Step) {
    if (busy || validating) return;
    setError("");
    if (step === "location" && next === "shortcuts" && native) {
      setValidating(true);
      try {
        await invoke("installer_validate_directory", { directory });
      } catch (error) {
        setError(String(error));
        return;
      } finally {
        setValidating(false);
      }
    }
    setDirection(pages.indexOf(next) >= pages.indexOf(step) ? 1 : -1);
    setStep(next);
  }
  const operating = useRef(false);
  async function operate() {
    if (busy || operating.current) return;
    operating.current = true;
    setError("");
    setDirection(1);
    setStep("working");
    try {
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
      setStep(info?.uninstall ? "remove" : isMac ? "location" : "licenses");
    } finally {
      operating.current = false;
    }
  }
  const close = () => {
    if (native && !busy) void getCurrentWindow().close();
  };
  const feedbackText = `Devyy ${info?.version}\nPlatform: ${info?.platform}\nReason: ${reason || "Not specified"}\n\n${feedback.trim()}`;
  const transition = reduced
    ? { duration: 0 }
    : {
        type: "tween" as const,
        duration: 0.28,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
      };
  const stage = step === "done" ? 3 : pages.indexOf(step);
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
  return (
    <div className={`installer ${isMac ? "mac-shell" : ""}`}>
      <header data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <Mark />
          <span>devyy</span>
          <small>{info?.uninstall ? "Uninstaller" : "Setup"}</small>
        </div>
        <div className="window-buttons">
          <button
            aria-label="Minimize installer"
            onClick={() => {
              if (native) void getCurrentWindow().minimize();
            }}
          >
            <Minus size={16} />
          </button>
          <button aria-label="Close installer" disabled={busy} onClick={close}>
            <X size={17} />
          </button>
        </div>
      </header>
      {info && !info.uninstall && !isMac && (
        <nav className="stepper" aria-label="Installation steps">
          {["Location", "Shortcuts", "Licenses", "Install"].map(
            (label, index) => (
              <button
                key={label}
                disabled={busy || index >= stage}
                aria-current={index === stage ? "step" : undefined}
                className={index < stage ? "complete" : ""}
                onClick={() => void navigate(pages[index])}
              >
                <span>{index < stage ? <Check size={12} /> : index + 1}</span>
                {label}
              </button>
            ),
          )}
        </nav>
      )}
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
              }),
            }}
            initial="enter"
            animate="visible"
            exit="exit"
            transition={transition}
          >
            {!info ? (
              <div className="center">
                <LoaderCircle className="spin" />
                <h1>Getting ready</h1>
              </div>
            ) : isMac && step === "location" ? (
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
            ) : step === "location" ? (
              <>
                <div className="page-heading">
                  <h1>Install Devyy</h1>
                  <p>Choose where Devyy will be installed.</p>
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
                    readOnly={!editing}
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
                  <p>Installed for your account.</p>
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
            ) : step === "shortcuts" ? (
              <>
                <div className="page-heading">
                  <h1>Shortcuts</h1>
                  <p>Choose where Devyy appears.</p>
                </div>
                <div className="shortcut-options">
                  <label className={desktop ? "enabled" : ""}>
                    <span className="choice-icon">
                      <Monitor size={24} />
                    </span>
                    <span>
                      <strong>Desktop shortcut</strong>
                      <small>Add Devyy to your desktop</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={desktop}
                      onChange={(event) => setDesktop(event.target.checked)}
                    />
                  </label>
                  <label className={menu ? "enabled" : ""}>
                    <span className="choice-icon">
                      <FolderOpen size={24} />
                    </span>
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
                      checked={menu}
                      onChange={(event) => setMenu(event.target.checked)}
                    />
                  </label>
                  {info.platform === "windows" && (
                    <label className={explorerContextMenu ? "enabled" : ""}>
                      <span className="choice-icon">
                        <Pointer size={24} />
                      </span>
                      <span>
                        <strong>Open in Devyy</strong>
                        <small>Show in the File Explorer context menu</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={explorerContextMenu}
                        onChange={(event) =>
                          setExplorerContextMenu(event.target.checked)
                        }
                      />
                    </label>
                  )}
                </div>
              </>
            ) : step === "licenses" ? (
              <>
                <div className="page-heading compact-heading">
                  <h1>Licenses</h1>
                  <p>
                    Devyy’s GPLv3 license and the projects that make it
                    possible.
                  </p>
                </div>
                <div className="wizard-licenses">
                  <LicenseContents />
                </div>
              </>
            ) : step === "remove" ? (
              <>
                <div className="page-heading">
                  <span className="eyebrow">
                    <Trash2 size={14} /> UNINSTALL DEVYY
                  </span>
                  <h1>Ready to remove Devyy?</h1>
                  <p>
                    Remove the application and its shortcuts. Your settings stay
                    available for a future install.
                  </p>
                </div>
                <section className="installed-card">
                  <Mark />
                  <div>
                    <strong>Devyy</strong>
                    <small title={directory}>{directory}</small>
                  </div>
                  <Trash2 size={19} />
                </section>
                {!info.installed && (
                  <p className="notice">
                    We couldn’t find a Devyy installation at this location.
                  </p>
                )}
              </>
            ) : step === "working" ? (
              <div className="working">
                <div className="install-orbit">
                  <Mark />
                  <span />
                </div>
                <h1>
                  {info.uninstall ? "Removing Devyy." : "Installing Devyy."}
                </h1>
                <div className="progress-label">
                  <p role="status">{progress.detail}</p>
                  <span>{Math.floor(progress.percent)}%</span>
                </div>
                <progress
                  aria-label={
                    info.uninstall ? "Uninstall progress" : "Install progress"
                  }
                  max={100}
                  value={progress.percent}
                />
              </div>
            ) : info.uninstall ? (
              <>
                <div className="page-heading">
                  <span className="eyebrow">
                    <CheckCheck size={15} /> DEVYY REMOVED
                  </span>
                  <h1>
                    Thanks for giving
                    <br />
                    Devyy a try.
                  </h1>
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
                <div className="success-icon">
                  <Check size={27} />
                </div>
                <h1>Devyy is installed</h1>
                <p>You can now open Devyy.</p>
                <section className="installed-card">
                  <Mark />
                  <div>
                    <strong>Devyy {info.version}</strong>
                    <small>
                      {isMac ? "/Applications/Devyy.app" : directory}
                    </small>
                  </div>
                  <Check size={18} />
                </section>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </motion.main>
        </AnimatePresence>
      </div>
      <footer>
        <div className="footer-meta">
          <Monitor size={13} />
          <span>
            {info?.platform === "windows"
              ? "Windows"
              : info?.platform === "macos"
                ? "macOS"
                : "Linux"}
          </span>
          <button className="text-action" onClick={() => setLicense(true)}>
            Licenses
          </button>
        </div>
        <div className="footer-actions">
          {step === "working" ? (
            <span className="footer-working">
              <LoaderCircle size={14} className="spin" />
              {info?.uninstall ? "Removing" : "Installing"}
            </span>
          ) : step === "done" ? (
            <>
              <button className="secondary" onClick={close}>
                {info?.uninstall ? "Skip feedback" : "Done"}
              </button>
              {(!info?.uninstall || info.feedbackAvailable) && (
                <button
                  className="primary"
                  disabled={
                    info?.uninstall &&
                    (sendingFeedback || (!reason && !feedback.trim()))
                  }
                  onClick={() => {
                    if (info?.uninstall) {
                      setSendingFeedback(true);
                      setError("");
                      void invoke("installer_send_feedback", {
                        reason,
                        feedback,
                      })
                        .then(close)
                        .catch((error) => setError(String(error)))
                        .finally(() => setSendingFeedback(false));
                    } else
                      void invoke("installer_launch")
                        .then(close)
                        .catch((error) => setError(String(error)));
                  }}
                >
                  {info?.uninstall
                    ? sendingFeedback
                      ? "Sending..."
                      : "Send feedback"
                    : "Launch Devyy"}
                  <ArrowRight size={15} />
                </button>
              )}
            </>
          ) : step === "remove" ? (
            <>
              <button className="secondary" onClick={close}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!info?.installed}
                onClick={() => void operate()}
              >
                Uninstall
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
              <button
                className="secondary"
                onClick={() =>
                  step === "location"
                    ? close()
                    : void navigate(
                        step === "licenses" ? "shortcuts" : "location",
                      )
                }
              >
                {step === "location" ? (
                  "Cancel"
                ) : (
                  <>
                    <ArrowLeft size={14} />
                    Back
                  </>
                )}
              </button>
              <button
                className="primary"
                disabled={
                  !info ||
                  validating ||
                  (step === "licenses" && (!info.hasPayload || !native))
                }
                onClick={() =>
                  step === "licenses"
                    ? void operate()
                    : void navigate(
                        step === "location" ? "shortcuts" : "licenses",
                      )
                }
              >
                {validating ? (
                  <LoaderCircle className="spin" size={14} />
                ) : null}
                {step === "licenses"
                  ? info?.installed
                    ? "Update Devyy"
                    : "Install Devyy"
                  : "Continue"}
                <ArrowRight size={15} />
              </button>
            </>
          )}
        </div>
      </footer>
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
