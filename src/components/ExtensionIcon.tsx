import { useEffect, useState } from "react";
import { Blocks } from "lucide-react";
import { invoke, native } from "../lib/native";
const cache = new Map<string, Promise<string>>();
export default function ExtensionIcon({
  id,
  path,
  fallback,
  size = 20,
}: {
  id: string;
  path?: string;
  fallback?: string;
  size?: number;
}) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setFailed(false);
    setSource(undefined);
    if (path && native && !path.startsWith("$(")) {
      const key = `${id}:${path}`;
      if (!cache.has(key))
        cache.set(
          key,
          invoke<string>("extension_icon", { id, path }).catch((error) => {
            cache.delete(key);
            throw error;
          }),
        );
      void cache
        .get(key)!
        .then((url) => {
          if (!disposed) setSource(url);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
    };
  }, [id, path, fallback]);
  const src = source ?? fallback;
  return src && !failed ? (
    <img
      className="extension-activity-icon"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <Blocks size={size} strokeWidth={1.65} aria-hidden="true" />
  );
}
