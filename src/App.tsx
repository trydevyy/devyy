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

import Skeleton from "./components/ui/Skeleton";
import { readClipboardText, writeClipboardText } from "./lib/clipboard";
import {
  DesktopMenuBar,
  NativeWindowControls,
} from "./components/DesktopHeader";
import { AnimatePresence } from "motion/react";
import UpdateOverlay from "./components/UpdateOverlay";
import FilePreview from "./components/FilePreview";
import { filePreviewKind } from "./lib/filePreview";
import RunPanel from "./components/RunPanel";
import { activeSurface, restoreFocus } from "./lib/focus";
import { resolveOpenTarget } from "./lib/openTargets";
import {
  setAIProposalStatus,
  getPendingAIProposals,
  type AIProposal,
} from "./lib/ai";
import {
  registerAIContext,
  writeAIContextDrag,
  boundedContext,
  type AIContextSource,
  type AIAttachment,
} from "./lib/aiContext";
import {
  lazy,
  startTransition,
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
import { undo, redo, selectAll } from "@codemirror/commands";
import { open } from "@tauri-apps/plugin-dialog";
import { useConfirm, type Confirmation } from "./components/ui/Confirm";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Asterisk,
  Copy,
  Eye,
  Columns2,
  Braces,
  Bug,
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
  Radio,
  Search,
  Settings2,
  SplitSquareHorizontal,
  TerminalSquare,
  Maximize2,
  Minimize2,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
const PortsPanel = lazy(() => import("./components/PortsPanel"));
import { supportsWindowVibrancy, useAppearance } from "./lib/appearance";
import {
  activateStoreTheme,
  restoreStoreTheme,
  useStoreTheme,
} from "./lib/store";
import { embeddedThemePreview } from "./lib/previewMode";
import StoreSprites, { TitlebarStoreSprites } from "./components/StoreSprites";
import type { GitBranchAction, GitSubmoduleAction } from "./lib/git";
import SourceControl from "./components/SourceControl";
import type { Comparison } from "./components/DiffEditor";
const GitGraph = lazy(() => import("./components/GitGraph"));
const DiffEditor = lazy(() => import("./components/DiffEditor"));
import Editor, { offset, toPosition } from "./components/Editor";
import ProblemList from "./components/ProblemList";
import FileTree, { FileIcon } from "./components/FileTree";
import Setup from "./components/Setup";
import ExtensionViews from "./components/ExtensionViews";
import ExtensionWebviews from "./components/ExtensionWebviews";
import ExtensionStatusItems from "./components/ExtensionStatusItems";
import ExtensionServices, {
  type WorkbenchRequest,
} from "./components/ExtensionServices";
import {
  extensionMenuItems,
  commandPaletteVisible,
  resourceContext,
  commandUri,
} from "./lib/extensionMenus";
import { matchesContext } from "./lib/extensionContext";
import { fileUri, sendExtensionEditorState } from "./lib/extensionWorkbench";
import {
  hostRequest,
  extensionLanguageFeature,
  extensionCommand,
  syncExtensionHost,
  useExtensionHostValue,
  type HostEvent,
} from "./lib/extensionHost";
import { initializeExtensions, useExtensions } from "./lib/extensions";
const Preferences = lazy(() => import("./components/Preferences"));
const RemoteExplorer = lazy(() => import("./components/RemoteExplorer"));
import { useAccountSync } from "./lib/account";
import AccountAvatar from "./components/AccountAvatar";
import AIWorkspace from "./components/AIWorkspace";
import AIPanelToggle from "./components/AIPanelToggle";
import ExtensionIcon from "./components/ExtensionIcon";
import { aiMainView, isAIExtension } from "./lib/aiExtensions";
import type { SettingsCategory } from "./lib/settingsCatalog";
import SearchResults from "./components/SearchResults";
import ProjectBadge from "./components/ProjectBadge";
import Palette, { type PaletteItem } from "./components/Palette";
import { checkUpdates, type UpdateStatus } from "./lib/buildInfo";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import Select from "./components/ui/Select";
import {
  normalizeSettings,
  filename,
  language,
  readLocal,
  BUILTIN_OUTPUT_SERVICES,
  type FileEntry,
  type GitState,
  type LspDiagnostic,
  type OutputEntry,
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
import { triggerSignatureHelp } from "./lib/lspSignatureHelp";

type Section =
  "files" | "search" | "git" | "run" | "remote" | `extension:${string}`;
import InputDialog, { type Dialog } from "./components/InputDialog";
import {
  movePreviewSprite,
  selectPreviewSprite,
  useThemePreview,
} from "./lib/themePreview";
import Empty from "./components/Empty";
import HelpModal from "./components/HelpModal";

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const emptyLines: number[] = [];
const emptyDiagnostics: LspDiagnostic[] = [];
const playground =
  embeddedThemePreview ||
  ((import.meta.env.DEV ||
    (!native && import.meta.env.VITE_DEVYY_PLAYGROUND === "1")) &&
    new URLSearchParams(location.search).get("playground") === "1");
const showcase = playground
  ? new URLSearchParams(location.search).get("showcase")
  : null;
const initialDemo = playground
  ? showcase
    ? seed
    : readLocal<Record<string, string>>("devyy.playground", seed)
  : {};
const initialTab: Tab = {
  path: "src/main.rs",
  content: initialDemo["src/main.rs"] ?? seed["src/main.rs"],
  saved: initialDemo["src/main.rs"] ?? seed["src/main.rs"],
  modified: "",
};
const outputTime = new Intl.DateTimeFormat([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function afterWorkspacePaint(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 150);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve();
      });
    });
  });
}

function whenWorkspaceIdle(work: () => void) {
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(work, { timeout: 800 });
  else setTimeout(work, 120);
}

