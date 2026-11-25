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

import AccountSettings from "./AccountSettings";
import ModalBackdrop from "./ui/ModalBackdrop";
import Select from "./ui/Select";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useSurfaceMotion } from "../lib/motion";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Asterisk,
  Settings2,
  Check,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  categories,
  controls,
  type SettingsCategory,
  type SettingControl,
} from "../lib/settingsCatalog";
import {
  useTerminalProfiles,
  refreshTerminalProfiles,
} from "../lib/terminalProfiles";
import { version } from "../../package.json";
import { native, nativeLinux } from "../lib/native";
import { supportsWindowVibrancy } from "../lib/appearance";
import EditorPreview from "./EditorPreview";
import About from "./About";
import Credits from "./Credits";
import ExtensionManager from "./ExtensionManager";
import ExtensionConfiguration, {
  matchingExtensionSettings,
} from "./ExtensionConfiguration";
import LanguageServers from "./LanguageServers";
import SettingsImport from "./SettingsImport";
import DefaultApplications from "./DefaultApplications";
import AIProviders from "./AIProviders";
import GitHubSettings from "./GitHubSettings";
import CompletionSettings from "./CompletionSettings";
import { extensionThemes, useExtensions } from "../lib/extensions";
import StoreBrowser from "./StoreBrowser";
import ThemeStore from "./ThemeStore";
import { activateStoreTheme } from "../lib/store";
import AccentPicker from "./AccentPicker";
import { defaults, type Settings } from "../lib/types";
import {
  bindingsWith,
  commandInfo,
  displayBinding,
  eventBinding,
  validBinding,
  type CommandId,
} from "../lib/shortcuts";

