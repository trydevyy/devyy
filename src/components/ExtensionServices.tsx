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

import { AnimatePresence, useIsPresent } from "motion/react";
import ModalBackdrop from "./ui/ModalBackdrop";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readClipboardText, writeClipboardText } from "../lib/clipboard";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { hostRequest, type HostEvent } from "../lib/extensionHost";
import { fileUri } from "../lib/extensionWorkbench";
import { invoke, native } from "../lib/native";
import ExtensionQuickInput from "./ExtensionQuickInput";
import { restoreFocus } from "../lib/focus";
export interface WorkbenchRequest {
  id: string;
  method: string;
  extension: string;
  params: Record<string, unknown>;
}
interface Prompt extends WorkbenchRequest {
  method: "inputBox" | "quickPick" | "message";
  params: {
    message?: string;
    items?: {
      label?: string;
      title?: string;
      description?: string;
      detail?: string;
      index?: number;
      picked?: boolean;
      kind?: number;
    }[];
    options?: {
      title?: string;
      prompt?: string;
      placeHolder?: string;
      password?: boolean;
      value?: string;
      canPickMany?: boolean;
      detail?: string;
    };
  };
}
function respond(
  request: WorkbenchRequest,
  result: unknown = null,
  error?: string,
) {
  return hostRequest("workbenchResponse", { id: request.id, result, error });
}
function pathOption(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "fsPath" in value)
    return String(value.fsPath);
}
export default function ExtensionServices({
  onRequest,
}: {
  onRequest: (request: WorkbenchRequest) => Promise<unknown>;
}) {
  const handler = useRef(onRequest);
  handler.current = onRequest;
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  useEffect(() => {
    const listener = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "cancelRequest") {
        setPrompts((items) =>
          items.filter((item) => item.id !== message.payload.id),
        );
        return;
      }
      if (message.event !== "workbenchRequest") return;
      const request = message.payload as unknown as WorkbenchRequest;
      if (["inputBox", "quickPick", "message"].includes(request.method)) {
        setPrompts((items) => [...items, request as Prompt]);
        return;
      }
      void (async () => {
        const p = request.params;
        switch (request.method) {
          case "secretGet":
          case "secretStore":
          case "secretDelete":
            return invoke("extension_secret", {
              id: request.extension,
              key: p.key,
              value: p.value ?? null,
              action:
                request.method === "secretGet"
                  ? "get"
                  : request.method === "secretStore"
                    ? "store"
                    : "delete",
            });
          case "languageClientStart":
            return invoke("lsp_start", { language: p.language });
          case "languageClientRequest":
            return invoke("lsp_request", p);
          case "languageClientStop":
            await invoke("lsp_stop_language", { language: p.language });
            return true;
          case "clipboardRead":
            return readClipboardText();
          case "clipboardWrite":
            await writeClipboardText(String(p.text));
            return null;
          case "openExternal":
            await openUrl(String(p.uri));
            return true;
          case "openDialog": {
            const options = (p.options ?? {}) as Record<string, unknown>;
            const result = await open({
              title: options.title as string | undefined,
              defaultPath: pathOption(options.defaultUri),
              directory: !!options.canSelectFolders,
              multiple: !!options.canSelectMany,
              filters: options.filters
                ? Object.entries(
                    options.filters as Record<string, string[]>,
                  ).map(([name, extensions]) => ({ name, extensions }))
                : undefined,
            });
            return result
              ? (Array.isArray(result) ? result : [result]).map(fileUri)
              : null;
          }
          case "saveDialog": {
            const options = (p.options ?? {}) as Record<string, unknown>;
            const result = await save({
              title: options.title as string | undefined,
              defaultPath: pathOption(options.defaultUri),
              filters: options.filters
                ? Object.entries(
                    options.filters as Record<string, string[]>,
                  ).map(([name, extensions]) => ({ name, extensions }))
                : undefined,
            });
            return result ? fileUri(result) : null;
          }
          default:
            return handler.current(request);
        }
      })()
        .then((result) => respond(request, result))
        .catch((error) => respond(request, null, String(error)))
        .catch((error) => toast.error(String(error)));
    };
    const reset = () => setPrompts([]);
    window.addEventListener("devyy-extension-event", listener);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      window.removeEventListener("devyy-extension-event", listener);
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const handle = (urls: string[]) => {
      for (const uri of urls)
        if (uri === "devyy://auth-complete" || uri === "devyy://auth-complete/")
          continue;
        else if (uri.startsWith("devyy:"))
          void hostRequest("handleUri", { uri }).catch((e) =>
            toast.error(String(e)),
          );
    };
    void onOpenUrl(handle)
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((e) => toast.error(String(e)));
    void getCurrent()
      .then((urls) => {
        if (!disposed && urls) handle(urls);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  const prompt = prompts[0];
  return (
    <>
      <ExtensionQuickInput />
      <AnimatePresence>
        {prompt && (
          <ExtensionPrompt
            key={prompt.id}
            prompt={prompt}
            onFinish={(value) => {
              setPrompts((items) =>
                items.filter((item) => item.id !== prompt.id),
              );
              void respond(prompt, value).catch((e) => toast.error(String(e)));
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
interface ProgressTask {
  id: string;
  extension: string;
  title: string;
  message?: string;
  percent?: number;
  cancellable?: boolean;
  cancelling?: boolean;
  language?: string;
  token?: string | number;
}
export function ExtensionProgress({
  children,
}: {
  children: (active: ReadonlySet<string>) => ReactNode;
}) {
  const [tasks, setTasks] = useState<ProgressTask[]>([]);
  useEffect(() => {
    const listener = (event: Event) => {
      const { event: kind, payload } = (event as CustomEvent<HostEvent>).detail;
      if (kind === "progressStart")
        setTasks((old) => [
          ...old.filter((task) => task.id !== payload.id),
          payload as unknown as ProgressTask,
        ]);
      if (kind === "progressEnd")
        setTasks((old) => old.filter((task) => task.id !== payload.id));
      if (kind === "progressReport")
        setTasks((old) => {
          const task = old.find((item) => item.id === payload.id);
          if (!task) return old;
          const percent = typeof payload.percent === "number"
            ? payload.percent
            : typeof payload.increment === "number"
              ? (task.percent ?? 0) + payload.increment
              : task.percent;
          return [...old.filter((item) => item.id !== task.id), {
            ...task,
            message: typeof payload.message === "string" ? payload.message : task.message,
            percent: percent === undefined ? undefined : Math.max(0, Math.min(100, percent)),
          }];
        });
    };
    const reset = () => setTasks([]);
    window.addEventListener("devyy-extension-event", listener);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      window.removeEventListener("devyy-extension-event", listener);
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  const latest = new Map<string, ProgressTask>();
  for (const task of tasks) {
    const owner = task.extension === "rust" || task.extension === "rust-analyzer"
      ? "rust-lang.rust-analyzer" : task.extension;
    latest.set(owner, task);
  }
  return (
    <>
      {latest.size > 0 && <span className="extension-status-progress" aria-label="Extension progress">
      {[...latest].map(([owner, task]) => (
        <span
          className="extension-status-task"
          key={owner}
          title={[task.extension, task.title, task.message]
            .filter(Boolean)
            .join(": ")}
        >
          <span
            role="progressbar"
            aria-label={task.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={task.percent}
          >
            <LoaderCircle size={12} className="spinning" />
            <span>
              {task.title}
              {task.message ? `: ${task.message}` : ""}
            </span>
            {task.percent !== undefined && (
              <small>{Math.round(task.percent)}%</small>
            )}
          </span>
          {task.cancellable && (
            <button
              aria-label={`Cancel ${task.title}`}
              disabled={task.cancelling}
              onClick={() => {
                setTasks((old) =>
                  old.map((item) =>
                    item.id === task.id ? { ...item, cancelling: true } : item,
                  ),
                );
                void (
                  task.language
                    ? invoke("lsp_request", {
                        language: task.language,
                        method: "window/workDoneProgress/cancel",
                        params: { token: task.token },
                        notification: true,
                      })
                    : hostRequest("cancelProgress", { id: task.id })
                ).catch((error) => {
                  toast.error(String(error));
                  setTasks((old) =>
                    old.map((item) =>
                      item.id === task.id
                        ? { ...item, cancelling: false }
                        : item,
                    ),
                  );
                });
              }}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      </span>}
      {children(new Set(latest.keys()))}
    </>
  );
}

function ExtensionPrompt({
  prompt,
  onFinish,
}: {
  prompt: Prompt;
  onFinish: (value: unknown) => void;
}) {
  const present = useIsPresent();
  const options = prompt.params.options ?? {};
  const [value, setValue] = useState(options.value ?? "");
  const [selected, setSelected] = useState<number[]>(() =>
    (prompt.params.items ?? [])
      .filter((item) => item.picked)
      .map((item) => item.index!),
  );
  const [active, setActive] = useState(0);
  const root = useRef<HTMLFormElement>(null);
  const isPick = prompt.method === "quickPick";
  const items = (prompt.params.items ?? []).filter(
    (item) =>
      item.kind !== -1 &&
      (!isPick ||
        `${item.label} ${item.description ?? ""} ${item.detail ?? ""}`
          .toLowerCase()
          .includes(value.toLowerCase())),
  );
  const title =
    options.title ??
    (isPick
      ? "Choose an item"
      : prompt.method === "inputBox"
        ? "Extension input"
        : (prompt.params.message ?? "Extension message"));
  const choose = (index: number) => {
    if (options.canPickMany)
      setSelected((previous) =>
        previous.includes(index)
          ? previous.filter((i) => i !== index)
          : [...previous, index],
      );
    else onFinish(index);
  };
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement | null;
    (
      root.current?.querySelector("input") ??
      root.current?.querySelector("button")
    )?.focus();
    return () => restoreFocus(previous);
  }, [present]);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <ModalBackdrop
      className="modal-backdrop"
      onMouseDown={() => onFinish(null)}
    >
      <form
        ref={root}
        className="input-modal extension-prompt"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (isPick)
            options.canPickMany
              ? onFinish(selected)
              : items[active] && choose(items[active].index!);
          else onFinish(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onFinish(null);
          }
          if (isPick && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setActive((i) =>
              Math.max(
                0,
                Math.min(
                  items.length - 1,
                  i + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === "Tab") {
            const focusable = [
              ...(root.current?.querySelectorAll<HTMLElement>(
                "input,button:not(:disabled)",
              ) ?? []),
            ];
            const first = focusable[0],
              last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-header">
          <span className="eyebrow">{prompt.extension}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel extension prompt"
            onClick={() => onFinish(null)}
          >
            <X size={16} />
          </button>
        </div>
        <h2>{title}</h2>
        {(options.prompt || options.detail) && (
          <p className="muted">{options.prompt ?? options.detail}</p>
        )}
        {prompt.method !== "message" && (
          <input
            aria-label={isPick ? "Filter items" : title}
            placeholder={options.placeHolder}
            type={options.password ? "password" : "text"}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setActive(0);
            }}
            autoComplete="off"
          />
        )}
        {isPick && (
          <div
            className="extension-quickpick"
            role="listbox"
            aria-label="Extension choices"
            aria-multiselectable={!!options.canPickMany}
          >
            {items.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={
                  options.canPickMany
                    ? selected.includes(item.index!)
                    : active === index
                }
                key={item.index}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item.index!)}
              >
                <span>
                  {options.canPickMany && (
                    <input
                      aria-label={`Select ${item.label}`}
                      type="checkbox"
                      tabIndex={-1}
                      checked={selected.includes(item.index!)}
                      readOnly
                    />
                  )}
                  {item.label}
                </span>
                {item.description && <small>{item.description}</small>}
                {item.detail && <p>{item.detail}</p>}
              </button>
            ))}
            {!items.length && <p className="muted">No matching items</p>}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onFinish(null)}
          >
            Cancel
          </button>
          {prompt.method === "message"
            ? items.map((item, index) => (
                <button
                  type="button"
                  className="primary"
                  key={index}
                  onClick={() => onFinish(index)}
                >
                  {item.title}
                </button>
              ))
            : (!isPick || options.canPickMany) && (
                <button className="primary" type="submit">
                  Confirm
                </button>
              )}
        </div>
      </form>
    </ModalBackdrop>
  );
}
