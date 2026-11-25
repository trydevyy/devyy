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

use crate::{extensions::InstalledExtension, language_config::ServerConfig};
use serde_json::Value;
use std::path::{Path, PathBuf};
fn resource(base: &Path, relative: &str) -> Option<PathBuf> {
    if Path::new(relative).is_absolute() || relative.contains(['\\', '\0', ':']) {
        return None;
    }
    let root = base.canonicalize().ok()?;
    let path = root.join(relative).canonicalize().ok()?;
    (path.is_file() && path.starts_with(root)).then_some(path)
}
fn config(
    ext: &InstalledExtension,
    language: &str,
    command: String,
    args: Vec<String>,
) -> ServerConfig {
    ServerConfig {
        env: Default::default(),
        cwd: None,
        client_id: None,
        client_capabilities: Value::Null,
        language: language.into(),
        command,
        args,
        initialization_options: Value::Null,
        settings: Value::Null,
        enabled: true,
        custom: false,
        source: Some(ext.id.clone()),
        store_id: None,
    }
}
pub fn discover(extensions: &[InstalledExtension]) -> Vec<ServerConfig> {
    let mut result = Vec::new();
    for ext in extensions.iter().filter(|e| e.enabled) {
        let base = Path::new(&ext.install_path);
        if let Some(entries) = ext.contributes["devyy.languageServers"].as_array() {
            for entry in entries {
                let Some(language) = entry["language"].as_str() else {
                    continue;
                };
                let args: Vec<String> = entry["args"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|a| a.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let candidate = if let Some(module) =
                    entry["module"].as_str().and_then(|p| resource(base, p))
                {
                    let mut launch = vec![module.to_string_lossy().into_owned()];
                    launch.extend(args);
                    Some(config(ext, language, "node".into(), launch))
                } else {
                    entry["command"]
                        .as_str()
                        .and_then(|p| resource(base, p))
                        .map(|p| config(ext, language, p.to_string_lossy().into_owned(), args))
                };
                if let Some(mut server) = candidate {
                    server.initialization_options = entry["initializationOptions"].clone();
                    server.settings = entry["settings"].clone();
                    if crate::language_config::validate(&server).is_ok() {
                        result.push(server);
                    }
                }
            }
        }
        let (languages, paths, args): (&[&str], &[&str], &[&str]) =
            match ext.id.to_ascii_lowercase().as_str() {
                "rust-lang.rust-analyzer" => (
                    &["rust"],
                    &["server/rust-analyzer", "server/rust-analyzer.exe"],
                    &[],
                ),
                "llvm-vs-code-extensions.vscode-clangd" => (
                    &["c", "cpp", "c++"],
                    &["install/bin/clangd", "install/bin/clangd.exe"],
                    &[],
                ),
                "ms-pyright.pyright" | "detachhead.basedpyright" => (
                    &["python"],
                    &["dist/server.js", "dist/pyright-langserver.js"],
                    &["--stdio"],
                ),
                "redhat.vscode-yaml" => (
                    &["yaml"],
                    &[
                        "dist/languageserver.js",
                        "out/server/src/server.js",
                        "node_modules/yaml-language-server/out/server/src/server.js",
                    ],
                    &["--stdio"],
                ),
                "svelte.svelte-vscode" => (
                    &["svelte"],
                    &["node_modules/svelte-language-server/bin/server.js"],
                    &["--stdio"],
                ),
                "vue.volar" => (
                    &["vue"],
                    &[
                        "server.js",
                        "node_modules/@vue/language-server/bin/vue-language-server.js",
                    ],
                    &["--stdio"],
                ),
                "vscode.html-language-features" => (
                    &["html"],
                    &["server/dist/node/htmlServerMain.js"],
                    &["--stdio"],
                ),
                "vscode.css-language-features" => (
                    &["css", "scss", "less"],
                    &["server/dist/node/cssServerMain.js"],
                    &["--stdio"],
                ),
                "vscode.json-language-features" => (
                    &["json", "jsonc"],
                    &["server/dist/node/jsonServerMain.js"],
                    &["--stdio"],
                ),
                _ => continue,
            };
        if let Some(file) = paths.iter().find_map(|p| resource(base, p)) {
            let javascript = file
                .extension()
                .is_some_and(|e| e == "js" || e == "cjs" || e == "mjs");
            let command = if javascript {
                "node".into()
            } else {
                file.to_string_lossy().into_owned()
            };
            let mut launch = if javascript {
                vec![file.to_string_lossy().into_owned()]
            } else {
                vec![]
            };
            launch.extend(args.iter().map(|s| s.to_string()));
            for language in languages {
                result.push(config(ext, language, command.clone(), launch.clone()));
            }
        }
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn bundled_servers_register_without_overwriting_custom_configuration_and_ignore_disabled_extensions(
    ) {
        let base = std::env::temp_dir().join(format!("devyy-discovery-{}", std::process::id()));
        std::fs::create_dir_all(base.join("dist")).unwrap();
        std::fs::write(base.join("dist/server.js"), "").unwrap();
        let mut ext = InstalledExtension {
            id: "ms-pyright.pyright".into(),
            name: "Pyright".into(),
            publisher: "ms-pyright".into(),
            version: "1.0.0".into(),
            description: String::new(),
            install_path: base.to_string_lossy().into_owned(),
            enabled: true,
            has_runtime: true,
            icon: None,
            contributes: json!({}),
            extension_dependencies: Vec::new(),
            extension_pack: Vec::new(),
        };
        let servers = discover(&[ext.clone()]);
        assert_eq!(servers[0].language, "python");
        assert_eq!(servers[0].command, "node");
        assert!(servers[0].args[0].ends_with("server.js"));
        ext.enabled = false;
        assert!(discover(&[ext.clone()]).is_empty());
        ext.enabled = true;
        ext.id = "test.custom".into();
        ext.contributes = json!({"devyy.languageServers":[{"language":"test","module":"dist/server.js","args":["--stdio"]},{"language":"bad","module":"../../escape.js"}]});
        let servers = discover(&[ext]);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].language, "test");
        std::fs::remove_dir_all(base).unwrap();
    }
}
