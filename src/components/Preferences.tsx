import { useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { native } from "../lib/native";
import EditorPreview from "./EditorPreview";
import About from "./About";
import ExtensionManager from "./ExtensionManager";
import LanguageServers from "./LanguageServers";
import SettingsImport from "./SettingsImport";
import AIProviders from "./AIProviders";
import { extensionThemes, useExtensions } from "../lib/extensions";
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
}: {
  settings: Settings;
  onChange: Dispatch<SetStateAction<Settings>>;
  onClose: () => void;
  onSetup: () => void;
  onResetLayout: () => void;
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
}) {
  useExtensions();
  const [query, setQuery] = useState("");
  const shells = useTerminalProfiles();
  const [recording, setRecording] = useState<CommandId | null>(null),
    [candidate, setCandidate] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    searching = terms.length > 0;
  const selected = categories.find((c) => c.id === category)!;
  const matches = controls.filter((c) =>
    searching
      ? terms.every((t) =>
          `${c.label} ${c.description} ${c.keywords} ${c.category}`
            .toLowerCase()
            .includes(t),
        )
      : c.category === category,
  );
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
  function choose(id: SettingsCategory) {
    onCategoryChange(id);
    setQuery("");
    setRecording(null);
    scrollRef.current?.scrollTo(0, 0);
  }
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
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
    if (item.type === "accent")
      return (
        <AccentPicker
          settings={settings}
          onChange={(patch) => onChange((s) => ({ ...s, ...patch }))}
        />
      );
    if (item.type === "theme")
      return (
        <div className="theme-options">
          {(["paper", "midnight"] as const).map((theme) => (
            <button
              key={theme}
              className={settings.theme === theme ? "selected" : ""}
              aria-pressed={settings.theme === theme}
              onClick={() =>
                onChange((s) => ({ ...s, theme, followSystemTheme: false }))
              }
            >
              <span className={`theme-preview ${theme}`}>
                <i />
                <i />
                <i />
              </span>
              {theme === "paper" ? "Light" : "Dark"}
              {settings.theme === theme && <Check size={12} />}
            </button>
          ))}
        </div>
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
        <select
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
        </select>
      );
    if (item.type === "profile")
      return (
        <div className="shell-setting">
          <select
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
          </select>
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
    return (
      <button
        role="switch"
        aria-label={item.label}
        aria-describedby={`setting-${key}-description`}
        aria-checked={Boolean(value)}
        className={`switch ${value ? "on" : ""}`}
        onClick={() => update(key, !value)}
      >
        <span />
      </button>
    );
  }
  return (
    <div className="modal-backdrop preferences-backdrop" onMouseDown={onClose}>
      <section
        className={`settings-modal ${category === "ai" && !searching ? "settings-ai" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        onMouseDown={(e) => e.stopPropagation()}
      >
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
              <h3
                id="settings-results-title"
                className="settings-current-category"
              >
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
              <div
                className="settings-inner"
                key={searching ? "search" : category}
              >
                {!searching && category === "about" ? <About /> : null}
                {(category !== "about" && category !== "ai") || searching ? (
                  <div className="settings-section-heading">
                    <p aria-live="polite">
                      {searching
                        ? `${matches.length + keys.length} results for “${query.trim()}”`
                        : selected.description}
                    </p>
                  </div>
                ) : null}
                {!searching && category === "extensions" && (
                  <ExtensionManager />
                )}
                {!searching && category === "languages" && <LanguageServers />}
                {!searching && category === "ai" && <AIProviders />}
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
                      onChange={(patch) =>
                        onChange((s) => ({ ...s, ...patch }))
                      }
                    />
                  </>
                )}
                {!searching &&
                  category === "appearance" &&
                  extensionThemes().length > 0 && (
                    <div className="setting-row">
                      <span>
                        <strong>Extension color theme</strong>
                        <small>
                          Syntax colors from installed Open VSX themes.
                        </small>
                      </span>
                      <select
                        aria-label="Extension color theme"
                        value={settings.extensionTheme}
                        onChange={(e) => {
                          const theme = extensionThemes().find(
                            (t) => t.key === e.target.value,
                          );
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
                      </select>
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
                                behavior:
                                  document.documentElement.dataset.motion ===
                                    "reduced" ||
                                  settings.animationSpeed === "instant"
                                    ? "instant"
                                    : "smooth",
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
                          ? categories.find((c) => c.id === item.category)!
                              .label
                          : item.section}
                      </h4>
                    )}
                    <div className="setting-row">
                      <span>
                        <strong>{item.label}</strong>
                        <small id={`setting-${item.key}-description`}>
                          {item.description}
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
                        Drag panel edges to resize. Double-click an edge to
                        reset it.
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
                {!matches.length &&
                  !keys.length &&
                  (searching ||
                    ![
                      "about",
                      "extensions",
                      "languages",
                      "setup",
                      "ai",
                    ].includes(category)) && (
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
              </div>
            </div>
            <footer className="settings-footer">
              <span>
                <Check size={12} /> Saved automatically
              </span>
              <button
                onClick={() => {
                  onChange({ ...defaults, bindings: {} });
                  setRecording(null);
                }}
              >
                Reset preferences
              </button>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
