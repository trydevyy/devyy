import { useEffect, useRef, useState } from "react";
import type { ReadCache } from "./readCache";

export function useCachedRead<T>(
  cache: ReadCache<T>,
  key: string,
  load: () => Promise<T>,
  { enabled = true, delay = 0 }: { enabled?: boolean; delay?: number } = {},
) {
  const loader = useRef(load);
  loader.current = load;
  const [retry, setRetry] = useState(0);
  const previousRetry = useRef(retry);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({ key });
  const cached = enabled ? cache.peek(key) : undefined;
  const current = result.key === key ? result : undefined;
  const data = current?.data ?? cached;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const force = retry !== previousRetry.current;
    setResult({ key });
    const factory = loader.current;
    const timer = setTimeout(
      () => {
        previousRetry.current = retry;
        void cache
          .read(key, factory, force)
          .then((data) => {
            if (active) setResult({ key, data });
          })
          .catch((error) => {
            if (active) setResult({ key, error: String(error) });
          });
      },
      force || cache.peek(key) !== undefined ? 0 : delay,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cache, delay, enabled, key, retry]);

  return {
    data,
    loading: enabled && data === undefined && !current?.error,
    error: current?.error ?? "",
    retry: () => setRetry((n) => n + 1),
  };
}
