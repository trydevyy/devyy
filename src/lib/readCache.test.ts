import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadCache } from "./readCache";

describe("read cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates in-flight reads, expires fresh results and retains stale data on failure", async () => {
    vi.useFakeTimers();
    const cache = createReadCache<number>({ ttl: 100, maxAge: 500 });
    const load = vi.fn(async () => 1);
    expect(cache.read("a", load)).toBe(cache.read("a", load));
    expect(await cache.read("a", load)).toBe(1);
    expect(await cache.read("a", load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(cache.peek("a")).toBe(1);
    await expect(
      cache.read("a", async () => {
        throw Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(cache.peek("a")).toBe(1);
    vi.advanceTimersByTime(350);
    expect(cache.peek("a")).toBeUndefined();
  });

  it("ignores responses superseded by invalidation or a forced refresh", async () => {
    const cache = createReadCache<number>({ ttl: 1000 });
    let complete!: (value: number) => void;
    const old = cache.read(
      "a",
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await Promise.resolve();
    cache.invalidate("a");
    await cache.read("a", async () => 2);
    await cache.read("a", async () => 3, true);
    complete(1);
    await old;
    expect(cache.peek("a")).toBe(3);
  });

  it("restores bounded public listings across instances and keeps searches in memory", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const options = {
      ttl: 1000,
      limit: 2,
      storageKey: "catalog",
      shouldPersist: (key: string) => key.startsWith("page"),
    };
    const cache = createReadCache<number>(options);
    await cache.read("page-1", async () => 1);
    await cache.read("page-2", async () => 2);
    await cache.read("private search", async () => 3);
    const reopened = createReadCache<number>(options);
    expect(reopened.peek("page-1")).toBeUndefined();
    expect(reopened.peek("page-2")).toBe(2);
    expect(reopened.peek("private search")).toBeUndefined();
  });
});
