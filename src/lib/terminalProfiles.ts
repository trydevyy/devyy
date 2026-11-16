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

import { useEffect, useSyncExternalStore } from "react";
import { invoke, native } from "./native";
export interface ShellProfile {
  id: string;
  name: string;
  path: string;
  args: string[];
  isDefault: boolean;
}
type Snapshot = { profiles: ShellProfile[]; loading: boolean; error: string };
let snapshot: Snapshot = { profiles: [], loading: false, error: "" },
  started = false,
  generation = 0;
const listeners = new Set<() => void>();
function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}
export async function refreshTerminalProfiles() {
  if (!native) return;
  started = true;
  const current = ++generation;
  publish({ ...snapshot, loading: true, error: "" });
  try {
    const profiles = await invoke<ShellProfile[]>("terminal_profiles");
    if (current === generation)
      publish({
        profiles: Array.isArray(profiles) ? profiles : [],
        loading: false,
        error: "",
      });
  } catch (error) {
    if (current === generation)
      publish({ ...snapshot, loading: false, error: String(error) });
  }
}
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
const getSnapshot = () => snapshot;
export function useTerminalProfiles() {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (!started && native) void refreshTerminalProfiles();
  }, []);
  return value;
}
