import {
  registerAIContext,
  writeAIContextDrag,
  boundedContext,
  type AIContextSource,
} from "./lib/aiContext";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";
import { undo, redo } from "@codemirror/commands";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Asterisk,
  BookOpen,
  Eye,
  Columns2,
  Braces,
  Blend,
  ChevronsUpDown,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleX,
  Code2,
  Files,
  Focus,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelsTopLeft,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SplitSquareHorizontal,
  TerminalSquare,
  Maximize2,
  Minimize2,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useAppearance } from "./lib/appearance";
import SourceControl from "./components/SourceControl";
import type { Comparison } from "./components/DiffEditor";
const DiffEditor = lazy(() => import("./components/DiffEditor"));
import Editor, { offset, toPosition } from "./components/Editor";
import FileTree, { FileIcon } from "./components/FileTree";
import Setup from "./components/Setup";
import ExtensionViews from "./components/ExtensionViews";
import ExtensionWebviews from "./components/ExtensionWebviews";
import ExtensionStatusItems from "./components/ExtensionStatusItems";
import ExtensionServices, {
  type WorkbenchRequest,
} from "./components/ExtensionServices";
import { matchesContext } from "./lib/extensionContext";
import { fileUri, sendExtensionEditorState } from "./lib/extensionWorkbench";
import {
  hostRequest,
  extensionLanguageFeature,
  extensionCommand,
  syncExtensionHost,
  useExtensionHost,
  type HostEvent,
} from "./lib/extensionHost";
import { initializeExtensions, useExtensions } from "./lib/extensions";
import Preferences from "./components/Preferences";
import AIWorkspace from "./components/AIWorkspace";
import AIProviderIcon from "./components/AIProviderIcon";
import { isAIExtension } from "./lib/aiExtensions";
import type { SettingsCategory } from "./lib/settingsCatalog";
import SearchResults from "./components/SearchResults";
import ProjectBadge from "./components/ProjectBadge";
import Palette, { type PaletteItem } from "./components/Palette";
import { Toaster, toast as showToast } from "sonner";
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview"));
const TerminalGroup = lazy(() => import("./components/TerminalGroup"));
import type { TerminalsHandle } from "./components/TerminalGroup";
import ResizeHandle from "./components/ResizeHandle";
import SplitTabGroup from "./components/SplitTabGroup";
import {
  groupedTabs,
  moveTabGroup,
  pairTabs,
  separateTab,
  type SplitGroup,
} from "./lib/splitGroups";
import { useContextMenu, type MenuItem } from "./components/ContextMenu";
import {
  bindingsWith,
  commandInfo,
  displayBinding,
  eventBinding,
  contributedBinding,
  isMac,
  type CommandId,
} from "./lib/shortcuts";
import Debugger, { type DebugSession } from "./components/Debugger";
import {
  normalizeSettings,
  filename,
  language,
  readLocal,
  type GitState,
  type LspDiagnostic,
  type Problem,
  type SearchMatch,
  type Settings,
  type Tab,
  type Workspace,
} from "./lib/types";
import { seed, demoEntries } from "./lib/demo";
import {
  native,
  invoke,
  listen,
  connectDocument,
  queueDocumentChange,
  closeDocument,
  savedDocument,
  clearLanguageServers,
  languageRequest,
  pathFromUri,
  type DiagnosticEvent,
} from "./lib/native";

type Section =
  "files" | "search" | "git" | "run" | "tools" | `extension:${string}`;
