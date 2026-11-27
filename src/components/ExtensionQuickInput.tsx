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

import { ModalSurface, ModalBody, ModalHeader } from "./ui/ModalSurface";
import Skeleton from "./ui/Skeleton";
import { AnimatePresence } from "motion/react";
import ModalBackdrop from "./ui/ModalBackdrop";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Check,
  File,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { hostRequest, type HostEvent } from "../lib/extensionHost";
import {
  quickInputItems,
  quickInputText,
  type QuickInputState,
  type QuickInputIcon,
  type QuickInputButton,
} from "../lib/quickInput";
import ExtensionIcon from "./ExtensionIcon";
import { restoreFocus } from "../lib/focus";
const DarkIcons = createContext(true);

function InputIcon({
  icon,
  extension,
}: {
  icon?: QuickInputIcon;
  extension: string;
}) {
  const dark = useContext(DarkIcons);
  if (!icon) return null;
  if (typeof icon === "object" && (icon.dark || icon.light))
    icon = (dark ? (icon.dark ?? icon.light) : (icon.light ?? icon.dark))!;
  if (typeof icon === "string")
    return <ExtensionIcon id={extension} path={icon} size={16} />;
  const icons: Record<string, typeof Check> = {
    "arrow-left": ArrowLeft,
    check: Check,
    close: X,
    add: Plus,
    refresh: RotateCw,
    settings: Settings2,
    gear: Settings2,
    trash: Trash2,
    edit: Pencil,
    search: Search,
    folder: Folder,
    file: File,
    "loading~spin": LoaderCircle,
  };
  const Icon = icons[icon.id ?? ""] ?? MoreHorizontal;
  return <Icon size={16} aria-hidden="true" />;
}

export default function ExtensionQuickInput() {
  const [input, setInput] = useState<QuickInputState>();
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const listener = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "quickInput") {
        opener.current ??= document.activeElement as HTMLElement | null;
        setInput(message.payload as unknown as QuickInputState);
      } else if (message.event === "quickInputHidden") {
        setInput((old) =>
          old &&
          old.id === message.payload.id &&
          old.session === message.payload.session
            ? undefined
            : old,
        );
      }
    };
    const reset = () => setInput(undefined);
    window.addEventListener("devyy-extension-event", listener);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      window.removeEventListener("devyy-extension-event", listener);
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  useEffect(() => {
    if (!input && opener.current) {
      restoreFocus(opener.current);
      opener.current = null;
    }
  }, [input]);
  return (
    <AnimatePresence>
      {input && (
        <QuickInput key={`${input.id}:${input.session}`} input={input} />
      )}
    </AnimatePresence>
  );
}

