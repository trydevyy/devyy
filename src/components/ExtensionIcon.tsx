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

import { useEffect, useState } from "react";
import { Blocks } from "lucide-react";
import { invoke, native } from "../lib/native";
const cache = new Map<string, Promise<string>>();
export default function ExtensionIcon({
  id,
  path,
  fallback,
  size = 20,
  monochrome = false,
}: {
  id: string;
  path?: string;
  fallback?: string;
  size?: number;
  monochrome?: boolean;
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
  if (!src || failed) {
    return <Blocks size={size} strokeWidth={1.65} aria-hidden="true" />;
  }
  const icon = (
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
  );
  return monochrome ? (
    <span
      aria-hidden="true"
      className="extension-activity-mask"
      style={{ maskImage: `url(${JSON.stringify(src)})` }}
    >
      {icon}
    </span>
  ) : (
    icon
  );
}
