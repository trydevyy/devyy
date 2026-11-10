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
  Minus,
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
import Editor, { offset, toPosition } from "./components/Editor";
import FileTree, { FileIcon } from "./components/FileTree";
import Preferences from "./components/Preferences";
import type { SettingsCategory } from "./lib/settingsCatalog";
import SearchResults from "./components/SearchResults";
import ProjectBadge from "./components/ProjectBadge";
import Palette, { type PaletteItem } from "./components/Palette";
import { Toaster, toast as showToast } from "sonner";
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview"));
const TerminalGroup = lazy(() => import("./components/TerminalGroup"));
import type { TerminalsHandle } from "./components/TerminalGroup";
import ResizeHandle from "./components/ResizeHandle";
import { useContextMenu, type MenuItem } from "./components/ContextMenu";
import {
  bindingsWith,
  commandInfo,
  displayBinding,
  eventBinding,
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
  changeDocument,
  closeDocument,
  savedDocument,
  clearLanguageServers,
  languageRequest,
  pathFromUri,
  type DiagnosticEvent,
} from "./lib/native";

type Section = "files" | "search" | "git" | "run" | "tools";
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
    [active, setActive] = useState(initialTab.path);
  const [markdownModes, setMarkdownModes] = useState<
    Record<string, "source" | "preview" | "split">
  >({});
  const markdownMode = markdownModes[active] ?? "source";
  function setMarkdownMode(
    mode: "source" | "preview" | "split",
    path = active,
  ) {
    setMarkdownModes((old) => ({ ...old, [path]: mode }));
    setSplit(mode === "split");
  }
  const [section, setSection] = useState<Section>("files"),
    [sidebar, setSidebar] = useState(true),
    [panel, setPanel] = useState(true),
    [panelTab, setPanelTab] = useState<"terminal" | "problems" | "output">(
      "terminal",
    );
  const [split, setSplit] = useState(false),
    [focus, setFocus] = useState(false),
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
    if (!palette && !settingsOpen && !help && !dialog) return;
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
  }, [palette, settingsOpen, help, dialog]);
  useAppearance(settings, notify);
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
      if (
        root !== "demo" &&
        ["rust", "typescript", "javascript", "python"].includes(language(path))
      )
        void connectDocument(path, language(path), existing.content)
          .then(() =>
            setLspStatus((s) => ({ ...s, [language(path)]: "Connected" })),
          )
          .catch((e) => {
            setLspStatus((s) => ({ ...s, [language(path)]: String(e) }));
            log(String(e));
          });
      if (line) setTimeout(() => jumpTo(path, line), 40);
    } catch (e) {
      notify(e);
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
  const edit = useCallback((path: string, content: string) => {
    setTabs((old) => old.map((t) => (t.path === path ? { ...t, content } : t)));
  }, []);
  const handleCursor = useCallback(
    (path: string, line: number, col: number) => {
      if (activeRef.current === path) setCursor({ line, col });
    },
    [],
  );
  const handleView = useCallback((path: string, view: EditorView | null) => {
    if (view) views.current.set(path, view);
    else views.current.delete(path);
    if (view && path === activeRef.current) currentView.current = view;
  }, []);
  const handleSplitView = useCallback(
    (path: string, view: EditorView | null) => {
      if (view && path === activeRef.current) currentView.current = view;
    },
    [],
  );
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
  async function save(path = activeRef.current): Promise<boolean> {
    const previous = saveQueue.current.get(path);
    const operation = (async () => {
      if (previous) await previous;
      const target = tabsRef.current.find((t) => t.path === path);
      if (!target || target.saved === target.content) return true;
      const root = wsRef.current.root;
      try {
        let modified = target.modified;
        if (root === "demo") {
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
    if (activeRef.current === path) setActive(remaining.at(-1)?.path ?? "");
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
      if (active === path) setActive(left.at(-1)?.path ?? "");
      void closeDocument(path).catch(() => {});
    } catch (e) {
      notify(e);
    }
  }
  useEffect(() => {
    if (!tab || workspace.root === "demo") return;
    const id = setTimeout(
      () => void changeDocument(tab.path, tab.content).catch(() => {}),
      180,
    );
    return () => clearTimeout(id);
  }, [tab?.content, tab?.path, workspace.root]);
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
          ...old.filter((d) => d.path !== path),
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
      const result = await languageRequest<Location | Location[]>(
        tab.path,
        "textDocument/definition",
        toPosition(view, view.state.selection.main.head),
      );
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
      const result = await languageRequest<
        Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          newText: string;
        }>
      >(tab.path, "textDocument/formatting");
      if (!result) {
        notify("Formatting requires a connected language server.", false);
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
    if (gitBusy) return;
    setGitBusy(true);
    try {
      await action();
      await refreshGit();
    } catch (e) {
      notify(e);
    } finally {
      setGitBusy(false);
    }
  }
  async function showDiff(path: string, staged: boolean) {
    try {
      const text = await invoke<string>("git_diff", { path, staged });
      setDialog(null);
      setOutput(text.split("\n"));
      setPanelTab("output");
      showPanel(true);
    } catch (e) {
      notify(e);
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
    const i = tabs.findIndex((t) => t.path === active);
    setActive(tabs[(i + delta + tabs.length) % tabs.length]?.path ?? "");
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
  const commandActions: Record<CommandId, () => void> = {
    files: () => setPalette("files"),
    "quick-open": () => setPalette("files"),
    commands: () => setPalette("commands"),
    open: () => void openFolder(),
    new: () => void newItem(false),
    save: () => void save(),
    "save-all": () => void saveAll(),
    close: () => void closeTab(activeRef.current),
    "close-all": () => void closeMany(tabsRef.current.map((t) => t.path)),
    "next-tab": () => cycleTab(1),
    "previous-tab": () => cycleTab(-1),
    format: () => void format(),
    definition: () => void definition(),
    find: () => {
      if (currentView.current) {
        currentView.current.focus();
        openSearchPanel(currentView.current);
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
      if (language(active) === "markdown" && !split) setMarkdownMode("split");
      else setSplit((v) => !v);
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
    "focus-editor": () => currentView.current?.focus(),
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
      else if (currentView.current) undo(currentView.current);
    },
    redo: () => {
      if (document.activeElement?.matches("input,textarea"))
        document.execCommand("redo");
      else if (currentView.current) redo(currentView.current);
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
          jumpTo(active, n);
        },
      }),
    settings: () => setSettingsOpen(true),
    about: () => {
      setSettingsPage("about");
      setSettingsOpen(true);
    },
    theme: () =>
      setSettings((s) => ({
        ...s,
        theme: s.theme === "paper" ? "midnight" : "paper",
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
  commandRef.current = commands;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("[data-shortcut-recorder], .terminal-session input") ||
        e.isComposing
      )
        return;
      const ui = uiRef.current;
      if (e.key === "Escape") {
        // Let nested context menus and CodeMirror search/completion consume Escape first.
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
      if (ui.dialog || ui.settingsOpen || ui.help) return;
      const binding = eventBinding(e);
      const id = (Object.keys(bindingsRef.current) as CommandId[]).find(
        (id) => bindingsRef.current[id] && bindingsRef.current[id] === binding,
      );
      const command = commandRef.current.find((c) => c.id === id);
      if (!command) return;
      if (
        ui.palette &&
        !["files", "quick-open", "commands"].includes(command.id)
      )
        return;
      if (
        ["undo", "redo"].includes(command.id) &&
        !target.closest(".code-editor")
      )
        return;
      if (
        target.closest(".terminal-content") &&
        ["find", "undo", "redo", "save", "new", "close"].includes(command.id)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      command.run();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
  useEffect(() => {
    if (native)
      void invoke("set_menu_shortcuts", {
        bindings: settingsOpen
          ? Object.fromEntries(Object.keys(bindings).map((id) => [id, ""]))
          : bindings,
      }).catch((e) => log(`Menu shortcuts: ${String(e)}`));
  }, [settings.bindings, settingsOpen]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    if (native)
      void listen<string>("devyy-command", ({ payload }) =>
        commandRef.current.find((c) => c.id === payload)?.run(),
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
              action: () => {
                void openFile(path);
                if (language(path) === "markdown")
                  setMarkdownMode("split", path);
                else setSplit(true);
              },
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
    const i = tabs.findIndex((t) => t.path === path);
    openMenu(e, [
      {
        label: "Save file",
        shortcut: displayBinding(bindings.save),
        action: () => void save(path),
      },
      {
        label: "Split editor",
        action: () => {
          setActive(path);
          if (language(path) === "markdown") setMarkdownMode("split", path);
          else setSplit(true);
        },
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
        disabled: i === tabs.length - 1,
        action: () => void closeMany(tabs.slice(i + 1).map((t) => t.path)),
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
    { id: "tools" as const, icon: PanelsTopLeft, label: "Language tools" },
  ];
  const openPreviewLink = useCallback(
    (path: string, line?: number) => {
      void openFile(path, line);
    },
    [workspace.root, demo],
  );
  function renderEditor(isSplit = false) {
    return (
      <div className="editor-stack" onContextMenu={editorMenu}>
        {split && (
          <div className="editor-pane-heading">
            <span className="pane-number">{isSplit ? 2 : 1}</span>
            <FileIcon path={active} size={12} />
            <span>{filename(active)}</span>
            <small>
              {language(active) === "markdown" &&
              (markdownMode === "preview" ||
                (markdownMode === "split" && isSplit))
                ? "Preview"
                : "Editor"}
            </small>
            {isSplit && (
              <button
                className="icon-button"
                aria-label="Close split"
                onClick={() => setSplit(false)}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {tabs.map((t) => {
          const preview =
            language(t.path) === "markdown" &&
            (markdownModes[t.path] === "preview" ||
              (markdownModes[t.path] === "split" && split && isSplit));
          return (
            <div
              key={t.path}
              className={`editor-document ${active === t.path ? "visible" : ""}`}
            >
              <div className="editor-source" hidden={preview}>
                <Editor
                  path={t.path}
                  value={t.content}
                  settings={settings}
                  diagnostics={diagnosticsByPath[t.path] ?? emptyDiagnostics}
                  onChange={edit}
                  onCursor={handleCursor}
                  onView={isSplit ? handleSplitView : handleView}
                  onDefinition={handleDefinition}
                  breakpoints={breakpoints[t.path] ?? emptyLines}
                  onBreakpoint={handleBreakpoint}
                />
              </div>
              {preview && (
                <Suspense
                  fallback={
                    <div className="preview-loading">Loading preview…</div>
                  }
                >
                  <MarkdownPreview
                    path={t.path}
                    root={workspace.root}
                    content={t.content}
                    onOpen={openPreviewLink}
                  />
                </Suspense>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  useEffect(() => {
    currentView.current = views.current.get(active) ?? null;
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
          </div>
          <div className="activity-bottom">
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
              {
                {
                  files: "Project",
                  search: "Search",
                  git: "Source control",
                  run: "Run & build",
                  tools: "Language tools",
                }[section]
              }
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
                <>
                  <div className="branch-card">
                    <GitBranch size={16} />
                    <strong>{git.branch}</strong>
                    <button
                      className="icon-button"
                      title="Refresh Git status"
                      onClick={() => void refreshGit()}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                  <textarea
                    className="commit-message"
                    value={commit}
                    onChange={(e) => setCommit(e.target.value)}
                    placeholder="Commit message"
                    aria-label="Commit message"
                  />
                  <button
                    className="primary full"
                    disabled={
                      gitBusy ||
                      !commit.trim() ||
                      !git.changes.some(
                        (c) => c.index.trim() && c.index !== "?",
                      )
                    }
                    onClick={() =>
                      void gitAction(async () => {
                        const message = await invoke<string>("git_commit", {
                          message: commit,
                        });
                        setCommit("");
                        log(message);
                        notify("Changes committed.", false);
                      })
                    }
                  >
                    <Check size={15} /> Commit staged changes
                  </button>
                  <div className="section-label">
                    <span>CHANGES</span>
                    <span>{git.changes.length}</span>
                  </div>
                  {!git.changes.length && (
                    <p className="muted">Your working tree is clean.</p>
                  )}
                  {git.changes.map((c) => (
                    <div className="change-row" key={c.path}>
                      <button
                        onClick={() =>
                          void showDiff(
                            c.path,
                            !!c.index.trim() && c.index !== "?",
                          )
                        }
                        title={`View diff: ${c.path}`}
                      >
                        <FileIcon path={c.path} />
                        <span>
                          {filename(c.path)}
                          <small>{c.path}</small>
                        </span>
                        <em>{c.worktree.trim() || c.index}</em>
                      </button>
                      <button
                        className="icon-button"
                        disabled={gitBusy}
                        title={
                          c.index.trim() && c.index !== "?"
                            ? "Unstage file"
                            : "Stage file"
                        }
                        onClick={() =>
                          void gitAction(() =>
                            invoke("git_stage", {
                              path: c.path,
                              staged: !!c.index.trim() && c.index !== "?",
                            }),
                          )
                        }
                      >
                        {c.index.trim() && c.index !== "?" ? (
                          <Minus size={15} />
                        ) : (
                          <Plus size={15} />
                        )}
                      </button>
                    </div>
                  ))}
                </>
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
                PROJECT COMMAND
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
                <span>QUICK ACTIONS</span>
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
          {section === "tools" && (
            <div className="sidebar-content">
              <p className="tools-intro">
                Language intelligence.
                <br />
                <strong>Connected to your code.</strong>
              </p>
              <p className="muted tiny">
                Syntax highlighting works out of the box. Connect a language
                server for completion, diagnostics, hover, definitions, and
                formatting.
              </p>
              {[
                {
                  name: "Rust",
                  id: "rust",
                  cmd: "rustup component add rust-analyzer",
                },
                {
                  name: "TypeScript / JavaScript",
                  id: "typescript",
                  cmd: "npm i -g typescript typescript-language-server",
                },
                {
                  name: "Python",
                  id: "python",
                  cmd: "pip install python-lsp-server",
                },
              ].map((tool) => (
                <div className="language-tool" key={tool.id}>
                  <div>
                    <Code2 size={17} />
                    <strong>{tool.name}</strong>
                    <span
                      className={
                        lspStatus[tool.id] === "Connected"
                          ? "connected-dot"
                          : "neutral-dot"
                      }
                    />
                  </div>
                  <small>
                    {lspStatus[tool.id] === "Connected"
                      ? "Connected"
                      : lspStatus[tool.id]
                        ? "Not available — install and reopen the project"
                        : "Connects when you open a file"}
                  </small>
                  <code>{tool.cmd}</code>
                </div>
              ))}
              <div className="notice">
                <CircleAlert size={16} />
                <p>
                  Servers must be on your PATH. Language tools are managed
                  locally. devyy v0.1 has no extension marketplace.
                </p>
              </div>
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
          {tabs.length > 0 && active && (
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
                {tabs.map((t) => (
                  <div
                    className={`tab ${active === t.path ? "active" : ""} ${split && active === t.path ? "is-split" : ""}`}
                    key={t.path}
                    draggable
                    onDragStart={(e) => {
                      draggedTab.current = t.path;
                      e.dataTransfer.effectAllowed = "move";
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
                      setTabs((old) => {
                        const moved = old.find((x) => x.path === path);
                        if (!moved) return old;
                        const next = old.filter((x) => x.path !== path);
                        next.splice(
                          next.findIndex((x) => x.path === t.path),
                          0,
                          moved,
                        );
                        return next;
                      });
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
                      aria-selected={active === t.path}
                      aria-label={filename(t.path)}
                      aria-description={
                        split && active === t.path
                          ? "Split across two editor panes"
                          : undefined
                      }
                      onClick={() => {
                        setActive(t.path);
                        activeRef.current = t.path;
                      }}
                      title={t.path}
                    >
                      <FileIcon path={t.path} size={14} />
                      {filename(t.path)}
                      {split && active === t.path && (
                        <span
                          className="split-tab-indicator"
                          title="Open in two panes"
                          aria-hidden="true"
                        >
                          <Columns2 size={12} />
                          <span>1 · 2</span>
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
                ))}
              </div>
              <button
                className="icon-button new-tab"
                title="New file"
                aria-label="New file"
                onClick={() => void newItem(false)}
              >
                <Plus size={15} />
              </button>
              <div className="tabbar-actions">
                {language(active) === "markdown" && (
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
                        (markdownMode === "split" && !split)
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
                      aria-pressed={markdownMode === "split" && split}
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
                      "--split-ratio": `${sizes.split}%`,
                    } as React.CSSProperties
                  }
                >
                  {renderEditor()}
                  {split && (
                    <div className="split-pane">
                      <ResizeHandle
                        label="Resize editor split"
                        value={sizes.split}
                        min={20}
                        max={80}
                        onChange={(value) =>
                          setSizes((s) => ({ ...s, split: value }))
                        }
                        onReset={() => setSizes((s) => ({ ...s, split: 50 }))}
                        percentOf={() => editorsRef.current?.clientWidth ?? 1}
                      />

                      {renderEditor(true)}
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
                      <div className="section-label">
                        PICK UP WHERE YOU LEFT OFF
                      </div>
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
        </main>
      </div>
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
            <p className="muted">devyy 0.1 · Local development environment</p>
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
                Rust-powered desktop core. CodeMirror editor. No accounts or
                telemetry. An independent editor, built from a clean slate.
              </p>
            </div>
          </section>
        </div>
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}
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
