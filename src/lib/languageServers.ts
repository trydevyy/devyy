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
