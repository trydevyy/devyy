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

import { invoke, native, clearLanguageServers } from "./native";
export interface ServerConfig {
  language: string;
  command: string;
  args: string[];
  initializationOptions: unknown;
  settings: unknown;
  enabled: boolean;
  custom: boolean;
  source?: string;
  storeId?: string;
}
export let serverLanguages = new Set([
  "rust",
  "typescript",
  "javascript",
  "python",
  "go",
  "c",
  "c++",
  "cpp",
  "typescriptreact",
  "javascriptreact",
  "css",
  "html",
  "json",
  "yaml",
  "svelte",
  "vue",
  "shell",
  "lua",
  "toml",
]);
export async function refreshLanguageServers() {
  const servers = native
    ? await invoke<ServerConfig[]>("list_language_servers")
    : [];
  if (servers)
    serverLanguages = new Set(
      servers.filter((s) => s.enabled).map((s) => s.language),
    );
  return servers ?? [];
}
export async function saveServer(
  language: string,
  config: ServerConfig | null,
) {
  await invoke("save_language_server", { language, config });
  await invoke("lsp_stop");
  clearLanguageServers();
  await refreshLanguageServers();
  window.dispatchEvent(new Event("devyy-language-servers-changed"));
}
