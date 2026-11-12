/* Storage for opaque sandbox frames. Parent persistence is scoped to the extension. */
window.__DEVYY_INSTALL_WEBVIEW_STORAGE__ = function (initial = {}) {
  const stores = new Map();
  for (const kind of ["local", "session"]) {
    try {
      const native = window[kind + "Storage"];
      if (native) continue;
    } catch {}
    const entries = new Map(Object.entries(initial[kind] || {}));
    const notify = (operation, key, value) =>
      parent.postMessage(
        { channel: "devyy-storage", kind, operation, key, value },
        "*",
      );
    const methods = {
      get length() {
        return entries.size;
      },
      key(index) {
        return [...entries.keys()][Number(index)] ?? null;
      },
      getItem(key) {
        return entries.get(String(key)) ?? null;
      },
      setItem(key, value) {
        key = String(key);
        value = String(value);
        const size =
          [...entries].reduce(
            (n, [k, v]) => n + (k === key ? 0 : (k.length + v.length) * 2),
            0,
          ) +
          (key.length + value.length) * 2;
        if (size > 5 * 1024 * 1024)
          throw new DOMException(
            "Storage quota exceeded",
            "QuotaExceededError",
          );
        entries.set(key, value);
        notify("set", key, value);
      },
      removeItem(key) {
        key = String(key);
        entries.delete(key);
        notify("remove", key);
      },
      clear() {
        entries.clear();
        notify("clear");
      },
    };
    const storage = new Proxy(methods, {
      get(target, key) {
        return key in target
          ? Reflect.get(target, key)
          : entries.get(String(key));
      },
      set(_target, key, value) {
        methods.setItem(key, value);
        return true;
      },
      deleteProperty(_target, key) {
        methods.removeItem(key);
        return true;
      },
      ownKeys() {
        return [...entries.keys()];
      },
      getOwnPropertyDescriptor(_target, key) {
        if (entries.has(key))
          return {
            value: entries.get(key),
            writable: true,
            enumerable: true,
            configurable: true,
          };
      },
    });
    stores.set(kind, { entries, storage });
    Object.defineProperty(window, kind + "Storage", {
      value: storage,
      configurable: true,
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== "devyy-storage-sync")
      return;
    const change = event.data,
      store = stores.get(change.kind);
    if (!store) return;
    const oldValue = store.entries.get(change.key) ?? null;
    if (change.operation === "set") store.entries.set(change.key, change.value);
    else if (change.operation === "remove") store.entries.delete(change.key);
    else if (change.operation === "clear") store.entries.clear();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: change.key ?? null,
        oldValue,
        newValue: change.value ?? null,
        url: window.location.href,
      }),
    );
  });
};