export default function App() {
  const confirmAction = useConfirm();
  const [portsVisited, setPortsVisited] = useState(false);
  const installedExtensions = useExtensions();
  const hostContexts = useExtensionHostValue((state) => state.contexts);
  const extensionWebviews = useExtensionHostValue((state) => state.webviews);
  const extensionContainers = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        title: string;
        icon?: string;
        extension?: string;
        fallback?: string;
      }
    >();
    for (const ext of installedExtensions.filter(
      (e) => e.enabled && !isAIExtension(e.id),
    )) {
      for (const container of Object.values(
        ext.contributes.viewsContainers ?? {},
      ).flat())
        map.set(container.id, {
          ...container,
          extension: ext.id,
          fallback: ext.icon,
        });
      for (const id of Object.keys(ext.contributes.views ?? {}))
        if (!["explorer", "scm", "debug"].includes(id) && !map.has(id))
          map.set(id, {
            id,
            title: id === "test" ? "Testing" : ext.name,
            extension: ext.id,
            fallback: ext.icon,
          });
    }
    return [...map.values()].filter((container) =>
      installedExtensions.some(
        (ext) =>
          ext.enabled &&
          ext.contributes.views?.[container.id]?.some((view) =>
            matchesContext(view.when, hostContexts),
          ),
      ),
    );
  }, [installedExtensions, hostContexts]);
  useEffect(() => {
    const focus = (event: Event) => {
      const message = (
        event as CustomEvent<{
          event: string;
          payload: { id: string; extension: string };
        }>
      ).detail;
      if (message.event !== "focusContainer") return;
      if (isAIExtension(message.payload.extension))
        window.dispatchEvent(
          new CustomEvent("devyy-ai-open", {
            detail: { extension: message.payload.extension },
          }),
        );
      else {
        setSection(`extension:${message.payload.id}`);
        setSidebar(true);
      }
    };
    window.addEventListener("devyy-extension-event", focus);
    return () => window.removeEventListener("devyy-extension-event", focus);
  }, []);
  const [setupOpen, setSetupOpen] = useState(
    () =>
      !embeddedThemePreview &&
      !(playground && import.meta.env.VITE_DEVYY_PLAYGROUND === "1") &&
      !readLocal("devyy.setupCompleted", false),
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
    name: playground ? "playground" : "Open a project",
    files: demoEntries(initialDemo),
  });
  const [activeServerId, setActiveServerId] = useState<string>();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["src"]),
  );
  const expandedFoldersRef = useRef(expandedFolders);
  expandedFoldersRef.current = expandedFolders;
  const [demo, setDemo] = useState(initialDemo),
    [tabs, setTabs] = useState<Tab[]>(
      playground
        ? [
            initialTab,
            ...["src/lib.rs", "README.md"]
              .filter((path) => initialDemo[path] !== undefined)
              .map((path) => ({
                path,
                content: initialDemo[path],
                saved: initialDemo[path],
                modified: "",
              })),
          ]
        : [],
    ),
    [active, setActivePath] = useState(playground ? initialTab.path : "");
  const [graphSelection, setGraphSelection] = useState<string | null>(null);
  const [graphParent, setGraphParent] = useState(0);
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
  const [runMode, setRunMode] = useState<"run" | "debug">("run");
  const [section, setSection] = useState<Section>(
      showcase === "remote" ? "remote" : "files",
    ),
    [sidebar, setSidebar] = useState(playground),
    [panel, setPanel] = useState(playground),
    [panelTab, setPanelTab] = useState<
      "terminal" | "problems" | "output" | "ports"
    >("terminal"),
    [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [fileSplits, setFileSplits] = useState<SplitGroup<string>[]>([]);
  const fileSplit = fileSplits.find(
    (group) =>
      group.includes(active) &&
      group.every((path) => tabs.some((tab) => tab.path === path)),
  );
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const markdownSplit =
    !fileSplit && language(active) === "markdown" && markdownMode === "split";
  const split = Boolean(fileSplit || markdownSplit);
  const fileTabGroups = groupedTabs(tabs, (tab) => tab.path, fileSplits);
  const [focus, setFocus] = useState(false),
    [palette, setPalette] = useState<"files" | "commands" | null>(null);
  const [settings, setSettings] = useState<Settings>(() =>
      normalizeSettings(
        embeddedThemePreview
          ? { followSystemTheme: false }
          : readLocal("devyy.settings", {}),
      ),
    ),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsPage, setSettingsPage] = useState<SettingsCategory>("appearance"),
    [settingsTabQuery, setSettingsTabQuery] = useState(""),
    [help, setHelp] = useState(false);
  const [git, setGit] = useState<GitState | null>(null),
    [gitError, setGitError] = useState(""),
    [commit, setCommit] = useState(""),
    [gitBusy, setGitBusy] = useState(false),
    [gitRepository, setGitRepository] = useState("");
  const gitRepositoryRef = useRef("");
  const gitStatusRequest = useRef(0);
  const gitOperationBusy = useRef(false);
  const gitDrafts = useRef(new Map<string, string>());
  const [query, setQuery] = useState(""),
    [caseSensitive, setCaseSensitive] = useState(false),
    [matches, setMatches] = useState<SearchMatch[]>([]),
    [searching, setSearching] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const pendingProblems = useRef(
    new Map<
      string,
      {
        path: string;
        collection?: string;
        entries: Problem[];
      }
    >(),
  );
  const problemsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function queueProblems(
    path: string,
    entries: Problem[],
    collection?: string,
  ) {
    const key = path + "\0" + (collection ?? "");
    pendingProblems.current.set(key, { path, collection, entries });
    if (problemsTimer.current !== undefined) return;
    problemsTimer.current = setTimeout(() => {
      problemsTimer.current = undefined;
      const pending = pendingProblems.current;
      pendingProblems.current = new Map();
      if (!pending.size) return;
      startTransition(() =>
        setProblems((old) => [
          ...old.filter(
            (problem) =>
              !pending.has(problem.path + "\0" + (problem.collection ?? "")),
          ),
          ...Array.from(pending.values()).flatMap(({ entries }) => entries),
        ]),
      );
    }, 40);
  }
  function clearQueuedProblems(
    match: (path: string, collection?: string) => boolean,
  ) {
    for (const [key, entry] of pendingProblems.current)
      if (match(entry.path, entry.collection))
        pendingProblems.current.delete(key);
  }
  useEffect(() => () => clearTimeout(problemsTimer.current), []);

  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([
    {
      id: "init-output",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      source: "Devyy",
      text: "devyy is ready. Open a folder to connect your tools.",
      level: "info",
    },
  ]);
  const [discoveredChannels, setDiscoveredChannels] = useState<string[]>([]);
  const [outputSource, setOutputSource] = useState<string>("all");
  const [outputFilter, setOutputFilter] = useState("");
  const [outputAutoScroll, setOutputAutoScroll] = useState(true);
  const outputContainerRef = useRef<HTMLDivElement | null>(null);

  const extensionChannels = useMemo(() => {
    const set = new Set<string>(discoveredChannels);
    for (const entry of outputEntries) {
      if (!BUILTIN_OUTPUT_SERVICES.includes(entry.source as any)) {
        set.add(entry.source);
      }
    }
    return Array.from(set).sort();
  }, [outputEntries, discoveredChannels]);

  const filteredOutputEntries = useMemo(() => {
    return outputEntries.filter((entry) => {
      if (outputSource !== "all" && entry.source !== outputSource) {
        return false;
      }
      if (outputFilter.trim()) {
        const q = outputFilter.toLowerCase();
        return (
          entry.text.toLowerCase().includes(q) ||
          entry.source.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [outputEntries, outputSource, outputFilter]);

  const formattedOutputText = useMemo(() => {
    if (outputEntries.length === 0) return "";
    if (filteredOutputEntries.length === 0) {
      return outputFilter.trim()
        ? "No output lines match the current filter."
        : "Output is clear.";
    }
    return filteredOutputEntries
      .map((entry) => {
        const prefix =
          outputSource === "all"
            ? `[${entry.timestamp}] [${entry.source}]`
            : `[${entry.timestamp}]`;
        const level =
          entry.level && entry.level !== "info"
            ? ` [${entry.level.toUpperCase()}]`
            : "";
        return `${prefix}${level} ${entry.text}`;
      })
      .join("\n");
  }, [filteredOutputEntries, outputEntries.length, outputFilter, outputSource]);

  const output = useMemo(
    () => (formattedOutputText ? formattedOutputText.split("\n") : []),
    [formattedOutputText],
  );
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const diffRequest = useRef(0);
  const [cursor, setCursor] = useState({ line: 1, col: 1 }),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [terminalId, setTerminalId] = useState<number | null>(null),
    [pendingRun, setPendingRun] = useState<string | null>(null);
  const [lspStatus, setLspStatus] = useState<Record<string, string>>({}),
    [recent, setRecent] = useState<string[]>(() =>
      readLocal("devyy.recent", []),
    ),
    [workspaceScan, setWorkspaceScan] = useState(false),
    [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [openingUpdate, setOpeningUpdate] = useState(false);
  const updateHandoff = useRef(false);

  async function viewUpdate(url: string, onError?: () => void) {
    if (updateHandoff.current) return;
    updateHandoff.current = true;
    setOpeningUpdate(true);
    try {
      // Give the webview time to paint before the browser takes focus.
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      await openUrl(url);
    } catch {
      if (onError) onError();
      else showToast.error("Could not open release");
    } finally {
      updateHandoff.current = false;
      setOpeningUpdate(false);
    }
  }

  useEffect(() => {
    if (!native) return;
    void checkUpdates()
      .then((status) => {
        if (status.status === "available") {
          setUpdateStatus(status);
        }
      })
      .catch(() => {});
  }, []);
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
      tabs
        .filter((t) => t.content !== t.saved || t.modified === "devyy:new")
        .map((t) => t.path),
    );
  const busyRef = useRef(false);
  const workspaceWaiters = useRef<(() => void)[]>([]);
  const workspaceOpenRequest = useRef(0);
  const fileOpenRequest = useRef(0);
  const workspaceRefreshRequest = useRef(0);
  const backgroundRefresh = useRef<{
    workspace: number;
    request: number;
    shallow: boolean;
  } | null>(null);
  const workspaceServices = useRef<Promise<void>>(Promise.resolve());
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
    const saved = embeddedThemePreview
      ? {}
      : readLocal<Record<string, number>>("devyy.layout", {});
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
    if (!embeddedThemePreview)
      localStorage.setItem("devyy.layout", JSON.stringify(sizes));
  }, [sizes]);
  useEffect(() => {
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const updateChrome = useCallback(() => {
    if (!supportsWindowVibrancy) return;
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
    if (!supportsWindowVibrancy) return;
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
  const pendingOutput = useRef<OutputEntry[]>([]);
  const outputTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const outputId = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(outputTimer.current);
      outputTimer.current = undefined;
    },
    [],
  );

  function appendOutput(
    text: string,
    source = "Devyy",
    level: "info" | "warn" | "error" | "debug" | "trace" = "info",
  ) {
    const timestamp = outputTime.format();
    const queued = pendingOutput.current;
    for (const line of String(text).split(/\r?\n/).slice(-500))
      queued.push({
        id: `out-${++outputId.current}`,
        timestamp,
        source,
        text: line,
        level,
      });
    if (queued.length > 500) queued.splice(0, queued.length - 500);
    if (outputTimer.current !== undefined) return;
    outputTimer.current = setTimeout(() => {
      outputTimer.current = undefined;
      const entries = pendingOutput.current;
      pendingOutput.current = [];
      if (!entries.length) return;
      startTransition(() =>
        setOutputEntries((previous) => {
          const retained = 500 - entries.length;
          return retained
            ? [...previous.slice(-retained), ...entries]
            : entries;
        }),
      );
    }, 40);
  }

  function log(
    text: string,
    source = "Devyy",
    level: "info" | "warn" | "error" | "debug" | "trace" = "info",
  ) {
    appendOutput(text, source, level);
  }

  function clearOutput() {
    if (outputSource === "all") {
      pendingOutput.current = [];
      setOutputEntries([]);
    } else {
      pendingOutput.current = pendingOutput.current.filter(
        (entry) => entry.source !== outputSource,
      );
      setOutputEntries((prev) => prev.filter((e) => e.source !== outputSource));
    }
    setPanelTab("output");
  }

  async function copyOutput() {
    if (!formattedOutputText) return;
    try {
      await writeClipboardText(formattedOutputText);
      showToast.success("Output copied to clipboard");
    } catch (e) {
      showToast.error("Failed to copy output: " + String(e));
    }
  }

  useEffect(() => {
    if (outputAutoScroll && outputContainerRef.current) {
      outputContainerRef.current.scrollTop =
        outputContainerRef.current.scrollHeight;
    }
  }, [formattedOutputText, outputAutoScroll]);
  useEffect(() => {
    if (!embeddedThemePreview)
      localStorage.setItem("devyy.settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (playground && !showcase)
      localStorage.setItem("devyy.playground", JSON.stringify(demo));
  }, [demo]);
  const paletteOpen = palette !== null;
  useEffect(() => {
    if (!paletteOpen && !settingsOpen && !help && !dialog && !setupOpen) return;
    const previous =
      modalReturnFocus.current ??
      (document.activeElement as HTMLElement | null);
    const modal = activeSurface('[role="dialog"]');
    const selector =
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';
    (
      modal?.querySelector<HTMLElement>("input:not(:disabled)") ??
      modal?.querySelector<HTMLElement>(selector)
    )?.focus();
    const trap = (event: KeyboardEvent) => {
      if (
        event.key !== "Tab" ||
        !modal ||
        activeSurface(".desktop-theme-preview[open]")
      )
        return;
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
      restoreFocus(previous);
    };
  }, [paletteOpen, settingsOpen, help, dialog, setupOpen]);
  const installedTheme = useStoreTheme();
  const themePreview = useThemePreview();
  const storeTheme = themePreview?.theme ?? installedTheme;
  const editorBackground = storeTheme?.manifest.editorBackground;
  const appearanceSettings = useMemo<Settings>(() => {
    if (!storeTheme) return settings;
    const { manifest } = storeTheme;
    return {
      ...settings,
      theme: manifest.base,
      fontSize: manifest.layout.fontSize ?? settings.fontSize,
      lineHeight: manifest.layout.lineHeight ?? settings.lineHeight,
      fontFamily: manifest.layout.fontFamily ?? settings.fontFamily,
    };
  }, [settings, storeTheme]);
  useEffect(() => {
    function applyDefault(event: Event) {
      const theme = (event as CustomEvent<Settings["theme"]>).detail;
      setSettings((current) => ({
        ...current,
        theme,
        followSystemTheme: false,
        extensionTheme: "",
      }));
    }
    window.addEventListener("devyy-default-theme", applyDefault);
    void restoreStoreTheme();
    return () =>
      window.removeEventListener("devyy-default-theme", applyDefault);
  }, []);
  useAppearance(appearanceSettings, notify, storeTheme);
  useAccountSync(settings, setSettings);
  useEffect(() => {
    if (
      !showcase ||
      showcase === "hero" ||
      showcase === "theme" ||
      window.parent === window ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const targets =
      showcase === "agent"
        ? [".ai-mode-tab:nth-child(2)", ".ai-mode-tab:nth-child(3)"]
        : showcase === "remote"
          ? [".remote-subbar .primary", ".port-dialog .dialog-heading button"]
          : [
              'button[aria-label="Toggle sidebar"]',
              'button[aria-label="Toggle sidebar"]',
            ];
    let index = 0;
    const timer = window.setInterval(() => {
      document
        .querySelector<HTMLButtonElement>(targets[index++ % targets.length])
        ?.click();
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);
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
  async function ask(
    text: string,
    options?: Omit<Confirmation, "description">,
  ) {
    return confirmAction({ description: text, ...options });
  }
  useEffect(() => {
    if (panel && panelTab === "ports") setPortsVisited(true);
  }, [panel, panelTab]);

  async function refreshGit() {
    if (!native || wsRef.current.root === "demo") return;
    const root = wsRef.current.root,
      repository = gitRepositoryRef.current,
      request = ++gitStatusRequest.current;
    try {
      const next = await invoke<GitState>("git_status", { repository });
      if (
        root === wsRef.current.root &&
        repository === gitRepositoryRef.current &&
        request === gitStatusRequest.current
      ) {
        setGit((previous) =>
          previous &&
          previous.branch === next.branch &&
          previous.upstream === next.upstream &&
          previous.ahead === next.ahead &&
          previous.behind === next.behind &&
          previous.changes.length === next.changes.length &&
          previous.changes.every((change, index) => {
            const current = next.changes[index];
            return (
              change.path === current.path &&
              change.index === current.index &&
              change.worktree === current.worktree &&
              change.oldPath === current.oldPath
            );
          })
            ? previous
            : next,
        );
        setGitError("");
      }
    } catch (e) {
      if (
        root === wsRef.current.root &&
        repository === gitRepositoryRef.current &&
        request === gitStatusRequest.current
      ) {
        setGit(null);
        setGitError(String(e));
      }
    }
  }
  async function refresh(silent = false, shallow = false) {
    const root = wsRef.current.root;
    const workspaceRequest = workspaceOpenRequest.current;
    const pending = backgroundRefresh.current;
    if (
      root === "demo" ||
      busyRef.current ||
      (silent &&
        pending?.workspace === workspaceRequest &&
        (!pending.shallow || shallow))
    )
      return;
    const request = ++workspaceRefreshRequest.current;
    if (silent)
      backgroundRefresh.current = {
        workspace: workspaceRequest,
        request,
        shallow,
      };
    const isCurrent = () =>
      workspaceRequest === workspaceOpenRequest.current &&
      root === wsRef.current.root &&
      request === workspaceRefreshRequest.current;
    try {
      const next = await invoke<Workspace>("refresh_workspace", { shallow });
      if (!isCurrent() || next.root !== root) return;

      const nextTraversedDirs = new Set<string>([""]);
      const nextDirs = new Set<string>();
      for (const f of next.files) {
        if (f.directory) nextDirs.add(f.path);
        const parent = f.path.includes("/")
          ? f.path.slice(0, f.path.lastIndexOf("/"))
          : "";
        nextTraversedDirs.add(parent);
      }

      const currentExpanded = expandedFoldersRef.current;
      const untraversedExpanded = Array.from(currentExpanded).filter(
        (dir) =>
          dir &&
          !nextTraversedDirs.has(dir) &&
          (!shallow || nextDirs.has(dir.split("/")[0])),
      );

      const dynamicFetches = await Promise.all(
        untraversedExpanded.map(async (dir) => {
          try {
            const children = await invoke<FileEntry[]>("list_directory", {
              path: dir,
            });
            return { dir, children };
          } catch {
            return { dir, children: null };
          }
        }),
      );

      if (!isCurrent()) return;

      const updateWorkspace = () =>
        setWorkspace((prev) => {
          if (!isCurrent() || prev.root !== root) return prev;

          const dynamicByDir = new Map<string, FileEntry[]>();
          for (const item of dynamicFetches) {
            if (item.children) {
              dynamicByDir.set(item.dir, item.children);
            }
          }

          const preservedChildren: FileEntry[] = [];
          const seenPaths = new Set(next.files.map((f) => f.path));
          const directories = new Set(nextDirs);
          const refreshed = new Set([
            ...nextTraversedDirs,
            ...dynamicByDir.keys(),
          ]);
          for (const children of dynamicByDir.values()) {
            for (const child of children) {
              if (child.directory) directories.add(child.path);
              if (!seenPaths.has(child.path)) {
                preservedChildren.push(child);
                seenPaths.add(child.path);
              }
            }
          }

          // A successful directory listing proves which immediate children
          // still exist. Unvisited branches remain in the quick-open index.
          const removed = new Set<string>();
          for (const file of prev.files) {
            if (!file.directory || directories.has(file.path)) continue;
            const parent = file.path.slice(
              0,
              Math.max(0, file.path.lastIndexOf("/")),
            );
            if (refreshed.has(parent)) removed.add(file.path);
          }
          const visibleBranch = new Map<string, boolean>();
          const survives = (dir: string): boolean => {
            if (!dir) return true;
            const known = visibleBranch.get(dir);
            if (known !== undefined) return known;
            const exists =
              !removed.has(dir) &&
              survives(dir.slice(0, Math.max(0, dir.lastIndexOf("/"))));
            visibleBranch.set(dir, exists);
            return exists;
          };
          for (const file of prev.files) {
            if (seenPaths.has(file.path)) continue;
            const parent = file.path.slice(
              0,
              Math.max(0, file.path.lastIndexOf("/")),
            );
            if (!refreshed.has(parent) && survives(parent)) {
              preservedChildren.push(file);
              seenPaths.add(file.path);
            }
          }

          const name = prev.remotePath ? prev.name : next.name;
          const logo = shallow ? prev.logo : next.logo;
          // Skip sorting and React work on the common unchanged poll.
          if (
            prev.logo === logo &&
            prev.name === name &&
            prev.files.length === seenPaths.size
          ) {
            const fresh = new Map(
              next.files.map((entry) => [entry.path, entry]),
            );
            for (const children of dynamicByDir.values())
              for (const child of children)
                if (!fresh.has(child.path)) fresh.set(child.path, child);
            if (
              prev.files.every((file) => {
                const entry = fresh.get(file.path);
                return (
                  seenPaths.has(file.path) &&
                  (!entry ||
                    (entry.directory === file.directory &&
                      entry.name === file.name))
                );
              })
            )
              return prev;
          }
          const mergedFiles = preservedChildren.length
            ? [...next.files, ...preservedChildren].sort(
                (a, b) =>
                  (!a.directory ? 1 : 0) - (!b.directory ? 1 : 0) ||
                  a.path.localeCompare(b.path),
              )
            : next.files;

          return {
            ...next,
            logo,
            name,
            files: mergedFiles,
          };
        });
      if (silent) startTransition(updateWorkspace);
      else updateWorkspace();
      if (!shallow || sectionRef.current === "git") await refreshGit();
    } catch (e) {
      if (!silent && isCurrent()) notify(e);
    } finally {
      if (silent && backgroundRefresh.current?.request === request)
        backgroundRefresh.current = null;
    }
  }

  useEffect(() => {
    if (workspace.root === "demo") return;
    let mounted = true;
    let lastFullPoll = Date.now();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const deep = now - lastFullPoll >= 30_000;
      if (deep) lastFullPoll = now;
      void refresh(true, !deep);
    }, 5000);

    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void refresh(true, true);
      void refreshGit();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh(true, true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let unlistenRefresh: (() => void) | undefined;
    if (native) {
      void listen("devyy-workspace-refresh", () => {
        void refresh(true);
      }).then((un) => {
        if (mounted) unlistenRefresh = un;
        else un();
      });
    }

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlistenRefresh?.();
    };
  }, [workspace.root]);

  async function handleExternalFileDrop(file: File) {
    try {
      const rawPath = (file as any).path as string | undefined;
      const root = wsRef.current.root;
      if (root && root !== "demo" && rawPath && rawPath.startsWith(root)) {
        const rel = rawPath.slice(root.length).replace(/^[/\\]+/, "");
        await openFile(rel);
        return;
      }
      const content = await file.text();
      const tabName = file.name || "Untitled";
      const targetPath = rawPath || tabName;
      const newTab: Tab = {
        path: targetPath,
        content,
        saved: content,
        modified: String(file.lastModified || Date.now()),
        readOnly: false,
      };
      setTabs((old) => {
        const idx = old.findIndex((t) => t.path === newTab.path);
        if (idx >= 0) return old;
        return [...old, newTab];
      });
      setActive(newTab.path);
    } catch (err) {
      showToast.error(`Could not open dropped file: ${String(err)}`);
    }
  }
  async function openFolder(
    path?: string,
    remoteName?: string,
    remoteServerId?: string,
  ) {
    return changeWorkspace({ path, remoteName, remoteServerId });
  }

  async function changeWorkspace({
    path,
    remoteName,
    remoteServerId,
    disconnect = false,
  }: {
    path?: string;
    remoteName?: string;
    remoteServerId?: string;
    disconnect?: boolean;
  }) {
    if (busyRef.current || (disconnect && !wsRef.current.remotePath))
      return false;
    const previousRoot = wsRef.current.root;
    if (
      debugSession.running &&
      !(await ask(
        disconnect
          ? "Stop debugging and disconnect?"
          : "Stop debugging and open another folder?",
        {
          title: "Stop debugging?",
          confirmLabel: disconnect ? "Disconnect" : "Open folder",
        },
      ))
    )
      return false;
    if (busyRef.current) return false;
    if (!native) {
      notify(
        "Open the Devyy desktop app to work with folders on your computer.",
        false,
      );
      return false;
    }
    if (
      dirty.size &&
      !(await ask(
        disconnect
          ? "You have unsaved changes. Discard them and disconnect?"
          : "You have unsaved changes. Discard them and open another folder?",
        {
          title: disconnect ? "Disconnect from SSH?" : "Open another project?",
          confirmLabel: "Discard changes",
          danger: true,
        },
      ))
    )
      return false;
    const chosen = disconnect
      ? previousRoot
      : (path ??
        (await open({
          directory: true,
          multiple: false,
          title: "Open a project in devyy",
        })));
    if (
      typeof chosen !== "string" ||
      busyRef.current ||
      wsRef.current.root !== previousRoot
    )
      return false;
    busyRef.current = true;
    const openRequest = ++workspaceOpenRequest.current;
    setWorkspaceScan(true);
    try {
      const next: Workspace = disconnect
        ? await invoke("close_ssh_workspace", { path: chosen }).then(() => ({
            root: "demo",
            name: playground ? "playground" : "Open a project",
            files: demoEntries(demo),
          }))
        : await invoke<Workspace>("open_workspace", { path: chosen });
      if (remoteName) next.name = remoteName;
      const stopped = Promise.allSettled([invoke("debug_stop")]);
      clearLanguageServers();
      setBreakpoints({});
      setDebugSession({ running: false, path: null, line: null });
      setWorkspace(next);
      setActiveServerId(remoteServerId);
      setExpandedFolders(new Set(["src"]));
      setSidebar(true);
      setMarkdownModes({});
      setFileSplits([]);
      setComparison(null);
      setGraphSelection(null);
      setDiffActive(false);
      ++diffRequest.current;
      setEditorSplitRatios({});
      wsRef.current = next;
      setTabs([]);
      tabsRef.current = [];
      setActive("");
      activeRef.current = "";
      ++fileOpenRequest.current;
      setGit(null);
      setGitRepository("");
      gitRepositoryRef.current = "";
      ++gitStatusRequest.current;
      gitDrafts.current.clear();
      setCommit("");
      clearQueuedProblems(() => true);
      setProblems([]);
      setLspStatus({});
      setMatches([]);
      setPendingRun(null);
      setTerminalId(null);
      if (!disconnect && !remoteName)
        setRecent((old) => {
          const list = [chosen, ...old.filter((p) => p !== chosen)].slice(0, 5);
          localStorage.setItem("devyy.recent", JSON.stringify(list));
          return list;
        });
      const painted = afterWorkspacePaint();
      workspaceServices.current = syncExtensionHost(
        Promise.all([stopped, painted]),
      ).catch((error) => log(String(error)));
      if (disconnect) {
        log("Disconnected from SSH");
        return true;
      }
      log(`Opened ${next.root}`);
      const first =
        next.files.find((f) =>
          ["src/main.rs", "src/App.tsx", "src/main.ts", "README.md"].includes(
            f.path,
          ),
        ) ?? next.files.find((f) => !f.directory);
      // An automatic tab should never delay or take focus from user navigation.
      if (first) void openFile(first.path, undefined, true);
      const currentWorkspace = () =>
        openRequest === workspaceOpenRequest.current &&
        wsRef.current.root === next.root;
      void painted.then(() => {
        whenWorkspaceIdle(() => {
          if (!currentWorkspace()) return;
          void refresh(true);
        });
      });
      return true;
    } catch (e) {
      notify(e);
      return false;
    } finally {
      busyRef.current = false;
      workspaceWaiters.current.splice(0).forEach((resolve) => resolve());
      setWorkspaceScan(false);
    }
  }
  function connectWorkspaceDocument(path: string) {
    if (!native || wsRef.current.root === "demo" || wsRef.current.remotePath)
      return;
    const request = workspaceOpenRequest.current;
    const lang = language(path);
    void workspaceServices.current
      .then(() => {
        if (request !== workspaceOpenRequest.current) return false;
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab &&
          !tab.extensionUri &&
          !tab.previewKind &&
          !tab.webviewId &&
          path !== "devyy:settings"
          ? connectDocument(path, lang, tab.content)
          : false;
      })
      .then((connected) => {
        if (connected && request === workspaceOpenRequest.current)
          setLspStatus((s) =>
            s[lang] === "Connected" ? s : { ...s, [lang]: "Connected" },
          );
      })
      .catch((error) => {
        if (request !== workspaceOpenRequest.current) return;
        setLspStatus((s) => ({ ...s, [lang]: String(error) }));
        log(String(error));
      });
  }
  async function openFile(path: string, line?: number, initial = false) {
    const root = wsRef.current.root;
    const workspaceRequest = workspaceOpenRequest.current;
    const request = ++fileOpenRequest.current;
    try {
      let existing = tabsRef.current.find((t) => t.path === path);
      if (!existing) {
        const previewKind = filePreviewKind(path);
        const doc =
          previewKind && !/\.svg$/i.test(path)
            ? { content: "", modified: "" }
            : root === "demo"
              ? { content: demo[path] ?? "", modified: "" }
              : await invoke<{ content: string; modified: string }>(
                  "read_file",
                  {
                    path,
                  },
                );
        if (
          root !== wsRef.current.root ||
          workspaceRequest !== workspaceOpenRequest.current ||
          (initial && request !== fileOpenRequest.current)
        )
          return;
        existing = tabsRef.current.find((tab) => tab.path === path);
        if (!existing) {
          existing = {
            path,
            previewKind,
            readOnly: previewKind && !/\.svg$/i.test(path) ? true : undefined,
            content: doc.content,
            saved: doc.content,
            modified: doc.modified,
          };
          setTabs((old) =>
            old.some((t) => t.path === path) ? old : [...old, existing!],
          );
          tabsRef.current = [...tabsRef.current, existing];
        }
      }
      if (request === fileOpenRequest.current) {
        setActive(path);
        activeRef.current = path;
      }
      connectWorkspaceDocument(path);
      if (line)
        setTimeout(() => {
          if (
            request === fileOpenRequest.current &&
            workspaceRequest === workspaceOpenRequest.current
          )
            jumpTo(path, line);
        }, 40);
    } catch (e) {
      if (
        workspaceRequest === workspaceOpenRequest.current &&
        (!initial || request === fileOpenRequest.current)
      )
        notify(e);
    }
  }
  useEffect(() => {
    const handler = (event: Event) => {
      const p = (event as CustomEvent).detail?.path;
      if (p && typeof p === "string") void openFile(p);
    };
    window.addEventListener("devyy-open-file", handler);
    return () => window.removeEventListener("devyy-open-file", handler);
  }, []);
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
  function openSettingsTab(query?: string) {
    if (query !== undefined) {
      setSettingsTabQuery(query);
      if (query.trim()) setSettingsPage("extensions");
    }
    const path = "devyy:settings";
    let existing = tabsRef.current.find((t) => t.path === path);
    if (!existing) {
      existing = {
        path,
        content: "",
        saved: "",
        modified: "",
      };
      setTabs((old) =>
        old.some((t) => t.path === path) ? old : [...old, existing!],
      );
      tabsRef.current = [...tabsRef.current, existing];
    }
    setActive(path);
    activeRef.current = path;
  }
  useEffect(() => {
    const reconnect = () => {
      setLspStatus({});
      for (const tab of tabsRef.current) connectWorkspaceDocument(tab.path);
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
      if (message.event === "output") {
        const src =
          typeof payload.name === "string" && payload.name.trim()
            ? payload.name.trim()
            : "Extension Host";
        const lvl =
          typeof payload.level === "string" &&
          ["info", "warn", "error", "debug", "trace"].includes(payload.level)
            ? (payload.level as "info" | "warn" | "error" | "debug" | "trace")
            : "info";
        appendOutput(String(payload.text ?? ""), src, lvl);
      }
      if (
        message.event === "outputChannelCreated" &&
        typeof payload.name === "string" &&
        payload.name
      ) {
        const channelName = payload.name.trim();
        setDiscoveredChannels((prev) =>
          prev.includes(channelName) ? prev : [...prev, channelName],
        );
      }
      if (message.event === "outputClear") {
        const target =
          typeof payload.name === "string" ? payload.name.trim() : undefined;
        if (target) {
          setOutputEntries((prev) => prev.filter((e) => e.source !== target));
        } else {
          setOutputEntries([]);
        }
      }
      if (message.event === "outputReplace") {
        const src =
          typeof payload.name === "string" && payload.name.trim()
            ? payload.name.trim()
            : "Extension Host";
        const text = String(payload.text ?? "");
        const now = new Date();
        const timestamp = now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const lines = text.split(/\r?\n/);
        const newEntries: OutputEntry[] = lines.map((line, i) => ({
          id: `out-replace-${Date.now()}-${i}`,
          timestamp,
          source: src,
          text: line,
          level: "info",
        }));
        setOutputEntries((prev) => [
          ...prev.filter((e) => e.source !== src),
          ...newEntries,
        ]);
      }
      if (message.event === "outputShow") {
        setPanel(true);
        setPanelTab("output");
        if (typeof payload.name === "string" && payload.name.trim()) {
          setOutputSource(payload.name.trim());
        }
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
          queueProblems(
            path,
            (payload.diagnostics as LspDiagnostic[]).map((diagnostic) => ({
              ...diagnostic,
              severity:
                diagnostic.severity === undefined ? 1 : diagnostic.severity + 1,
              path,
              collection: String(payload.collection),
            })),
            String(payload.collection),
          );
      }
      if (
        message.event === "webview" &&
        payload.viewKind !== "view" &&
        payload.id !== aiMainView(String(payload.extension))
      ) {
        const id = String(payload.id),
          path = `devyy:webview:${id}`;
        const existing = tabsRef.current.some((tab) => tab.webviewId === id);
        if (!existing) {
          const next: Tab = {
            path,
            webviewId: id,
            readOnly: true,
            content: "",
            saved: "",
            modified: "",
          };
          tabsRef.current = [...tabsRef.current, next];
          setTabs(tabsRef.current);
          if (!payload.preserveFocus) {
            setActive(path);
            activeRef.current = path;
          }
        }
      }
      if (message.event === "focusWebview" && !payload.preserveFocus) {
        const tab = tabsRef.current.find((tab) => tab.webviewId === payload.id);
        if (tab) {
          setActive(tab.path);
          activeRef.current = tab.path;
        }
      }
      if (message.event === "webviewClosed") {
        const target = tabsRef.current.find(
          (tab) => tab.webviewId === payload.id,
        );
        if (target) void closeTab(target.path, false);
      }
      if (message.event === "hostError")
        log(`Extension host: ${payload.error}`, "Extension Host", "error");
      if (message.event === "openFile" && typeof payload.uri === "string") {
        const path = pathFromUri(payload.uri, wsRef.current.root);
        if (path) void openFile(path);
      }
    };
    const reset = () => {
      const remaining = tabsRef.current.filter((tab) => !tab.webviewId);
      tabsRef.current = remaining;
      setTabs(remaining);
      if (activeRef.current.startsWith("devyy:webview:"))
        setActive(remaining.at(-1)?.path ?? "");
      clearQueuedProblems((_path, collection) => !!collection);
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
        : tabsRef.current.filter(
            (tab) =>
              !tab.previewKind &&
              !tab.webviewId &&
              tab.path !== "devyy:settings",
          );
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
    let viewportTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(viewportTimer);
      publishExtensionState.current();
    };
    const updateViewport = () => {
      clearTimeout(viewportTimer);
      viewportTimer = setTimeout(update, 80);
    };
    window.addEventListener("devyy-editor-viewport", updateViewport);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("devyy-editor-selection", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("devyy-editor-selection", update);
      window.removeEventListener("devyy-editor-viewport", updateViewport);
      clearTimeout(viewportTimer);
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
      case "openSettings": {
        const query = typeof p?.query === "string" ? p.query : "";
        openSettingsTab(p.category === "keyboard" ? "" : query);
        if (p.category === "keyboard") setSettingsPage("keyboard");
        return null;
      }
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
        const range = p.range as {
          start: { line: number; character: number };
          end?: { line: number; character: number };
        };
        const revealType = typeof p.revealType === "number" ? p.revealType : 0;
        if (path) {
          if (activeRef.current !== path) await openFile(path);
          jumpTo(path, range.start.line + 1, range.start.character, revealType);
        }
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
  function jumpTo(path: string, line: number, character = 0, revealType = 0) {
    const view = views.current.get(path);
    if (!view) return;
    const pos = offset(view, { line: line - 1, character });
    const y =
      revealType === 3 ? "start" : revealType === 0 ? "nearest" : "center";
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y }),
    });
    view.focus();
  }
  const reviewAISuggestion = useCallback(
    async (
      path: string,
      original: string,
      modified: string,
      create = false,
      proposalId?: string,
    ) => {
      const root = wsRef.current.root;
      try {
        if (!create && !tabsRef.current.some((item) => item.path === path))
          await openFile(path);
        if (root !== wsRef.current.root) return;
        const target = tabsRef.current.find((item) => item.path === path);
        if ((!create && (!target || target.readOnly)) || (create && target)) {
          showToast.error(
            create
              ? "A file with this path is already open. Ask for a fresh edit proposal."
              : "Open this file in an editable tab before reviewing a replacement.",
          );
          return;
        }
        setComparison({
          source: "ai",
          title: `AI suggestion: ${filename(path)}`,
          path,
          original,
          modified,
          create,
          proposalId,
          workspaceRoot: root,
        });
        setDiffActive(true);
      } catch (error) {
        showToast.error(String(error));
      }
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
  const applyAIProposal = useCallback(
    async (targetProp: {
      path: string;
      original: string;
      modified: string;
      create?: boolean;
      proposalId?: string;
      workspaceRoot?: string;
    }) => {
      const root = wsRef.current.root;
      if (targetProp.workspaceRoot && targetProp.workspaceRoot !== root) {
        showToast.error("Open the proposal's workspace before applying it.");
        return false;
      }
      if (targetProp.create) {
        if (tabsRef.current.some((item) => item.path === targetProp.path)) {
          edit(targetProp.path, targetProp.modified);
        } else {
          const next = {
            path: targetProp.path,
            content: targetProp.modified,
            saved: "",
            modified: "devyy:new",
          };
          tabsRef.current = [...tabsRef.current, next];
          setTabs(tabsRef.current);
          setWorkspace((workspace) => ({
            ...workspace,
            files: [
              ...workspace.files.filter((file) => file.path !== next.path),
              {
                path: next.path,
                name: filename(next.path),
                directory: false,
              },
            ],
          }));
        }
        setActive(targetProp.path);
        if (targetProp.proposalId)
          setAIProposalStatus(targetProp.proposalId, "applied");
        return true;
      }
      let target = tabsRef.current.find(
        (item) => item.path === targetProp.path,
      );
      if (!target) {
        await openFile(targetProp.path);
        target = tabsRef.current.find((item) => item.path === targetProp.path);
      }
      if (
        !target ||
        target.readOnly ||
        (targetProp.original && target.content !== targetProp.original)
      ) {
        showToast.error(
          "The file changed since this suggestion. Attach its latest contents and ask again.",
        );
        return false;
      }
      edit(targetProp.path, targetProp.modified);
      setActive(targetProp.path);
      if (targetProp.proposalId)
        setAIProposalStatus(targetProp.proposalId, "applied");
      return true;
    },
    [edit, openFile],
  );

  const applyAllAIProposals = useCallback(
    async (proposals?: AIProposal[]) => {
      const list = proposals ?? getPendingAIProposals();
      const pending = list.filter(
        (p) => p.status !== "applied" && p.status !== "dismissed",
      );
      if (!pending.length) {
        showToast.info("No pending proposals to apply.");
        return;
      }
      let appliedCount = 0;
      for (const p of pending) {
        const ok = await applyAIProposal({
          path: p.path,
          original: p.original,
          modified: p.modified,
          create: p.create,
          proposalId: p.id,
          workspaceRoot: p.workspace,
        });
        if (ok) appliedCount++;
      }
      if (appliedCount > 0) {
        showToast.success(
          `Approved and applied ${appliedCount} change${appliedCount > 1 ? "s" : ""}.`,
        );
      }
      setComparison(null);
      setDiffActive(false);
    },
    [applyAIProposal],
  );
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
  const previousDiagnostics = useRef<Record<string, LspDiagnostic[]>>({});
  const diagnosticsByPath = useMemo(() => {
    const map: Record<string, LspDiagnostic[]> = {};
    for (const p of problems) (map[p.path] ??= []).push(p);
    for (const [path, entries] of Object.entries(map)) {
      const previous = previousDiagnostics.current[path];
      if (
        previous?.length === entries.length &&
        previous.every((item, index) => item === entries[index])
      )
        map[path] = previous;
    }
    previousDiagnostics.current = map;
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
    return registerAIContext("workbench-files", sources);
  }, [workspace.root, workspace.files, tabs.length]);
  useEffect(() => {
    const sources: AIContextSource[] = [];
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
        const main = view!.state.selection.main;
        const startLine = view!.state.doc.lineAt(main.from).number;
        const endLine = view!.state.doc.lineAt(main.to).number;
        const rangeTag =
          startLine === endLine
            ? `#L${startLine}`
            : `#L${startLine}-L${endLine}`;
        return {
          kind: "selection",
          id: `${path}:${main.from}:${main.to}`,
          title: `${filename(path)} ${rangeTag}`,
          path,
          startLine,
          endLine,
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
    return registerAIContext("workbench-diagnostics", sources);
  }, [active, problems]);
  useEffect(() => {
    const sources: AIContextSource[] = [];
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
  }, [output, comparison]);
  async function save(path = activeRef.current): Promise<boolean> {
    if (busyRef.current) return false;
    const previous = saveQueue.current.get(path);
    const operation = (async () => {
      if (previous) await previous;
      const target = tabsRef.current.find((t) => t.path === path);
      if (
        !target ||
        (target.saved === target.content && target.modified !== "devyy:new")
      )
        return true;
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
          if (
            target.modified === "devyy:new" &&
            root === wsRef.current.root &&
            !busyRef.current
          )
            connectWorkspaceDocument(path);
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
  async function closeTab(path: string, disposeWebview = true) {
    const target = tabsRef.current.find((t) => t.path === path);
    if (
      target &&
      (target.content !== target.saved || target.modified === "devyy:new") &&
      !(await ask(`Discard unsaved changes to ${filename(path)}?`, {
        title: "Close file?",
        confirmLabel: "Discard changes",
        danger: true,
      }))
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
    if (target?.webviewId && disposeWebview)
      void hostRequest("closeWebview", { id: target.webviewId }).catch(notify);
    if (!target?.webviewId && !target?.previewKind && path !== "devyy:settings")
      void closeDocument(path).catch(() => {});
    clearQueuedProblems((queuedPath) => queuedPath === path);
    setProblems((old) => old.filter((p) => p.path !== path));
    return true;
  }
  async function newItem(directory: boolean, parent = "") {
    if (!playground && wsRef.current.root === "demo") {
      await openFolder();
      if (wsRef.current.root === "demo") return;
    }
    const workspace = wsRef.current;
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
  async function moveItem(path: string, newPath: string) {
    const root = wsRef.current.root;
    if (busyRef.current)
      throw new Error("Wait for the project to finish opening.");
    if (path === newPath) return;

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
          t.modified === "devyy:new",
      )
    )
      throw new Error("Save new files before moving them.");
    if (root !== "demo") await invoke("rename_file", { path, newPath });
    if (root !== wsRef.current.root) return;
    const replace = (p: string) =>
      p === path
        ? newPath
        : p.startsWith(path + "/")
          ? newPath + p.slice(path.length)
          : p;
    for (const t of tabsRef.current.filter((t) => replace(t.path) !== t.path))
      await closeDocument(t.path).catch(() => {});
    setTabs((ts) => ts.map((t) => ({ ...t, path: replace(t.path) })));
    setActive(replace(active));
    setFileSplits((groups) => groups.map(([a, b]) => [replace(a), replace(b)]));
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
    setBreakpoints((old) =>
      Object.fromEntries(
        Object.entries(old).map(([path, lines]) => [replace(path), lines]),
      ),
    );
    clearQueuedProblems(() => true);
    setProblems([]);
    if (workspace.root === "demo") {
      setDemo((d) =>
        Object.fromEntries(Object.entries(d).map(([p, c]) => [replace(p), c])),
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
  }
  function renameItem(path: string) {
    setDialog({
      title: "Rename item",
      description: "Rename or move this item within your project.",
      initial: path,
      label: "Rename",
      submit: (newPath) => moveItem(path, newPath),
    });
  }

  async function deleteItem(path: string) {
    const root = wsRef.current.root;
    const directory = wsRef.current.files.find(
      (file) => file.path === path,
    )?.directory;
    const contains = (candidate: string) =>
      candidate === path || candidate.startsWith(path + "/");
    const unsaved = tabsRef.current.some(
      (tab) =>
        contains(tab.path) &&
        (tab.content !== tab.saved || tab.modified === "devyy:new"),
    );
    if (
      (settings.confirmDelete || unsaved) &&
      !(await ask(
        `${path}\n\n${directory ? "This permanently deletes the folder and everything inside it." : "This permanently deletes the file."}${unsaved ? " Unsaved changes in affected files will be discarded." : ""}`,
        {
          title: `Delete ${directory ? "folder" : "file"} “${filename(path)}”?`,
          confirmLabel: directory ? "Delete folder" : "Delete file",
          danger: true,
          rememberLabel: "Do not ask again for file and folder deletion",
          onRemember: () =>
            setSettings((value) => ({ ...value, confirmDelete: false })),
        },
      ))
    )
      return;
    if (root !== wsRef.current.root || busyRef.current) return;
    try {
      if (root === "demo") {
        setDemo((d) => {
          return Object.fromEntries(
            Object.entries(d).filter(([name]) => !contains(name)),
          );
        });
        setWorkspace((w) => ({
          ...w,
          files: w.files.filter((f) => !contains(f.path)),
        }));
      } else {
        await invoke("delete_file", { path });
        await refresh();
      }
      const removed = tabsRef.current.filter((tab) => contains(tab.path));
      const left = tabsRef.current.filter((t) => !contains(t.path));
      setTabs(left);
      tabsRef.current = left;
      setFileSplits((groups) =>
        removed.reduce(
          (current, tab) => separateTab(current, tab.path),
          groups,
        ),
      );
      clearQueuedProblems(contains);
      setProblems((old) => old.filter((problem) => !contains(problem.path)));
      setMarkdownModes((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([name]) => !contains(name)),
        ),
      );
      setBreakpoints((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([name]) => !contains(name)),
        ),
      );
      if (contains(activeRef.current)) setActive(left.at(-1)?.path ?? "");
      removed.forEach((tab) => void closeDocument(tab.path).catch(() => {}));
    } catch (e) {
      notify(e);
    }
  }

  async function deleteItems(paths: string[]) {
    if (!paths.length) return;
    if (paths.length === 1) return deleteItem(paths[0]);
    const root = wsRef.current.root;
    const containsAny = (candidate: string) =>
      paths.some((p) => candidate === p || candidate.startsWith(p + "/"));
    const unsaved = tabsRef.current.some(
      (tab) =>
        containsAny(tab.path) &&
        (tab.content !== tab.saved || tab.modified === "devyy:new"),
    );
    if (
      (settings.confirmDelete || unsaved) &&
      !(await ask(
        `Are you sure you want to permanently delete these ${paths.length} items and their contents?${unsaved ? "\n\nUnsaved changes in affected files will be discarded." : ""}`,
        {
          title: `Delete ${paths.length} items?`,
          confirmLabel: `Delete ${paths.length} items`,
          danger: true,
          rememberLabel: "Do not ask again for file and folder deletion",
          onRemember: () =>
            setSettings((value) => ({ ...value, confirmDelete: false })),
        },
      ))
    )
      return;
    if (root !== wsRef.current.root || busyRef.current) return;
    try {
      if (root === "demo") {
        setDemo((d) => {
          return Object.fromEntries(
            Object.entries(d).filter(([name]) => !containsAny(name)),
          );
        });
        setWorkspace((w) => ({
          ...w,
          files: w.files.filter((f) => !containsAny(f.path)),
        }));
      } else {
        for (const p of paths) {
          try {
            await invoke("delete_file", { path: p });
          } catch {}
        }
        await refresh();
      }
      const removed = tabsRef.current.filter((tab) => containsAny(tab.path));
      const left = tabsRef.current.filter((t) => !containsAny(t.path));
      setTabs(left);
      tabsRef.current = left;
      setFileSplits((groups) =>
        removed.reduce(
          (current, tab) => separateTab(current, tab.path),
          groups,
        ),
      );
      clearQueuedProblems(containsAny);
      setProblems((old) => old.filter((problem) => !containsAny(problem.path)));
      setMarkdownModes((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([name]) => !containsAny(name)),
        ),
      );
      setBreakpoints((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([name]) => !containsAny(name)),
        ),
      );
      if (containsAny(activeRef.current)) setActive(left.at(-1)?.path ?? "");
      removed.forEach((tab) => void closeDocument(tab.path).catch(() => {}));
    } catch (e) {
      notify(e);
    }
  }

  async function initGitRepository() {
    try {
      await invoke("git_init");
      await refreshGit();
      notify("Git repository initialized.", false);
    } catch (e) {
      notify(e);
    }
  }
  useEffect(() => {
    if (!settings.autoSave) return;
    const id = setTimeout(() => {
      for (const target of tabsRef.current)
        if (target.content !== target.saved || target.modified === "devyy:new")
          void save(target.path);
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
        queueProblems(
          path,
          payload.params.diagnostics.map((d) => ({ ...d, path })),
        );
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
    let confirmingClose = false;
    const before = (e: BeforeUnloadEvent) => {
      if (
        !native &&
        tabsRef.current.some(
          (t) => t.content !== t.saved || t.modified === "devyy:new",
        )
      ) {
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
          if (
            !tabsRef.current.some(
              (t) => t.content !== t.saved || t.modified === "devyy:new",
            )
          )
            return;
          e.preventDefault();
          if (confirmingClose) return;
          confirmingClose = true;
          try {
            if (
              await ask("Discard unsaved changes and close devyy?", {
                title: "Quit Devyy?",
                confirmLabel: "Discard and quit",
                danger: true,
              })
            )
              await getCurrentWindow().destroy();
          } catch (error) {
            showToast.error(String(error));
          } finally {
            confirmingClose = false;
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
  async function findReferences() {
    const view = currentView.current;
    if (!view || !tab) return;
    try {
      type Location = {
        uri: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      };
      let result = await languageRequest<Location[]>(
        tab.path,
        "textDocument/references",
        toPosition(view, view.state.selection.main.head),
      );
      if (!result || result.length === 0) {
        type ProviderLocation = {
          uri: string | { external: string };
          range: Location["range"];
        };
        const values = await extensionLanguageFeature<ProviderLocation[]>(
          "provideReferences",
          tab.path,
          toPosition(view, view.state.selection.main.head),
          undefined,
          { includeDeclaration: true },
        );
        result = values.flat().map((v) => ({
          ...v,
          uri:
            typeof v.uri === "string"
              ? v.uri
              : (v.uri as { external: string }).external,
        }));
      }
      if (!result || result.length === 0) {
        notify("No references found.", false);
        return;
      }
      const first = result[0];
      const p = pathFromUri(first.uri, workspace.root);
      if (p) {
        await openFile(p);
        setTimeout(
          () =>
            jumpTo(p, first.range.start.line + 1, first.range.start.character),
          50,
        );
      }
      if (result.length > 1) {
        notify(`Found ${result.length} references.`, false);
      }
    } catch (e) {
      notify(e);
    }
  }
  async function renameSymbol() {
    const view = currentView.current;
    if (!view || !tab) return;
    const head = view.state.selection.main.head;
    const word = view.state.wordAt(head);
    let initialName = word ? view.state.sliceDoc(word.from, word.to) : "";
    try {
      const prep = await languageRequest<{
        range?: unknown;
        placeholder?: string;
      }>(tab.path, "textDocument/prepareRename", toPosition(view, head));
      if (prep?.placeholder) initialName = prep.placeholder;
    } catch {}

    setDialog({
      title: "Rename symbol",
      description: "Enter a new name for the symbol across the workspace.",
      initial: initialName,
      label: "Rename",
      submit: async (newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === initialName) return;
        type WorkspaceEditResult = {
          changes?: Record<
            string,
            Array<{
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
              newText: string;
            }>
          >;
          documentChanges?: Array<{
            textDocument: { uri: string };
            edits: Array<{
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
              newText: string;
            }>;
          }>;
        };

        let result = await languageRequest<WorkspaceEditResult>(
          tab.path,
          "textDocument/rename",
          toPosition(view, head),
          { newName: trimmed },
        );
        if (!result || (!result.changes && !result.documentChanges)) {
          const values = await extensionLanguageFeature<WorkspaceEditResult>(
            "provideRenameEdits",
            tab.path,
            toPosition(view, head),
            undefined,
            { newName: trimmed },
          );
          if (values && values[0]) result = values[0];
        }

        if (!result) {
          notify("This language server could not rename the symbol.", false);
          return;
        }

        const documents: Array<{
          uri: string;
          edits: Array<{
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
            newText: string;
          }>;
        }> = [];

        if (result.changes) {
          for (const [uri, edits] of Object.entries(result.changes)) {
            documents.push({ uri, edits });
          }
        } else if (result.documentChanges) {
          for (const docChange of result.documentChanges) {
            if ("edits" in docChange) {
              documents.push({
                uri: docChange.textDocument.uri,
                edits: docChange.edits,
              });
            }
          }
        }

        if (documents.length === 0) {
          notify("No matching symbols found.", false);
          return;
        }

        const success = await extensionWorkbenchRequest({
          id: `rename-${Date.now()}`,
          extension: "workbench",
          method: "applyEdit",
          params: { documents },
        });

        if (success !== false) {
          const count = documents.reduce((sum, d) => sum + d.edits.length, 0);
          notify(
            `Renamed ${count} occurrence${count === 1 ? "" : "s"} across ${documents.length} file${documents.length === 1 ? "" : "s"}.`,
            false,
          );
        } else {
          notify(
            "Could not rename the symbol. Your files have not been changed.",
            true,
          );
        }
      },
    });
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
  async function run(command?: string) {
    const { files, root } = wsRef.current;
    const task =
      command ??
      (files.some((file) => file.path === "Cargo.toml")
        ? "cargo run"
        : files.some((file) => file.path === "package.json")
          ? "npm run dev"
          : "");
    if (!native || root === "demo") {
      notify("Open a local project in the desktop app to run commands.", false);
      return;
    }
    if (!task.trim()) {
      setSection("run");
      showSidebar(true);
      notify(
        "No default task found. Choose a project task or open the terminal.",
        false,
      );
      return;
    }
    if (!(await saveAll()) || wsRef.current.root !== root) return;
    showPanel(true);
    setPanelTab("terminal");
    terminalGroup.current?.ensure();
    setPendingRun(task);
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
    if (gitOperationBusy.current) return false;
    gitOperationBusy.current = true;
    setGitBusy(true);
    const root = wsRef.current.root,
      repository = gitRepositoryRef.current;
    try {
      await action();
      if (
        root !== wsRef.current.root ||
        repository !== gitRepositoryRef.current
      )
        return false;
      await refreshGit();
      return true;
    } catch (e) {
      notify(e);
      return false;
    } finally {
      gitOperationBusy.current = false;
      setGitBusy(false);
    }
  }
  function selectGitRepository(repository: string) {
    if (gitOperationBusy.current || repository === gitRepositoryRef.current)
      return;
    gitDrafts.current.set(gitRepositoryRef.current, commit);
    setCommit(gitDrafts.current.get(repository) ?? "");
    gitRepositoryRef.current = repository;
    setGitRepository(repository);
    setGit(null);
    setGitError("");
    setComparison(null);
    setDiffActive(false);
    ++diffRequest.current;
    void refreshGit();
  }
  async function manageGitBranch(
    action: GitBranchAction,
    branch: string,
    name?: string,
  ) {
    if (
      action === "merge" &&
      tabsRef.current.some(
        (tab) => tab.content !== tab.saved || tab.modified === "devyy:new",
      )
    ) {
      notify("Save or close your unsaved files before updating the branch.");
      return;
    }
    if (
      action === "delete" &&
      !(await ask(
        `Delete ${branch.replace(/^refs\/heads\//, "")}? Git will keep branches with unmerged commits.`,
        {
          title: "Delete branch?",
          confirmLabel: "Delete branch",
          danger: true,
        },
      ))
    )
      return;
    if (
      await gitAction(() =>
        invoke("git_branch_action", {
          repository: gitRepositoryRef.current,
          action,
          branch,
          name,
        }),
      )
    ) {
      if (action === "merge") {
        setComparison(null);
        setDiffActive(false);
        await reloadBuffers();
      }
    }
  }
  async function manageGitSubmodule(
    action: GitSubmoduleAction,
    path?: string,
    url?: string,
  ) {
    if (
      action === "update" &&
      tabsRef.current.some(
        (tab) => tab.content !== tab.saved || tab.modified === "devyy:new",
      )
    ) {
      notify("Save or close your unsaved files before updating submodules.");
      return false;
    }
    if (
      await gitAction(() =>
        invoke("git_submodule_action", {
          repository: gitRepositoryRef.current,
          action,
          path,
          url,
        }),
      )
    ) {
      await reloadBuffers();
      return true;
    }
    return false;
  }
  async function showDiff(path: string, staged: boolean) {
    const request = ++diffRequest.current,
      root = wsRef.current.root,
      repository = gitRepositoryRef.current;
    try {
      const document = await invoke<{
        original: string;
        modified: string;
        binary: boolean;
      }>("git_diff_files", { path, staged, repository });
      if (
        request !== diffRequest.current ||
        root !== wsRef.current.root ||
        repository !== gitRepositoryRef.current
      )
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
  async function showCommitDiff(
    hash: string,
    path: string,
    parent: number,
    parentHash?: string,
  ) {
    const request = ++diffRequest.current,
      root = wsRef.current.root,
      repository = gitRepositoryRef.current;
    try {
      const document = await invoke<{
        original: string;
        modified: string;
        binary: boolean;
      }>("git_commit_diff", { hash, path, parent, repository });
      if (
        request !== diffRequest.current ||
        root !== wsRef.current.root ||
        repository !== gitRepositoryRef.current
      )
        return;
      setComparison({
        ...document,
        path,
        source: "history",
        title: `${filename(path)} (${hash.slice(0, 8)})`,
        commitHash: hash,
        parentIndex: parent,
        originalLabel: parentHash ? parentHash.slice(0, 10) : "Empty tree",
        modifiedLabel: hash.slice(0, 10),
      });
      setDiffActive(true);
      setGraphSelection(null);
    } catch (error) {
      notify(error);
    }
  }
  async function reloadBuffers() {
    const root = wsRef.current.root;
    for (const tab of [...tabsRef.current]) {
      if (
        tab.extensionUri ||
        tab.content !== tab.saved ||
        tab.modified === "devyy:new"
      )
        continue;
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
      } catch {}
    }
    await refresh();
  }
  async function discardGitFile(path: string) {
    if (
      !(await ask(
        `Discard working changes to ${path}? This also discards unsaved edits to this file. Staged changes are kept.`,
        {
          title: "Discard working changes?",
          confirmLabel: "Discard changes",
          danger: true,
        },
      ))
    )
      return;
    if (
      await gitAction(() =>
        invoke("git_discard", { path, repository: gitRepositoryRef.current }),
      )
    ) {
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
  async function switchGitBranch(
    branch: string,
    create = false,
    startPoint?: string,
  ) {
    if (
      tabsRef.current.some(
        (tab) => tab.content !== tab.saved || tab.modified === "devyy:new",
      )
    ) {
      notify("Save or close your unsaved files before switching branches.");
      return;
    }
    if (
      await gitAction(() =>
        invoke("git_switch_branch", {
          branch,
          create,
          startPoint,
          repository: gitRepositoryRef.current,
        }),
      )
    ) {
      setComparison(null);
      setDiffActive(false);
      await reloadBuffers();
    }
  }
  async function stageGitFile(path: string, staged: boolean) {
    if (
      await gitAction(() =>
        invoke("git_stage", {
          path,
          staged,
          repository: gitRepositoryRef.current,
        }),
      )
    ) {
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
    references: () => {
      if (!diffActive) void findReferences();
    },
    rename: () => {
      if (!diffActive) void renameSymbol();
    },
    "signature-help": () => {
      if (currentView.current && active) {
        void triggerSignatureHelp(currentView.current, active);
      }
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
    theme: () => {
      activateStoreTheme(undefined);
      setSettings((s) => ({
        ...s,
        theme: appearanceSettings.theme === "paper" ? "midnight" : "paper",
        followSystemTheme: false,
      }));
    },
    wrap: () => setSettings((s) => ({ ...s, wordWrap: !s.wordWrap })),
    help: () => setHelp(true),
    reload: () => window.location.reload(),
  };
  const editorIsOpen = !!tab;
  const editorHasSelection =
    !!currentView.current && !currentView.current.state.selection.main.empty;
  const extensionContexts = useMemo(
    () => ({
      ...hostContexts,
      ...resourceContext(
        fileUri(
          `${workspace.root === "demo" ? "/demo" : workspace.root}/${active}`,
        ),
        language(active),
      ),
      workspaceFolderCount: workspace.root === "demo" ? 0 : 1,
      editorIsOpen,
      editorHasSelection,
    }),
    [hostContexts, workspace.root, active, editorIsOpen, editorHasSelection],
  );
  const extensionCommands = useMemo(() => {
    const commands: PaletteItem[] = [];
    for (const extension of installedExtensions) {
      if (!extension.enabled) continue;
      for (const item of extension.contributes.commands ?? []) {
        if (
          !matchesContext(item.enablement, extensionContexts) ||
          !commandPaletteVisible(extension, item.command, extensionContexts)
        )
          continue;
        commands.push({
          id: item.command,
          label: item.category ? `${item.category}: ${item.title}` : item.title,
          detail: extension.name,
          extension: { id: extension.id, icon: extension.icon },
          run: () => void extensionCommand(item.command).catch(notify),
        });
      }
    }
    return commands;
  }, [installedExtensions, extensionContexts]);
  const commands: PaletteItem[] = commandInfo.map(([id, label, detail]) => ({
    id,
    label,
    detail,
    shortcut: displayBinding(bindings[id]),
    run: commandActions[id],
  }));
  commands.push(...extensionCommands);
  commandRef.current = commands;
  const shortcutData = useRef({
    installedExtensions,
    contexts: hostContexts,
    active,
    root: workspace.root,
    overrides: settings.bindings,
  });
  shortcutData.current = {
    installedExtensions,
    contexts: hostContexts,
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
        activeSurface(
          ".setup-dialog,.extension-prompt,.desktop-theme-preview[open]",
        )
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
        document.querySelector(".desktop-theme-preview[open]") ||
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
      if (updateHandoff.current) return;
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
        if (activeSurface('[role="menu"], [data-escape-scope="active"]'))
          return;
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
    const webviewShortcut = (event: Event) => {
      modalReturnFocus.current = document.activeElement as HTMLElement | null;
      dispatchBinding(
        String((event as CustomEvent).detail),
        targetElement(document.activeElement),
      );
    };
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
  useEffect(() => {
    if (!native) return;
    let disposed = false,
      stop: (() => void) | undefined;
    let queue = Promise.resolve();
    const drain = () => {
      queue = queue
        .then(async () => {
          const targets =
            await invoke<{ path: string; directory: boolean }[]>(
              "take_open_targets",
            );
          for (const target of targets ?? []) {
            if (busyRef.current)
              await new Promise<void>((resolve) =>
                workspaceWaiters.current.push(resolve),
              );
            if (disposed) return;
            const action = resolveOpenTarget(target, wsRef.current.root);
            if (action.folder && !(await openFolder(action.folder))) continue;
            if (action.file) await openFile(action.file);
          }
        })
        .catch((error) => log(String(error)));
    };
    void listen("devyy-open-targets", drain).then((unlisten) => {
      if (disposed) unlisten();
      else {
        stop = unlisten;
        drain();
      }
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
  async function editClipboard(action: "cut" | "copy" | "paste") {
    const view = views.current.get(activeRef.current);
    if (!view) return;
    view.focus();
    try {
      if (action === "paste") {
        const text = await readClipboardText();
        if (
          views.current.get(activeRef.current) === view &&
          !view.state.readOnly
        )
          view.dispatch(view.state.replaceSelection(text), {
            userEvent: "input.paste",
          });
      } else {
        const text = view.state.selection.ranges
          .map((r) => view.state.sliceDoc(r.from, r.to))
          .join("\n");
        await writeClipboardText(text);
        if (
          action === "cut" &&
          views.current.get(activeRef.current) === view &&
          !view.state.readOnly
        )
          view.dispatch(view.state.replaceSelection(""), {
            userEvent: "delete.cut",
          });
      }
    } catch (error) {
      notify(String(error));
    }
  }
  function copyPath(path: string, absolute = false) {
    void writeClipboardText(
      absolute && workspace.root !== "demo"
        ? `${(workspace.remotePath ?? workspace.root).replace(/[\\/]$/, "")}/${path}`
        : path,
    )
      .then(() => notify("Path copied.", false))
      .catch(notify);
  }
  function contributedMenu(location: string, path: string, folder = false) {
    const uri = fileUri(
      `${workspace.root === "demo" ? "/demo" : workspace.root}/${path}`,
    );
    const context = {
      ...hostContexts,
      ...resourceContext(uri, language(path), folder),
      editorHasSelection:
        !!currentView.current &&
        !currentView.current.state.selection.main.empty,
    };
    const items = extensionMenuItems(
      installedExtensions,
      location,
      context,
      (id) =>
        void extensionCommand(id, [commandUri(uri), [commandUri(uri)]]).catch(
          notify,
        ),
    );
    if (items.length) items[0].separator = true;
    return items;
  }
  function fileMenu(
    e: React.MouseEvent,
    path: string,
    selectedPaths?: string[],
  ) {
    const isMulti =
      !!selectedPaths &&
      selectedPaths.length > 1 &&
      selectedPaths.includes(path);
    if (isMulti) {
      openMenu(e, [
        {
          label: `Copy relative paths (${selectedPaths.length})`,
          action: () => void writeClipboardText(selectedPaths.join("\n")),
        },
        {
          label: `Copy absolute paths (${selectedPaths.length})`,
          action: () => {
            const abs = selectedPaths.map((p) =>
              workspace.root && workspace.root !== "demo"
                ? `${workspace.root.replace(/\/$/, "")}/${p}`
                : p,
            );
            void writeClipboardText(abs.join("\n"));
          },
        },
        {
          label: `Delete ${selectedPaths.length} items`,
          danger: true,
          separator: true,
          action: () => void deleteItems(selectedPaths),
        },
      ]);
      return;
    }
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
        label: directory ? "Delete folder" : "Delete file",
        danger: true,
        action: () => void deleteItem(path),
      },
      ...contributedMenu("explorer/context", path, !!directory),
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
      ...contributedMenu("editor/title/context", path),
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
            void writeClipboardText(
              window.getSelection()?.toString() ?? "",
            ).catch(notify),
        },
        {
          label: "Copy Markdown",
          action: () =>
            void writeClipboardText(tab?.content ?? "").catch(notify),
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
          void writeClipboardText(text)
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
          void writeClipboardText(
            view.state.sliceDoc(selection.from, selection.to),
          ).catch(notify),
      },
      {
        label: "Paste",
        action: () =>
          void readClipboardText()
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
      {
        label: "Add to Devyy AI",
        separator: true,
        disabled: selection.empty,
        action: () => {
          const fromLine = view.state.doc.lineAt(selection.from).number;
          const toLine = view.state.doc.lineAt(selection.to).number;
          const rangeTag =
            fromLine === toLine ? `#L${fromLine}` : `#L${fromLine}-L${toLine}`;
          const selectedText = view.state.sliceDoc(
            selection.from,
            selection.to,
          );
          const item: AIAttachment = {
            kind: "selection",
            id: `${active}:${selection.from}:${selection.to}`,
            title: `${filename(active)} ${rangeTag}`,
            path: active,
            startLine: fromLine,
            endLine: toLine,
            content: selectedText,
          };
          window.dispatchEvent(
            new CustomEvent("devyy-ai-attach", {
              detail: { items: [item] },
            }),
          );
          window.dispatchEvent(new CustomEvent("devyy-ai-open"));
        },
      },
      menuCommand("find", { separator: true }),
      menuCommand("definition"),
      menuCommand("format"),
      menuCommand("wrap"),
      ...contributedMenu("editor/context", active),
    ]);
  }
  const railItems = [
    { id: "files" as const, icon: Files, label: "Explorer" },
    { id: "search" as const, icon: Search, label: "Search" },
    { id: "git" as const, icon: GitBranch, label: "Source control" },
    { id: "run" as const, icon: Play, label: "Run & build" },
    { id: "remote" as const, icon: Radio, label: "Remote Explorer" },
  ];
  const hasProject = workspace.root !== "demo" || playground;
  useEffect(() => {
    if (section === "search" && !hasProject) setSection("files");
  }, [section, hasProject, git, workspaceScan]);
  const visibleRailItems = railItems.filter(
    (item) =>
      (item.id !== "search" || hasProject) && (item.id !== "git" || !!git),
  );
  const openPreviewLink = useCallback(
    (path: string, line?: number) => {
      void openFile(path, line);
    },
    [workspace.root, demo],
  );
  function tabTitle(t: Tab) {
    return t.webviewId
      ? (extensionWebviews.find((view) => view.id === t.webviewId)?.title ??
          "Extension")
      : t.path === "devyy:settings"
        ? "Settings"
        : filename(t.path);
  }
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
          aria-label={tabTitle(t)}
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
          title={t.path === "devyy:settings" ? "Settings" : t.path}
        >
          {pane && (
            <span className="pane-number" aria-hidden="true">
              {pane}
            </span>
          )}
          {t.webviewId ? (
            <PanelsTopLeft size={14} />
          ) : t.path === "devyy:settings" ? (
            <Settings2 size={14} />
          ) : (
            <FileIcon path={t.path} size={14} />
          )}
          <span className="tab-label">{tabTitle(t)}</span>
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
          {(t.content !== t.saved || t.modified === "devyy:new") && (
            <span className="unsaved-indicator" aria-label="Unsaved changes">
              *
            </span>
          )}
        </button>
        <button
          className="tab-close"
          title={
            t.path === "devyy:settings"
              ? "Close Settings"
              : `Close ${tabTitle(t)}`
          }
          aria-label={
            t.path === "devyy:settings"
              ? "Close Settings"
              : `Close ${tabTitle(t)}`
          }
          onClick={() => void closeTab(t.path)}
        >
          <X size={12} />
        </button>
      </div>
    );
  }
  const [previewSources, setPreviewSources] = useState<Record<string, boolean>>(
    {},
  );
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
            {t.path === "devyy:settings" ? (
              <Settings2 size={12} />
            ) : (
              <FileIcon path={t.path} size={12} />
            )}
            <span>{tabTitle(t)}</span>
            <small>
              {t.path === "devyy:settings"
                ? "Preferences"
                : preview
                  ? "Preview"
                  : "Editor"}
            </small>
          </div>
        )}
        {t.path === "devyy:settings" ? (
          <div className="editor-settings-view">
            <Suspense
              fallback={
                <p className="sidebar-empty" role="status">
                  Loading settings…
                </p>
              }
            >
              <Preferences
                embedded
                initialQuery={settingsTabQuery}
                settings={settings}
                category={settingsPage}
                onCategoryChange={setSettingsPage}
                onViewUpdate={viewUpdate}
                onSetup={() => {
                  void closeTab("devyy:settings");
                  setSetupOpen(true);
                }}
                onChange={setSettings}
                onResetLayout={resetLayout}
                onClose={() => void closeTab("devyy:settings")}
              />
            </Suspense>
          </div>
        ) : t.webviewId ? (
          <ExtensionWebviews
            placement="editor"
            viewId={t.webviewId}
            visible={visible}
            shortcuts={Object.values(bindings).filter(Boolean)}
          />
        ) : t.previewKind && !previewSources[t.path] ? (
          <FilePreview
            path={t.path}
            kind={t.previewKind}
            source={/\.svg$/i.test(t.path) ? t.content : undefined}
            onSource={
              /\.svg$/i.test(t.path)
                ? () => setPreviewSources((old) => ({ ...old, [t.path]: true }))
                : undefined
            }
          />
        ) : (
          <>
            {t.previewKind && (
              <div className="file-preview-toolbar">
                <button
                  onClick={() =>
                    setPreviewSources((old) => ({ ...old, [t.path]: false }))
                  }
                >
                  Show image preview
                </button>
              </div>
            )}
            <div className="editor-source" hidden={preview}>
              <Editor
                path={t.path}
                value={t.content}
                readOnly={t.readOnly || workspaceScan}
                languageId={t.languageId}
                settings={appearanceSettings}
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
          </>
        )}
      </div>
    );
  }
  function renderMarkdownPreview(t: Tab) {
    return (
      <Suspense
        fallback={
          <div className="preview-loading">
            <Skeleton label="Loading preview" />
          </div>
        }
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
      aria-busy={workspaceScan}
      className={`devyy ${focus ? "focus-mode" : ""} ${maximizedPanel && panel ? "panel-maximized" : ""} ${settingsOpen ? "settings-open" : ""}`}
    >
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          {showcase !== "theme" && <span className="window-space" />}
          <button
            className="titlebar-app"
            onClick={() => setActive("")}
            aria-label="devyy home"
          >
            {themePreview?.theme.manifest.icon ? (
              <img
                width={19}
                height={19}
                alt=""
                src={themePreview.theme.manifest.icon}
              />
            ) : (
              <Asterisk size={19} strokeWidth={2.2} />
            )}
            <span>devyy</span>
          </button>
          <span className="title-divider" data-tauri-drag-region />
          <Popover.Root
            open={workspaceMenuOpen}
            onOpenChange={setWorkspaceMenuOpen}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                className="project-title"
                aria-label="Choose workspace"
                aria-haspopup="menu"
                aria-expanded={workspaceMenuOpen}
              >
                {workspace.root === "demo" && !playground ? (
                  <FolderOpen size={14} />
                ) : (
                  <ProjectBadge name={workspace.name} logo={workspace.logo} />
                )}
                <span>{workspace.name}</span>
                <ChevronsUpDown size={12} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="header-popover-content"
                side="bottom"
                align="start"
                sideOffset={6}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {recent.slice(0, 8).map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="header-menu-item"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      void openFolder(path);
                    }}
                  >
                    <span className="header-menu-check-slot">
                      {workspace.root === path && (
                        <Check size={13} className="header-menu-checked" />
                      )}
                    </span>
                    <span className="header-menu-item-label">
                      {path.split(/[\\/]/).pop() || path}
                      <small className="header-menu-description">{path}</small>
                    </span>
                  </button>
                ))}
                {recent.length > 0 && <div className="header-menu-separator" />}
                <button
                  type="button"
                  className="header-menu-item"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    void openFolder();
                  }}
                >
                  <span className="header-menu-check-slot" />
                  <span className="header-menu-item-label">
                    Open another folder…
                  </span>
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <span className="title-divider" data-tauri-drag-region />
          <DesktopMenuBar
            onMenu={openMenu}
            menus={[
              {
                label: "File",
                items: [
                  menuCommand("new"),
                  menuCommand("open"),
                  menuCommand("save", { separator: true }),
                  menuCommand("save-all"),
                  menuCommand("close", { separator: true }),
                  menuCommand("close-all"),
                  menuCommand("settings"),
                  {
                    label: "Exit Devyy",
                    action: () => {
                      if (native) void getCurrentWindow().close();
                    },
                  },
                ],
              },
              {
                label: "Edit",
                items: [
                  menuCommand("undo"),
                  menuCommand("redo"),
                  {
                    label: "Cut",
                    shortcut: displayBinding("Mod+X"),
                    separator: true,
                    action: () => void editClipboard("cut"),
                  },
                  {
                    label: "Copy",
                    shortcut: displayBinding("Mod+C"),
                    action: () => void editClipboard("copy"),
                  },
                  {
                    label: "Paste",
                    shortcut: displayBinding("Mod+V"),
                    action: () => void editClipboard("paste"),
                  },
                  {
                    label: "Select all",
                    shortcut: displayBinding("Mod+A"),
                    action: () => {
                      const view = views.current.get(activeRef.current);
                      if (view) {
                        view.focus();
                        selectAll(view);
                      }
                    },
                  },
                  menuCommand("find", { separator: true }),
                  menuCommand("global"),
                  menuCommand("format"),
                ],
              },
              {
                label: "View",
                items: [
                  menuCommand("sidebar"),
                  menuCommand("terminal"),
                  menuCommand("ai"),
                  menuCommand("split"),
                  menuCommand("focus"),
                  menuCommand("reset-layout"),
                ],
              },
              {
                label: "Go",
                items: [
                  menuCommand("files"),
                  menuCommand("goto"),
                  menuCommand("definition"),
                  menuCommand("references"),
                  menuCommand("next-tab"),
                  menuCommand("previous-tab"),
                ],
              },
              { label: "Run", items: [menuCommand("run")] },
              {
                label: "Terminal",
                items: [
                  menuCommand("new-terminal"),
                  menuCommand("split-terminal"),
                  menuCommand("close-terminal"),
                  menuCommand("clear-terminal"),
                ],
              },
              {
                label: "Help",
                items: [
                  menuCommand("help"),
                  menuCommand("about"),
                  menuCommand("setup"),
                ],
              },
            ]}
          />
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
        <div
          className="window-controls"
          onMouseDown={(event) => {
            if (
              native &&
              document.documentElement.dataset.platform !== "macos" &&
              event.button === 0 &&
              event.target === event.currentTarget
            ) {
              event.preventDefault();
              void getCurrentWindow()
                .startDragging()
                .catch(() => {});
            }
          }}
        >
          <TitlebarStoreSprites
            theme={storeTheme}
            editing={
              themePreview?.editable
                ? {
                    selected: themePreview.selected,
                    onSelect: selectPreviewSprite,
                    onMove: movePreviewSprite,
                  }
                : undefined
            }
          />
          {(workspace.root !== "demo" || playground) && (
            <>
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
              <span className="title-divider" data-tauri-drag-region />
            </>
          )}
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
          <AIPanelToggle />
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
          {supportsWindowVibrancy && (
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
          )}
          {updateStatus?.status === "available" && (
            <button
              className="titlebar-update-button"
              aria-label={`Update available: ${updateStatus.version}`}
              title={`View release for v${updateStatus.version}`}
              onClick={() => {
                const showAbout = () => {
                  setSettingsPage("about");
                  setSettingsOpen(true);
                };
                if (updateStatus.url)
                  void viewUpdate(updateStatus.url, showAbout);
                else showAbout();
              }}
            >
              <span>Update</span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          )}
          <NativeWindowControls />
        </div>
      </header>
      <div className="app-body">
        <nav className="activity-bar" aria-label="Main navigation">
          <div className="activity-main">
            {visibleRailItems.map((item) => (
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
                <ExtensionIcon
                  id={container.extension!}
                  path={container.icon}
                  fallback={container.fallback}
                  monochrome
                />
              </button>
            ))}
          </div>
          <div className="activity-bottom">
            <button
              title="Devyy account"
              aria-label="Devyy account"
              onClick={() => {
                setSettingsPage("account");
                setSettingsOpen(true);
              }}
            >
              <AccountAvatar />
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
                  run: "Run & Debug",
                  remote: "Remote Explorer",
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
          {section === "files" &&
            (workspace.root === "demo" && !playground ? (
              <div className="sidebar-content">
                <Empty
                  icon={<Files size={28} />}
                  title="No folder opened"
                  text="You have not yet opened a folder. Open a project folder to browse, edit, and organize files."
                  action={() => void openFolder()}
                />
              </div>
            ) : (
              <>
                <FileTree
                  root={workspace.root}
                  onMove={moveItem}
                  files={workspace.files}
                  active={active}
                  dirty={dirty}
                  changes={git?.changes ?? []}
                  expanded={expandedFolders}
                  onExpandedChange={setExpandedFolders}
                  onOpen={(path) => void openFile(path)}
                  onExpand={(path) => {
                    if (workspace.root === "demo") return;
                    const root = workspace.root;
                    void invoke<Workspace["files"]>("list_directory", { path })
                      .then((children) => {
                        if (wsRef.current.root !== root) return;
                        const childPaths = new Set(
                          children.map((child) => child.path),
                        );
                        setWorkspace((old) => ({
                          ...old,
                          files: [
                            ...old.files.filter(
                              (entry) => !childPaths.has(entry.path),
                            ),
                            ...children,
                          ],
                        }));
                      })
                      .catch(notify);
                  }}
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
                  onDropFiles={async (droppedFiles, targetDir) => {
                    if (workspace.root === "demo") return;
                    try {
                      for (const file of Array.from(droppedFiles)) {
                        const fileName = file.name;
                        const targetPath = targetDir
                          ? `${targetDir}/${fileName}`
                          : fileName;
                        const content = await file.text();
                        try {
                          await invoke("create_file", {
                            path: targetPath,
                            directory: false,
                          });
                        } catch {}
                        await invoke("write_file", {
                          path: targetPath,
                          content,
                          expected: "devyy:new",
                        }).catch(async () => {
                          const doc = await invoke<{ modified: string }>(
                            "read_file",
                            { path: targetPath },
                          );
                          await invoke("write_file", {
                            path: targetPath,
                            content,
                            expected: doc.modified,
                          });
                        });
                        await openFile(targetPath);
                      }
                      await refresh();
                    } catch (err) {
                      showToast.error(`Could not import file: ${String(err)}`);
                    }
                  }}
                />
                <ExtensionViews container="explorer" />
              </>
            ))}
          {section.startsWith("extension:") && (
            <div className="sidebar-content">
              <ExtensionViews container={section.slice(10)} />
            </div>
          )}
          {section === "search" && hasProject && (
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
          {section === "remote" && (
            <div className="sidebar-content">
              <Suspense
                fallback={
                  <p className="sidebar-empty" role="status">
                    Loading remote explorer…
                  </p>
                }
              >
                <RemoteExplorer
                  activeServerId={
                    workspace.remotePath ? activeServerId : undefined
                  }
                  onOpenFolder={openFolder}
                  onDisconnect={() => changeWorkspace({ disconnect: true })}
                />
              </Suspense>
            </div>
          )}
          {section === "git" && !!git && (
            <div className="sidebar-content">
              {workspace.root === "demo" && !playground ? (
                <Empty
                  icon={<GitBranch size={28} />}
                  title="Source control"
                  text="Open a Git project to review changes, stage files, and commit your work."
                  action={() => void openFolder()}
                />
              ) : git ? (
                <SourceControl
                  onGraph={(hash = "") => {
                    setGraphParent(0);
                    setGraphSelection(hash);
                  }}
                  state={git}
                  root={workspace.root}
                  repository={gitRepository}
                  onRepository={selectGitRepository}
                  onBranchAction={(action, branch, name) =>
                    void manageGitBranch(action, branch, name)
                  }
                  onSubmoduleAction={manageGitSubmodule}
                  onRenameBranch={(branch, name) =>
                    setDialog({
                      title: "Rename branch",
                      label: "Branch name",
                      initial: name,
                      description: "Rename the local branch.",
                      submit: async (name) => {
                        await manageGitBranch("rename", branch, name);
                      },
                    })
                  }
                  busy={gitBusy || workspaceScan}
                  commit={commit}
                  onCommitChange={setCommit}
                  onRefresh={() => void refreshGit()}
                  onCommit={() =>
                    void gitAction(async () => {
                      const root = wsRef.current.root,
                        repository = gitRepositoryRef.current;
                      const message = await invoke<string>("git_commit", {
                        message: commit,
                        repository,
                      });
                      if (
                        root !== wsRef.current.root ||
                        repository !== gitRepositoryRef.current
                      )
                        return;
                      gitDrafts.current.delete(repository);
                      setCommit("");
                      log(message);
                      notify("Changes committed.", false);
                    })
                  }
                  onStage={(path, staged) => void stageGitFile(path, staged)}
                  onStageAll={(staged) =>
                    void gitAction(() =>
                      invoke("git_stage_all", {
                        staged,
                        repository: gitRepositoryRef.current,
                      }),
                    )
                  }
                  onDiff={(path, staged) => void showDiff(path, staged)}
                  onOpen={(path) => void openFile(path)}
                  onDiscard={(path) => void discardGitFile(path)}
                  onSwitch={(branch) => void switchGitBranch(branch)}
                  onCreateBranch={(startPoint) =>
                    setDialog({
                      title: "Create branch",
                      description: startPoint
                        ? `Create a branch from ${startPoint.replace(/^refs\/(heads|remotes)\//, "")}.`
                        : "Create and switch to a new branch.",
                      initial: "",
                      label: "Branch name",
                      submit: async (branch) => {
                        await switchGitBranch(branch, true, startPoint);
                      },
                    })
                  }
                />
              ) : (
                <Empty
                  icon={<GitBranch size={28} />}
                  title="Not a Git repository"
                  text={
                    gitError ||
                    "This folder is not currently a Git repository. Initialize Git to begin tracking changes, staging files, and managing branches."
                  }
                  action={() => void initGitRepository()}
                  actionLabel="Initialize repository"
                />
              )}
            </div>
          )}
          {section === "run" &&
            (workspace.root === "demo" && !playground ? (
              <div className="sidebar-content">
                <Empty
                  icon={<Play size={28} />}
                  title="Run & Debug"
                  text="Open a project folder to run scripts, start servers, and configure launch configurations."
                  action={() => void openFolder()}
                />
              </div>
            ) : (
              <>
                <div
                  className="run-mode-tabs"
                  role="tablist"
                  aria-label="Run and debug"
                >
                  <button
                    role="tab"
                    aria-selected={runMode === "run"}
                    onClick={() => setRunMode("run")}
                  >
                    <Play size={13} />
                    Run
                  </button>
                  <button
                    role="tab"
                    aria-selected={runMode === "debug"}
                    onClick={() => setRunMode("debug")}
                  >
                    <Bug size={13} />
                    Debug{debugSession.running && <Play size={10} />}
                  </button>
                </div>
                {runMode === "run" && (
                  <RunPanel
                    workspace={workspace}
                    onRun={(command) => void run(command)}
                  />
                )}
                <div
                  className={`debugger-container ${runMode === "debug" ? "visible" : ""}`}
                >
                  <Debugger
                    workspace={workspace}
                    breakpoints={breakpoints}
                    onNavigate={(path, line) => void openFile(path, line)}
                    onSession={setDebugSession}
                    onOutput={(text) => appendOutput(text, "Debugger")}
                    onError={notify}
                    onSave={saveAll}
                  />
                </div>
                <ExtensionViews container="debug" />
              </>
            ))}
          {section === "git" && <ExtensionViews container="scm" />}
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
              <div
                className="tabbar-actions"
                hidden={diffActive || active === "devyy:settings"}
              >
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
                      void applyAIProposal({
                        path: comparison.path,
                        original: comparison.original,
                        modified: comparison.modified,
                        create: comparison.create,
                        proposalId: comparison.proposalId,
                        workspaceRoot: comparison.workspaceRoot,
                      }).then((ok) => {
                        if (ok) {
                          setComparison(null);
                          setDiffActive(false);
                        }
                      });
                    }}
                    onApplyAll={() => void applyAllAIProposals()}
                    document={comparison}
                    active={diffActive}
                    settings={appearanceSettings}
                    busy={gitBusy || workspaceScan}
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
                    onHistory={
                      comparison.source === "history"
                        ? () => {
                            setGraphParent(comparison.parentIndex ?? 0);
                            setGraphSelection(comparison.commitHash ?? "");
                          }
                        : undefined
                    }
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
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={async (e) => {
                if (e.dataTransfer.files?.length) {
                  e.preventDefault();
                  for (const file of Array.from(e.dataTransfer.files)) {
                    await handleExternalFileDrop(file);
                  }
                }
              }}
            >
              {tab ? (
                <>
                  {settings.showBreadcrumbs && (
                    <div className="editor-breadcrumb">
                      <span>
                        {tab.webviewId
                          ? "Extension"
                          : tab.path === "devyy:settings"
                            ? "devyy"
                            : workspace.name}
                      </span>
                      {(tab.webviewId || tab.path === "devyy:settings"
                        ? [tabTitle(tab)]
                        : tab.path.split("/")
                      ).map((part, i) => (
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
                    {editorBackground && (
                      <img
                        className="theme-editor-background"
                        src={editorBackground.image}
                        alt=""
                        draggable={false}
                        style={{
                          opacity: editorBackground.opacity,
                          objectFit: editorBackground.fit,
                          objectPosition: `${editorBackground.x}% ${editorBackground.y}%`,
                          imageRendering: editorBackground.pixelated
                            ? "pixelated"
                            : "auto",
                        }}
                      />
                    )}
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
                  {(["terminal", "problems", "output", "ports"] as const).map(
                    (name) => (
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
                              "ports",
                            ] as const,
                            index = names.indexOf(name);
                          const next =
                            e.key === "ArrowRight"
                              ? (index + 1) % names.length
                              : e.key === "ArrowLeft"
                                ? (index + names.length - 1) % names.length
                                : e.key === "Home"
                                  ? 0
                                  : e.key === "End"
                                    ? names.length - 1
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
                                kind:
                                  name === "problems" ? "problems" : "output",
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
                        ) : name === "ports" ? (
                          <Radio size={13} />
                        ) : (
                          <Code2 size={13} />
                        )}
                        <span>{name}</span>
                        {name === "problems" && !!problems.length && (
                          <small>{problems.length}</small>
                        )}
                      </button>
                    ),
                  )}
                </div>
                <div
                  className="panel-session-slot"
                  ref={setTerminalToolbar}
                  hidden={panelTab !== "terminal"}
                />
                <div
                  className="panel-output-slot"
                  hidden={panelTab !== "output"}
                >
                  <div className="output-toolbar">
                    <div className="output-channel-picker">
                      <Select
                        value={outputSource}
                        onChange={(e) => setOutputSource(e.target.value)}
                        aria-label="Filter output by service or extension"
                        className="output-service-select"
                      >
                        <option value="all">
                          All outputs ({outputEntries.length})
                        </option>
                        <optgroup label="Devyy services">
                          {BUILTIN_OUTPUT_SERVICES.map((service) => {
                            const count = outputEntries.filter(
                              (e) => e.source === service,
                            ).length;
                            return (
                              <option key={service} value={service}>
                                {service} {count > 0 ? `(${count})` : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                        {extensionChannels.length > 0 && (
                          <optgroup label="Extension channels">
                            {extensionChannels.map((channel) => {
                              const count = outputEntries.filter(
                                (e) => e.source === channel,
                              ).length;
                              return (
                                <option key={channel} value={channel}>
                                  {channel} {count > 0 ? `(${count})` : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                      </Select>
                    </div>
                    <div className="output-filter-box">
                      <Search size={12} className="output-filter-icon" />
                      <input
                        type="text"
                        value={outputFilter}
                        onChange={(e) => setOutputFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setOutputFilter("");
                        }}
                        placeholder="Filter text…"
                        aria-label="Filter output text"
                        className="output-filter-input"
                      />
                      {outputFilter && (
                        <button
                          className="output-filter-clear"
                          title="Clear text filter (Esc)"
                          aria-label="Clear text filter"
                          onClick={() => setOutputFilter("")}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    <span className="output-line-badge" title="Matching lines">
                      {filteredOutputEntries.length}{" "}
                      {filteredOutputEntries.length === 1 ? "line" : "lines"}
                      {outputFilter || outputSource !== "all"
                        ? ` (of ${outputEntries.length})`
                        : ""}
                    </span>
                  </div>
                </div>
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
                    <>
                      <button
                        className="icon-button"
                        title="Copy output"
                        aria-label="Copy output"
                        onClick={() => void copyOutput()}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-button"
                        title={
                          outputSource === "all"
                            ? "Clear output"
                            : `Clear ${outputSource} output`
                        }
                        aria-label={
                          outputSource === "all"
                            ? "Clear output"
                            : `Clear ${outputSource} output`
                        }
                        onClick={clearOutput}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
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
                    settings={appearanceSettings}
                    themeColors={storeTheme?.manifest.colors}
                    preview={showcase === "theme"}
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
                  panelTab === "problems" &&
                  panel && (
                    <ProblemList
                      problems={problems}
                      renderRow={(p, i) => (
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
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMenu(e, [
                              {
                                label: "Explain with Devyy AI",
                                action: () => {
                                  window.dispatchEvent(
                                    new CustomEvent("devyy-ai-open", {
                                      detail: {
                                        draft: `Explain this diagnostic in ${filename(p.path)}: "${p.message}" (line ${p.range.start.line + 1})`,
                                        refs: [
                                          {
                                            kind: "problem",
                                            id: `${p.path}:${i}`,
                                          },
                                        ],
                                      },
                                    }),
                                  );
                                },
                              },
                              {
                                label: "Fix with Devyy AI",
                                action: () => {
                                  window.dispatchEvent(
                                    new CustomEvent("devyy-ai-open", {
                                      detail: {
                                        draft: `Fix this issue in ${filename(p.path)} at line ${p.range.start.line + 1}: "${p.message}"`,
                                        refs: [
                                          {
                                            kind: "problem",
                                            id: `${p.path}:${i}`,
                                          },
                                        ],
                                      },
                                    }),
                                  );
                                },
                              },
                              {
                                label: "Go to Problem",
                                separator: true,
                                action: () =>
                                  void openFile(p.path, p.range.start.line + 1),
                              },
                              {
                                label: "Copy Problem Message",
                                action: () =>
                                  void writeClipboardText(p.message).catch(
                                    notify,
                                  ),
                              },
                              {
                                label: "Copy Path",
                                action: () =>
                                  void writeClipboardText(p.path).catch(notify),
                              },
                            ]);
                          }}
                        >
                          {p.severity === 1 ? (
                            <CircleX size={14} />
                          ) : (
                            <CircleAlert size={14} />
                          )}
                          <span title={p.message}>{p.message}</span>
                          <small>
                            {p.path}:{p.range.start.line + 1}
                          </small>
                        </button>
                      )}
                    />
                  )
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
                <div
                  className="output-scroll-container"
                  ref={outputContainerRef}
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    setOutputAutoScroll(
                      el.scrollHeight - el.scrollTop - el.clientHeight < 24,
                    );
                  }}
                >
                  <pre className="output-log">
                    {formattedOutputText || "Output is clear."}
                  </pre>
                </div>
              </div>
              <div
                className={`panel-view ${panelTab === "ports" ? "visible" : ""}`}
                id="panel-ports"
                role="tabpanel"
                aria-labelledby="panel-tab-ports"
              >
                {(portsVisited || (panel && panelTab === "ports")) && (
                  <Suspense
                    fallback={
                      <p className="sidebar-empty" role="status">
                        Loading ports…
                      </p>
                    }
                  >
                    <PortsPanel
                      active={panel && panelTab === "ports"}
                      onOpenAccount={() => {
                        setSettingsPage("account");
                        setSettingsOpen(true);
                      }}
                    />
                  </Suspense>
                )}
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
                  {tab &&
                  !tab.webviewId &&
                  !tab.previewKind &&
                  tab.path !== "devyy:settings" ? (
                    <>
                      <button
                        title="Go to line"
                        onClick={() =>
                          commands.find((c) => c.id === "goto")?.run()
                        }
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
                          setSettingsPage("languages");
                          setSettingsOpen(true);
                        }}
                      >
                        <Braces size={12} />
                        {tab ? language(tab.path) : "text"}
                      </button>
                    </>
                  ) : (
                    <span className="status-encoding">
                      {tab?.webviewId
                        ? tabTitle(tab)
                        : tab?.previewKind
                          ? `${tab.previewKind.charAt(0).toUpperCase()}${tab.previewKind.slice(1)} preview`
                          : tab?.path === "devyy:settings"
                            ? "Settings"
                            : "No file open"}
                    </span>
                  )}
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
        </main>
        <AIWorkspace
          peekOnDrag={settings.aiPanelOnDrag}
          file={
            tab &&
            !tab.webviewId &&
            !tab.previewKind &&
            tab.path !== "devyy:settings"
              ? { path: tab.path, content: tab.content, readOnly: tab.readOnly }
              : undefined
          }
          cwd={workspace.root === "demo" ? undefined : workspace.root}
          onSettings={() => {
            setSettingsPage("ai");
            setSettingsOpen(true);
          }}
          onReview={reviewAISuggestion}
          onApproveAll={applyAllAIProposals}
          shortcuts={Object.values(bindings).filter(Boolean)}
        />
      </div>
      {keyChord && (
        <div className="shortcut-hint" role="status">
          {displayBinding(keyChord)}: press the next key
        </div>
      )}
      <AnimatePresence>
        {graphSelection !== null && (
          <Suspense key="commit-graph" fallback={null}>
            <GitGraph
              repository={gitRepository}
              initialHash={graphSelection}
              initialParent={graphParent}
              onClose={() => setGraphSelection(null)}
              onDiff={(hash, path, parent, parentHash) =>
                void showCommitDiff(hash, path, parent, parentHash)
              }
            />
          </Suspense>
        )}
        {palette && (
          <Palette
            key="palette"
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
          <Suspense key="preferences" fallback={null}>
            <Preferences
              settings={settings}
              category={settingsPage}
              onCategoryChange={setSettingsPage}
              onViewUpdate={viewUpdate}
              onSetup={() => {
                setSettingsOpen(false);
                setSetupOpen(true);
              }}
              onChange={setSettings}
              onResetLayout={resetLayout}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        )}
        {help && (
          <HelpModal
            key="help"
            onClose={() => setHelp(false)}
            bindings={bindings}
            commandInfo={commandInfo}
            displayBinding={displayBinding}
          />
        )}
        {dialog && (
          <InputDialog
            key="input"
            dialog={dialog}
            onClose={() => setDialog(null)}
          />
        )}
        {setupOpen && (
          <Setup
            key="setup"
            settings={settings}
            onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onFinish={finishSetup}
          />
        )}
      </AnimatePresence>
      <StoreSprites
        theme={storeTheme}
        editing={
          themePreview?.editable
            ? {
                selected: themePreview.selected,
                onSelect: selectPreviewSprite,
                onMove: movePreviewSprite,
              }
            : undefined
        }
      />
      <ExtensionServices
        onRequest={extensionWorkbenchRequest}
        onStoreLink={(kind) => {
          setSettingsPage(
            kind === "language-server"
              ? "languages"
              : kind === "theme"
                ? "themes"
                : "extensions",
          );
          setSettingsOpen(true);
        }}
      />
      {openingUpdate && <UpdateOverlay />}
      <Toaster
        theme={settings.theme === "paper" ? "light" : "dark"}
        position="bottom-right"
        closeButton
        visibleToasts={3}
        toastOptions={{ className: "devyy-toast", duration: 5000 }}
      />
    </div>
  );
}
