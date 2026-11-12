use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportData {
    pub name: String,
    pub settings: Map<String, Value>,
    pub keybindings: Vec<Value>,
    pub extensions: Vec<String>,
}
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}
fn config_root() -> Option<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(PathBuf::from);
    }
    let home = home()?;
    Some(if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or(home.join(".config"))
    })
}
fn sources_at(config: &Path) -> Vec<ImportSource> {
    let mut result = Vec::new();
    for (id, name, directory, kind, file) in [
        (
            "vscode",
            "Visual Studio Code",
            "Code",
            "vscode",
            "User/settings.json",
        ),
        (
            "vscode-insiders",
            "VS Code Insiders",
            "Code - Insiders",
            "vscode",
            "User/settings.json",
        ),
        (
            "vscodium",
            "VSCodium",
            "VSCodium",
            "vscode",
            "User/settings.json",
        ),
        ("cursor", "Cursor", "Cursor", "vscode", "User/settings.json"),
        (
            "windsurf",
            "Windsurf",
            "Windsurf",
            "vscode",
            "User/settings.json",
        ),
        ("zed", "Zed", "zed", "zed", "settings.json"),
    ] {
        let path = config.join(directory).join(file);
        if path.is_file() {
            result.push(ImportSource {
                id: id.into(),
                name: name.into(),
                path: path.to_string_lossy().into(),
                kind: kind.into(),
            });
        }
    }
    // Zed always uses ~/.config/zed, including macOS.
    if !result.iter().any(|s| s.id == "zed") {
        if let Some(path) = home()
            .map(|p| p.join(".config/zed/settings.json"))
            .filter(|p| p.is_file())
        {
            result.push(ImportSource {
                id: "zed".into(),
                name: "Zed".into(),
                path: path.to_string_lossy().into(),
                kind: "zed".into(),
            });
        }
    }
    result
}
fn read_json(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
        return Err("Settings file is too large".into());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    json5::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("Could not read settings: {e}"))
}
fn import_source(source: ImportSource) -> Result<ImportData, String> {
    let path = Path::new(&source.path);
    let raw = read_json(path)?;
    let allowed = [
        "workbench.colorTheme",
        "window.autoDetectColorScheme",
        "window.zoomLevel",
        "editor.fontSize",
        "editor.fontFamily",
        "editor.lineHeight",
        "editor.fontLigatures",
        "editor.letterSpacing",
        "editor.tabSize",
        "editor.wordWrap",
        "editor.lineNumbers",
        "editor.minimap.enabled",
        "editor.cursorStyle",
        "editor.cursorBlinking",
        "editor.renderWhitespace",
        "editor.folding",
        "editor.matchBrackets",
        "editor.autoClosingBrackets",
        "editor.autoIndent",
        "editor.scrollBeyondLastLine",
        "editor.suggestOnTriggerCharacters",
        "editor.quickSuggestionsDelay",
        "editor.renderLineHighlight",
        "files.autoSave",
        "files.autoSaveDelay",
        "terminal.integrated.fontSize",
        "terminal.integrated.scrollback",
        "terminal.integrated.cursorStyle",
        "terminal.integrated.cursorBlinking",
        "terminal.integrated.lineHeight",
        "buffer_font_size",
        "buffer_font_family",
        "tab_size",
        "soft_wrap",
        "theme",
        "autosave",
    ];
    let settings = raw
        .as_object()
        .map(|s| {
            s.iter()
                .filter(|(k, _)| allowed.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default();
    let keybindings = if source.kind == "vscode" {
        read_json(&path.with_file_name("keybindings.json"))
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    } else {
        vec![]
    };
    let mut extensions = Vec::new();
    let ext_dir = match source.id.as_str() {
        "vscode" => ".vscode",
        "vscode-insiders" => ".vscode-insiders",
        "cursor" => ".cursor",
        "windsurf" => ".windsurf",
        "vscodium" => ".vscode-oss",
        _ => "",
    };
    if !ext_dir.is_empty() {
        if let Some(home) = home() {
            if let Ok(entries) = fs::read_dir(home.join(ext_dir).join("extensions")) {
                for entry in entries.flatten().take(500) {
                    if let Ok(manifest) = read_json(&entry.path().join("package.json")) {
                        if let (Some(publisher), Some(name)) =
                            (manifest["publisher"].as_str(), manifest["name"].as_str())
                        {
                            let id = format!("{publisher}.{name}");
                            if !extensions.contains(&id) {
                                extensions.push(id);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(ImportData {
        name: source.name,
        settings,
        keybindings,
        extensions,
    })
}
#[tauri::command]
pub async fn detect_ide_settings() -> Result<Vec<ImportSource>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        config_root().map(|p| sources_at(&p)).unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn read_ide_settings(id: String) -> Result<ImportData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = config_root()
            .map(|p| sources_at(&p))
            .unwrap_or_default()
            .into_iter()
            .find(|s| s.id == id)
            .ok_or("This editor's settings are no longer available")?;
        import_source(source)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_and_import_accept_comments_and_exclude_secrets() {
        let base = std::env::temp_dir().join(format!("devyy-import-{}", std::process::id()));
        let user = base.join("Code/User");
        fs::create_dir_all(&user).unwrap();
        fs::write(
            user.join("settings.json"),
            "{ // comment\n \"editor.fontSize\": 16, \"private.token\": \"secret\", }",
        )
        .unwrap();
        fs::write(
            user.join("keybindings.json"),
            "[{\"key\":\"ctrl+s\",\"command\":\"workbench.action.files.save\"}]",
        )
        .unwrap();
        let source = sources_at(&base)
            .into_iter()
            .find(|s| s.id == "vscode")
            .unwrap();
        let imported = import_source(source).unwrap();
        assert_eq!(imported.settings["editor.fontSize"], 16);
        assert!(!imported.settings.contains_key("private.token"));
        assert_eq!(imported.keybindings.len(), 1);
        fs::remove_dir_all(base).unwrap();
    }
}
