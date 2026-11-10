import { useEffect, useRef, useState } from "react";
import {
  Bug,
  Circle,
  CornerDownRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pause,
  Play,
  Square,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { invoke, listen, native } from "../lib/native";
import { readLocal, type Workspace } from "../lib/types";
interface Frame {
  id: number;
  name: string;
  line: number;
  source?: { path?: string };
}
interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}
interface DebugEvent {
  event: string;
  body?: { threadId?: number; output?: string; reason?: string };
}
export interface DebugSession {
  running: boolean;
  path: string | null;
  line: number | null;
}
export default function Debugger({
  workspace,
  breakpoints,
  onNavigate,
  onSession,
  onOutput,
  onError,
  onSave,
}: {
  workspace: Workspace;
  breakpoints: Record<string, number[]>;
  onNavigate: (path: string, line: number) => void;
  onSession: (session: DebugSession) => void;
  onOutput: (text: string) => void;
  onError: (error: unknown) => void;
  onSave: () => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"lldb" | "python">(() =>
      readLocal("devyy.debug.kind", "lldb"),
    ),
    [program, setProgram] = useState(() =>
      readLocal("devyy.debug.program", ""),
    );
  const [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false),
    [thread, setThread] = useState<number | null>(null),
    [frames, setFrames] = useState<Frame[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [variables, setVariables] = useState<Variable[]>([]),
    [state, setState] = useState("Ready when you are.");
  const refs = useRef({
    workspace,
    breakpoints,
    onNavigate,
    onSession,
    onOutput,
    onError,
    onSave,
    running,
  });
  refs.current = {
    workspace,
    breakpoints,
    onNavigate,
    onSession,
    onOutput,
    onError,
    onSave,
    running,
  };
  async function request<T>(command: string, args: unknown = {}): Promise<T> {
    return invoke("debug_request", { command, arguments: args });
  }
  async function syncBreakpoints(path: string, lines: number[]) {
    await request("setBreakpoints", {
      source: { path: refs.current.workspace.root + "/" + path },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false,
    });
  }
  async function inspect(frame: Frame) {
    setSelected(frame.id);
    if (frame.source?.path) {
      const root = refs.current.workspace.root + "/";
      if (frame.source.path.startsWith(root)) {
        const path = frame.source.path.slice(root.length);
        refs.current.onNavigate(path, frame.line);
        refs.current.onSession({ running: true, path, line: frame.line });
      }
    }
    const scopes = await request<{
      scopes: Array<{ variablesReference: number; expensive?: boolean }>;
    }>("scopes", { frameId: frame.id });
    const local = scopes.scopes.find((s) => !s.expensive) ?? scopes.scopes[0];
    if (local) {
      const result = await request<{ variables: Variable[] }>("variables", {
        variablesReference: local.variablesReference,
      });
      setVariables(result.variables);
    } else setVariables([]);
  }
  const handlers = useRef({ inspect, syncBreakpoints });
  handlers.current = { inspect, syncBreakpoints };
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<DebugEvent>("debug-event", ({ payload }) => {
      void (async () => {
        switch (payload.event) {
          case "initialized":
            for (const [path, lines] of Object.entries(
              refs.current.breakpoints,
            ))
              await handlers.current.syncBreakpoints(path, lines);
            await request("configurationDone");
            setState("Running");
            break;
          case "stopped": {
            let id = payload.body?.threadId;
            if (!id) {
              const result = await request<{ threads: Array<{ id: number }> }>(
                "threads",
              );
              id = result.threads[0]?.id;
            }
            if (!id) return;
            setThread(id);
            setState(`Paused · ${payload.body?.reason ?? "breakpoint"}`);
            const result = await request<{ stackFrames: Frame[] }>(
              "stackTrace",
              { threadId: id, startFrame: 0, levels: 30 },
            );
            setFrames(result.stackFrames);
            if (result.stackFrames[0])
              await handlers.current.inspect(result.stackFrames[0]);
            break;
          }
          case "continued":
            setThread(null);
            setFrames([]);
            setVariables([]);
            setState("Running");
            refs.current.onSession({ running: true, path: null, line: null });
            break;
          case "output":
            if (payload.body?.output)
              refs.current.onOutput(payload.body.output);
            break;
          case "terminated":
          case "exited":
          case "adapterExited":
            setRunning(false);
            setThread(null);
            setFrames([]);
            setVariables([]);
            setState("Session finished.");
            refs.current.onSession({ running: false, path: null, line: null });
            void invoke("debug_stop").catch(() => {});
            break;
        }
      })().catch(refs.current.onError);
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
    if (!running) return;
    for (const [path, lines] of Object.entries(breakpoints))
      void syncBreakpoints(path, lines).catch(onError);
  }, [breakpoints]);
  useEffect(
    () => () => {
      if (native && refs.current.running)
        void invoke("debug_stop").catch(() => {});
    },
    [],
  );
  async function start() {
    if (!native || workspace.root === "demo") {
      onError("Open a project in the desktop app to debug.");
      return;
    }
    setBusy(true);
    try {
      if (!(await onSave())) return;
      const full = await invoke<string>("debug_program", { path: program });
      await invoke("debug_start", { kind });
      setRunning(true);
      onSession({ running: true, path: null, line: null });
      setState("Starting adapter…");
      await request("launch", {
        program: full,
        cwd: workspace.root,
        stopOnEntry: true,
        stopAtEntry: true,
        ...(kind === "python"
          ? { console: "internalConsole", justMyCode: true }
          : {}),
      });
    } catch (e) {
      setRunning(false);
      onSession({ running: false, path: null, line: null });
      onError(e);
      void invoke("debug_stop").catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function control(command: string) {
    try {
      if (command === "disconnect") {
        await invoke("debug_stop");
        setRunning(false);
        setThread(null);
        setFrames([]);
        setVariables([]);
        onSession({ running: false, path: null, line: null });
        setState("Session stopped.");
      } else await request(command, { threadId: thread ?? undefined });
    } catch (e) {
      onError(e);
    }
  }
  return (
    <div className="debugger">
      <div className="section-label">
        <span>
          <Bug size={12} /> DEBUGGER
        </span>
        <span className={running ? "connected-dot" : "neutral-dot"} />
      </div>
      <div className="debug-config">
        <label className="field-label" htmlFor="debug-adapter">
          ADAPTER
        </label>
        <select
          id="debug-adapter"
          disabled={running}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as "lldb" | "python";
            setKind(k);
            localStorage.setItem("devyy.debug.kind", JSON.stringify(k));
          }}
        >
          <option value="lldb">LLDB · Rust / C / C++</option>
          <option value="python">Python · debugpy</option>
        </select>
        <label className="field-label" htmlFor="debug-program">
          {kind === "python" ? "SCRIPT PATH" : "COMPILED BINARY PATH"}
        </label>
        <input
          id="debug-program"
          className="text-input mono"
          disabled={running}
          value={program}
          placeholder={
            kind === "python" ? "src/main.py" : "target/debug/my-app"
          }
          onChange={(e) => {
            setProgram(e.target.value);
            localStorage.setItem(
              "devyy.debug.program",
              JSON.stringify(e.target.value),
            );
          }}
        />
        <small>
          Relative to this workspace.{" "}
          {kind === "lldb"
            ? "Build with debug symbols first."
            : "Install with pip install debugpy."}
        </small>
      </div>
      <div className="debug-controls">
        <button
          className="primary"
          disabled={busy || (!running && !program)}
          title={running ? "Continue" : "Start debugging"}
          aria-label={running ? "Continue" : "Start debugging"}
          onClick={() => (running ? void control("continue") : void start())}
        >
          {busy ? (
            <RefreshCw size={14} className="spinning" />
          ) : (
            <Play size={14} />
          )}
        </button>
        <button
          title="Pause"
          aria-label="Pause debugging"
          disabled={!running || thread !== null}
          onClick={() =>
            void (async () => {
              try {
                const result = await request<{
                  threads: Array<{ id: number }>;
                }>("threads");
                await request("pause", { threadId: result.threads[0]?.id });
              } catch (e) {
                onError(e);
              }
            })()
          }
        >
          <Pause size={15} />
        </button>
        <button
          title="Step over"
          aria-label="Step over"
          disabled={!running || thread === null}
          onClick={() => void control("next")}
        >
          <CornerDownRight size={16} />
        </button>
        <button
          title="Step into"
          aria-label="Step into"
          disabled={!running || thread === null}
          onClick={() => void control("stepIn")}
        >
          <ArrowDownToLine size={16} />
        </button>
        <button
          title="Step out"
          aria-label="Step out"
          disabled={!running || thread === null}
          onClick={() => void control("stepOut")}
        >
          <ArrowUpFromLine size={16} />
        </button>
        <button
          title="Stop debugging"
          aria-label="Stop debugging"
          disabled={!running}
          onClick={() => void control("disconnect")}
        >
          <Square size={13} />
        </button>
      </div>
      <p className="debug-state">
        <span className={running ? "alive-dot" : "neutral-dot"} />
        {state}
      </p>
      {!!frames.length && (
        <>
          <div className="section-label">
            <span>CALL STACK</span>
          </div>
          <div className="debug-stack">
            {frames.map((frame) => (
              <button
                className={selected === frame.id ? "selected" : ""}
                key={frame.id}
                onClick={() => void inspect(frame).catch(onError)}
              >
                <ChevronRight size={11} />
                <span>{frame.name}</span>
                <small>:{frame.line}</small>
              </button>
            ))}
          </div>
          <div className="section-label">
            <span>VARIABLES · LOCALS</span>
          </div>
          <div className="debug-variables">
            {variables.map((v, i) => (
              <VariableRow
                key={`${v.name}:${i}`}
                variable={v}
                request={request}
                onError={onError}
              />
            ))}
          </div>
        </>
      )}
      <div className="section-label">
        <span>BREAKPOINTS</span>
        <small>{Object.values(breakpoints).flat().length}</small>
      </div>
      {Object.entries(breakpoints).flatMap(([path, lines]) =>
        lines.map((line) => (
          <button
            className="breakpoint-row"
            key={`${path}:${line}`}
            onClick={() => onNavigate(path, line)}
          >
            <Circle size={8} fill="currentColor" />
            <span>{path}</span>
            <small>:{line}</small>
          </button>
        )),
      )}
      <p className="muted tiny">
        Click the gutter beside a line number to toggle a breakpoint. Install{" "}
        <code>lldb-dap</code> or <code>debugpy</code> on your PATH.
      </p>
    </div>
  );
}
function VariableRow({
  variable,
  request,
  onError,
}: {
  variable: Variable;
  request: <T>(command: string, args: unknown) => Promise<T>;
  onError: (error: unknown) => void;
}) {
  const [children, setChildren] = useState<Variable[] | null>(null),
    [open, setOpen] = useState(false);
  async function expand() {
    if (!variable.variablesReference) return;
    if (!children) {
      try {
        const result = await request<{ variables: Variable[] }>("variables", {
          variablesReference: variable.variablesReference,
        });
        setChildren(result.variables);
      } catch (e) {
        onError(e);
        return;
      }
    }
    setOpen((v) => !v);
  }
  return (
    <div>
      <button
        className="variable-row"
        title={variable.type}
        onClick={() => void expand()}
      >
        <ChevronRight
          size={10}
          style={{
            visibility: variable.variablesReference ? "visible" : "hidden",
            transform: open ? "rotate(90deg)" : "",
          }}
        />
        <strong>{variable.name}</strong>
        <code>{variable.value}</code>
      </button>
      {open && (
        <div className="variable-children">
          {children?.map((child, i) => (
            <VariableRow
              key={`${child.name}:${i}`}
              variable={child}
              request={request}
              onError={onError}
            />
          ))}
        </div>
      )}
    </div>
  );
}
