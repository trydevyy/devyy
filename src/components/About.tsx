import { useState } from "react";
import {
  Asterisk,
  Check,
  Copy,
  Cpu,
  Keyboard,
  Layers,
  Lock,
  TerminalSquare,
} from "lucide-react";
import { version } from "../../package.json";
import { native } from "../lib/native";
const platform = /Mac/.test(navigator.platform)
  ? "macOS"
  : /Win/.test(navigator.platform)
    ? "Windows"
    : /Linux/.test(navigator.platform)
      ? "Linux"
      : navigator.platform;
export default function About({ onShortcuts }: { onShortcuts: () => void }) {
  const [status, setStatus] = useState("");
  const details = `devyy ${version}\n${platform} · ${native ? "Desktop" : "Browser playground"}\nRust + Tauri · React · CodeMirror 6 · xterm.js`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      setStatus("Copied app details.");
    } catch {
      setStatus("Clipboard is unavailable. You can select the details below.");
    }
  }
  return (
    <div className="about-page">
      <div className="about-hero">
        <div className="about-mark">
          <Asterisk size={64} strokeWidth={1.4} />
        </div>
        <span className="about-version">
          devyy <span>{version}</span>
        </span>
        <h3>
          Room for your
          <br />
          <span>next great idea.</span>
        </h3>
        <p>
          A thoughtful editor for the work you love.
          <br />
          Quiet by design. Ready when you are.
        </p>
      </div>
      <div className="about-values">
        <article>
          <Cpu size={19} />
          <strong>Rust at the core</strong>
          <p>
            Native files, Git, shells, and developer tools. A lightweight system
            webview.
          </p>
        </article>
        <article>
          <Lock size={19} />
          <strong>Your workspace. Yours.</strong>
          <p>
            Local files and local tools. No account, telemetry, or cloud service
            required.
          </p>
        </article>
        <article>
          <Layers size={19} />
          <strong>Made to feel like you</strong>
          <p>
            From the first line to the last shortcut, shape a workspace that
            fits your flow.
          </p>
        </article>
      </div>
      <div className="about-runtime">
        <div>
          <TerminalSquare size={15} />
          <strong>{platform}</strong>
          <span>{native ? "Desktop application" : "Browser playground"}</span>
        </div>
        <pre>{details}</pre>
      </div>
      <div className="about-actions">
        <button className="setting-action" onClick={copy}>
          {status.startsWith("Copied") ? (
            <Check size={14} />
          ) : (
            <Copy size={14} />
          )}{" "}
          Copy app details
        </button>
        <button className="setting-action" onClick={onShortcuts}>
          <Keyboard size={14} /> Find your shortcuts
        </button>
      </div>
      <p className="about-copy-status" role="status">
        {status}
      </p>
      <footer className="about-credits">
        <span>BUILT WITH GOOD TOOLS</span>
        <p>
          Rust <i /> Tauri <i /> React <i /> CodeMirror <i /> xterm.js
        </p>
        <small>
          Independent software. A little less interface. A lot more flow.
        </small>
      </footer>
    </div>
  );
}
