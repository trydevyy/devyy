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

"use strict";
const path = require("node:path");

module.exports = function installQuickInput(api, host) {
  const inputs = new Map();
  let serial = 0,
    current;
  api.QuickInputButtons = {
    Back: Object.freeze({
      iconPath: new api.ThemeIcon("arrow-left"),
      tooltip: "Back",
    }),
  };
  api.InputBoxValidationSeverity = {
    Info: 1,
    Warning: 2,
    Error: 3,
    1: "Info",
    2: "Warning",
    3: "Error",
  };
  const same = (a, b) =>
    a.length === b.length && a.every((item, i) => item === b[i]);
  const button = (value, extension) => ({
    tooltip: value.tooltip,
    icon: value.iconPath?.id,
    iconPath: value.iconPath?.id ? undefined : icon(value.iconPath, extension),
    back: value === api.QuickInputButtons.Back,
  });
  function icon(value, extension) {
    if (!value) return;
    if (value.id) return { id: value.id };
    if (value.light || value.dark)
      return {
        light: icon(value.light, extension),
        dark: icon(value.dark, extension),
      };
    const file =
      value.scheme === "file"
        ? value.fsPath
        : typeof value === "string"
          ? value
          : undefined;
    if (!file) return;
    return path.isAbsolute(file) ? path.relative(extension.path, file) : file;
  }
  function create(kind) {
    const extension = host.own(),
      id = `quick-input-${++serial}`;
    const events = new Map();
    const state = {
      title: undefined,
      step: undefined,
      totalSteps: undefined,
      enabled: true,
      busy: false,
      ignoreFocusOut: false,
      value: "",
      placeholder: undefined,
      buttons: [],
      valueSelection: undefined,
      password: false,
      prompt: undefined,
      validationMessage: undefined,
      items: [],
      activeItems: [],
      selectedItems: [],
      canSelectMany: false,
      matchOnDescription: false,
      matchOnDetail: false,
      keepScrollPosition: false,
      sortByLabel: true,
    };
    let visible = false,
      disposed = false,
      session = 0,
      queued = false;
    let valueVersion = 0,
      selectionVersion = 0,
      itemsVersion = 0,
      buttonsVersion = 0;
    function fire(name, value) {
      events.get(name)?.fire(value);
    }
    function snapshot() {
      return {
        id,
        session,
        extension: extension.id,
        kind,
        ...state,
        valueVersion,
        selectionVersion,
        itemsVersion,
        buttonsVersion,
        buttons: state.buttons.map((value) => button(value, extension)),
        items: state.items.map((item, index) => ({
          index,
          label: item.label,
          description: item.description,
          detail: item.detail,
          kind: item.kind,
          picked: item.picked,
          alwaysShow: item.alwaysShow,
          iconPath: icon(item.iconPath, extension),
          buttons: (item.buttons || []).map((value) =>
            button(value, extension),
          ),
        })),
        activeItems: state.activeItems.map((item) => state.items.indexOf(item)),
        selectedItems: state.selectedItems.map((item) =>
          state.items.indexOf(item),
        ),
      };
    }
    function publish() {
      if (!visible || disposed || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (visible && !disposed) host.emit("quickInput", snapshot());
      });
    }
    function hide() {
      if (!visible) return;
      visible = false;
      if (current === input) current = undefined;
      host.emit("quickInputHidden", { id, session });
      fire("onDidHide");
    }
    function setItems(name, value) {
      const next = [...(value || [])].filter(
        (item) => state.items.includes(item) && item.kind !== -1,
      );
      const normalized =
        name === "activeItems" || !state.canSelectMany
          ? next.slice(0, 1)
          : next;
      if (same(state[name], normalized)) return;
      state[name] = normalized;
      publish();
      fire(
        name === "activeItems" ? "onDidChangeActive" : "onDidChangeSelection",
        [...normalized],
      );
    }
    const input = {
      show() {
        if (disposed) return;
        if (!visible) {
          const previous = current;
          current = input;
          visible = true;
          session++;
          previous?.hide();
        }
        publish();
      },
      hide,
      dispose() {
        if (disposed) return;
        disposed = true;
        hide();
        inputs.delete(id);
        for (const event of events.values()) event.dispose();
      },
    };
    const names = [
      "onDidHide",
      "onDidAccept",
      "onDidChangeValue",
      "onDidTriggerButton",
    ];
    if (kind === "pick")
      names.push(
        "onDidChangeActive",
        "onDidChangeSelection",
        "onDidTriggerItemButton",
      );
    for (const name of names) {
      const emitter = new api.EventEmitter();
      events.set(name, emitter);
      input[name] = emitter.event;
    }
    const properties = [
      "title",
      "step",
      "totalSteps",
      "enabled",
      "busy",
      "ignoreFocusOut",
      "value",
      "placeholder",
      "buttons",
    ];
    properties.push(
      ...(kind === "pick"
        ? [
            "items",
            "activeItems",
            "selectedItems",
            "canSelectMany",
            "matchOnDescription",
            "matchOnDetail",
            "keepScrollPosition",
            "sortByLabel",
          ]
        : ["valueSelection", "password", "prompt", "validationMessage"]),
    );
    for (const name of properties)
      Object.defineProperty(input, name, {
        enumerable: true,
        get: () =>
          Array.isArray(state[name]) ? [...state[name]] : state[name],
        set(value) {
          if (disposed) return;
          if (name === "activeItems" || name === "selectedItems")
            return setItems(name, value);
          if (name === "items") {
            state.items = [...value];
            itemsVersion++;
            setItems("selectedItems", state.selectedItems);
            const active = state.activeItems.filter((item) =>
              state.items.includes(item),
            );
            setItems(
              "activeItems",
              active.length
                ? active
                : state.items.filter((item) => item.kind !== -1).slice(0, 1),
            );
            publish();
          } else {
            if (Object.is(state[name], value)) return;
            state[name] = Array.isArray(value) ? [...value] : value;
            if (name === "value") {
              valueVersion++;
              fire("onDidChangeValue", value);
            }
            if (name === "valueSelection") selectionVersion++;
            if (name === "buttons") buttonsVersion++;
            if (name === "canSelectMany" && !value)
              setItems("selectedItems", state.selectedItems);
          }
          publish();
        },
      });
    inputs.set(id, {
      input,
      dispatch(message) {
        if (!visible || disposed || message.session !== session) return false;
        if (message.kind === "hide") {
          hide();
          return true;
        }
        if (!state.enabled) return false;
        if (message.kind === "value") {
          if (message.valueVersion !== valueVersion) return false;
          if (
            typeof message.value !== "string" ||
            message.value === state.value
          )
            return true;
          state.value = message.value;
          fire("onDidChangeValue", message.value);
        } else if (message.kind === "button") {
          if (message.buttonsVersion !== buttonsVersion) return false;
          const value = state.buttons[message.index];
          if (value) fire("onDidTriggerButton", value);
        } else if (message.kind === "accept") {
          if (message.valueVersion !== valueVersion) return false;
          if (kind === "pick" && message.itemsVersion !== itemsVersion)
            return false;
          const validation = state.validationMessage;
          if (
            kind === "input" &&
            validation &&
            (typeof validation === "string" || validation.severity === 3)
          )
            return false;
          fire("onDidAccept");
        } else {
          if (kind !== "pick" || message.itemsVersion !== itemsVersion)
            return false;
          if (message.kind === "active" || message.kind === "selection") {
            const values = [...new Set(message.indices || [])]
              .map((index) => state.items[index])
              .filter(Boolean);
            setItems(
              message.kind === "active" ? "activeItems" : "selectedItems",
              values,
            );
          } else if (message.kind === "itemButton") {
            const item = state.items[message.index],
              value = item?.buttons?.[message.button];
            if (item) setItems("activeItems", [item]);
            if (value) fire("onDidTriggerItemButton", { item, button: value });
          } else return false;
        }
        return true;
      },
    });
    return input;
  }
  api.window.createQuickPick = () => create("pick");
  api.window.createInputBox = () => create("input");
  function prompt(input, token, setup) {
    return new Promise((resolve, reject) => {
      let done = false;
      const subscriptions = [];
      const finish = (value, error) => {
        if (done) return;
        done = true;
        for (const subscription of subscriptions) subscription.dispose();
        input.dispose();
        if (error) reject(error);
        else resolve(value);
      };
      subscriptions.push(input.onDidHide(() => finish(undefined)));
      if (token?.isCancellationRequested) {
        finish(undefined);
        return;
      }
      if (token)
        subscriptions.push(
          token.onCancellationRequested(() => finish(undefined)),
        );
      try {
        setup({
          finish,
          subscribe: (subscription) => subscriptions.push(subscription),
          isDone: () => done,
        });
        if (!done) input.show();
      } catch (error) {
        finish(undefined, error);
      }
    });
  }
  function showQuickPick(values, options = {}, token) {
    const input = create("pick");
    input.title = options.title;
    input.placeholder = options.placeHolder;
    input.ignoreFocusOut = !!options.ignoreFocusOut;
    input.matchOnDescription = !!options.matchOnDescription;
    input.matchOnDetail = !!options.matchOnDetail;
    input.canSelectMany = !!options.canPickMany;
    input.busy = true;
    return prompt(input, token, ({ finish, subscribe, isDone }) => {
      let originals = [],
        items = [];
      subscribe(
        input.onDidAccept(() => {
          const selected = input.selectedItems;
          finish(
            options.canPickMany
              ? selected.map((item) => originals[items.indexOf(item)])
              : originals[items.indexOf(selected[0])],
          );
        }),
      );
      if (options.onDidSelectItem)
        subscribe(
          input.onDidChangeActive((active) => {
            if (active[0])
              options.onDidSelectItem(originals[items.indexOf(active[0])]);
          }),
        );
      Promise.resolve(values)
        .then((result) => {
          if (isDone()) return;
          originals = result;
          items = result.map((item) =>
            typeof item === "string" ? { label: item } : item,
          );
          input.items = items;
          if (options.canPickMany)
            input.selectedItems = items.filter((item) => item.picked);
          input.busy = false;
        })
        .catch((error) => finish(undefined, error));
    });
  }
  function showInputBox(options = {}, token) {
    const input = create("input");
    input.title = options.title;
    input.placeholder = options.placeHolder;
    input.ignoreFocusOut = !!options.ignoreFocusOut;
    input.password = !!options.password;
    input.prompt = options.prompt;
    input.value = options.value ?? "";
    input.valueSelection = options.valueSelection;
    return prompt(input, token, ({ finish, subscribe, isDone }) => {
      let generation = 0,
        validation = Promise.resolve();
      const validate = (value) => {
        const version = ++generation;
        input.busy = !!options.validateInput;
        validation = Promise.resolve()
          .then(() => options.validateInput?.(value))
          .then((message) => {
            if (isDone() || version !== generation) return;
            input.validationMessage = message;
            input.busy = false;
          })
          .catch((error) => {
            if (!isDone() && version === generation) finish(undefined, error);
          });
      };
      subscribe(input.onDidChangeValue(validate));
      subscribe(
        input.onDidAccept(async () => {
          const value = input.value,
            version = generation;
          await validation;
          if (isDone() || version !== generation) return;
          const message = input.validationMessage;
          if (
            !message ||
            (typeof message !== "string" && message.severity !== 3)
          )
            finish(value);
        }),
      );
      validate(input.value);
    });
  }
  return {
    showQuickPick,
    showInputBox,
    dispatch(message) {
      return inputs.get(message.id)?.dispatch(message) ?? false;
    },
    shutdown() {
      for (const entry of [...inputs.values()]) entry.input.dispose();
    },
  };
};