type Dialog = {
  title: string;
  description: string;
  initial: string;
  label: string;
  submit: (value: string) => Promise<void>;
};
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const emptyLines: number[] = [];
const emptyDiagnostics: LspDiagnostic[] = [];
const initialDemo = readLocal<Record<string, string>>("devyy.playground", seed);
const initialTab: Tab = {
  path: "src/main.rs",
  content: initialDemo["src/main.rs"] ?? seed["src/main.rs"],
  saved: initialDemo["src/main.rs"] ?? seed["src/main.rs"],
  modified: "",
};
export default function App() {
  const installedExtensions = useExtensions();
  const extensionHost = useExtensionHost();
  const extensionContainers = useMemo(() => {
    const map = new Map<
      string,
      { id: string; title: string; extension?: string }
    >();
    for (const ext of installedExtensions.filter((e) => e.enabled)) {
      for (const container of Object.values(
        ext.contributes.viewsContainers ?? {},
      ).flat())
        map.set(container.id, { ...container, extension: ext.id });
      for (const id of Object.keys(ext.contributes.views ?? {}))
        if (!["explorer", "scm", "debug", "test"].includes(id) && !map.has(id))
          map.set(id, { id, title: id, extension: ext.id });
    }
    return [...map.values()].filter((container) =>
      installedExtensions.some(
        (ext) =>
          ext.enabled &&
          ext.contributes.views?.[container.id]?.some((view) =>
            matchesContext(view.when, extensionHost.contexts),
          ),
      ),
    );
  }, [installedExtensions, extensionHost.contexts]);
  const [setupOpen, setSetupOpen] = useState(
    () =>
      !readLocal("devyy.setupCompleted", false) &&
      !localStorage.getItem("devyy.settings") &&
      !localStorage.getItem("devvy.settings"),
  );
  function finishSetup() {
    localStorage.setItem("devyy.setupCompleted", "true");
    setSetupOpen(false);
  }
  useEffect(() => {
    void initializeExtensions().catch(notify);
  }, []);
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({}),
    [debugSession, setDebugSession] = useState<DebugSession>({
      running: false,
      path: null,
      line: null,
    });
  const [workspace, setWorkspace] = useState<Workspace>({
    root: "demo",
    name: "playground",
    files: demoEntries(initialDemo),
  });
  const [demo, setDemo] = useState(initialDemo),
    [tabs, setTabs] = useState<Tab[]>([
      initialTab,
      ...["src/lib.rs", "README.md"]
        .filter((path) => initialDemo[path] !== undefined)
        .map((path) => ({
          path,
          content: initialDemo[path],
          saved: initialDemo[path],
          modified: "",
        })),
    ]),
    [active, setActivePath] = useState(initialTab.path);
  const [diffActive, setDiffActive] = useState(false);
  function setActive(path: string) {
    ++diffRequest.current;
    setDiffActive(false);
    setActivePath(path);
  }
  const [markdownModes, setMarkdownModes] = useState<
    Record<string, "source" | "preview" | "split">
  >({});
  const markdownMode = markdownModes[active] ?? "source";
  function setMarkdownMode(
    mode: "source" | "preview" | "split",
    path = active,
  ) {
    setMarkdownModes((old) => ({ ...old, [path]: mode }));
    if (mode === "split") setFileSplits((groups) => separateTab(groups, path));
  }
  const [section, setSection] = useState<Section>("files"),
    [sidebar, setSidebar] = useState(true),
    [panel, setPanel] = useState(true),
    [panelTab, setPanelTab] = useState<"terminal" | "problems" | "output">(
      "terminal",
    );
  const [fileSplits, setFileSplits] = useState<SplitGroup<string>[]>([]);
  const fileSplit = fileSplits.find(
    (group) =>
      group.includes(active) &&
      group.every((path) => tabs.some((tab) => tab.path === path)),
  );
  const markdownSplit =
    !fileSplit && language(active) === "markdown" && markdownMode === "split";
  const split = Boolean(fileSplit || markdownSplit);
  const fileTabGroups = groupedTabs(tabs, (tab) => tab.path, fileSplits);
  const [focus, setFocus] = useState(false),
    [palette, setPalette] = useState<"files" | "commands" | null>(null);
  const [settings, setSettings] = useState<Settings>(() =>
      normalizeSettings(readLocal("devyy.settings", {})),
    ),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsPage, setSettingsPage] = useState<SettingsCategory>("appearance"),
    [help, setHelp] = useState(false);
  const [git, setGit] = useState<GitState | null>(null),
    [gitError, setGitError] = useState(""),
    [commit, setCommit] = useState(""),
    [gitBusy, setGitBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [caseSensitive, setCaseSensitive] = useState(false),
    [matches, setMatches] = useState<SearchMatch[]>([]),
    [searching, setSearching] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]),
    [output, setOutput] = useState<string[]>([
      "devyy is ready. Open a folder to connect your tools.",
    ]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const diffRequest = useRef(0);
  const [cursor, setCursor] = useState({ line: 1, col: 1 }),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [terminalId, setTerminalId] = useState<number | null>(null),
    [runCommand, setRunCommand] = useState("cargo run"),
    [pendingRun, setPendingRun] = useState<string | null>(null);
  const [lspStatus, setLspStatus] = useState<Record<string, string>>({}),
    [recent, setRecent] = useState<string[]>(() =>
      readLocal("devyy.recent", []),
    ),
    [opening, setOpening] = useState(false);
  const views = useRef(new Map<string, EditorView>()),
    currentView = useRef<EditorView | null>(null),
    tabsRef = useRef(tabs),
    wsRef = useRef(workspace),
    activeRef = useRef(active),
    saveQueue = useRef(new Map<string, Promise<boolean>>());
  tabsRef.current = tabs;
  wsRef.current = workspace;
  activeRef.current = active;
  const tab = tabs.find((t) => t.path === active),
    dirty = new Set(
      tabs.filter((t) => t.content !== t.saved).map((t) => t.path),
    );
  const busyRef = useRef(false);
  const terminalGroup = useRef<TerminalsHandle>(null);
  const [terminalToolbar, setTerminalToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const track = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (document.querySelector(".setup-dialog")) return;
      if (!target.closest('[role="dialog"],[role="menu"]'))
        modalReturnFocus.current = target;
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);
  const openMenu = useContextMenu();
  const [sizes, setSizes] = useState(() => {
    const saved = readLocal<Record<string, number>>("devyy.layout", {});
    return {
      sidebar: Number.isFinite(saved.sidebar)
        ? Math.max(160, Math.min(600, saved.sidebar))
        : 236,
      panel: Number.isFinite(saved.panel)
        ? Math.max(120, Math.min(800, saved.panel))
        : 250,
      split: Number.isFinite(saved.split)
        ? Math.max(20, Math.min(80, saved.split))
        : 50,
    };
  });
  const defaultEditorSplitRatio = useRef(sizes.split);
  const [editorSplitRatios, setEditorSplitRatios] = useState<
    Record<string, number>
  >({});
  const editorSplitKey = JSON.stringify(fileSplit ?? [active]);
  const editorSplitRatio =
    editorSplitRatios[editorSplitKey] ?? defaultEditorSplitRatio.current;
  function resizeEditorSplit(value: number) {
    setEditorSplitRatios((ratios) => ({ ...ratios, [editorSplitKey]: value }));
    setSizes((sizes) => ({ ...sizes, split: value }));
  }
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight,
  });
  const [maximizedPanel, setMaximizedPanel] = useState(false);
  const editorsRef = useRef<HTMLDivElement>(null);
  const focusLayout = useRef({ sidebar: true, panel: true });
  const commandRef = useRef<PaletteItem[]>([]);
  const draggedTab = useRef<string | null>(null);
  const uiRef = useRef({ focus, palette, settingsOpen, help, dialog });
  uiRef.current = { focus, palette, settingsOpen, help, dialog };
  const bindings = bindingsWith(settings.bindings);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  function resetLayout() {
    setSizes({ sidebar: 236, panel: 250, split: 50 });
    defaultEditorSplitRatio.current = 50;
    setEditorSplitRatios({});
    setMaximizedPanel(false);
  }
  function toggleFocus() {
    if (focus) {
      setSidebar(focusLayout.current.sidebar);
      setPanel(focusLayout.current.panel);
      setFocus(false);
    } else {
      focusLayout.current = { sidebar, panel };
      setSidebar(false);
      setPanel(false);
      setFocus(true);
    }
  }
  function showSidebar(value: boolean) {
    setSidebar(value);
    if (value) setFocus(false);
  }
  function showPanel(value: boolean) {
    setPanel(value);
    if (value) setFocus(false);
  }
  function toggleSidebar() {
    setFocus(false);
    setSidebar(!sidebar);
  }
  function togglePanel() {
    setFocus(false);
    setPanel(!panel);
  }
  useEffect(() => {
    localStorage.setItem("devyy.layout", JSON.stringify(sizes));
  }, [sizes]);
  useEffect(() => {
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  // Cut the editor out of the one continuous chrome tint so its opacity is truly independent.
  const updateChrome = useCallback(() => {
    const shell = document.querySelector<HTMLElement>(".devyy"),
      surface = document.querySelector<HTMLElement>(".editor-surface");
    if (!shell || !surface) return;
    const a = shell.getBoundingClientRect(),
      b = surface.getBoundingClientRect();
    const l = b.left - a.left,
      t = b.top - a.top,
      r = b.right - a.left,
      d = b.bottom - a.top,
      c = 9;
    shell.style.setProperty(
      "--chrome-clip",
      `path(evenodd, 'M0 0H${a.width}V${a.height}H0Z M${l + c} ${t}H${r - c}Q${r} ${t} ${r} ${t + c}V${d - c}Q${r} ${d} ${r - c} ${d}H${l + c}Q${l} ${d} ${l} ${d - c}V${t + c}Q${l} ${t} ${l + c} ${t}Z')`,
    );
  }, []);
  useLayoutEffect(updateChrome, [
    updateChrome,
    sidebar,
    focus,
    active,
    split,
    settingsOpen,
    tabs.length,
  ]);
  useEffect(() => {
    const observer = new ResizeObserver(updateChrome);
    document
      .querySelectorAll(".devyy,.sidebar,.editor-surface,.settings-modal")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [updateChrome, settingsOpen]);
  function notify(error: unknown, isError = true) {
    const message = String(error).replace(/^Error: /, "");
    if (isError) showToast.error(message);
    else showToast.success(message);
  }
  function log(text: string) {
    setOutput((lines) => [
      ...lines.slice(-199),
      `[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${text}`,
    ]);
  }
  useEffect(() => {
    localStorage.setItem("devyy.settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("devyy.playground", JSON.stringify(demo));
  }, [demo]);
  useEffect(() => {
    if (!palette && !settingsOpen && !help && !dialog && !setupOpen) return;
    const previous =
      modalReturnFocus.current ??
      (document.activeElement as HTMLElement | null);
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector =
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';
    (
      modal?.querySelector<HTMLElement>("input:not(:disabled)") ??
      modal?.querySelector<HTMLElement>(selector)
    )?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !modal) return;
      const items = [...modal.querySelectorAll<HTMLElement>(selector)];
      const first = items[0],
        last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [palette, settingsOpen, help, dialog, setupOpen]);
  useAppearance(settings, notify);
  useEffect(() => {
    if (!settings.followSystemTheme) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      setSettings((s) => ({
        ...s,
        theme: media.matches ? "midnight" : "paper",
      }));
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [settings.followSystemTheme]);
  async function ask(text: string) {
    return native
      ? confirm(text, { title: "devyy", kind: "warning" })
      : window.confirm(text);
  }
  async function refreshGit() {
    if (!native || wsRef.current.root === "demo") return;
    const root = wsRef.current.root;
    try {
      const next = await invoke<GitState>("git_status");
      if (root === wsRef.current.root) {
        setGit(next);
        setGitError("");
      }
    } catch (e) {
      if (root === wsRef.current.root) {
        setGit(null);
        setGitError(String(e));
      }
    }
  }
  async function refresh() {
    if (workspace.root === "demo") return;
    try {
      const root = wsRef.current.root;
      const next = await invoke<Workspace>("refresh_workspace");
      if (root !== wsRef.current.root || next.root !== root) return;
      setWorkspace(next);
      await refreshGit();
    } catch (e) {
      notify(e);
    }
  }
  async function openFolder(path?: string) {
    if (
      debugSession.running &&
      !(await ask("Stop debugging and open another folder?"))
    )
      return;
    if (busyRef.current) return;
    if (!native) {
      notify(
        "Local folders are available in the desktop app. Run npm run desktop to connect your files.",
        false,
      );
      return;
    }
    if (
      dirty.size &&
      !(await ask(
        "You have unsaved changes. Discard them and open another folder?",
      ))
    )
      return;
    const chosen =
      path ??
      (await open({
        directory: true,
        multiple: false,
        title: "Open a project in devyy",
      }));
    if (typeof chosen !== "string") return;
    busyRef.current = true;
    setOpening(true);
    try {
      // Preserve the current project if the chosen directory cannot be opened.
      const next = await invoke<Workspace>("open_workspace", { path: chosen });
      await invoke("lsp_stop");
      await invoke("debug_stop");
      clearLanguageServers();
      setBreakpoints({});
      setDebugSession({ running: false, path: null, line: null });
      setWorkspace(next);
      setMarkdownModes({});
      setFileSplits([]);
      setComparison(null);
      setDiffActive(false);
      ++diffRequest.current;
      setEditorSplitRatios({});
      wsRef.current = next;
      setTabs([]);
      tabsRef.current = [];
      setActive("");
      setGit(null);
      setProblems([]);
      setLspStatus({});
      setMatches([]);
      setPendingRun(null);
      setTerminalId(null);
      setRecent((old) => {
        const list = [chosen, ...old.filter((p) => p !== chosen)].slice(0, 5);
        localStorage.setItem("devyy.recent", JSON.stringify(list));
        return list;
      });
      setRunCommand(
        next.files.some((f) => f.path === "Cargo.toml")
          ? "cargo run"
          : next.files.some((f) => f.path === "package.json")
            ? "npm run dev"
            : "",
      );
      await syncExtensionHost();
      log(`Opened ${next.root}`);
      void refreshGit();
      const first =
        next.files.find((f) =>
          ["src/main.rs", "src/App.tsx", "src/main.ts", "README.md"].includes(
            f.path,
          ),
        ) ?? next.files.find((f) => !f.directory);
      if (first) await openFile(first.path);
    } catch (e) {
      notify(e);
    } finally {
      busyRef.current = false;
      setOpening(false);
    }
  }
  async function openFile(path: string, line?: number) {
    const root = wsRef.current.root;
    try {
      let existing = tabsRef.current.find((t) => t.path === path);
      if (!existing) {
        const doc =
          root === "demo"
            ? { content: demo[path] ?? "", modified: "" }
            : await invoke<{ content: string; modified: string }>("read_file", {
                path,
              });
        if (root !== wsRef.current.root) return;
        existing = {
          path,
          content: doc.content,
          saved: doc.content,
          modified: doc.modified,
        };
        setTabs((old) =>
          old.some((t) => t.path === path) ? old : [...old, existing!],
        );
        tabsRef.current = [...tabsRef.current, existing];
      }
      setActive(path);
      activeRef.current = path;
      if (root !== "demo" && !existing.extensionUri)
        void connectDocument(path, language(path), existing.content)
          .then((connected) => {
            if (connected)
              setLspStatus((s) => ({ ...s, [language(path)]: "Connected" }));
          })
          .catch((e) => {
            setLspStatus((s) => ({ ...s, [language(path)]: String(e) }));
            log(String(e));
          });
      if (line) setTimeout(() => jumpTo(path, line), 40);
    } catch (e) {
      notify(e);
    }
  }
  async function openInSplit(path: string, source = activeRef.current) {
    const root = wsRef.current.root;
    await openFile(path);
    if (
      root !== wsRef.current.root ||
      !tabsRef.current.some((tab) => tab.path === path)
    )
      return;
    const partner =
      source !== path && tabsRef.current.some((tab) => tab.path === source)
        ? source
        : tabsRef.current.find((tab) => tab.path !== path)?.path;
    if (!partner) {
      notify("Open another file to create a split group.", false);
      return;
    }
    setFileSplits((groups) => pairTabs(groups, partner, path));
  }
  function separateEditor(path = active) {
    setFileSplits((groups) => separateTab(groups, path));
    if (markdownModes[path] === "split") setMarkdownMode("source", path);
  }
  useEffect(() => {
    const reconnect = () => {
      setLspStatus({});
      for (const tab of tabsRef.current)
        if (native && wsRef.current.root !== "demo" && !tab.extensionUri) {
          void connectDocument(tab.path, language(tab.path), tab.content)
            .then((connected) => {
              if (connected)
                setLspStatus((s) => ({
                  ...s,
                  [language(tab.path)]: "Connected",
                }));
            })
            .catch((e) =>
              setLspStatus((s) => ({ ...s, [language(tab.path)]: String(e) })),
            );
        }
    };
    window.addEventListener("devyy-language-servers-changed", reconnect);
    window.addEventListener("devyy-extensions-changed", reconnect);
    return () => {
      window.removeEventListener("devyy-language-servers-changed", reconnect);
      window.removeEventListener("devyy-extensions-changed", reconnect);
    };
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      const payload = message.payload;
      if (message.event === "output") log(String(payload.text ?? ""));
      if (message.event === "notification") {
        if (payload.kind === "error") showToast.error(String(payload.message));
        else if (payload.kind === "warning")
          showToast.warning(String(payload.message));
        else showToast.info(String(payload.message));
      }
      if (
        message.event === "documentContent" &&
        typeof payload.uri === "string" &&
        typeof payload.text === "string"
      ) {
        const next = tabsRef.current.map((tab) =>
          tab.extensionUri === payload.uri && tab.readOnly
            ? {
                ...tab,
                content: String(payload.text),
                saved: String(payload.text),
              }
            : tab,
        );
        tabsRef.current = next;
        setTabs(next);
      }
      if (message.event === "diagnostics") {
        const path =
          pathFromUri(String(payload.uri), wsRef.current.root) ??
          tabsRef.current.find((tab) => tab.extensionUri === payload.uri)?.path;
        if (path)
          setProblems((old) => [
            ...old.filter(
              (problem) =>
                !(
                  problem.path === path &&
                  problem.collection === payload.collection
                ),
            ),
            ...(payload.diagnostics as LspDiagnostic[]).map((diagnostic) => ({
              ...diagnostic,
              severity:
                diagnostic.severity === undefined ? 1 : diagnostic.severity + 1,
              path,
              collection: String(payload.collection),
            })),
          ]);
      }
      if (message.event === "hostError")
        log(`Extension host: ${payload.error}`);
      if (message.event === "openFile" && typeof payload.uri === "string") {
        const path = pathFromUri(payload.uri, wsRef.current.root);
        if (path) void openFile(path);
      }
    };
    const reset = () => {
      setProblems((old) => old.filter((problem) => !problem.collection));
      setComparison((document) =>
        document?.source === "extension" ? null : document,
      );
    };
    window.addEventListener("devyy-extension-event", listener);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      window.removeEventListener("devyy-extension-event", listener);
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  const publishExtensionState = useRef(() => {});
  publishExtensionState.current = () => {
    const managedTabs =
      wsRef.current.root === "demo"
        ? tabsRef.current.filter((tab) => tab.extensionUri)
        : tabsRef.current;
    const toUri = (tab: Tab) =>
      tab.extensionUri ??
      fileUri(wsRef.current.root.replace(/[\\/]$/, "") + "/" + tab.path);
    const current = managedTabs.find((tab) => tab.path === activeRef.current);
    const view = views.current.get(activeRef.current);
    const position = (value: number) => {
      const line = view!.state.doc.lineAt(value);
      return { line: line.number - 1, character: value - line.from };
    };
    sendExtensionEditorState({
      documents: managedTabs.map((tab) => {
        const editor = views.current.get(tab.path);
        const visible =
          !diffActive &&
          (fileSplit
            ? fileSplit.includes(tab.path)
            : tab.path === activeRef.current) &&
          markdownModes[tab.path] !== "preview";
        return {
          uri: toUri(tab),
          text: tab.content,
          languageId: tab.languageId ?? language(tab.path),
          isDirty: tab.saved !== tab.content,
          visible,
          viewColumn: fileSplit?.[1] === tab.path ? 2 : 1,
          selections: editor?.state.selection.ranges.map((range) => ({
            anchor: toPosition(editor, range.anchor),
            active: toPosition(editor, range.head),
          })),
          visibleRanges: editor?.visibleRanges.map((range) => ({
            start: toPosition(editor, range.from),
            end: toPosition(editor, range.to),
          })),
        };
      }),
      activeUri:
        current && !diffActive && markdownModes[current.path] !== "preview"
          ? toUri(current)
          : undefined,
      selections: view?.state.selection.ranges.map((range) => ({
        anchor: position(range.anchor),
        active: position(range.head),
      })),
      themeKind: settings.theme === "paper" ? 1 : 2,
      focused: document.hasFocus(),
    });
  };
  useEffect(() => {
    publishExtensionState.current();
  }, [
    tabs,
    active,
    cursor,
    settings.theme,
    fileSplit,
    diffActive,
    markdownModes,
  ]);
  useEffect(() => {
    const update = () => publishExtensionState.current();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("devyy-editor-selection", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("devyy-editor-selection", update);
    };
  }, []);
  async function extensionWorkbenchRequest(request: WorkbenchRequest) {
    const p = request.params;
    const pathFor = (uri: string) =>
      tabsRef.current.find((tab) => tab.extensionUri === uri)?.path ??
      pathFromUri(uri, wsRef.current.root);
    switch (request.method) {
      case "executeBuiltin": {
        const id = String(p.command);
        if (!commandInfo.some(([command]) => command === id))
          throw Error(`Unsupported workbench command: ${id}`);
        await commandRef.current.find((command) => command.id === id)?.run();
        return null;
      }
      case "openSettings":
        setSettingsOpen(true);
        return null;
      case "saveAll":
        return saveAll();
      case "showDocument": {
        const uri = String(p.uri),
          previous = activeRef.current;
        let path = pathFor(uri);
        if (path) await openFile(path);
        else {
          path = uri;
          const data =
            typeof p.text === "string"
              ? {
                  text: p.text,
                  readOnly: !!p.readOnly,
                  languageId: p.languageId as string | undefined,
                }
              : await hostRequest<{
                  text: string;
                  readOnly: boolean;
                  languageId: string;
                }>("readDocument", { uri });
          const tab: Tab = {
            path,
            extensionUri: uri,
            languageId: data.languageId,
            readOnly: data.readOnly,
            content: data.text,
            saved: data.text,
            modified: "",
          };
          if (!tabsRef.current.some((item) => item.path === path)) {
            tabsRef.current = [...tabsRef.current, tab];
            setTabs(tabsRef.current);
          }
          setActive(path);
          activeRef.current = path;
        }
        if (!tabsRef.current.some((tab) => tab.path === path)) return false;
        const options = p.options as
          | {
              preserveFocus?: boolean;
              viewColumn?: number;
              selection?: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
            }
          | undefined;
        if (
          (options?.viewColumn === -2 || options?.viewColumn === 2) &&
          previous &&
          previous !== path &&
          tabsRef.current.some((tab) => tab.path === previous)
        )
          setFileSplits((groups) => pairTabs(groups, previous, path!));
        if (options?.preserveFocus && previous && previous !== path) {
          setActive(previous);
          activeRef.current = previous;
        }
        if (options?.selection) {
          const selection = options.selection;
          setTimeout(() => {
            const view = views.current.get(path!);
            if (view)
              view.dispatch({
                selection: {
                  anchor: offset(view, selection.start),
                  head: offset(view, selection.end),
                },
                effects: EditorView.scrollIntoView(
                  offset(view, selection.start),
                  { y: "center" },
                ),
              });
          }, 40);
        }
        return true;
      }
      case "saveDocument": {
        const path = p.uri ? pathFor(String(p.uri)) : activeRef.current;
        return path ? save(path) : false;
      }
      case "closeDocument": {
        const path = p.uri ? pathFor(String(p.uri)) : activeRef.current;
        return path ? closeTab(path) : false;
      }
      case "closeTabs": {
        for (const uri of p.tabs as string[]) {
          const path = pathFor(uri);
          if (path && !(await closeTab(path))) return false;
        }
        return true;
      }
      case "setSelections": {
        const path = pathFor(String(p.uri)),
          view = path ? views.current.get(path) : undefined;
        if (!view) return false;
        const selections = p.selections as {
          anchor: { line: number; character: number };
          active: { line: number; character: number };
        }[];
        if (!selections.length) return false;
        view.dispatch({
          selection: EditorSelection.create(
            selections.map((selection) =>
              EditorSelection.range(
                offset(view, selection.anchor),
                offset(view, selection.active),
              ),
            ),
          ),
        });
        return true;
      }
      case "revealRange": {
        const path = pathFor(String(p.uri));
        const range = p.range as { start: { line: number; character: number } };
        if (path) jumpTo(path, range.start.line + 1, range.start.character);
        return null;
      }
      case "diff": {
        setComparison({
          source: "extension",
          title: String(p.title ?? "Extension diff"),
          original: (p.original as { text: string }).text,
          modified: (p.modified as { text: string }).text,
        });
        setDiffActive(true);
        return null;
      }
      case "applyEdit": {
        const changes = p.documents as {
          uri: string;
          textBefore?: string;
          edits: {
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
            newText: string;
            newEol?: number;
          }[];
        }[];
        const prepared: { tab: Tab; text: string }[] = [];
        for (const change of changes) {
          let path = pathFor(change.uri);
          if (!path) {
            await extensionWorkbenchRequest({
              ...request,
              method: "showDocument",
              params: { uri: change.uri },
            });
            path = change.uri;
          }
          let tab = tabsRef.current.find((tab) => tab.path === path);
          if (!tab && path) {
            await openFile(path);
            tab = tabsRef.current.find((tab) => tab.path === path);
          }
          if (
            !tab ||
            tab.readOnly ||
            (change.textBefore !== undefined &&
              tab.content !== change.textBefore)
          )
            return false;
          const text = tab.content;
          const offsetAt = (position: { line: number; character: number }) => {
            const lines = text.split("\n");
            if (
              position.line < 0 ||
              position.line >= lines.length ||
              position.character < 0 ||
              position.character >
                lines[position.line].replace(/\r$/, "").length
            )
              throw Error("Extension edit is outside document bounds");
            return (
              lines
                .slice(0, position.line)
                .reduce((n, line) => n + line.length + 1, 0) +
              position.character
            );
          };
          const edits = change.edits
            .filter((e) => e.range)
            .map((e) => ({
              from: offsetAt(e.range.start),
              to: offsetAt(e.range.end),
              text: e.newText,
            }))
            .sort((a, b) => b.from - a.from || b.to - a.to);
          let result = text,
            previous = text.length + 1;
          for (const edit of edits) {
            if (edit.to > previous || edit.to < edit.from)
              throw Error("Extension edits overlap");
            result =
              result.slice(0, edit.from) + edit.text + result.slice(edit.to);
            previous = edit.from;
          }
          const eol = change.edits.find((e) => e.newEol)?.newEol;
          if (eol) result = result.replace(/\r?\n/g, eol === 2 ? "\r\n" : "\n");
          prepared.push({ tab, text: result });
        }
        for (const { tab, text } of prepared) {
          const view = views.current.get(tab.path);
          if (view)
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: text },
            });
          edit(tab.path, text);
        }
        tabsRef.current = tabsRef.current.map((tab) => {
          const change = prepared.find((p) => p.tab.path === tab.path);
          return change ? { ...tab, content: change.text } : tab;
        });
        if (p.files) await hostRequest("fileOperations", { files: p.files });
        publishExtensionState.current();
        return true;
      }
      default:
        throw new Error(
          `Devyy does not yet implement the workbench action ${request.method}`,
        );
    }
  }
  function jumpTo(path: string, line: number, character = 0) {
    const view = views.current.get(path);
    if (!view) return;
    const pos = offset(view, { line: line - 1, character });
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }
  const reviewAISuggestion = useCallback(
    (path: string, original: string, modified: string) => {
      const target = tabsRef.current.find((item) => item.path === path);
      if (!target || target.readOnly) {
        showToast.error(
          "Open the attached file in an editable tab before reviewing a replacement.",
        );
        return;
      }
      setComparison({
        source: "ai",
        title: `AI suggestion: ${filename(path)}`,
        path,
        original,
        modified,
      });
      setDiffActive(true);
    },
    [],
  );
  const edit = useCallback((path: string, content: string) => {
    if (
      wsRef.current.root !== "demo" &&
      !tabsRef.current.find((tab) => tab.path === path)?.extensionUri
    )
      queueDocumentChange(path, content);
    setTabs((old) => old.map((t) => (t.path === path ? { ...t, content } : t)));
  }, []);
  const handleCursor = useCallback(
    (path: string, line: number, col: number) => {
      if (activeRef.current === path)
        setCursor((previous) =>
          previous.line === line && previous.col === col
            ? previous
            : { line, col },
        );
    },
    [],
  );
  const handleView = useCallback((path: string, view: EditorView | null) => {
    if (view) views.current.set(path, view);
    else views.current.delete(path);
    if (view && path === activeRef.current) currentView.current = view;
  }, []);
  const handleDefinition = useCallback(
    () => commandRef.current.find((c) => c.id === "definition")?.run(),
    [],
  );
  const handleBreakpoint = useCallback(
    (path: string, line: number) =>
      setBreakpoints((old) => {
        const lines = old[path] ?? [];
        return {
          ...old,
          [path]: lines.includes(line)
            ? lines.filter((n) => n !== line)
            : [...lines, line].sort((a, b) => a - b),
        };
      }),
    [],
  );
  const diagnosticsByPath = useMemo(() => {
    const map: Record<string, LspDiagnostic[]> = {};
    for (const p of problems) (map[p.path] ??= []).push(p);
    return map;
  }, [problems]);
  useEffect(() => {
    const root = workspace.root;
    const readFile = async (path: string) => {
      if (wsRef.current.root !== root)
        throw new Error("The workspace changed. Attach the file again.");
      const opened = tabsRef.current.find((tab) => tab.path === path);
      const content =
        opened?.content ??
        (root === "demo"
          ? (demo[path] ?? "")
          : (await invoke<{ content: string }>("read_file", { path })).content);
      if (wsRef.current.root !== root)
        throw new Error("The workspace changed. Attach the file again.");
      return {
        kind: "file" as const,
        id: path,
        path,
        title: filename(path),
        content,
      };
    };
    const files = new Map(
      workspace.files
        .filter((f) => !f.directory)
        .map((file) => [file.path, file]),
    );
    for (const tab of tabsRef.current)
      if (!files.has(tab.path))
        files.set(tab.path, {
          path: tab.path,
          name: filename(tab.path),
          directory: false,
        });
    const sources: AIContextSource[] = [...files.values()].map((file) => ({
      kind: "file",
      id: file.path,
      title: file.name,
      description: file.path,
      read: () => readFile(file.path),
    }));
    for (const folder of workspace.files.filter((f) => f.directory))
      sources.push({
        kind: "folder",
        id: folder.path,
        title: folder.name,
        description: folder.path,
        read: async () => {
          const children = workspace.files.filter(
            (file) =>
              !file.directory && file.path.startsWith(folder.path + "/"),
          );
          const snapshots: string[] = [];
          let size = 0;
          for (const child of children.slice(0, 24)) {
            const item = await readFile(child.path);
            const snapshot = boundedContext(item.content, 20 * 1024).content;
            snapshots.push(`File: ${child.path}\n${snapshot}`);
            size += snapshot.length;
            if (size > 140 * 1024) break;
          }
          if (snapshots.length < children.length)
            snapshots.push(
              `[Included ${snapshots.length} of ${children.length} files]`,
            );
          return {
            kind: "folder",
            id: folder.path,
            path: folder.path,
            title: folder.name,
            content: snapshots.join("\n\n"),
          };
        },
      });
    sources.push({
      kind: "selection",
      id: "editor-selection",
      title: "Editor selection",
      description: active,
      read: () => {
        const path = activeRef.current,
          view = views.current.get(path),
          selected =
            view?.state.selection.ranges
              .filter((range) => !range.empty)
              .map((range) => view.state.sliceDoc(range.from, range.to))
              .join("\n\n") ?? "";
        if (!selected) throw new Error("Select text in an editor first.");
        return {
          kind: "selection",
          id: `${path}:${view!.state.selection.main.from}:${view!.state.selection.main.to}`,
          title: `Selection: ${filename(path)}`,
          path,
          content: selected,
        };
      },
    });
    const problemText = (p: Problem) =>
      `${p.path}:${p.range.start.line + 1}:${p.range.start.character + 1} ${["", "error", "warning", "information", "hint"][p.severity ?? 2] ?? "diagnostic"}: ${p.message}`;
    sources.push({
      kind: "problems",
      id: "workspace-problems",
      title: "Problems",
      description: `${problems.length} diagnostics`,
      read: () => ({
        kind: "problems",
        id: "workspace-problems",
        title: "Problems",
        content: problems.length
          ? problems.map(problemText).join("\n")
          : "No diagnostics reported by connected language servers.",
      }),
    });
    for (const [index, problem] of problems.entries())
      sources.push({
        kind: "problem",
        id: `${problem.path}:${index}`,
        title: problem.message,
        description: problem.path,
        read: () => ({
          kind: "problem",
          id: `${problem.path}:${index}`,
          title: `Problem: ${filename(problem.path)}`,
          path: problem.path,
          content: problemText(problem),
        }),
      });
    sources.push({
      kind: "output",
      id: "workbench-output",
      title: "Output",
      read: () => ({
        kind: "output",
        id: "workbench-output",
        title: "Output",
        content: output.join("\n"),
      }),
    });
    if (comparison)
      sources.push({
        kind: "diff",
        id: "current-diff",
        title: comparison.title,
        read: () => ({
          kind: "diff",
          id: "current-diff",
          title: comparison.title,
          path: comparison.path,
          content: `Original:\n${comparison.original}\n\nModified:\n${comparison.modified}`,
        }),
      });
    return registerAIContext("workbench", sources);
  }, [
    workspace.root,
    workspace.files,
    tabs.length,
    active,
    problems,
    output,
    comparison,
  ]);
  async function save(path = activeRef.current): Promise<boolean> {
    const previous = saveQueue.current.get(path);
    const operation = (async () => {
      if (previous) await previous;
      const target = tabsRef.current.find((t) => t.path === path);
      if (!target || target.saved === target.content) return true;
      const root = wsRef.current.root;
      try {
        let modified = target.modified;
        if (target.extensionUri) {
          await hostRequest("saveVirtualDocument", {
            uri: target.extensionUri,
            text: target.content,
          });
        } else if (root === "demo") {
          setDemo((old) => ({ ...old, [path]: target.content }));
        } else {
          modified = await invoke<string>("write_file", {
            path,
            content: target.content,
            expected: target.modified,
          });
          await savedDocument(path, target.content).catch((e) =>
            log(String(e)),
          );
          void hostRequest("documentSaved", {
            uri: fileUri(root.replace(/[\\/]$/, "") + "/" + path),
            text: target.content,
          }).catch(() => {});
        }
        if (root === wsRef.current.root) {
          setTabs((old) =>
            old.map((t) =>
              t.path === path ? { ...t, saved: target.content, modified } : t,
            ),
          );
          tabsRef.current = tabsRef.current.map((t) =>
            t.path === path ? { ...t, saved: target.content, modified } : t,
          );
        }
        void refreshGit();
        return true;
      } catch (e) {
        notify(e);
        return false;
      }
    })();
    saveQueue.current.set(path, operation);
    const result = await operation;
    if (saveQueue.current.get(path) === operation)
      saveQueue.current.delete(path);
    return result;
  }
  async function saveAll() {
    for (const target of tabsRef.current) {
      if (!(await save(target.path))) return false;
    }
    return true;
  }
  async function closeTab(path: string) {
    const target = tabsRef.current.find((t) => t.path === path);
    if (
      target &&
      target.content !== target.saved &&
      !(await ask(`Discard unsaved changes to ${filename(path)}?`))
    )
      return false;
    const remaining = tabsRef.current.filter((t) => t.path !== path);
    setTabs(remaining);
    tabsRef.current = remaining;
    const partner = fileSplits
      .find((group) => group.includes(path))
      ?.find((member) => member !== path);
    setFileSplits((groups) => separateTab(groups, path));
    setMarkdownModes((modes) => {
      const next = { ...modes };
      delete next[path];
      return next;
    });
    if (activeRef.current === path) {
      const next =
        partner && remaining.some((tab) => tab.path === partner)
          ? partner
          : (remaining.at(-1)?.path ?? "");
      setActive(next);
      activeRef.current = next;
    }
    void closeDocument(path).catch(() => {});
    setProblems((old) => old.filter((p) => p.path !== path));
    return true;
  }
  async function newItem(directory: boolean, parent = "") {
    setDialog({
      title: directory ? "New folder" : "New file",
      description:
        "Use a path relative to your project. Parent folders must already exist.",
      initial: parent ? `${parent}/` : "",
      label: directory ? "Create folder" : "Create file",
      submit: async (path) => {
        if (
          !path.trim() ||
          path.startsWith("/") ||
          path
            .split("/")
            .some((part) => part === ".." || part === "." || part === "")
        )
          throw new Error("Enter a valid relative path.");
        const parent = path.split("/").slice(0, -1).join("/");
        if (
          parent &&
          !workspace.files.some((f) => f.directory && f.path === parent)
        )
          throw new Error("The parent folder must already exist.");
        if (workspace.files.some((f) => f.path === path))
          throw new Error("That path already exists.");
        if (workspace.root === "demo") {
          if (directory) {
            setWorkspace((w) => ({
              ...w,
              files: [
                ...w.files,
                { path, name: filename(path), directory: true },
              ],
            }));
          } else {
            setDemo((d) => ({ ...d, [path]: "" }));
            setWorkspace((w) => ({
              ...w,
              files: [
                ...w.files,
                { path, name: filename(path), directory: false },
              ],
            }));
            setTabs((old) => [
              ...old,
              { path, content: "", saved: "", modified: "" },
            ]);
            setActive(path);
          }
        } else {
          await invoke("create_file", { path, directory });
          await refresh();
          if (!directory) await openFile(path);
        }
      },
    });
  }
  function renameItem(path: string) {
    setDialog({
      title: "Rename item",
      description: "Rename or move this item within your project.",
      initial: path,
      label: "Rename",
      submit: async (newPath) => {
        if (
          !newPath.trim() ||
          newPath.startsWith("/") ||
          newPath.split("/").some((s) => !s || s === "." || s === "..")
        )
          throw new Error("Enter a valid relative path.");
        const parent = newPath.split("/").slice(0, -1).join("/");
        if (
          parent &&
          !workspace.files.some((f) => f.directory && f.path === parent)
        )
          throw new Error("The parent folder must already exist.");
        if (newPath.startsWith(path + "/"))
          throw new Error("A folder cannot be moved into itself.");
        if (workspace.files.some((f) => f.path === newPath))
          throw new Error("That path already exists.");
        if (
          tabsRef.current.some(
            (t) =>
              (t.path === path || t.path.startsWith(path + "/")) &&
              t.content !== t.saved,
          )
        )
          throw new Error("Save your changes before renaming.");
        if (workspace.root !== "demo")
          await invoke("rename_file", { path, newPath });
        const replace = (p: string) =>
          p === path
            ? newPath
            : p.startsWith(path + "/")
              ? newPath + p.slice(path.length)
              : p;
        for (const t of tabsRef.current.filter(
          (t) => replace(t.path) !== t.path,
        ))
          await closeDocument(t.path).catch(() => {});
        setTabs((ts) => ts.map((t) => ({ ...t, path: replace(t.path) })));
        setActive(replace(active));
        setFileSplits((groups) =>
          groups.map(([a, b]) => [replace(a), replace(b)]),
        );
        setEditorSplitRatios((ratios) =>
          Object.fromEntries(
            Object.entries(ratios).map(([key, ratio]) => [
              JSON.stringify((JSON.parse(key) as string[]).map(replace)),
              ratio,
            ]),
          ),
        );
        setMarkdownModes((modes) =>
          Object.fromEntries(
            Object.entries(modes).map(([path, mode]) => [replace(path), mode]),
          ),
        );
        setProblems([]);
        if (workspace.root === "demo") {
          setDemo((d) =>
            Object.fromEntries(
              Object.entries(d).map(([p, c]) => [replace(p), c]),
            ),
          );
          setWorkspace((w) => ({
            ...w,
            files: w.files.map((f) => ({
              ...f,
              path: replace(f.path),
              name: filename(replace(f.path)),
            })),
          }));
        } else await refresh();
      },
    });
  }
  async function deleteItem(path: string) {
    if (
      !(await ask(
        `Delete ${path}? This permanently removes the file. Folders must be empty.`,
      ))
    )
      return;
    try {
      if (workspace.root === "demo") {
        if (workspace.files.some((f) => f.path.startsWith(path + "/")))
          throw new Error("The folder must be empty.");
        setDemo((d) => {
          const next = { ...d };
          delete next[path];
          return next;
        });
        setWorkspace((w) => ({
          ...w,
          files: w.files.filter((f) => f.path !== path),
        }));
      } else {
        await invoke("delete_file", { path });
        await refresh();
      }
      const left = tabsRef.current.filter((t) => t.path !== path);
      setTabs(left);
      tabsRef.current = left;
      setFileSplits((groups) => separateTab(groups, path));
      if (active === path) setActive(left.at(-1)?.path ?? "");
      void closeDocument(path).catch(() => {});
    } catch (e) {
      notify(e);
    }
  }
  useEffect(() => {
    if (!settings.autoSave) return;
    const id = setTimeout(() => {
      for (const target of tabsRef.current)
        if (target.content !== target.saved) void save(target.path);
    }, settings.autoSaveDelay);
    return () => clearTimeout(id);
  }, [tabs, settings.autoSave, settings.autoSaveDelay]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<DiagnosticEvent>("lsp-diagnostics", ({ payload }) => {
      const path = pathFromUri(payload.params.uri, wsRef.current.root);
      if (path)
        setProblems((old) => [
          ...old.filter((d) => d.path !== path || d.collection),
          ...payload.params.diagnostics.map((d) => ({ ...d, path })),
        ]);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      const search =
        workspace.root === "demo"
          ? Promise.resolve(
              Object.entries(demo)
                .flatMap(([path, text]) =>
                  text.split("\n").flatMap((line, i) => {
                    const col = (
                      caseSensitive ? line : line.toLowerCase()
                    ).indexOf(caseSensitive ? query : query.toLowerCase());
                    return col < 0
                      ? []
                      : [{ path, line: i + 1, text: line, column: col }];
                  }),
                )
                .slice(0, 500),
            )
          : invoke<SearchMatch[]>("search_workspace", {
              options: { query, case_sensitive: caseSensitive },
            });
      void search
        .then((result) => {
          if (!cancelled) setMatches(result);
        })
        .catch((e) => {
          if (!cancelled) notify(e);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, caseSensitive, workspace.root, demo]);
  useEffect(() => {
    const focusHandler = () => {
      if (wsRef.current.root === "demo") return;
      void refreshGit();
      const path = activeRef.current;
      const current = tabsRef.current.find((t) => t.path === path);
      if (!current || current.content !== current.saved) return;
      void invoke<{ content: string; modified: string }>("read_file", { path })
        .then((doc) =>
          setTabs((old) =>
            old.map((t) =>
              t.path === path && t.content === t.saved
                ? { ...t, ...doc, saved: doc.content }
                : t,
            ),
          ),
        )
        .catch(() => {});
    };
    window.addEventListener("focus", focusHandler);
    return () => window.removeEventListener("focus", focusHandler);
  }, []);
  useEffect(() => {
    let discard = false;
    const before = (e: BeforeUnloadEvent) => {
      if (tabsRef.current.some((t) => t.content !== t.saved)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (native)
      void getCurrentWindow()
        .onCloseRequested(async (e) => {
          if (discard || !tabsRef.current.some((t) => t.content !== t.saved))
            return;
          e.preventDefault();
          if (await ask("Discard unsaved changes and close devyy?")) {
            discard = true;
            await getCurrentWindow().close();
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", before);
      unlisten?.();
    };
  }, []);
  async function definition() {
    const view = currentView.current;
    if (!view || !tab) return;
    try {
      type Location = {
        uri: string;
        range: { start: { line: number; character: number } };
      };
      let result = await languageRequest<Location | Location[]>(
        tab.path,
        "textDocument/definition",
        toPosition(view, view.state.selection.main.head),
      );
      if (!result) {
        type ProviderLocation = {
          uri: string | { external: string };
          range: Location["range"];
        };
        const values = await extensionLanguageFeature<
          ProviderLocation | ProviderLocation[]
        >(
          "provideDefinition",
          tab.path,
          toPosition(view, view.state.selection.main.head),
        );
        result = values.flat().map((value) => ({
          ...value,
          uri: typeof value.uri === "string" ? value.uri : value.uri.external,
        }));
      }
      const target = Array.isArray(result) ? result[0] : result;
      if (!target) {
        notify(
          "No definition found. Check that the language server is connected.",
          false,
        );
        return;
      }
      const path = pathFromUri(target.uri, workspace.root);
      if (!path) {
        notify("This definition is outside the open workspace.", false);
        return;
      }
      await openFile(path);
      setTimeout(
        () =>
          jumpTo(
            path,
            target.range.start.line + 1,
            target.range.start.character,
          ),
        50,
      );
    } catch (e) {
      notify(e);
    }
  }
  async function format() {
    if (!tab) return;
    const view = views.current.get(tab.path);
    if (!view) return;
    try {
      let result = await languageRequest<
        Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          newText: string;
        }>
      >(tab.path, "textDocument/formatting");
      if (!result) {
        const provided = await extensionLanguageFeature<
          NonNullable<typeof result>
        >("provideDocumentFormattingEdits", tab.path, undefined, undefined, {
          tabSize: settings.tabSize,
          insertSpaces: true,
        });
        if (provided.length) result = provided.flat();
      }
      if (!result) {
        notify(
          "Formatting requires a connected language server or an extension formatting provider.",
          false,
        );
        return;
      }
      view.dispatch({
        changes: result.map((edit) => ({
          from: offset(view, edit.range.start),
          to: offset(view, edit.range.end),
          insert: edit.newText,
        })),
      });
      notify("Document formatted.", false);
    } catch (e) {
      notify(e);
    }
  }
  async function run() {
    if (!native || workspace.root === "demo") {
      notify("Open a local project in the desktop app to run commands.", false);
      return;
    }
    if (!runCommand.trim()) {
      setSection("run");
      showSidebar(true);
      notify("Add a command in Run & build first.", false);
      return;
    }
    if (!(await saveAll())) return;
    showPanel(true);
    setPanelTab("terminal");
    terminalGroup.current?.ensure();
    setPendingRun(runCommand);
  }
  useEffect(() => {
    if (terminalId === null || !pendingRun) return;
    const cmd = pendingRun;
    setPendingRun(null);
    void invoke("terminal_write", { id: terminalId, data: cmd + "\r" })
      .then(() => log(`Run: ${cmd}`))
      .catch((e) => notify(e));
  }, [terminalId, pendingRun]);
  async function gitAction(action: () => Promise<unknown>) {
    if (gitBusy) return false;
    setGitBusy(true);
    try {
      await action();
      await refreshGit();
      return true;
    } catch (e) {
      notify(e);
      return false;
    } finally {
      setGitBusy(false);
    }
  }
  async function showDiff(path: string, staged: boolean) {
    const request = ++diffRequest.current,
      root = wsRef.current.root;
    try {
      const document = await invoke<{
        original: string;
        modified: string;
        binary: boolean;
      }>("git_diff_files", { path, staged });
      if (request !== diffRequest.current || root !== wsRef.current.root)
        return;
      setComparison({
        ...document,
        path,
        staged,
        source: "git",
        title: `${filename(path)} (${staged ? "Staged" : "Working tree"})`,
      });
      setDiffActive(true);
    } catch (e) {
      if (request === diffRequest.current) notify(e);
    }
  }
  async function reloadBuffers() {
    const root = wsRef.current.root;
    for (const tab of [...tabsRef.current]) {
      if (tab.extensionUri || tab.content !== tab.saved) continue;
      try {
        const file = await invoke<{ content: string; modified: string }>(
          "read_file",
          { path: tab.path },
        );
        if (root !== wsRef.current.root) return;
        setTabs((tabs) =>
          tabs.map((item) =>
            item.path === tab.path && item.content === item.saved
              ? {
                  ...item,
                  content: file.content,
                  saved: file.content,
                  modified: file.modified,
                }
              : item,
          ),
        );
        queueDocumentChange(tab.path, file.content);
      } catch {
        /* A file deleted by a branch switch remains available in its open buffer. */
      }
    }
    await refresh();
  }
  async function discardGitFile(path: string) {
    if (
      !(await ask(
        `Discard working changes to ${path}? This also discards unsaved edits to this file. Staged changes are kept.`,
      ))
    )
      return;
    if (await gitAction(() => invoke("git_discard", { path }))) {
      const file = await invoke<{ content: string; modified: string }>(
        "read_file",
        { path },
      ).catch(() => null);
      if (file) {
        setTabs((tabs) =>
          tabs.map((tab) =>
            tab.path === path
              ? {
                  ...tab,
                  content: file.content,
                  saved: file.content,
                  modified: file.modified,
                }
              : tab,
          ),
        );
        queueDocumentChange(path, file.content);
      }
      await refresh();
      if (comparison?.path === path) await showDiff(path, !!comparison.staged);
    }
  }
  async function switchGitBranch(branch: string, create = false) {
    if (tabsRef.current.some((tab) => tab.content !== tab.saved)) {
      notify("Save or close your unsaved files before switching branches.");
      return;
    }
    if (
      await gitAction(() => invoke("git_switch_branch", { branch, create }))
    ) {
      setComparison(null);
      setDiffActive(false);
      await reloadBuffers();
    }
  }
  async function stageGitFile(path: string, staged: boolean) {
    if (await gitAction(() => invoke("git_stage", { path, staged }))) {
      if (comparison?.source === "git" && comparison.path === path)
        await showDiff(path, !staged);
    }
  }
  function activateSection(next: Section) {
    if (section === next && sidebar) setSidebar(false);
    else {
      setSection(next);
      showSidebar(true);
    }
    if (next === "git") void refreshGit();
  }
  async function closeMany(paths: string[]) {
    for (const path of paths) if (!(await closeTab(path))) break;
  }
  function cycleTab(delta: number) {
    const order = fileTabGroups.flat();
    if (!order.length) return;
    const i = order.findIndex((tab) => tab.path === activeRef.current);
    const next =
      (diffActive
        ? delta > 0
          ? order[0]
          : order.at(-1)
        : order[(i + delta + order.length) % order.length]
      )?.path ?? "";
    activeRef.current = next;
    setActive(next);
  }
  function terminalAction(action: keyof TerminalsHandle, delta?: number) {
    showPanel(true);
    setPanelTab("terminal");
    requestAnimationFrame(() => {
      const group = terminalGroup.current;
      if (!group) return;
      if (action === "next") group.next(delta ?? 1);
      else group[action]();
    });
  }
  function activeEditorView() {
    if (!diffActive) return currentView.current;
    const element =
      document.querySelector<HTMLElement>(
        ".comparison-workspace .cm-merge-b",
      ) ??
      document.querySelector<HTMLElement>(".comparison-workspace .cm-editor");
    return element ? EditorView.findFromDOM(element) : null;
  }
  const commandActions: Record<CommandId, () => void> = {
    files: () => setPalette("files"),
    "quick-open": () => setPalette("files"),
    commands: () => setPalette("commands"),
    open: () => void openFolder(),
    new: () => void newItem(false),
    save: () => {
      if (!diffActive) void save();
    },
    "save-all": () => void saveAll(),
    close: () => {
      if (diffActive && comparison) {
        setComparison(null);
        setDiffActive(false);
      } else void closeTab(activeRef.current);
    },
    "close-all": () => {
      setComparison(null);
      setDiffActive(false);
      void closeMany(tabsRef.current.map((t) => t.path));
    },
    "next-tab": () => cycleTab(1),
    "previous-tab": () => cycleTab(-1),
    format: () => {
      if (!diffActive) void format();
    },
    definition: () => {
      if (!diffActive) void definition();
    },
    find: () => {
      const view = activeEditorView();
      if (view) {
        view.focus();
        openSearchPanel(view);
      }
    },
    global: () => {
      setSection("search");
      showSidebar(true);
      setTimeout(
        () => document.getElementById("workspace-search")?.focus(),
        50,
      );
    },
    split: () => {
      if (split) separateEditor();
      else if (language(active) === "markdown") setMarkdownMode("split");
      else void openInSplit(active);
    },
    "markdown-preview": () => {
      if (language(active) === "markdown")
        setMarkdownMode(markdownMode === "preview" ? "source" : "preview");
      else notify("Open a Markdown file to preview it.", false);
    },
    "markdown-preview-beside": () => {
      if (language(active) === "markdown") setMarkdownMode("split");
      else notify("Open a Markdown file to preview it.", false);
    },
    sidebar: toggleSidebar,
    terminal: togglePanel,
    focus: toggleFocus,
    "focus-editor": () => activeEditorView()?.focus(),
    "focus-terminal": () => terminalAction("focus"),
    "new-terminal": () => terminalAction("create"),
    "split-terminal": () => terminalAction("split"),
    "next-terminal": () => terminalAction("next", 1),
    "previous-terminal": () => terminalAction("next", -1),
    "close-terminal": () => terminalAction("close"),
    "clear-terminal": () => terminalAction("clear"),
    "rename-terminal": () => terminalAction("rename"),
    "maximize-panel": () => {
      showPanel(true);
      setMaximizedPanel((v) => !v);
    },
    "reset-layout": resetLayout,
    run: () => void run(),
    undo: () => {
      if (document.activeElement?.matches("input,textarea"))
        document.execCommand("undo");
      else {
        const view = activeEditorView();
        if (view) undo(view);
      }
    },
    redo: () => {
      if (document.activeElement?.matches("input,textarea"))
        document.execCommand("redo");
      else {
        const view = activeEditorView();
        if (view) redo(view);
      }
    },
    goto: () =>
      setDialog({
        title: "Go to line",
        description: "Enter a line number in the current file.",
        initial: String(cursor.line),
        label: "Go to line",
        submit: async (value) => {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1)
            throw new Error("Enter a positive line number.");
          const view = activeEditorView();
          if (view) {
            const line = view.state.doc.line(Math.min(n, view.state.doc.lines));
            view.dispatch({
              selection: { anchor: line.from },
              effects: EditorView.scrollIntoView(line.from, { y: "center" }),
            });
            view.focus();
          }
        },
      }),
    ai: () => window.dispatchEvent(new CustomEvent("devyy-ai-open")),
    "ai-settings": () => {
      setSettingsPage("ai");
      setSettingsOpen(true);
    },
    settings: () => setSettingsOpen(true),
    setup: () => {
      setSettingsOpen(false);
      setSetupOpen(true);
    },
    extensions: () => {
      setSettingsPage("extensions");
      setSettingsOpen(true);
    },
    about: () => {
      setSettingsPage("about");
      setSettingsOpen(true);
    },
    theme: () =>
      setSettings((s) => ({
        ...s,
        theme: s.theme === "paper" ? "midnight" : "paper",
        followSystemTheme: false,
      })),
    wrap: () => setSettings((s) => ({ ...s, wordWrap: !s.wordWrap })),
    help: () => setHelp(true),
  };
  const commands: PaletteItem[] = commandInfo.map(([id, label, detail]) => ({
    id,
    label,
    detail,
    shortcut: displayBinding(bindings[id]),
    run: commandActions[id],
  }));
  for (const extension of installedExtensions.filter((e) => e.enabled))
    for (const item of extension.contributes.commands ?? [])
      commands.push({
        id: item.command,
        label: item.category ? `${item.category}: ${item.title}` : item.title,
        detail: extension.name,
        run: () => {
          void extensionCommand(item.command).catch(notify);
        },
      });
  commandRef.current = commands;
  const shortcutData = useRef({
    installedExtensions,
    contexts: extensionHost.contexts,
    active,
    root: workspace.root,
    overrides: settings.bindings,
  });
  shortcutData.current = {
    installedExtensions,
    contexts: extensionHost.contexts,
    active,
    root: workspace.root,
    overrides: settings.bindings,
  };
  const [keyChord, setKeyChord] = useState("");
  useEffect(() => {
    let chord = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    const cancelChord = () => {
      chord = "";
      setKeyChord("");
      clearTimeout(timer);
    };
    const targetElement = (target: EventTarget | null) =>
      target instanceof Element
        ? target
        : (document.activeElement ?? document.body);
    const runApp = (id: string, target: Element, fromMenu = false) => {
      const ui = uiRef.current;
      if (
        target.closest("[data-shortcut-recorder], .terminal-session input") ||
        document.querySelector(".setup-dialog,.extension-prompt")
      )
        return false;
      if (ui.dialog || ui.help) return false;
      if (ui.palette && !["files", "quick-open", "commands"].includes(id))
        return false;
      if (
        !fromMenu &&
        ["undo", "redo"].includes(id) &&
        !target.closest(".code-editor,.diff-editor")
      )
        return false;
      if (
        target.closest(".terminal-content") &&
        ["find", "undo", "redo", "save", "new", "close"].includes(id)
      )
        return false;
      const command = commandRef.current.find((command) => command.id === id);
      if (!command) return false;
      if (ui.settingsOpen && id !== "settings") setSettingsOpen(false);
      if (ui.settingsOpen && id === "settings") setSettingsOpen(false);
      else command.run();
      return true;
    };
    const dispatchBinding = (binding: string, target: Element) => {
      const ui = uiRef.current;
      if (
        !binding ||
        ui.dialog ||
        ui.help ||
        target.closest(
          "[data-shortcut-recorder], .terminal-session input, .extension-prompt",
        )
      )
        return false;
      const appId = (Object.keys(bindingsRef.current) as CommandId[]).find(
        (id) => bindingsRef.current[id] === binding,
      );
      const data = shortcutData.current;
      if (
        !chord &&
        appId &&
        (data.overrides[appId] || ui.settingsOpen || ui.palette) &&
        runApp(appId, target)
      )
        return true;
      if (ui.settingsOpen || ui.palette) {
        cancelChord();
        return false;
      }
      const context = {
        ...data.contexts,
        isMac,
        isWindows: /Win/.test(navigator.platform),
        isLinux: /Linux/.test(navigator.platform),
        editorTextFocus: !!target.closest(".code-editor"),
        editorFocus: !!target.closest(".editors"),
        textInputFocus: !!target.closest(
          'input,textarea,[contenteditable="true"]',
        ),
        terminalFocus: !!target.closest(".terminal-content"),
        resourceLangId: language(data.active),
        editorLangId: language(data.active),
        resourceFilename: filename(data.active),
        workspaceFolderCount: data.root === "demo" ? 0 : 1,
      };
      const candidates = data.installedExtensions
        .filter((extension) => extension.enabled)
        .flatMap((extension) =>
          (extension.contributes.keybindings ?? []).map((item) => ({
            ...item,
            enablement: extension.contributes.commands?.find(
              (command) => command.command === item.command,
            )?.enablement,
            key: contributedBinding(
              (isMac
                ? item.mac
                : /Win/.test(navigator.platform)
                  ? item.win
                  : item.linux) ?? item.key,
            ),
          })),
        )
        .filter(
          (item) =>
            item.key &&
            matchesContext(item.when, context) &&
            matchesContext(item.enablement, context),
        )
        .reverse();
      const sequence = chord ? `${chord} ${binding}` : binding;
      const match = candidates.find((item) => item.key === sequence);
      if (match) {
        cancelChord();
        void extensionCommand(
          match.command,
          match.args === undefined ? [] : [match.args],
        ).catch(notify);
        return true;
      }
      if (candidates.some((item) => item.key?.startsWith(sequence + " "))) {
        chord = sequence;
        setKeyChord(sequence);
        clearTimeout(timer);
        timer = setTimeout(cancelChord, 4000);
        return true;
      }
      const pending = !!chord;
      cancelChord();
      if (!pending && appId) return runApp(appId, target);
      return pending;
    };
    const handler = (e: KeyboardEvent) => {
      const target = targetElement(e.target);
      if (
        e.isComposing ||
        target.closest("[data-shortcut-recorder], .terminal-session input")
      )
        return;
      const ui = uiRef.current;
      if (e.key === "Escape") {
        if (chord) {
          cancelChord();
          e.preventDefault();
          return;
        }
        if (document.querySelector('[role="menu"]')) return;
        if (ui.palette || ui.settingsOpen || ui.help || ui.dialog) {
          setPalette(null);
          setSettingsOpen(false);
          setHelp(false);
          setDialog(null);
          e.preventDefault();
          return;
        }
        if (ui.focus) commandRef.current.find((c) => c.id === "focus")?.run();
        return;
      }
      if (dispatchBinding(eventBinding(e), target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const nativeCommand = (event: Event) =>
      runApp(
        String((event as CustomEvent).detail),
        targetElement(document.activeElement),
        true,
      );
    const webviewShortcut = (event: Event) =>
      dispatchBinding(
        String((event as CustomEvent).detail),
        targetElement(document.activeElement),
      );
    window.addEventListener("keydown", handler, true);
    window.addEventListener("devyy-native-command", nativeCommand);
    window.addEventListener("devyy-webview-shortcut", webviewShortcut);
    return () => {
      cancelChord();
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("devyy-native-command", nativeCommand);
      window.removeEventListener("devyy-webview-shortcut", webviewShortcut);
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    const prefixes = new Set(
      installedExtensions
        .filter((extension) => extension.enabled)
        .flatMap((extension) =>
          (extension.contributes.keybindings ?? []).map(
            (item) =>
              contributedBinding(
                (isMac
                  ? item.mac
                  : /Win/.test(navigator.platform)
                    ? item.win
                    : item.linux) ?? item.key,
              )?.split(" ")[0],
          ),
        ),
    );
    const menuBindings = Object.fromEntries(
      Object.entries(bindings).map(([id, binding]) => [
        id,
        settingsOpen || (prefixes.has(binding) && !settings.bindings[id])
          ? ""
          : binding,
      ]),
    );
    void invoke("set_menu_shortcuts", { bindings: menuBindings }).catch((e) =>
      log(`Menu shortcuts: ${String(e)}`),
    );
  }, [settings.bindings, settingsOpen, installedExtensions]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    if (native)
      void listen<string>("devyy-command", ({ payload }) =>
        window.dispatchEvent(
          new CustomEvent("devyy-native-command", { detail: payload }),
        ),
      ).then((fn) => {
        if (disposed) fn();
        else stop = fn;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  function menuCommand(id: CommandId, extra: Partial<MenuItem> = {}): MenuItem {
    return {
      label: commandInfo.find((c) => c[0] === id)![1],
      shortcut: displayBinding(bindings[id]),
      action: commandActions[id],
      ...extra,
    };
  }
  function copyPath(path: string, absolute = false) {
    void navigator.clipboard
      .writeText(
        absolute && workspace.root !== "demo"
          ? `${workspace.root}/${path}`
          : path,
      )
      .then(() => notify("Path copied.", false))
      .catch(notify);
  }
  function fileMenu(e: React.MouseEvent, path: string) {
    const directory = workspace.files.find((f) => f.path === path)?.directory;
    openMenu(e, [
      ...(directory
        ? []
        : [
            { label: "Open file", action: () => void openFile(path) },
            {
              label: "Open in split editor",
              action: () => void openInSplit(path),
            },
          ]),
      {
        label: "New file",
        separator: !directory,
        action: () =>
          void newItem(
            false,
            directory ? path : path.split("/").slice(0, -1).join("/"),
          ),
      },
      {
        label: "New folder",
        action: () =>
          void newItem(
            true,
            directory ? path : path.split("/").slice(0, -1).join("/"),
          ),
      },
      {
        label: "Copy relative path",
        separator: true,
        action: () => copyPath(path),
      },
      { label: "Copy absolute path", action: () => copyPath(path, true) },
      { label: "Rename", separator: true, action: () => renameItem(path) },
      {
        label: directory ? "Delete empty folder" : "Delete",
        danger: true,
        action: () => void deleteItem(path),
      },
    ]);
  }
  function tabMenu(e: React.MouseEvent, path: string) {
    const order = fileTabGroups.flat();
    const i = order.findIndex((t) => t.path === path);
    openMenu(e, [
      {
        label: "Save file",
        shortcut: displayBinding(bindings.save),
        action: () => void save(path),
      },
      {
        label: active !== path ? "Open in split editor" : "Split editor",
        action: () => {
          if (active !== path) void openInSplit(path);
          else if (language(path) === "markdown")
            setMarkdownMode("split", path);
          else void openInSplit(path);
        },
      },
      ...(fileSplits.some((group) => group.includes(path))
        ? [
            {
              label: "Separate split group",
              action: () => separateEditor(path),
            },
          ]
        : []),
      {
        label: "Close split group",
        disabled: !fileSplits.some((group) => group.includes(path)),
        action: () =>
          void closeMany([
            ...(fileSplits.find((group) => group.includes(path)) ?? []),
          ]),
      },
      ...(language(path) === "markdown"
        ? [
            {
              label: "Open Markdown preview",
              action: () => {
                setActive(path);
                setMarkdownMode("preview", path);
              },
            },
            {
              label: "Open preview to the side",
              action: () => {
                setActive(path);
                setMarkdownMode("split", path);
              },
            },
          ]
        : []),
      { label: "Copy path", action: () => copyPath(path) },
      {
        label: "Close tab",
        separator: true,
        shortcut: displayBinding(bindings.close),
        action: () => void closeTab(path),
      },
      {
        label: "Close other tabs",
        disabled: tabs.length < 2,
        action: () =>
          void closeMany(
            tabs.filter((t) => t.path !== path).map((t) => t.path),
          ),
      },
      {
        label: "Close tabs to the right",
        disabled: i === order.length - 1,
        action: () => void closeMany(order.slice(i + 1).map((t) => t.path)),
      },
      menuCommand("close-all"),
    ]);
  }
  function editorMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".markdown-preview")) {
      openMenu(e, [
        { label: "Edit Markdown", action: () => setMarkdownMode("source") },
        {
          label: "Open preview to the side",
          action: () => setMarkdownMode("split"),
        },
        {
          label: "Copy selection",
          separator: true,
          disabled: !window.getSelection()?.toString(),
          action: () =>
            void navigator.clipboard
              .writeText(window.getSelection()?.toString() ?? "")
              .catch(notify),
        },
        {
          label: "Copy Markdown",
          action: () =>
            void navigator.clipboard
              .writeText(tab?.content ?? "")
              .catch(notify),
        },
      ]);
      return;
    }
    const view = currentView.current;
    if (!view) return;
    const selection = view.state.selection.main;
    openMenu(e, [
      menuCommand("undo"),
      menuCommand("redo"),
      {
        label: "Cut",
        separator: true,
        disabled: selection.empty,
        action: () => {
          const text = view.state.sliceDoc(selection.from, selection.to);
          void navigator.clipboard
            .writeText(text)
            .then(() =>
              view.dispatch({
                changes: { from: selection.from, to: selection.to, insert: "" },
              }),
            )
            .catch(notify);
        },
      },
      {
        label: "Copy",
        disabled: selection.empty,
        action: () =>
          void navigator.clipboard
            .writeText(view.state.sliceDoc(selection.from, selection.to))
            .catch(notify),
      },
      {
        label: "Paste",
        action: () =>
          void navigator.clipboard
            .readText()
            .then((text) => view.dispatch(view.state.replaceSelection(text)))
            .catch(notify),
      },
      {
        label: "Select all",
        action: () =>
          view.dispatch({
            selection: { anchor: 0, head: view.state.doc.length },
          }),
      },
      menuCommand("find", { separator: true }),
      menuCommand("definition"),
      menuCommand("format"),
      menuCommand("wrap"),
    ]);
  }
  const railItems = [
    { id: "files" as const, icon: Files, label: "Explorer" },
    { id: "search" as const, icon: Search, label: "Search" },
    { id: "git" as const, icon: GitBranch, label: "Source control" },
    { id: "run" as const, icon: Play, label: "Run & build" },
    {
      id: "tools" as const,
      icon: PanelsTopLeft,
      label: "Extensions & languages",
    },
  ];
  const openPreviewLink = useCallback(
    (path: string, line?: number) => {
      void openFile(path, line);
    },
    [workspace.root, demo],
  );
  function renderFileTab(t: Tab, pane?: number) {
    return (
      <div
        className={`tab ${!diffActive && active === t.path ? "active" : ""} ${pane || (markdownModes[t.path] === "split" && language(t.path) === "markdown") ? "is-split" : ""}`}
        key={t.path}
        draggable
        onDragStart={(e) => {
          draggedTab.current = t.path;
          writeAIContextDrag(e.dataTransfer, [{ kind: "file", id: t.path }]);
          e.dataTransfer.setData("text/plain", t.path);
        }}
        onDragEnd={() => {
          draggedTab.current = null;
        }}
        onDragOver={(e) => {
          if (draggedTab.current) e.preventDefault();
        }}
        onDrop={(e) => {
          const path = draggedTab.current;
          if (!path || path === t.path) return;
          e.preventDefault();
          setTabs((old) =>
            moveTabGroup(old, (tab) => tab.path, fileSplits, path, t.path),
          );
          draggedTab.current = null;
        }}
        onContextMenu={(e) => tabMenu(e, t.path)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            void closeTab(t.path);
          }
        }}
      >
        <button
          role="tab"
          aria-selected={!diffActive && active === t.path}
          aria-label={filename(t.path)}
          aria-description={
            pane ? `Pane ${pane} of split file group` : undefined
          }
          tabIndex={active === t.path ? 0 : -1}
          onKeyDown={(event) => {
            const order = fileTabGroups.flat();
            const index = order.findIndex((tab) => tab.path === t.path);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? order.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % order.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + order.length) % order.length
                      : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            const next = order[nextIndex];
            setActive(next.path);
            activeRef.current = next.path;
            const buttons = event.currentTarget
              .closest(".tabs")
              ?.querySelectorAll<HTMLButtonElement>("[role=tab]");
            buttons?.[order.indexOf(next)]?.focus();
          }}
          onClick={() => {
            setActive(t.path);
            activeRef.current = t.path;
          }}
          title={t.path}
        >
          {pane && (
            <span className="pane-number" aria-hidden="true">
              {pane}
            </span>
          )}
          <FileIcon path={t.path} size={14} />
          <span className="tab-label">{filename(t.path)}</span>
          {!pane &&
            markdownModes[t.path] === "split" &&
            language(t.path) === "markdown" && (
              <span
                className="split-tab-indicator"
                title="Source and Markdown preview"
                aria-hidden="true"
              >
                <Columns2 size={12} />
                <span>1 / 2</span>
              </span>
            )}
          {t.content !== t.saved && <span className="dirty-dot" />}
        </button>
        <button
          className="tab-close"
          title={`Close ${filename(t.path)}`}
          aria-label={`Close ${filename(t.path)}`}
          onClick={() => void closeTab(t.path)}
        >
          <X size={12} />
        </button>
      </div>
    );
  }
  function renderEditor(t: Tab) {
    const index = fileSplit
      ? fileSplit.indexOf(t.path)
      : t.path === active
        ? 0
        : -1;
    const visible = index >= 0;
    const preview =
      language(t.path) === "markdown" && markdownModes[t.path] === "preview";
    return (
      <div
        key={t.path}
        data-path={t.path}
        className={`editor-stack editor-document ${visible ? "visible" : ""}`}
        style={{
          order: index === 1 ? 2 : 0,
          ...(split && visible
            ? {
                width:
                  index === 1
                    ? "calc(100% - var(--split-ratio))"
                    : "var(--split-ratio)",
                flex: "none",
              }
            : {}),
        }}
        onFocusCapture={() => {
          if (!visible) return;
          setActive(t.path);
          activeRef.current = t.path;
          currentView.current = views.current.get(t.path) ?? null;
        }}
        onContextMenu={editorMenu}
      >
        {split && visible && (
          <div className="editor-pane-heading">
            <span className="pane-number">{index + 1}</span>
            <FileIcon path={t.path} size={12} />
            <span>{filename(t.path)}</span>
            <small>{preview ? "Preview" : "Editor"}</small>
          </div>
        )}
        <div className="editor-source" hidden={preview}>
          <Editor
            path={t.path}
            value={t.content}
            readOnly={t.readOnly}
            languageId={t.languageId}
            settings={settings}
            diagnostics={diagnosticsByPath[t.path] ?? emptyDiagnostics}
            onChange={edit}
            onCursor={handleCursor}
            onView={handleView}
            onDefinition={handleDefinition}
            breakpoints={breakpoints[t.path] ?? emptyLines}
            onBreakpoint={handleBreakpoint}
          />
        </div>
        {preview && renderMarkdownPreview(t)}
      </div>
    );
  }
  function renderMarkdownPreview(t: Tab) {
    return (
      <Suspense
        fallback={<div className="preview-loading">Loading preview…</div>}
      >
        <MarkdownPreview
          path={t.path}
          root={workspace.root}
          content={t.content}
          onOpen={openPreviewLink}
        />
      </Suspense>
    );
  }
  useEffect(() => {
    currentView.current = views.current.get(active) ?? null;
    document
      .querySelector<HTMLElement>('.tabs [role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const errors = problems.filter((p) => p.severity === 1).length,
    warnings = problems.filter((p) => p.severity === 2).length;
  return (
    <div
      className={`devyy ${focus ? "focus-mode" : ""} ${maximizedPanel && panel ? "panel-maximized" : ""} ${settingsOpen ? "settings-open" : ""}`}
    >
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <span className="window-space" />
          <button
            className="titlebar-app"
            onClick={() => setActive("")}
            aria-label="devyy home"
          >
            <Asterisk size={19} strokeWidth={2.2} />
            <span>devyy</span>
          </button>
          <span className="title-divider" />
          <button className="project-title" onClick={() => void openFolder()}>
            <ProjectBadge name={workspace.name} logo={workspace.logo} />
            {workspace.name}
            <ChevronsUpDown size={12} />
          </button>
        </div>
        <button
          className="quick-search"
          onClick={() => setPalette("files")}
          aria-label="Search files"
        >
          <Search size={14} />
          <span>Search files and commands</span>
          <kbd>{displayBinding(bindings.files)}</kbd>
        </button>
        <div className="window-controls">
          <button
            className="header-branch"
            title="Source control"
            onClick={() => {
              setSection("git");
              showSidebar(true);
              void refreshGit();
            }}
          >
            <GitBranch size={13} />
            <span>{git?.branch ?? "local"}</span>
          </button>
          <span className="title-divider" />
          <button
            aria-label="Toggle sidebar"
            aria-pressed={sidebar}
            title={`Toggle sidebar (${mod} B)`}
            onClick={toggleSidebar}
          >
            <PanelLeft size={16} />
          </button>
          <button
            aria-label="Toggle bottom panel"
            aria-pressed={panel}
            title={`Toggle panel (${mod} J)`}
            onClick={togglePanel}
          >
            <PanelBottom size={16} />
          </button>
          <button
            className="header-layout-button"
            aria-label="Workspace layout"
            title="Workspace layout"
            onClick={(e) => {
              openMenu(e, [
                {
                  label: "Sidebar only",
                  checked: sidebar && !panel,
                  action: () => {
                    setFocus(false);
                    setSidebar(true);
                    setPanel(false);
                  },
                },
                {
                  label: "Terminal only",
                  checked: !sidebar && panel,
                  action: () => {
                    setFocus(false);
                    setSidebar(false);
                    setPanel(true);
                    setPanelTab("terminal");
                  },
                },
                {
                  label: "Sidebar and terminal",
                  checked: sidebar && panel,
                  action: () => {
                    setFocus(false);
                    setSidebar(true);
                    setPanel(true);
                  },
                },
                {
                  label: "Editor only",
                  checked: !sidebar && !panel,
                  action: () => {
                    setSidebar(false);
                    setPanel(false);
                  },
                },
                menuCommand("focus", { separator: true }),
                menuCommand("reset-layout"),
                menuCommand("new-terminal", { separator: true }),
                menuCommand("settings"),
              ]);
            }}
          >
            <PanelsTopLeft size={16} />
          </button>
          <button
            aria-label="Toggle vibrancy"
            aria-pressed={settings.vibrancy}
            title="Toggle window vibrancy"
            onClick={() =>
              setSettings((s) => ({ ...s, vibrancy: !s.vibrancy }))
            }
          >
            <Blend size={16} />
          </button>
        </div>
      </header>
      <div className="app-body">
        <nav className="activity-bar" aria-label="Main navigation">
          <div className="activity-main">
            {railItems.map((item) => (
              <button
                key={item.id}
                className={section === item.id && sidebar ? "active" : ""}
                title={item.label}
                aria-label={item.label}
                aria-pressed={section === item.id && sidebar}
                onClick={() => activateSection(item.id)}
              >
                <item.icon size={21} strokeWidth={1.65} />
                {item.id === "git" && !!git?.changes.length && (
                  <span className="rail-badge">{git.changes.length}</span>
                )}
              </button>
            ))}
            {extensionContainers.map((container) => (
              <button
                key={container.id}
                title={container.title}
                aria-label={container.title}
                className={
                  section === `extension:${container.id}` && sidebar
                    ? "active"
                    : ""
                }
                aria-pressed={
                  section === `extension:${container.id}` && sidebar
                }
                onClick={() => {
                  if (container.extension && isAIExtension(container.extension))
                    window.dispatchEvent(
                      new CustomEvent("devyy-ai-open", {
                        detail: { container: container.id },
                      }),
                    );
                  else activateSection(`extension:${container.id}`);
                }}
              >
                {container.extension && isAIExtension(container.extension) ? (
                  <AIProviderIcon
                    kind={
                      container.extension === "openai.chatgpt"
                        ? "codex"
                        : "claude"
                    }
                    size={20}
                  />
                ) : (
                  <PanelsTopLeft size={20} />
                )}
              </button>
            ))}
          </div>
          <div className="activity-bottom">
            <button
              title="AI assistant"
              aria-label="Open AI assistant"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("devyy-ai-open"))
              }
            >
              <Sparkles size={20} />
            </button>
            <button
              title="Keyboard shortcuts & help"
              aria-label="Help"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={20} />
            </button>
            <button
              title="Preferences"
              aria-label="Preferences"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={20} />
            </button>
          </div>
        </nav>
        <aside
          className={`sidebar ${!sidebar ? "sidebar-hidden" : ""}`}
          style={{
            width: sidebar
              ? Math.min(sizes.sidebar, Math.max(160, viewport.width - 470))
              : 0,
          }}
        >
          {sidebar && (
            <ResizeHandle
              label="Resize sidebar"
              value={Math.min(
                sizes.sidebar,
                Math.max(160, viewport.width - 470),
              )}
              min={160}
              max={Math.min(600, viewport.width - 470)}
              onChange={(value) => setSizes((s) => ({ ...s, sidebar: value }))}
              onReset={() => setSizes((s) => ({ ...s, sidebar: 236 }))}
            />
          )}
          <div className="sidebar-heading">
            <h1>
              {(
                {
                  files: "Project",
                  search: "Search",
                  git: "Source control",
                  run: "Run & build",
                  tools: "Extensions & languages",
                } as Record<string, string>
              )[section] ??
                extensionContainers.find((c) => `extension:${c.id}` === section)
                  ?.title ??
                "Extensions"}
            </h1>
            <button
              className="icon-button"
              title="All commands"
              aria-label="All commands"
              onClick={() => setPalette("commands")}
            >
              <MoreHorizontal size={19} />
            </button>
          </div>
          {section === "files" && (
            <>
              <FileTree
                files={workspace.files}
                active={active}
                dirty={dirty}
                changes={git?.changes ?? []}
                onOpen={(path) => void openFile(path)}
                onNew={(d) => void newItem(d)}
                onRename={renameItem}
                onDelete={(path) => void deleteItem(path)}
                onRefresh={() => void refresh()}
                onMenu={fileMenu}
                onEmptyMenu={(e) =>
                  openMenu(e, [
                    menuCommand("new"),
                    { label: "New folder", action: () => void newItem(true) },
                    { label: "Refresh files", action: () => void refresh() },
                    menuCommand("open", { separator: true }),
                  ])
                }
              />
            </>
          )}
          {section === "files" && <ExtensionViews container="explorer" />}
          {section.startsWith("extension:") && (
            <div className="sidebar-content">
              <ExtensionViews container={section.slice(10)} />
            </div>
          )}
          {section === "search" && (
            <div className="sidebar-content">
              <div className="search-field">
                <Search size={15} />
                <input
                  id="workspace-search"
                  autoFocus
                  placeholder="Search your code…"
                  aria-label="Search workspace code"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  aria-label="Match case"
                  aria-pressed={caseSensitive}
                  title="Match case"
                  className={caseSensitive ? "active" : ""}
                  onClick={() => setCaseSensitive((v) => !v)}
                >
                  Aa
                </button>
                {query && (
                  <button
                    aria-label="Clear workspace search"
                    onClick={() => setQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <p className="muted tiny">
                {searching
                  ? "Searching…"
                  : query
                    ? `${matches.length}${matches.length === 500 ? "+" : ""} results`
                    : "Search across project files."}
              </p>
              <SearchResults
                matches={matches}
                query={query}
                busy={searching}
                onOpen={(m) => void openFile(m.path, m.line)}
                onMenu={fileMenu}
              />
              {query && !matches.length && !searching && (
                <div className="sidebar-empty">
                  <Search size={25} />
                  <p>No matches yet.</p>
                  <small>Try something a little different.</small>
                </div>
              )}
            </div>
          )}
          {section === "git" && (
            <div className="sidebar-content">
              {workspace.root === "demo" ? (
                <Empty
                  icon={<GitBranch size={28} />}
                  title="Source control"
                  text="Open a Git project to review changes, stage files, and commit your work."
                  action={() => void openFolder()}
                />
              ) : git ? (
                <SourceControl
                  state={git}
                  root={workspace.root}
                  busy={gitBusy}
                  commit={commit}
                  onCommitChange={setCommit}
                  onRefresh={() => void refreshGit()}
                  onCommit={() =>
                    void gitAction(async () => {
                      const message = await invoke<string>("git_commit", {
                        message: commit,
                      });
                      setCommit("");
                      log(message);
                      notify("Changes committed.", false);
                    })
                  }
                  onStage={(path, staged) => void stageGitFile(path, staged)}
                  onStageAll={(staged) =>
                    void gitAction(() => invoke("git_stage_all", { staged }))
                  }
                  onDiff={(path, staged) => void showDiff(path, staged)}
                  onOpen={(path) => void openFile(path)}
                  onDiscard={(path) => void discardGitFile(path)}
                  onSwitch={(branch) => void switchGitBranch(branch)}
                  onCreateBranch={() =>
                    setDialog({
                      title: "Create branch",
                      description: "Create and switch to a new branch.",
                      initial: "",
                      label: "Branch name",
                      submit: async (branch) => {
                        await switchGitBranch(branch, true);
                      },
                    })
                  }
                />
              ) : (
                <Empty
                  icon={<GitBranch size={28} />}
                  title="No repository connected."
                  text={gitError || "Checking for a Git repository…"}
                  action={() => void refreshGit()}
                  actionLabel="Check again"
                />
              )}
            </div>
          )}
          {section === "run" && (
            <div className="sidebar-content run-content">
              <div className="tool-illustration">
                <Play size={30} />
                <span>Run configurations</span>
              </div>
              <label className="field-label" htmlFor="run-command">
                Project command
              </label>
              <input
                className="text-input mono"
                id="run-command"
                value={runCommand}
                onChange={(e) => setRunCommand(e.target.value)}
                placeholder="cargo run, npm test…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void run();
                }}
              />
              <p className="muted tiny">
                Runs in your project’s integrated shell. Unsaved files are saved
                first.
              </p>
              <button className="primary full" onClick={() => void run()}>
                <Play size={14} /> Run command
              </button>
              <div className="section-label">
                <span>Quick actions</span>
              </div>
              {["cargo check", "cargo test", "cargo build --release"].map(
                (command) => (
                  <button
                    className="quick-action"
                    key={command}
                    onClick={() => {
                      setRunCommand(command);
                      notify(
                        `Command set to ${command}. Press Run command to start.`,
                        false,
                      );
                    }}
                  >
                    <TerminalSquare size={14} />
                    {command}
                    <ArrowUpRight size={12} />
                  </button>
                ),
              )}
              <div className="notice">
                <BookOpen size={16} />
                <p>
                  Run, test, or build any language using its CLI. Use Ctrl C in
                  the terminal to stop a process.
                </p>
              </div>
            </div>
          )}
          <div
            className={`debugger-container ${section === "run" ? "visible" : ""}`}
          >
            <Debugger
              workspace={workspace}
              breakpoints={breakpoints}
              onNavigate={(path, line) => void openFile(path, line)}
              onSession={setDebugSession}
              onOutput={(text) => {
                setOutput((lines) => [...lines.slice(-199), text]);
              }}
              onError={notify}
              onSave={saveAll}
            />
          </div>
          {section === "git" && <ExtensionViews container="scm" />}
          {section === "run" && <ExtensionViews container="debug" />}
          {section === "tools" && <ExtensionViews container="test" />}
          {section === "tools" && (
            <div className="sidebar-content tools-content">
              <h3>Extensions</h3>
              <p className="muted tiny">
                Languages, themes, commands, and views from Open VSX.
              </p>
              <button
                className="primary full"
                onClick={() => commandActions.extensions()}
              >
                Browse extensions <ArrowUpRight size={13} />
              </button>
              <p className="muted tiny">
                {installedExtensions.length} installed /{" "}
                {installedExtensions.filter((e) => e.enabled).length} enabled
              </p>
              {extensionHost.statuses.some((s) => s.status === "error") && (
                <p className="muted tiny">
                  Some extension features need attention. Open Installed
                  extensions for details.
                </p>
              )}
              <ExtensionViews container="devyy" />
              <h3>Language servers</h3>
              {Object.entries(lspStatus).map(([id, status]) => (
                <div className="language-tool" key={id}>
                  <div>
                    <Code2 size={15} />
                    <strong>{id}</strong>
                    <span
                      className={
                        status === "Connected" ? "connected-dot" : "neutral-dot"
                      }
                    />
                  </div>
                  <small>{status}</small>
                </div>
              ))}
              <p className="muted tiny">
                Servers connect when you open a matching file. Add or configure
                any server that uses LSP over stdio.
              </p>
              <button
                className="setting-action"
                onClick={() => {
                  setSettingsPage("languages");
                  setSettingsOpen(true);
                }}
              >
                Manage language servers
              </button>
            </div>
          )}
          <div className="sidebar-foot">
            <span>
              <Asterisk size={14} /> devyy
            </span>
            <small>v0.1.0</small>
          </div>
        </aside>
        <main className="main-workspace">
          {((tabs.length > 0 && active) || comparison) && (
            <div
              className="tabbar"
              onContextMenu={(e) =>
                openMenu(e, [
                  menuCommand("new"),
                  menuCommand("split"),
                  menuCommand("close-all"),
                  menuCommand("focus", { separator: true }),
                ])
              }
            >
              <div className="tabs" role="tablist" aria-label="Open files">
                {comparison && (
                  <div className={`tab diff-tab ${diffActive ? "active" : ""}`}>
                    <button
                      role="tab"
                      aria-label={comparison.title}
                      aria-selected={diffActive}
                      onClick={() => setDiffActive(true)}
                    >
                      <Columns2 size={14} />
                      <span className="tab-label">{comparison.title}</span>
                    </button>
                    <button
                      className="tab-close"
                      aria-label="Close comparison tab"
                      onClick={() => {
                        setComparison(null);
                        setDiffActive(false);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {fileTabGroups.map((group) =>
                  group.length === 2 ? (
                    <SplitTabGroup
                      key={`group:${group[0].path}`}
                      kind="file"
                      onDragStart={(event) => {
                        draggedTab.current = group[0].path;
                        event.dataTransfer.setData("text/plain", group[0].path);
                        writeAIContextDrag(
                          event.dataTransfer,
                          group.map((tab) => ({ kind: "file", id: tab.path })),
                        );
                      }}
                      onDragEnd={() => {
                        draggedTab.current = null;
                      }}
                      active={
                        !diffActive && group.some((tab) => tab.path === active)
                      }
                      onSeparate={() => separateEditor(group[0].path)}
                    >
                      {renderFileTab(group[0], 1)}
                      {renderFileTab(group[1], 2)}
                    </SplitTabGroup>
                  ) : (
                    renderFileTab(group[0])
                  ),
                )}
              </div>
              <button
                className="icon-button new-tab"
                title="New file"
                aria-label="New file"
                onClick={() => void newItem(false)}
              >
                <Plus size={15} />
              </button>
              <div className="tabbar-actions" hidden={diffActive}>
                {!diffActive && language(active) === "markdown" && (
                  <div
                    className="markdown-view-switch"
                    role="group"
                    aria-label="Markdown view"
                  >
                    <button
                      title="Markdown source"
                      aria-label="Markdown source"
                      aria-pressed={
                        markdownMode === "source" ||
                        (markdownMode === "split" && !markdownSplit)
                      }
                      onClick={() => setMarkdownMode("source")}
                    >
                      <Code2 size={14} />
                    </button>
                    <button
                      title="Markdown preview"
                      aria-label="Markdown preview"
                      aria-pressed={markdownMode === "preview"}
                      onClick={() => setMarkdownMode("preview")}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      title="Markdown preview to the side"
                      aria-label="Markdown preview to the side"
                      aria-pressed={markdownSplit}
                      onClick={() => setMarkdownMode("split")}
                    >
                      <Columns2 size={14} />
                    </button>
                  </div>
                )}
                <button
                  className="icon-button"
                  title="Format document"
                  aria-label="Format document"
                  onClick={() => void format()}
                >
                  <WandSparkles size={15} />
                </button>
                <button
                  className="icon-button"
                  title="Split editor"
                  aria-label="Split editor"
                  onClick={() => commandActions.split()}
                >
                  <SplitSquareHorizontal size={15} />
                </button>
              </div>
            </div>
          )}
          <div className="editor-surface">
            {comparison && (
              <div className="comparison-workspace" hidden={!diffActive}>
                <Suspense
                  fallback={
                    <div className="preview-loading">Opening diff…</div>
                  }
                >
                  <DiffEditor
                    onApply={() => {
                      if (comparison.source !== "ai" || !comparison.path)
                        return;
                      const target = tabsRef.current.find(
                        (item) => item.path === comparison.path,
                      );
                      if (
                        !target ||
                        target.readOnly ||
                        target.content !== comparison.original
                      ) {
                        showToast.error(
                          "The file changed since this suggestion. Attach its latest contents and ask again.",
                        );
                        return;
                      }
                      edit(comparison.path, comparison.modified);
                      setActive(comparison.path);
                      setComparison(null);
                      setDiffActive(false);
                    }}
                    document={comparison}
                    active={diffActive}
                    settings={settings}
                    busy={gitBusy}
                    onClose={() => {
                      setComparison(null);
                      setDiffActive(false);
                    }}
                    onOpen={() => {
                      if (comparison.path) void openFile(comparison.path);
                    }}
                    onRefresh={() => {
                      if (comparison.path)
                        void showDiff(comparison.path, !!comparison.staged);
                    }}
                    onStage={() => {
                      if (comparison.path)
                        void stageGitFile(comparison.path, !!comparison.staged);
                    }}
                  />
                </Suspense>
              </div>
            )}
            <div
              className="document-workspace"
              hidden={diffActive && !!comparison}
            >
              {tab ? (
                <>
                  {settings.showBreadcrumbs && (
                    <div className="editor-breadcrumb">
                      <span>{workspace.name}</span>
                      {tab.path.split("/").map((part, i) => (
                        <span key={i}>
                          <ChevronRight size={11} />
                          {i === tab.path.split("/").length - 1 && (
                            <FileIcon path={tab.path} size={12} />
                          )}
                          <span>{part}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    ref={editorsRef}
                    className={`editors ${split ? "split" : ""}`}
                    style={
                      {
                        "--split-ratio": `${editorSplitRatio}%`,
                      } as React.CSSProperties
                    }
                  >
                    {tabs.map(renderEditor)}
                    {markdownSplit && (
                      <div
                        className="editor-stack editor-preview-pane"
                        style={{
                          width: "calc(100% - var(--split-ratio))",
                          flex: "none",
                          order: 2,
                        }}
                      >
                        <div className="editor-pane-heading">
                          <span className="pane-number">2</span>
                          <FileIcon path={active} size={12} />
                          <span>{filename(active)}</span>
                          <small>Preview</small>
                          <button
                            className="icon-button"
                            aria-label="Close split"
                            onClick={() => setMarkdownMode("source")}
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {renderMarkdownPreview(tab)}
                      </div>
                    )}
                    {split && (
                      <div
                        className="editor-split-divider"
                        style={{ left: `${editorSplitRatio}%` }}
                      >
                        <ResizeHandle
                          label="Resize editor split"
                          value={editorSplitRatio}
                          min={20}
                          max={80}
                          onChange={resizeEditorSplit}
                          onReset={() => resizeEditorSplit(50)}
                          percentOf={() => editorsRef.current?.clientWidth ?? 1}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="welcome">
                  <div className="welcome-eyebrow">
                    {/* Trim the icon's horizontal inset to align the visible mark with the text. */}
                    <Asterisk
                      size={64}
                      width={34}
                      viewBox="5.8 0 12.4 24"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="welcome-layout">
                    <div className="welcome-intro">
                      <h2>
                        Your next project.
                        <br />
                        <span>Everything in place.</span>
                      </h2>
                      <p>
                        Open a project to connect your files, terminal, and
                        developer tools.
                      </p>
                      <div className="welcome-actions">
                        <button
                          className="primary"
                          onClick={() => void openFolder()}
                        >
                          <FolderOpen size={16} /> Open a project{" "}
                          <kbd>{mod} O</kbd>
                        </button>
                        <button onClick={() => setPalette("files")}>
                          Find a file <ArrowUpRight size={15} />
                        </button>
                      </div>
                    </div>
                    {!!recent.length && (
                      <section className="recent" aria-label="Recent projects">
                        <div className="section-label">Recent projects</div>
                        {recent.map((path) => (
                          <button
                            key={path}
                            title={path}
                            onClick={() => void openFolder(path)}
                          >
                            <FolderOpen size={14} />
                            <span>
                              <span className="recent-name">
                                {filename(path)}
                              </span>
                              <small>{path}</small>
                            </span>
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </section>
                    )}
                  </div>
                </div>
              )}
            </div>
            <section
              className={`bottom-panel ${!panel ? "panel-hidden" : ""}`}
              style={{
                height: maximizedPanel
                  ? "100%"
                  : Math.min(sizes.panel, Math.max(120, viewport.height - 240)),
              }}
              aria-label="Developer panel"
            >
              {panel && !maximizedPanel && (
                <ResizeHandle
                  label="Resize developer panel"
                  axis="y"
                  reverse
                  value={Math.min(
                    sizes.panel,
                    Math.max(120, viewport.height - 240),
                  )}
                  min={120}
                  max={Math.max(120, viewport.height - 240)}
                  onChange={(value) =>
                    setSizes((s) => ({ ...s, panel: value }))
                  }
                  onReset={() => setSizes((s) => ({ ...s, panel: 250 }))}
                />
              )}
              <div
                className="panel-header"
                onContextMenu={(e) =>
                  openMenu(e, [
                    menuCommand("new-terminal"),
                    menuCommand("split-terminal"),
                    menuCommand("maximize-panel", { separator: true }),
                    menuCommand("terminal"),
                  ])
                }
              >
                <div
                  className="panel-tabs"
                  role="tablist"
                  aria-label="Developer views"
                >
                  {(["terminal", "problems", "output"] as const).map((name) => (
                    <button
                      key={name}
                      className={panelTab === name ? "active" : ""}
                      role="tab"
                      aria-label={name}
                      title={name.charAt(0).toUpperCase() + name.slice(1)}
                      aria-selected={panelTab === name}
                      aria-controls={`panel-${name}`}
                      id={`panel-tab-${name}`}
                      tabIndex={panelTab === name ? 0 : -1}
                      onKeyDown={(e) => {
                        const names = [
                            "terminal",
                            "problems",
                            "output",
                          ] as const,
                          index = names.indexOf(name);
                        const next =
                          e.key === "ArrowRight"
                            ? (index + 1) % 3
                            : e.key === "ArrowLeft"
                              ? (index + 2) % 3
                              : e.key === "Home"
                                ? 0
                                : e.key === "End"
                                  ? 2
                                  : -1;
                        if (next < 0) return;
                        e.preventDefault();
                        setPanelTab(names[next]);
                        document
                          .getElementById(`panel-tab-${names[next]}`)
                          ?.focus();
                      }}
                      draggable={name !== "terminal"}
                      onDragStart={(event) => {
                        if (name !== "terminal")
                          writeAIContextDrag(event.dataTransfer, [
                            {
                              kind: name === "problems" ? "problems" : "output",
                              id:
                                name === "problems"
                                  ? "workspace-problems"
                                  : "workbench-output",
                            },
                          ]);
                      }}
                      onClick={() => setPanelTab(name)}
                    >
                      {name === "terminal" ? (
                        <TerminalSquare size={13} />
                      ) : name === "problems" ? (
                        <CircleAlert size={13} />
                      ) : (
                        <Code2 size={13} />
                      )}
                      <span>{name}</span>
                      {name === "problems" && !!problems.length && (
                        <small>{problems.length}</small>
                      )}
                    </button>
                  ))}
                </div>
                <div
                  className="panel-session-slot"
                  ref={setTerminalToolbar}
                  hidden={panelTab !== "terminal"}
                />
                <div className="panel-actions">
                  <button
                    className="icon-button"
                    aria-label={
                      maximizedPanel ? "Restore panel" : "Maximize panel"
                    }
                    title="Maximize / restore panel"
                    onClick={() => setMaximizedPanel((v) => !v)}
                  >
                    {maximizedPanel ? (
                      <Minimize2 size={13} />
                    ) : (
                      <Maximize2 size={13} />
                    )}
                  </button>
                  {panelTab === "output" && (
                    <button
                      className="icon-button"
                      title="Clear output"
                      aria-label="Clear output"
                      onClick={() => {
                        setOutput([]);
                        setPanelTab("output");
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    title="Close panel"
                    aria-label="Close panel"
                    onClick={() => setPanel(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <div
                className={`panel-view ${panelTab === "terminal" ? "visible" : ""}`}
                id="panel-terminal"
                role="tabpanel"
                aria-labelledby="panel-tab-terminal"
              >
                <Suspense
                  fallback={
                    <div className="panel-empty">Preparing your shell…</div>
                  }
                >
                  <TerminalGroup
                    ref={terminalGroup}
                    toolbarHost={terminalToolbar}
                    settings={settings}
                    key={workspace.root}
                    root={workspace.root}
                    onReady={setTerminalId}
                    onError={notify}
                    onOpen={() => void openFolder()}
                  />
                </Suspense>
              </div>
              <div
                className={`panel-view ${panelTab === "problems" ? "visible" : ""}`}
                id="panel-problems"
                role="tabpanel"
                aria-labelledby="panel-tab-problems"
              >
                {problems.length ? (
                  <div className="problems-list">
                    {problems.map((p, i) => (
                      <button
                        key={`${p.path}:${i}`}
                        draggable
                        onDragStart={(event) =>
                          writeAIContextDrag(event.dataTransfer, [
                            { kind: "problem", id: `${p.path}:${i}` },
                          ])
                        }
                        onClick={() =>
                          void openFile(p.path, p.range.start.line + 1)
                        }
                      >
                        {p.severity === 1 ? (
                          <CircleX size={14} />
                        ) : (
                          <CircleAlert size={14} />
                        )}
                        <span>{p.message}</span>
                        <small>
                          {p.path}:{p.range.start.line + 1}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty">
                    <span className="success-circle">
                      <Check size={16} />
                    </span>
                    <div>
                      <strong>No problems detected</strong>
                      <p>
                        {Object.values(lspStatus).includes("Connected")
                          ? "No diagnostics reported by connected language servers."
                          : "No diagnostics reported. Open a supported file with its language server installed to check your code."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div
                className={`panel-view ${panelTab === "output" ? "visible" : ""}`}
                id="panel-output"
                role="tabpanel"
                aria-labelledby="panel-tab-output"
              >
                <pre className="output-log">
                  {output.join("\n") || "Output is clear."}
                </pre>
              </div>
            </section>
            {settings.showStatusbar && (
              <footer className="statusbar">
                <div>
                  <button
                    onClick={() => {
                      setSection("git");
                      showSidebar(true);
                      void refreshGit();
                    }}
                  >
                    <GitBranch size={12} />
                    {git?.branch ?? "local"}
                  </button>
                  <span className="status-divider" />
                  <button
                    onClick={() => {
                      showPanel(true);
                      setPanelTab("problems");
                    }}
                  >
                    <CircleX size={12} />
                    {errors}
                    <CircleAlert size={12} />
                    {warnings}
                  </button>
                  <span className="status-divider" />
                  <ExtensionStatusItems />
                  <span className="saved-status">
                    {dirty.size ? `${dirty.size} unsaved` : "All changes saved"}
                  </span>
                </div>
                <div>
                  <button
                    title="Go to line"
                    onClick={() => commands.find((c) => c.id === "goto")?.run()}
                  >
                    Ln {cursor.line}, Col {cursor.col}
                  </button>
                  <button
                    title="Indentation preferences"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Spaces: {settings.tabSize}
                  </button>
                  <span className="status-encoding">UTF-8</span>
                  <span className="status-encoding">
                    {tab?.content.includes("\r\n") ? "CRLF" : "LF"}
                  </span>
                  <button
                    onClick={() => {
                      setSection("tools");
                      showSidebar(true);
                    }}
                  >
                    <Braces size={12} />
                    {tab ? language(tab.path) : "text"}
                  </button>
                  <button
                    className={focus ? "focus-active" : ""}
                    title="Toggle focus mode"
                    aria-label="Toggle focus mode"
                    onClick={toggleFocus}
                  >
                    <Focus size={13} />
                  </button>
                </div>
              </footer>
            )}
          </div>
          <ExtensionWebviews
            shortcuts={Object.entries(bindings)
              .filter(
                ([id, key]) =>
                  key &&
                  ![
                    "undo",
                    "redo",
                    "find",
                    "save",
                    "save-all",
                    "new",
                    "close",
                    "close-all",
                    "format",
                    "definition",
                    "goto",
                    "run",
                  ].includes(id),
              )
              .map(([, key]) => key)}
          />
        </main>
        <AIWorkspace
          file={
            tab
              ? { path: tab.path, content: tab.content, readOnly: tab.readOnly }
              : undefined
          }
          cwd={workspace.root === "demo" ? undefined : workspace.root}
          onSettings={() => {
            setSettingsPage("ai");
            setSettingsOpen(true);
          }}
          onReview={reviewAISuggestion}
          shortcuts={Object.values(bindings).filter(Boolean)}
        />
      </div>
      {keyChord && (
        <div className="shortcut-hint" role="status">
          {displayBinding(keyChord)} — waiting for the next key
        </div>
      )}
      {palette && (
        <Palette
          mode={palette}
          onModeChange={setPalette}
          onClose={() => setPalette(null)}
          items={
            palette === "commands"
              ? commands
              : workspace.files
                  .filter((f) => !f.directory)
                  .map((f) => ({
                    id: f.path,
                    label: f.name,
                    detail: f.path,
                    run: () => void openFile(f.path),
                  }))
          }
        />
      )}
      {settingsOpen && (
        <Preferences
          settings={settings}
          category={settingsPage}
          onCategoryChange={setSettingsPage}
          onSetup={() => {
            setSettingsOpen(false);
            setSetupOpen(true);
          }}
          onChange={setSettings}
          onResetLayout={resetLayout}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {help && (
        <div className="modal-backdrop" onMouseDown={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="About devyy and keyboard shortcuts"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <Asterisk size={34} />
              <button
                className="icon-button"
                aria-label="Close help"
                onClick={() => setHelp(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2>Keyboard shortcuts</h2>
            <p className="muted">devyy 0.1 — Local development environment</p>
            <div className="shortcut-list">
              {commandInfo
                .filter(([id]) => bindings[id])
                .map(([id, name]) => [name, displayBinding(bindings[id])])
                .map(([name, key]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
            </div>
            <div className="notice">
              <Sparkles size={18} />
              <p>
                Rust-powered desktop core. CodeMirror editor. Optional AI
                providers. No telemetry. An independent editor, built from a
                clean slate.
              </p>
            </div>
          </section>
        </div>
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}
      {setupOpen && (
        <Setup
          settings={settings}
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onFinish={finishSetup}
        />
      )}
      <ExtensionServices onRequest={extensionWorkbenchRequest} />
      <Toaster
        theme={settings.theme === "paper" ? "light" : "dark"}
        position="bottom-right"
        closeButton
        visibleToasts={3}
        toastOptions={{ className: "devyy-toast", duration: 5000 }}
      />
      {opening && (
        <div className="opening-indicator">
          <RefreshCw size={15} className="spinning" /> Opening your workspace…
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
  actionLabel = "Open a folder",
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="sidebar-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="secondary" onClick={action}>
        {actionLabel}
        <ArrowUpRight size={13} />
      </button>
    </div>
  );
}
function InputDialog({
  dialog,
  onClose,
}: {
  dialog: Dialog;
  onClose: () => void;
}) {
  const [value, setValue] = useState(dialog.initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="input-modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void dialog
            .submit(value.trim())
            .then(onClose)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-heading">
          <Braces size={24} />
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <h2>{dialog.title}</h2>
        <p className="muted">{dialog.description}</p>
        <input
          className="text-input"
          autoFocus
          aria-label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !value.trim()}>
            {busy ? "Working…" : dialog.label}
          </button>
        </div>
      </form>
    </div>
  );
}
