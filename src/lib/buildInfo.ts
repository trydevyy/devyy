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

import { invoke, native } from "./native";
import { version } from "../../package.json";
declare const __DEVYY_BUILD__: { builtAt: string; revision: string };
export interface BuildInfo {
  version: string;
  builtAt: string;
  revision: string;
  os: string;
  osBuild: string;
  arch: string;
}
export interface UpdateStatus {
  status: "available" | "current" | "unpublished";
  version: string | null;
  url: string | null;
}
export interface UpdateProgress {
  stage: "checking" | "downloading" | "verifying" | "installing" | "restarting";
  downloaded: number;
  total: number | null;
}
const browserInfo: BuildInfo = {
  version,
  builtAt: __DEVYY_BUILD__.builtAt,
  revision: __DEVYY_BUILD__.revision,
  os: "Browser playground",
  osBuild: "Available in the desktop app",
  arch: "—",
};
let info: Promise<BuildInfo> | undefined;
export function getBuildInfo() {
  return (info ??= (
    native ? invoke<BuildInfo>("build_info") : Promise.resolve(browserInfo)
  ).catch((error) => {
    info = undefined;
    throw error;
  }));
}
let lastCheck: { time: number; value: UpdateStatus } | undefined;
let checking: Promise<UpdateStatus> | undefined;
export function checkUpdates(force = false) {
  if (!force && lastCheck && Date.now() - lastCheck.time < 15 * 60 * 1000)
    return Promise.resolve(lastCheck.value);
  return (checking ??= invoke<UpdateStatus>("check_updates")
    .then((value) => {
      lastCheck = { time: Date.now(), value };
      return value;
    })
    .finally(() => {
      checking = undefined;
    }));
}
