import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Asterisk,
  Check,
  Code2,
  Download,
  Moon,
  Palette,
  Puzzle,
  Sun,
} from "lucide-react";
import type { Settings } from "../lib/types";
import AccentPicker from "./AccentPicker";
import EditorPreview from "./EditorPreview";
import ExtensionManager from "./ExtensionManager";
import SettingsImport from "./SettingsImport";
const steps = [
  { name: "Appearance", icon: Palette },
  { name: "Editor", icon: Code2 },
  { name: "Import", icon: Download },
  { name: "Extensions", icon: Puzzle },
];
export default function Setup({
  settings,
  onChange,
  onFinish,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  return (
    <div className="setup-backdrop">
      <section
        className="setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Set up devyy"
      >
        <aside className="setup-rail">
          <div className="setup-wordmark">
            <Asterisk size={30} strokeWidth={1.8} />
            <span>devyy</span>
          </div>
          <div className="setup-introduction">
            <h1>
              A workspace
              <br />
              of your own.
            </h1>
            <p>
              A few choices to get comfortable.
              <br />
              Everything can be changed later.
            </p>
          </div>
          <nav aria-label="Setup steps">
            {steps.map((item, i) => (
              <button
                key={item.name}
                aria-current={step === i ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                <span className="setup-step-number">
                  {i < step ? <Check size={12} /> : i + 1}
                </span>
                <span>{item.name}</span>
                {step === i && <ArrowRight size={13} />}
              </button>
            ))}
          </nav>
          <button className="setup-skip" onClick={onFinish}>
            Skip setup
          </button>
        </aside>
        <div className="setup-main">
          <header>
            <span>{steps[step].name}</span>
            <span
              className="setup-progress"
              aria-label={`Step ${step + 1} of ${steps.length}`}
            >
              {steps.map((item, i) => (
                <i key={item.name} className={i <= step ? "complete" : ""} />
              ))}
            </span>
          </header>
          <div className="setup-scroll" key={step}>
            <h2>
              {
                [
                  "Find your focus.",
                  "Make room for your code.",
                  "Pick up where you left off.",
                  "Add the tools you use.",
                ][step]
              }
            </h2>
            <p className="setup-description">
              {
                [
                  "Choose your appearance. The workspace updates as you go.",
                  "Set the type and spacing that feel right to you.",
                  "Import compatible preferences from an editor on this machine.",
                  "Browse Open VSX for languages, syntax, snippets, and themes.",
                ][step]
              }
            </p>
            {step === 0 && (
              <>
                <div
                  className="setup-theme-choices"
                  role="group"
                  aria-label="Setup theme"
                >
                  {(["midnight", "paper"] as const).map((theme) => (
                    <button
                      key={theme}
                      aria-pressed={
                        settings.theme === theme && !settings.followSystemTheme
                      }
                      onClick={() =>
                        onChange({ theme, followSystemTheme: false })
                      }
                    >
                      <span className={`setup-theme-window ${theme}`}>
                        <span>
                          <i />
                          <i />
                          <i />
                        </span>
                        <b />
                        <div>
                          <em />
                          <em />
                          <em />
                        </div>
                      </span>
                      <span>
                        {theme === "midnight" ? (
                          <Moon size={14} />
                        ) : (
                          <Sun size={14} />
                        )}{" "}
                        {theme === "midnight" ? "Dark" : "Light"}
                        {settings.theme === theme &&
                          !settings.followSystemTheme && <Check size={13} />}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="setup-check">
                  <input
                    type="checkbox"
                    checked={settings.followSystemTheme}
                    onChange={(e) =>
                      onChange({ followSystemTheme: e.target.checked })
                    }
                  />{" "}
                  Follow system appearance
                </label>
                <div className="setup-option">
                  <span>
                    <strong>Accent</strong>
                    <small>Neutral by default. Yours to change.</small>
                  </span>
                  <AccentPicker settings={settings} onChange={onChange} />
                </div>
                <div className="setup-option">
                  <span>
                    <strong>Window vibrancy</strong>
                    <small>Native glass where supported.</small>
                  </span>
                  <button
                    role="switch"
                    aria-label="Setup window vibrancy"
                    aria-checked={settings.vibrancy}
                    className={`switch ${settings.vibrancy ? "on" : ""}`}
                    onClick={() => onChange({ vibrancy: !settings.vibrancy })}
                  >
                    <span />
                  </button>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <EditorPreview settings={settings} />
                <div className="setup-option">
                  <span>
                    <strong>Text size</strong>
                    <small>Editor font size</small>
                  </span>
                  <div className="setting-range">
                    <input
                      type="range"
                      min={10}
                      max={24}
                      step={1}
                      aria-label="Setup editor font size"
                      value={settings.fontSize}
                      onChange={(e) =>
                        onChange({ fontSize: Number(e.target.value) })
                      }
                    />
                    <output>{settings.fontSize}px</output>
                  </div>
                </div>
                <div className="setup-option">
                  <span>
                    <strong>Indentation</strong>
                  </span>
                  <div
                    className="segmented"
                    role="group"
                    aria-label="Setup indentation"
                  >
                    {[2, 4, 8].map((n) => (
                      <button
                        key={n}
                        aria-pressed={settings.tabSize === n}
                        onClick={() => onChange({ tabSize: n })}
                      >
                        {n} spaces
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setup-option">
                  <span>
                    <strong>Wrap long lines</strong>
                    <small>Keep code within the editor width.</small>
                  </span>
                  <button
                    role="switch"
                    aria-label="Setup word wrap"
                    aria-checked={settings.wordWrap}
                    className={`switch ${settings.wordWrap ? "on" : ""}`}
                    onClick={() => onChange({ wordWrap: !settings.wordWrap })}
                  >
                    <span />
                  </button>
                </div>
                <div className="setup-option">
                  <span>
                    <strong>Save automatically</strong>
                    <small>Save changes after you stop typing.</small>
                  </span>
                  <button
                    role="switch"
                    aria-label="Setup auto save"
                    aria-checked={settings.autoSave}
                    className={`switch ${settings.autoSave ? "on" : ""}`}
                    onClick={() => onChange({ autoSave: !settings.autoSave })}
                  >
                    <span />
                  </button>
                </div>
              </>
            )}
            {step === 2 && (
              <SettingsImport
                settings={settings}
                onChange={onChange}
                onSuggestions={setSuggestions}
              />
            )}
            {step === 3 && <ExtensionManager suggested={suggestions} />}
          </div>
          <footer>
            <button
              className="setup-back"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              className="primary"
              onClick={() => (step === 3 ? onFinish() : setStep((s) => s + 1))}
            >
              {step === 3 ? "Start coding" : "Continue"}
              {step === 3 ? <Check size={14} /> : <ArrowRight size={14} />}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
