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

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub language: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_capabilities: Value,
    #[serde(default)]
    pub initialization_options: Value,
    #[serde(default)]
    pub settings: Value,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_id: Option<String>,
}
fn enabled() -> bool {
    true
}
pub fn defaults() -> Vec<ServerConfig> {
    [
        ("rust", "rust-analyzer", vec![]),
        ("typescript", "typescript-language-server", vec!["--stdio"]),
        ("javascript", "typescript-language-server", vec!["--stdio"]),
        ("python", "pylsp", vec![]),
        ("go", "gopls", vec![]),
        ("c", "clangd", vec![]),
        ("c++", "clangd", vec![]),
        ("cpp", "clangd", vec![]),
        (
            "typescriptreact",
            "typescript-language-server",
            vec!["--stdio"],
        ),
        (
            "javascriptreact",
            "typescript-language-server",
            vec!["--stdio"],
        ),
        ("css", "vscode-css-language-server", vec!["--stdio"]),
        ("html", "vscode-html-language-server", vec!["--stdio"]),
        ("json", "vscode-json-language-server", vec!["--stdio"]),
        ("yaml", "yaml-language-server", vec!["--stdio"]),
        ("svelte", "svelteserver", vec!["--stdio"]),
        ("vue", "vue-language-server", vec!["--stdio"]),
        ("shell", "bash-language-server", vec!["start"]),
        ("lua", "lua-language-server", vec![]),
        ("toml", "taplo", vec!["lsp", "stdio"]),
    ]
    .into_iter()
    .map(|(language, command, args)| ServerConfig {
        language: language.into(),
        command: command.into(),
        args: args.into_iter().map(String::from).collect(),
        env: BTreeMap::new(),
        cwd: None,
        client_id: None,
        client_capabilities: Value::Null,
        initialization_options: Value::Null,
        settings: Value::Null,
        enabled: true,
        custom: false,
        source: None,
        store_id: None,
    })
    .collect()
}
fn path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("language-servers.json"))
}
pub fn configs<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Vec<ServerConfig>, String> {
    let path = path(app)?;
    let mut map: BTreeMap<String, ServerConfig> = defaults()
        .into_iter()
        .map(|s| (s.language.clone(), s))
        .collect();
    for server in crate::extension_servers::discover(&crate::extensions::for_app(app)?) {
        map.insert(server.language.clone(), server);
    }
    if let Some(host) = app.try_state::<crate::extension_host::ExtensionHost>() {
        for server in host.servers.lock().map_err(|e| e.to_string())?.values() {
            map.insert(server.language.clone(), server.clone());
        }
    }
    if path.exists() {
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
            return Err("Language server configuration is too large".into());
        }
        let custom: Vec<ServerConfig> =
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Invalid language server configuration: {e}"))?;
        for mut server in custom {
            validate(&server)?;
            server.custom = true;
            map.insert(server.language.clone(), server);
        }
    }
    Ok(map.into_values().collect())
}
pub fn validate(s: &ServerConfig) -> Result<(), String> {
    if s.language.is_empty()
        || s.language.len() > 100
        || !s
            .language
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_+-#".contains(c))
    {
        return Err("Use a language identifier such as rust, python, or c++".into());
    }
    if s.command.trim().is_empty()
        || s.command.len() > 4096
        || s.command.contains(['\n', '\r', '\0'])
        || s.args.len() > 100
        || s.args.iter().any(|a| a.len() > 8192 || a.contains('\0'))
    {
        return Err("Invalid language server command or arguments".into());
    }
    if s.env.len() > 256
        || s.env.iter().any(|(k, v)| {
            k.is_empty() || k.contains(['=', '\0']) || v.contains('\0') || v.len() > 65536
        })
        || s.cwd
            .as_ref()
            .is_some_and(|p| p.len() > 4096 || p.contains('\0'))
    {
        return Err("Invalid language server environment or working directory".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn list_language_servers(app: AppHandle) -> Result<Vec<ServerConfig>, String> {
    tauri::async_runtime::spawn_blocking(move || configs(&app))
        .await
        .map_err(|e| e.to_string())?
}
static CONFIG_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn write_custom(
    app: &AppHandle,
    configurations: Vec<ServerConfig>,
    removed: Option<&str>,
    replace: bool,
) -> Result<(), String> {
    use std::io::Write;
    let _lock = CONFIG_WRITE.lock().map_err(|e| e.to_string())?;
    let mut custom: BTreeMap<_, _> = configs(app)?
        .into_iter()
        .filter(|s| s.custom)
        .map(|s| (s.language.clone(), s))
        .collect();
    if let Some(language) = removed {
        custom.remove(language);
    }
    for mut server in configurations {
        if !replace && custom.contains_key(&server.language) {
            return Err("Another server was configured while this one was installing".into());
        }
        validate(&server)?;
        server.custom = true;
        custom.insert(server.language.clone(), server);
    }
    let path = path(app)?;
    let parent = path.parent().ok_or("Invalid configuration path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&custom.into_values().collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_language_server(
    config: Option<ServerConfig>,
    language: String,
    app: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if config
            .as_ref()
            .is_some_and(|server| server.language != language)
        {
            return Err("Language identifier does not match".into());
        }
        write_custom(&app, config.into_iter().collect(), Some(&language), true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_configuration_overrides_runtime_and_bundled_servers() {
        let base =
            std::env::temp_dir().join(format!("devyy-server-priority-{}", std::process::id()));
        let package = base.join("extensions/test.server");
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("package.json"), r#"{"publisher":"test","name":"server","version":"1.0.0","contributes":{"devyy.languageServers":[{"language":"rust","module":"server.js"}]}}"#).unwrap();
        fs::write(package.join("server.js"), "").unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(base.clone()),
        );
        let app = tauri::test::mock_builder()
            .manage(crate::extension_host::ExtensionHost::default())
            .build(context)
            .unwrap();
        assert_eq!(
            configs(app.handle())
                .unwrap()
                .into_iter()
                .find(|s| s.language == "rust")
                .unwrap()
                .source
                .as_deref(),
            Some("test.server")
        );
        let mut server = defaults().remove(0);
        server.command = "runtime-server".into();
        server.source = Some("test.runtime".into());
        app.state::<crate::extension_host::ExtensionHost>()
            .servers
            .lock()
            .unwrap()
            .insert("rust".into(), server.clone());
        assert_eq!(
            configs(app.handle())
                .unwrap()
                .into_iter()
                .find(|s| s.language == "rust")
                .unwrap()
                .command,
            "runtime-server"
        );
        server.command = "my-server".into();
        server.enabled = false;
        fs::write(
            base.join("language-servers.json"),
            serde_json::to_vec(&vec![server]).unwrap(),
        )
        .unwrap();
        let server = configs(app.handle())
            .unwrap()
            .into_iter()
            .find(|s| s.language == "rust")
            .unwrap();
        assert_eq!(server.command, "my-server");
        assert!(!server.enabled);
        assert!(server.custom);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn server_config_validation_keeps_program_and_arguments_separate() {
        let mut server = defaults().remove(0);
        assert!(validate(&server).is_ok());
        server.command = "bad\0command".into();
        assert!(validate(&server).is_err());
        server = defaults().remove(0);
        server.language = "../escape".into();
        assert!(validate(&server).is_err());
    }
}