export default function Preferences({
  settings,
  onChange,
  onClose,
  onResetLayout,
  category,
  onCategoryChange,
  onSetup,
  onViewUpdate,
  embedded = false,
  initialQuery = "",
}: {
  settings: Settings;
  onChange: Dispatch<SetStateAction<Settings>>;
  onClose: () => void;
  onSetup: () => void;
  onViewUpdate: (url: string) => Promise<void>;
  onResetLayout: () => void;
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  embedded?: boolean;
  initialQuery?: string;
}) {
  const present = useIsPresent();
  const installed = useExtensions();
  const { transition, instant } = useSurfaceMotion();
  const blurPages = !nativeLinux && !instant;
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => {
    if (present) setQuery(initialQuery);
  }, [initialQuery, present]);
  const shells = useTerminalProfiles();
  const [recording, setRecording] = useState<CommandId | null>(null),
    [candidate, setCandidate] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    searching = terms.length > 0;
  const selected = categories.find((c) => c.id === category)!;
  const matches = controls.filter((c) => {
    if (!supportsWindowVibrancy && c.section === "Glass") return false;
    return searching
      ? terms.every((t) =>
          `${c.label} ${c.description} ${c.keywords} ${c.category}`
            .toLowerCase()
            .includes(t),
        )
      : c.category === category &&
          c.key !== "vcsProvider" &&
          c.type !== "theme-store";
  });
  const keys = commandInfo.filter(([, label, group]) =>
    searching
      ? terms.every((t) =>
          `${label} ${group} keyboard shortcut keybind`
            .toLowerCase()
            .includes(t),
        )
      : category === "keyboard",
  );
  const bindings = bindingsWith(settings.bindings);
  const reserved = [
    "Mod+Q",
    "Mod+H",
    "Mod+Alt+H",
    "Mod+C",
    "Mod+X",
    "Mod+V",
    "Mod+A",
    "Alt+F4",
  ].includes(candidate);
  const candidateError = reserved
    ? "This shortcut is reserved for a system or clipboard action."
    : candidate && !validBinding(candidate)
      ? "Use Command, Control, or Option with a key, or a function key."
      : "";
  const conflicts = candidate
    ? commandInfo.filter(
        ([id]) => id !== recording && bindings[id] === candidate,
      )
    : [];
  const previousCategory = useRef(category);
  const direction =
    categories.findIndex((c) => c.id === category) >=
    categories.findIndex((c) => c.id === previousCategory.current)
      ? 1
      : -1;
  function choose(id: SettingsCategory) {
    previousCategory.current = category;
    onCategoryChange(id);
    setQuery("");
    setRecording(null);
    scrollRef.current?.scrollTo(0, 0);
  }
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (key === "followSystemTheme" && value) activateStoreTheme(undefined);
    onChange((s) => ({ ...s, [key]: value }));
  }
  function applyBinding() {
    if (!recording || !candidate || candidateError) return;
    onChange((s) => ({
      ...s,
      bindings: {
        ...s.bindings,
        ...Object.fromEntries(conflicts.map(([id]) => [id, ""])),
        [recording]: candidate,
      },
    }));
    setRecording(null);
    setCandidate("");
  }
  function control(item: SettingControl) {
    const key = item.key,
      value = settings[key];
    if (item.type === "theme-store")
      return (
        <button className="setting-action" onClick={() => choose("themes")}>
          Open Themes
        </button>
      );
    if (item.type === "accent")
      return (
        <AccentPicker
          settings={settings}
          onChange={(patch) => onChange((s) => ({ ...s, ...patch }))}
        />
      );
    if (item.type === "range")
      return (
        <div className="setting-range">
          <input
            type="range"
            aria-label={item.label}
            aria-describedby={`setting-${key}-description`}
            min={item.min}
            max={item.max}
            step={item.step}
            value={Number(value)}
            disabled={
              [
                "windowTransparency",
                "editorTransparency",
                "overlayTransparency",
                "glassBlur",
              ].includes(key) && !settings.vibrancy
            }
            onChange={(e) => update(key, Number(e.target.value))}
          />
          <output>
            {value as number}
            {item.unit}
          </output>
        </div>
      );
    if (item.type === "font-size")
      return (
        <div className="stepper" role="group" aria-label="Font size">
          <button
            aria-label="Decrease font size"
            disabled={settings.fontSize <= 10}
            onClick={() => update("fontSize", settings.fontSize - 1)}
          >
            <Minus size={13} />
          </button>
          <span aria-live="polite">{settings.fontSize}</span>
          <button
            aria-label="Increase font size"
            disabled={settings.fontSize >= 28}
            onClick={() => update("fontSize", settings.fontSize + 1)}
          >
            <Plus size={13} />
          </button>
        </div>
      );
    if (item.type === "select")
      return (
        <Select
          aria-label={key === "tabSize" ? "Spaces per tab" : item.label}
          value={String(value)}
          onChange={(e) =>
            update(
              key,
              typeof value === "number"
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        >
          {item.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    if (item.type === "profile")
      return (
        <div className="shell-setting">
          <Select
            aria-label="Default shell"
            value={settings.terminalProfile}
            disabled={!native || shells.loading}
            onChange={(e) => update("terminalProfile", e.target.value)}
          >
            <option value="">System default</option>
            {shells.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {settings.terminalProfile &&
              !shells.profiles.some(
                (p) => p.id === settings.terminalProfile,
              ) && (
                <option value={settings.terminalProfile} disabled>
                  Unavailable profile
                </option>
              )}
          </Select>
          <button
            className="icon-button"
            aria-label="Refresh shells"
            title="Refresh installed shells"
            disabled={!native || shells.loading}
            onClick={() => void refreshTerminalProfiles()}
          >
            <RotateCcw size={13} />
          </button>
        </div>
      );
    const unavailable = key === "vibrancy" && !supportsWindowVibrancy;
    const checked = !unavailable && Boolean(value);
    return (
      <button
        role="switch"
        aria-label={item.label}
        aria-describedby={`setting-${key}-description`}
        aria-checked={checked}
        className={`switch ${checked ? "on" : ""}`}
        disabled={unavailable}
        onClick={() => update(key, !value)}
      >
        <span />
      </button>
    );
  }
  const body = (
    <div className="settings-layout">
      <aside className="settings-navigation">
        <div className="settings-identity">
          <Settings2 size={18} />
          <div>
            <strong>Settings</strong>
          </div>
        </div>
        <div className="settings-search">
          <Search size={15} />
          <input
            ref={searchRef}
            autoFocus
            type="search"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              scrollRef.current?.scrollTo(0, 0);
            }}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear settings search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="vertical"
        >
          {categories.map((c, i) => (
            <button
              key={c.id}
              id={`settings-tab-${c.id}`}
              role="tab"
              aria-selected={!searching && category === c.id}
              aria-controls="settings-panel"
              tabIndex={category === c.id ? 0 : -1}
              className={!searching && category === c.id ? "active" : ""}
              onClick={() => choose(c.id)}
              onKeyDown={(e) => {
                const n =
                  e.key === "ArrowDown"
                    ? (i + 1) % categories.length
                    : e.key === "ArrowUp"
                      ? (i + categories.length - 1) % categories.length
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? categories.length - 1
                          : -1;
                if (n < 0) return;
                e.preventDefault();
                choose(categories[n].id);
                document
                  .getElementById(`settings-tab-${categories[n].id}`)
                  ?.focus();
              }}
            >
              <c.icon size={16} />
              {c.label}
            </button>
          ))}
        </div>
        <span className="settings-brand">
          <Asterisk size={15} /> devyy <small>v{version}</small>
        </span>
      </aside>
      <div
        className="settings-content"
        id="settings-panel"
        role={searching ? "region" : "tabpanel"}
        aria-labelledby={
          searching ? "settings-results-title" : `settings-tab-${category}`
        }
      >
        <header className="settings-heading">
          <h3 id="settings-results-title" className="settings-current-category">
            {searching ? "Search results" : selected.label}
          </h3>
          <button
            className="icon-button"
            aria-label="Close preferences"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="settings-scroll" ref={scrollRef}>
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              className="settings-inner"
              initial={{
                opacity: 0,
                y: instant ? 0 : direction * 24,
                filter: blurPages ? "blur(5px)" : "none",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: blurPages ? "blur(0px)" : "none",
                transition: {
                  type: "tween",
                  duration: instant ? 0 : 0.3,
                  ease: [0.16, 1, 0.3, 1],
                },
              }}
              variants={{
                leave: (d: number) => ({
                  opacity: 0,
                  y: instant ? 0 : -d * 20,
                  filter: blurPages ? "blur(4px)" : "none",
                  transition: {
                    type: "tween",
                    duration: instant ? 0 : 0.2,
                    ease: "easeOut",
                  },
                }),
              }}
              key={searching ? "search" : category}
              exit="leave"
              transition={transition}
            >
              {!searching && category === "about" ? (
                <About onViewUpdate={onViewUpdate} />
              ) : null}
              {!["about", "ai", "credits"].includes(category) || searching ? (
                <div className="settings-section-heading">
                  <p aria-live="polite">
                    {searching
                      ? `${matches.length + keys.length + matchingExtensionSettings(installed, query).length} results for “${query.trim()}”`
                      : selected.description}
                  </p>
                </div>
              ) : null}
              {searching && <ExtensionConfiguration query={query} />}
              {!searching && category === "extensions" && <ExtensionManager />}
              {!searching && category === "languages" && (
                <StoreBrowser configured={<LanguageServers />} />
              )}
              {!searching && category === "themes" && (
                <ThemeStore
                  base={settings.theme}
                  followSystem={settings.followSystemTheme}
                />
              )}
              {!searching && category === "ai" && <AIProviders />}
              {!searching && category === "account" && (
                <AccountSettings settings={settings} onChange={onChange} />
              )}
              {!searching && category === "git" && (
                <GitHubSettings settings={settings} onChange={onChange} />
              )}
              {!searching && category === "editor" && (
                <CompletionSettings
                  settings={settings}
                  onChange={(patch) => onChange((s) => ({ ...s, ...patch }))}
                />
              )}
              {!searching && category === "applications" && (
                <DefaultApplications />
              )}
              {!searching && category === "credits" && <Credits />}
              {!searching && category === "setup" && (
                <>
                  <div className="setting-row">
                    <span>
                      <strong>Set up devyy</strong>
                      <small>
                        Revisit appearance, editing, import, and extensions.
                      </small>
                    </span>
                    <button className="setting-action" onClick={onSetup}>
                      Open setup
                    </button>
                  </div>
                  <SettingsImport
                    settings={settings}
                    onChange={(patch) => onChange((s) => ({ ...s, ...patch }))}
                  />
                </>
              )}
              {!searching &&
                category === "themes" &&
                extensionThemes().length > 0 && (
                  <div className="setting-row">
                    <span>
                      <strong>Extension color theme</strong>
                      <small>
                        Syntax colors from installed Open VSX themes.
                      </small>
                    </span>
                    <Select
                      aria-label="Extension color theme"
                      value={settings.extensionTheme}
                      onChange={(e) => {
                        const theme = extensionThemes().find(
                          (t) => t.key === e.target.value,
                        );
                        activateStoreTheme(undefined);
                        onChange((s) => ({
                          ...s,
                          extensionTheme: e.target.value,
                          followSystemTheme: false,
                          ...(theme
                            ? {
                                theme:
                                  theme.uiTheme.includes("dark") ||
                                  theme.uiTheme === "hc-black"
                                    ? "midnight"
                                    : "paper",
                              }
                            : {}),
                        }));
                      }}
                    >
                      <option value="">devyy default</option>
                      {extensionThemes().map((theme) => (
                        <option key={theme.key} value={theme.key}>
                          {theme.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              {!searching && category === "editor" && (
                <EditorPreview settings={settings} />
              )}
              {!searching && category === "editor" && (
                <nav className="settings-jumps" aria-label="Editor sections">
                  {Array.from(new Set(matches.map((c) => c.section))).map(
                    (section) => (
                      <button
                        key={section}
                        onClick={() =>
                          document
                            .getElementById(`settings-section-${section}`)
                            ?.scrollIntoView({
                              behavior: "instant",
                              block: "start",
                            })
                        }
                      >
                        {section}
                      </button>
                    ),
                  )}
                </nav>
              )}
              {matches.map((item, i) => (
                <div key={item.key}>
                  {(i === 0 || matches[i - 1].section !== item.section) && (
                    <h4
                      className="settings-group-title"
                      id={`settings-section-${item.section}`}
                    >
                      {searching
                        ? categories.find((c) => c.id === item.category)!.label
                        : item.section}
                    </h4>
                  )}
                  <div className="setting-row">
                    <span>
                      <strong>{item.label}</strong>
                      <small id={`setting-${item.key}-description`}>
                        {item.key === "vibrancy" && !supportsWindowVibrancy
                          ? "Window vibrancy is unavailable on Linux."
                          : item.description}
                      </small>
                    </span>
                    {control(item)}
                  </div>
                </div>
              ))}
              {!searching && category === "terminal" && (
                <p className="settings-note">
                  {shells.error
                    ? `Shell discovery: ${shells.error}`
                    : native
                      ? `${shells.profiles.length} installed ${shells.profiles.length === 1 ? "shell" : "shells"}. Use the arrow beside + in the terminal toolbar to start a specific profile.`
                      : "Shell profiles are available in the desktop app."}
                </p>
              )}

              {!searching && category === "layout" && (
                <div className="setting-row">
                  <span>
                    <strong>Panel sizes</strong>
                    <small>
                      Drag panel edges to resize. Double-click an edge to reset
                      it.
                    </small>
                  </span>
                  <button className="setting-action" onClick={onResetLayout}>
                    <RotateCcw size={13} /> Reset layout
                  </button>
                </div>
              )}
              {keys.length > 0 && (
                <>
                  <h4 className="settings-group-title">
                    {searching ? "Keyboard shortcuts" : "Commands"}{" "}
                    <span>{keys.length}</span>
                  </h4>
                  <p className="settings-note">
                    Click a shortcut to record a new combination. Escape
                    cancels. Conflicts can be reassigned here.
                  </p>
                  {keys.map(([id, label, group]) => (
                    <div className="shortcut-row" key={id}>
                      <span>
                        <strong>{label}</strong>
                        <small>{group}</small>
                      </span>
                      <button
                        data-shortcut-recorder="true"
                        className={`shortcut-binding ${recording === id ? "recording" : ""}`}
                        aria-label={`Change shortcut for ${label}`}
                        onClick={() => {
                          setRecording(id);
                          setCandidate("");
                        }}
                        onKeyDown={(e) => {
                          if (recording !== id) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.key === "Escape") {
                            setRecording(null);
                            return;
                          }
                          const value = eventBinding(e.nativeEvent);
                          if (value) setCandidate(value);
                        }}
                      >
                        <kbd>
                          {recording === id
                            ? candidate
                              ? displayBinding(candidate)
                              : "Press shortcut…"
                            : displayBinding(bindings[id]) || "Unassigned"}
                        </kbd>
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Reset shortcut for ${label}`}
                        onClick={() =>
                          onChange((s) => {
                            const bindings = { ...s.bindings };
                            delete bindings[id];
                            return { ...s, bindings };
                          })
                        }
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove shortcut for ${label}`}
                        disabled={!bindings[id]}
                        onClick={() =>
                          onChange((s) => ({
                            ...s,
                            bindings: { ...s.bindings, [id]: "" },
                          }))
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {recording && (
                <div className="shortcut-recording" role="status">
                  <span>
                    {candidateError ||
                      (candidate
                        ? `${displayBinding(candidate)}${conflicts.length ? ` is used by ${conflicts.map(([, l]) => l).join(", ")}.` : " is available."}`
                        : "Press the keys you want to use.")}
                  </span>
                  <button
                    disabled={!candidate || !!candidateError}
                    onClick={applyBinding}
                  >
                    {conflicts.length ? "Reassign shortcut" : "Use shortcut"}
                  </button>
                  <button onClick={() => setRecording(null)}>Cancel</button>
                </div>
              )}
              {searching &&
                !matches.length &&
                !keys.length &&
                !matchingExtensionSettings(installed, query).length && (
                  <div className="settings-empty">
                    <Search size={25} />
                    <strong>No matching settings</strong>
                    <p>Try “transparency”, “font”, or a command name.</p>
                    <button
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      Clear search
                    </button>
                  </div>
                )}
            </motion.div>
          </AnimatePresence>
        </div>
        <footer className="settings-footer">
          <span>
            {!["ai", "credits", "about"].includes(category) && (
              <>
                <Check size={12} /> Saved automatically
              </>
            )}
          </span>
          <button
            onClick={() => {
              activateStoreTheme(undefined);
              onChange({ ...defaults, bindings: {} });
              setRecording(null);
            }}
          >
            Reset preferences
          </button>
        </footer>
      </div>
    </div>
  );
  if (embedded) {
    return (
      <section
        className={`settings-view-embedded ${category === "ai" && !searching ? "settings-ai" : ""}`}
        role="region"
        aria-label="Settings"
      >
        {body}
      </section>
    );
  }
  return (
    <ModalBackdrop
      className="modal-backdrop preferences-backdrop"
      onMouseDown={onClose}
    >
      <motion.section
        layout
        transition={transition}
        initial={{ opacity: 0, scale: instant ? 1 : 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: instant ? 1 : 0.98, y: instant ? 0 : 6 }}
        className={`settings-modal ${category === "ai" && !searching ? "settings-ai" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {body}
      </motion.section>
    </ModalBackdrop>
  );
}
