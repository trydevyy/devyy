type Entry<T> = { value: T; savedAt: number };

export function createReadCache<T>({
  ttl,
  limit = 24,
  storageKey,
  shouldPersist = () => true,
  maxAge = ttl * 4,
}: {
  ttl: number;
  limit?: number;
  storageKey?: string;
  shouldPersist?: (key: string) => boolean;
  maxAge?: number;
}) {
  const entries = new Map<string, Entry<T>>();
  const pending = new Map<string, Promise<T>>();
  let hydrated = false;

  function hydrate() {
    if (hydrated || !storageKey) return;
    hydrated = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw.length > 240_000) return;
      const saved: [string, Entry<T>][] = JSON.parse(raw);
      for (const [key, entry] of saved.slice(-limit)) {
        if (
          typeof key === "string" &&
          shouldPersist(key) &&
          entry &&
          typeof entry.savedAt === "number" &&
          Date.now() - entry.savedAt < maxAge &&
          entry.savedAt <= Date.now()
        )
          entries.set(key, entry);
      }
    } catch {
      // Storage is optional. The session cache still works.
    }
  }

  function persist() {
    if (!storageKey) return;
    try {
      const saved = [...entries].filter(([key]) => shouldPersist(key));
      let json = JSON.stringify(saved);
      while (json.length > 240_000 && saved.length) {
        saved.shift();
        json = JSON.stringify(saved);
      }
      localStorage.setItem(storageKey, json);
    } catch {
      // A quota or storage restriction must never fail a read.
    }
  }

  function peek(key: string) {
    hydrate();
    const entry = entries.get(key);
    if (!entry || Date.now() - entry.savedAt >= maxAge) return undefined;
    return entry.value;
  }

  function read(key: string, load: () => Promise<T>, force = false) {
    const cached = peek(key);
    if (
      !force &&
      cached !== undefined &&
      Date.now() - entries.get(key)!.savedAt < ttl
    )
      return Promise.resolve(cached);
    const current = pending.get(key);
    if (current && !force) return current;

    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        if (pending.get(key) === request && value !== undefined) {
          entries.delete(key);
          entries.set(key, { value, savedAt: Date.now() });
          while (entries.size > limit)
            entries.delete(entries.keys().next().value!);
          persist();
        }
        return value;
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  }

  function invalidate(key: string) {
    hydrate();
    pending.delete(key);
    entries.delete(key);
    persist();
  }

  return { peek, read, invalidate };
}

export type ReadCache<T> = ReturnType<typeof createReadCache<T>>;
