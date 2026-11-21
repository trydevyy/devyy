// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import ModalBackdrop from "./ui/ModalBackdrop";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Asterisk,
  Check,
  Code2,
  Download,
  Moon,
  Monitor,
  Palette,
  Puzzle,
  Sun,
  Github,
  UserRound,
} from "lucide-react";
import AIProviders from "./AIProviders";
import { Bot } from "lucide-react";
import type { Settings } from "../lib/types";
import AccentPicker from "./AccentPicker";
import EditorPreview from "./EditorPreview";
import ExtensionManager from "./ExtensionManager";
import SettingsImport from "./SettingsImport";
import GitHubSettings from "./GitHubSettings";
import CompletionSettings from "./CompletionSettings";
import AccountSignIn, { useAccountProfile } from "./AccountSignIn";
const steps = [
  { name: "Devyy account", icon: UserRound },
  { name: "Appearance", icon: Palette },
  { name: "Editor", icon: Code2 },
  { name: "Import", icon: Download },
  { name: "Extensions", icon: Puzzle },
  { name: "AI providers", icon: Bot },
  { name: "Git & GitHub", icon: Github },
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
  const profile = useAccountProfile();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  return (
    <ModalBackdrop className="setup-backdrop">
      <section
        className={`setup-dialog ${step === 5 ? "setup-providers" : ""}`}
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
              Set up Devyy
            </h1>
            <p>
              Choose how Devyy works on this device.
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
                  <item.icon size={14} />
                </span>
                <span>{item.name}</span>

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
          </header>
          <div className="setup-scroll" key={step}>
            <h2>
              {
                [
                  "Sign in to Devyy",
                  "Choose your appearance",
                  "Make room for your code.",
                  "Pick up where you left off.",
                  "Add the tools you use.",
                  "Connect your AI providers.",
                  "Connect your repositories.",
                ][step]
              }
            </h2>
            <p className="setup-description">
              {
                [
                  "Continue as a guest to set up a local workspace.",
                  "The workspace updates as you go.",
                  "Set the type and spacing that feel right to you.",
                  "Import compatible preferences from an editor on this machine.",
                  "Browse Open VSX for languages, syntax, snippets, and themes.",
                  "Sign in or connect an API endpoint. You can change these later.",
                  "Install Git, sign in to GitHub, and choose your commit identity.",
                ][step]
              }
            </p>
            {step === 0 && <AccountSignIn profile={profile} />}
            {step === 1 && (
              <>
                <div
                  className="setup-theme-choices"
                  role="group"
                  aria-label="Setup theme"
                >
                  {(["midnight", "paper", "monochrome"] as const).map((theme) => (
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
                        ) : theme === "paper" ? (
                          <Sun size={14} />
                        ) : (
                          <Monitor size={14} />
                        )}{" "}
                        {theme === "midnight"
                          ? "Dark"
                          : theme === "paper"
                            ? "Light"
                            : "Monochrome"}
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
            {step === 2 && (
              <>
                <EditorPreview settings={settings} />
                <CompletionSettings
                  settings={settings}
                  onChange={onChange}
                  setup
                />
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
            {step === 3 && (
              <SettingsImport
                settings={settings}
                onChange={onChange}
                onSuggestions={setSuggestions}
              />
            )}
            {step === 4 && <ExtensionManager suggested={suggestions} />}
            {step === 5 && <AIProviders />}
            {step === 6 && <GitHubSettings />}
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
              onClick={() =>
                step === steps.length - 1 ? onFinish() : setStep((s) => s + 1)
              }
            >
              {step === steps.length - 1 ? "Start coding" : step === 0 && !profile ? "Continue as guest" : "Continue"}
              {step === steps.length - 1 ? (
                <Check size={14} />
              ) : (
                <ArrowRight size={14} />
              )}
            </button>
          </footer>
        </div>
      </section>
    </ModalBackdrop>
  );
}