function QuickInput({ input }: { input: QuickInputState }) {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme !== "paper",
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme !== "paper"),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const root = useRef<HTMLFormElement>(null);
  const textbox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const appliedSelection = useRef<number | undefined>(undefined);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const [value, setValue] = useState(input.value);
  const [active, setActive] = useState(input.activeItems[0]);
  const [selected, setSelected] = useState(input.selectedItems);
  const isPick = input.kind === "pick";
  const items = useMemo(() => quickInputItems(input, value), [input, value]);
  const choices = items.filter((item) => item.kind !== -1);
  const activeItem =
    choices.find((item) => item.index === active) ?? choices[0];
  const validation =
    typeof input.validationMessage === "string"
      ? { message: input.validationMessage, severity: 3 }
      : input.validationMessage;
  const title = input.title ?? (isPick ? "Choose an item" : "Extension input");
  function send(kind: string, params: Record<string, unknown> = {}) {
    const message = {
      id: input.id,
      session: input.session,
      itemsVersion: input.itemsVersion,
      buttonsVersion: input.buttonsVersion,
      valueVersion: input.valueVersion,
      kind,
      ...params,
    };
    tail.current = tail.current
      .catch(() => {})
      .then(() => hostRequest("quickInputEvent", message))
      .catch((error) => toast.error(String(error)));
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    setValue(input.value);
  }, [input.valueVersion]); // User typing is optimistic; only explicit extension assignments replace it.
  const activeKey = input.activeItems.join(","),
    selectedKey = input.selectedItems.join(",");
  useEffect(() => {
    setActive(input.activeItems[0]);
  }, [activeKey, input.itemsVersion]);
  useEffect(() => {
    setSelected(input.selectedItems);
  }, [selectedKey, input.itemsVersion]);
  useEffect(() => {
    textbox.current?.focus();
  }, []);
  useEffect(() => {
    const field = textbox.current;
    if (
      field &&
      !isPick &&
      appliedSelection.current !== input.selectionVersion &&
      field.value === input.value
    ) {
      const selection = input.valueSelection ?? [0, field.value.length];
      field.setSelectionRange(selection[0], selection[1]);
      appliedSelection.current = input.selectionVersion;
    }
  }, [input.selectionVersion, input.valueVersion, value]);
  useEffect(() => {
    if (activeItem?.index === active) return;
    setActive(activeItem?.index);
    sendRef.current("active", {
      indices: activeItem ? [activeItem.index] : [],
    });
  }, [activeItem?.index, active]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${activeItem?.index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeItem?.index]);
  useEffect(() => {
    if (!input.keepScrollPosition && list.current) list.current.scrollTop = 0;
  }, [input.itemsVersion, input.keepScrollPosition]);
  useEffect(() => {
    const blur = () => {
      if (!input.ignoreFocusOut) sendRef.current("hide");
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [input.ignoreFocusOut]);
  function changeActive(index: number) {
    if (!input.enabled || index === active) return;
    setActive(index);
    send("active", { indices: [index] });
  }
  function changeSelection(indices: number[]) {
    setSelected(indices);
    send("selection", { indices });
  }
  function accept(index?: number) {
    if (
      !input.enabled ||
      (!isPick && validation?.message && validation.severity === 3)
    )
      return;
    if (isPick && !input.canSelectMany) {
      if (index === undefined) return;
      changeActive(index);
      changeSelection([index]);
    }
    send("accept");
  }
  function toggle(index: number) {
    if (!input.enabled) return;
    changeActive(index);
    changeSelection(
      selected.includes(index)
        ? selected.filter((item) => item !== index)
        : [...selected, index],
    );
  }
  function renderButton(
    button: QuickInputButton,
    index: number,
    item?: number,
  ) {
    const label =
      button.tooltip ??
      (button.back
        ? "Back"
        : item === undefined
          ? `Action ${index + 1}`
          : `Item action ${index + 1}`);
    return (
      <button
        type="button"
        key={index}
        className="icon-button"
        title={label}
        aria-label={label}
        disabled={!input.enabled}
        onClick={() => {
          if (item !== undefined) changeActive(item);
          send(
            item === undefined ? "button" : "itemButton",
            item === undefined ? { index } : { index: item, button: index },
          );
        }}
      >
        <InputIcon
          extension={input.extension}
          icon={
            button.back
              ? { id: "arrow-left" }
              : button.icon
                ? { id: button.icon }
                : (button.iconPath ?? { id: "ellipsis" })
          }
        />
      </button>
    );
  }
  return (
    <DarkIcons.Provider value={dark}>
      <ModalBackdrop
        className="modal-backdrop"
        onMouseDown={() => {
          if (!input.ignoreFocusOut) send("hide");
        }}
      >
        <ModalSurface
          as="form"
          ref={root}
          className="input-modal extension-prompt extension-live-input"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          aria-busy={input.busy}
          onMouseDown={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (
              event.relatedTarget &&
              !event.currentTarget.contains(event.relatedTarget as Node) &&
              !input.ignoreFocusOut
            )
              send("hide");
          }}
          onSubmit={(event) => {
            event.preventDefault();
            accept(activeItem?.index);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              send("hide");
            }
            if (isPick && ["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              if (!choices.length) return;
              const offset = choices.findIndex(
                (item) => item.index === activeItem?.index,
              );
              const next =
                (offset +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  choices.length) %
                choices.length;
              changeActive(choices[next].index);
            }
            if (
              event.key === " " &&
              isPick &&
              input.canSelectMany &&
              (event.ctrlKey || list.current?.contains(event.target as Node)) &&
              activeItem
            ) {
              event.preventDefault();
              toggle(activeItem.index);
            }
            if (
              event.key === "Enter" &&
              list.current?.contains(event.target as Node) &&
              !(event.target instanceof HTMLButtonElement)
            ) {
              event.preventDefault();
              accept(activeItem?.index);
            }
            if (event.key === "Tab") {
              const focusable = [
                ...(root.current?.querySelectorAll<HTMLElement>(
                  'input:not(:disabled),button:not(:disabled),[tabindex="0"]',
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
          <ModalHeader
            title={title}
            description={input.extension}
            onClose={() => send("hide")}
            closeLabel="Cancel extension prompt"
          />
          <ModalBody>
            {(input.step !== undefined || input.buttons.length > 0) && (
              <div className="modal-header">
                {input.step !== undefined && (
                  <span className="muted">
                    {input.step}
                    {input.totalSteps ? ` / ${input.totalSteps}` : ""}
                  </span>
                )}
                <div className="extension-input-actions">
                  {input.buttons.map((button, index) =>
                    renderButton(button, index),
                  )}
                </div>
              </div>
            )}
            {input.prompt && (
              <p className="muted" id={`${input.id}-prompt`}>
                {input.prompt}
              </p>
            )}
            <input
              ref={textbox}
              role={isPick ? "combobox" : undefined}
              aria-label={isPick ? "Filter items" : title}
              aria-expanded={isPick ? true : undefined}
              aria-controls={isPick ? `${input.id}-choices` : undefined}
              aria-autocomplete={isPick ? "list" : undefined}
              aria-activedescendant={
                isPick && activeItem
                  ? `${input.id}-item-${activeItem.index}`
                  : undefined
              }
              aria-invalid={!!validation?.message && validation.severity === 3}
              aria-describedby={
                validation?.message
                  ? `${input.id}-validation`
                  : input.prompt
                    ? `${input.id}-prompt`
                    : undefined
              }
              placeholder={input.placeholder}
              type={input.password ? "password" : "text"}
              value={value}
              disabled={!input.enabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setValue(event.target.value);
                send("value", { value: event.target.value });
              }}
            />
            {input.busy && (
              <div
                className="extension-input-busy"
                role="progressbar"
                aria-label="Loading choices"
              >
                <span />
              </div>
            )}
            {validation?.message && (
              <p
                id={`${input.id}-validation`}
                className={`extension-input-validation severity-${validation.severity}`}
                role={validation.severity === 3 ? "alert" : "status"}
              >
                {validation.message}
              </p>
            )}
            {isPick && (
              <div
                ref={list}
                className="extension-quickpick extension-live-choices"
                role="listbox"
                tabIndex={input.canSelectMany ? 0 : -1}
                id={`${input.id}-choices`}
                aria-label="Extension choices"
                aria-multiselectable={!!input.canSelectMany}
              >
                {items.map((item) =>
                  item.kind === -1 ? (
                    <div
                      className="extension-input-separator"
                      role="presentation"
                      key={`separator-${item.index}`}
                    >
                      {quickInputText(item.label)}
                    </div>
                  ) : (
                    <div
                      className={`extension-input-item ${activeItem?.index === item.index ? "active" : ""}`}
                      key={item.index}
                      data-index={item.index}
                    >
                      <button
                        type="button"
                        role="option"
                        id={`${input.id}-item-${item.index}`}
                        tabIndex={-1}
                        disabled={!input.enabled}
                        aria-selected={
                          input.canSelectMany
                            ? selected.includes(item.index)
                            : activeItem?.index === item.index
                        }
                        onMouseEnter={() => changeActive(item.index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          input.canSelectMany
                            ? toggle(item.index)
                            : accept(item.index)
                        }
                      >
                        <span>
                          {input.canSelectMany && (
                            <span
                              className={`extension-input-check ${selected.includes(item.index) ? "checked" : ""}`}
                              aria-hidden="true"
                            >
                              {selected.includes(item.index) && (
                                <Check size={12} />
                              )}
                            </span>
                          )}
                          <InputIcon
                            icon={item.iconPath}
                            extension={input.extension}
                          />
                          <span>{quickInputText(item.label)}</span>
                          {item.description && (
                            <small>{quickInputText(item.description)}</small>
                          )}
                        </span>
                        {item.detail && <p>{quickInputText(item.detail)}</p>}
                      </button>
                      {!!item.buttons?.length && (
                        <div className="extension-input-actions">
                          {item.buttons.map((button, index) =>
                            renderButton(button, index, item.index),
                          )}
                        </div>
                      )}
                    </div>
                  ),
                )}
                {!choices.length &&
                  (input.busy ? (
                    <Skeleton label="Loading choices" />
                  ) : (
                    <p className="muted">No matching items</p>
                  ))}
              </div>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => send("hide")}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={
                  !input.enabled ||
                  (!isPick &&
                    !!validation?.message &&
                    validation.severity === 3) ||
                  (isPick && !input.canSelectMany && !activeItem)
                }
              >
                {input.canSelectMany && selected.length
                  ? `Confirm (${selected.length})`
                  : "Confirm"}
              </button>
            </div>
          </ModalBody>
        </ModalSurface>
      </ModalBackdrop>
    </DarkIcons.Provider>
  );
}
