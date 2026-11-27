use crate::{account, language_config, process};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const THEME_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct Store {
    changes: tokio::sync::Mutex<()>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

pub(crate) fn catalog_origin() -> &'static str {
    #[cfg(debug_assertions)]
    if std::env::var("DEVYY_LOCAL_STORE").as_deref() == Ok("1") {
        return "http://127.0.0.1:8787";
    }
    account::ACCOUNT_ORIGIN
}

async fn get(path: &str) -> Result<Value, String> {
    let mut response = account::client()?
        .get(format!("{}/api/store/{path}", catalog_origin()))
        .send()
        .await
        .map_err(|error| account::connection_error(&error, "Devyy Store"))?;
    if !response.status().is_success() {
        return Err(format!("Devyy Store returned {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > THEME_LIMIT + 4096 {
            return Err("The store download is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Devyy Store returned invalid data".into())
}

#[tauri::command]
pub async fn store_catalog(kind: String, query: String, offset: u32) -> Result<Value, String> {
    match kind.as_str() {
        "language-servers" => get("language-servers").await,
        "themes" => {
            let query: String = query.chars().take(80).collect();
            let params = reqwest::Url::parse_with_params(
                "https://example.invalid",
                [("query", query), ("offset", offset.min(10000).to_string())],
            )
            .map_err(|e| e.to_string())?;
            get(&format!("themes?{}", params.query().unwrap_or_default())).await
        }
        _ => Err("Unknown catalog".into()),
    }
}

#[derive(Deserialize)]
struct Recipe {
    id: String,
    name: String,
    installer: String,
    package: Option<String>,
    version: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
    commands: BTreeMap<String, Launch>,
}

#[derive(Deserialize)]
struct Launch {
    binary: String,
    args: Vec<String>,
}

fn package_name(package: &str, slash: bool) -> bool {
    !package.is_empty()
        && package.len() <= 160
        && package.as_bytes()[0].is_ascii_alphanumeric()
        && package.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || b".-_".contains(&byte) || (slash && byte == b'/')
        })
        && package
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn npm_name(name: &str) -> bool {
    if let Some(scoped) = name.strip_prefix('@') {
        return scoped.split_once('/').is_some_and(|(owner, package)| {
            package_name(owner, false) && package_name(package, false)
        });
    }
    package_name(name, false)
}

async fn run(command: Command, name: &str) -> Result<(), String> {
    let mut command = tokio::process::Command::from(command);
    let result = tokio::time::timeout(
        Duration::from_secs(240),
        command
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .output(),
    )
    .await
    .map_err(|_| format!("{name} took too long"))?
    .map_err(|e| format!("Could not start {name}: {e}"))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "{name} failed: {}",
            stderr.trim().chars().take(500).collect::<String>()
        ));
    }
    Ok(())
}

fn tool(names: &[&str], message: &str) -> Result<PathBuf, String> {
    names
        .iter()
        .find_map(|name| process::executable(name))
        .ok_or_else(|| message.into())
}

fn npm_entry(root: &Path, package: &str, executable: &str) -> Result<PathBuf, String> {
    let package = root.join("node_modules").join(package);
    let metadata: Value =
        serde_json::from_slice(&fs::read(package.join("package.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let binary = metadata["bin"]
        .as_str()
        .or_else(|| metadata["bin"][executable].as_str())
        .ok_or_else(|| format!("The package did not provide {executable}"))?;
    let package = package.canonicalize().map_err(|e| e.to_string())?;
    let binary = package
        .join(binary)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !binary.starts_with(&package) || !binary.is_file() {
        return Err("The server entry point is outside its package".into());
    }
    Ok(binary)
}

async fn install_recipe(app: &AppHandle, recipe: Recipe, replacing: bool) -> Result<(), String> {
    if recipe.commands.is_empty()
        || recipe.commands.len() > 20
        || recipe
            .commands
            .values()
            .any(|command| !package_name(&command.binary, false))
    {
        return Err("Invalid language server recipe".into());
    }
    if !replacing
        && language_config::configs(app)?
            .iter()
            .any(|config| config.custom && recipe.commands.contains_key(&config.language))
    {
        return Err("A custom server is already configured for one of these languages. Confirm replacing it first.".into());
    }
    let package = recipe.package.as_deref().unwrap_or_default();
    let version = recipe.version.as_deref().unwrap_or_default();
    let version_number = version.strip_prefix('v').unwrap_or(version);
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("language-servers");
    let managed = matches!(recipe.installer.as_str(), "npm" | "pip" | "go");
    let staged = if managed {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Some(
            tempfile::Builder::new()
                .prefix(&format!("{}-", recipe.id))
                .tempdir_in(&root)
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let directory = staged.as_ref().map(|path| path.path()).unwrap_or(&root);
    let mut node = None;
    match recipe.installer.as_str() {
        "npm" if npm_name(package) && semver::Version::parse(version_number).is_ok() => {
            let npm = tool(&["npm"], "Install Node.js and npm, then restart Devyy")?;
            node = Some(tool(&["node"], "Install Node.js, then restart Devyy")?);
            let mut args = vec![format!("{package}@{version}")];
            for dependency in &recipe.dependencies {
                let (name, version) = dependency
                    .rsplit_once('@')
                    .ok_or("Invalid package dependency")?;
                if !npm_name(name) || semver::Version::parse(version).is_err() {
                    return Err("Invalid package dependency".into());
                }
                args.push(dependency.clone());
            }
            fs::write(directory.join("package.json"), r#"{"private":true}"#)
                .map_err(|e| e.to_string())?;
            let mut command = process::command(npm.to_str().ok_or("Invalid npm path")?);
            process::with_tool_path(&mut command);
            command
                .current_dir(directory)
                .args([
                    "install",
                    "--ignore-scripts",
                    "--no-audit",
                    "--no-fund",
                    "--loglevel=error",
                    "--registry=https://registry.npmjs.org",
                    "--",
                ])
                .args(args);
            run(command, "npm").await?;
        }
        "pip"
            if package_name(package, false)
                && !version.is_empty()
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".+!-".contains(&byte)) =>
        {
            let python = tool(
                &["python3", "python"],
                "Install Python 3 with venv and pip, then restart Devyy",
            )?;
            let mut command = process::command(python.to_str().ok_or("Invalid Python path")?);
            command.current_dir(directory).args(["-m", "venv", "."]);
            run(command, "Python venv").await?;
            let binary = directory.join(if cfg!(windows) {
                "Scripts/python.exe"
            } else {
                "bin/python"
            });
            let mut command = process::command(binary.to_str().ok_or("Invalid environment path")?);
            command.current_dir(directory).args([
                "-m",
                "pip",
                "--isolated",
                "install",
                "--only-binary=:all:",
                "--index-url",
                "https://pypi.org/simple",
                "--",
                &format!("{package}=={version}"),
            ]);
            run(command, "pip").await?;
        }
        "go" if package == "golang.org/x/tools/gopls"
            && semver::Version::parse(version_number).is_ok() =>
        {
            let go = tool(&["go"], "Install Go, then restart Devyy")?;
            let mut command = process::command(go.to_str().ok_or("Invalid Go path")?);
            command
                .current_dir(directory)
                .env("GOBIN", directory)
                .env("GOWORK", "off")
                .args(["install", &format!("{package}@v{version_number}")]);
            run(command, "Go").await?;
        }
        "rustup" if package == "rust-analyzer" => {
            let rustup = tool(&["rustup"], "Install Rust with rustup, then restart Devyy")?;
            let mut command = process::command(rustup.to_str().ok_or("Invalid rustup path")?);
            command
                .current_dir(
                    app.path()
                        .app_local_data_dir()
                        .map_err(|e| e.to_string())?
                        .parent()
                        .ok_or("Invalid local data path")?,
                )
                .args(["component", "add", "rust-analyzer"]);
            run(command, "rustup").await?;
        }
        "path" => {}
        _ => return Err("The store did not provide a supported installation recipe".into()),
    }
    let sdk = directory.join("node_modules/typescript/lib");
    let initialization = match package {
        "@vue/language-server" => {
            json!({"typescript": {"tsdk": sdk}, "vue": {"hybridMode": false}})
        }
        "@astrojs/language-server" => json!({"typescript": {"tsdk": sdk}}),
        _ => Value::Null,
    };
    let mut configurations = Vec::new();
    for (language, launch) in recipe.commands {
        let mut args = launch.args;
        let command = if let Some(node) = &node {
            let binary = npm_entry(directory, package, &launch.binary)?;
            args.insert(0, binary.to_string_lossy().into_owned());
            node.clone()
        } else if recipe.installer == "pip" || recipe.installer == "go" {
            let mut path = if recipe.installer == "go" {
                directory.join(&launch.binary)
            } else {
                directory
                    .join(if cfg!(windows) { "Scripts" } else { "bin" })
                    .join(&launch.binary)
            };
            if cfg!(windows) {
                path.set_extension("exe");
            }
            if !path.is_file() {
                return Err(format!("The package did not provide {}", launch.binary));
            }
            path
        } else {
            process::executable(&launch.binary).ok_or_else(|| format!(
                "Install {} and put {} on your PATH, or enter an executable in Settings → Language servers.",
                recipe.name, launch.binary
            ))?
        };
        let configuration: language_config::ServerConfig = serde_json::from_value(json!({
            "language": language, "command": command, "args": args, "initializationOptions": initialization,
            "enabled": true, "custom": true, "source": format!("Store: {}", recipe.name), "storeId": recipe.id
        })).map_err(|error| error.to_string())?;
        language_config::validate(&configuration)?;
        configurations.push(configuration);
    }
    language_config::write_custom(app, configurations, None, replacing)?;
    if let Some(staged) = staged {
        let _ = staged.keep();
    }
    Ok(())
}

#[tauri::command]
pub async fn store_install_language(
    app: AppHandle,
    id: String,
    replace: bool,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid language server ID".into());
    }
    let store = app.state::<Store>();
    let _change = store.changes.lock().await;
    let recipe: Recipe = serde_json::from_value(get(&format!("language-servers/{id}")).await?)
        .map_err(|_| "Invalid language server recipe")?;
    if recipe.id != id {
        return Err("The store returned a different language server".into());
    }
    install_recipe(&app, recipe, replace).await
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    version: u8,
    base: String,
    colors: BTreeMap<String, String>,
    layout: Value,
    sprites: Vec<Sprite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    editor_background: Option<EditorBackground>,
    #[serde(default, alias = "icon", skip_serializing_if = "Option::is_none")]
    app_icon: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct EditorBackground {
    image: String,
    opacity: f64,
    fit: String,
    x: f64,
    y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pixelated: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct Sprite {
    id: String,
    image: String,
    x: f64,
    y: f64,
    width: f64,
    rotation: f64,
    opacity: f64,
    layer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    anchor: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ThemeEntry {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    copyright: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    creator: Option<ThemeCreator>,
    manifest: Theme,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeCreator {
    name: String,
    #[serde(default)]
    official: bool,
    #[serde(default)]
    verified: bool,
    avatar_id: Option<String>,
}

pub fn icon_bytes(source: &str) -> Result<Vec<u8>, String> {
    source
        .strip_prefix("data:image/png;base64,")
        .filter(|value| value.len() <= 768 * 1024)
        .and_then(|value| STANDARD.decode(value).ok())
        .filter(|bytes| dimensions(bytes, b"\x89PNG\r\n\x1a\n", 512))
        .ok_or_else(|| "Invalid app icon".into())
}

#[tauri::command]
pub fn set_theme_icon(window: tauri::WebviewWindow, icon: String) -> Result<(), String> {
    crate::appearance::apply_icon(&window, &icon_bytes(&icon)?)
}

fn dimensions(bytes: &[u8], header: &[u8], max: u32) -> bool {
    bytes.starts_with(header)
        && bytes.get(16..24).is_some_and(|size| {
            size.chunks_exact(4)
                .all(|part| (1..=max).contains(&u32::from_be_bytes(part.try_into().unwrap())))
        })
}

fn valid_sprite(image: &str) -> bool {
    let Some((kind, source)) = image.split_once(";base64,") else {
        return false;
    };
    if source.len() > 768 * 1024 {
        return false;
    }
    let Ok(bytes) = STANDARD.decode(source) else {
        return false;
    };
    match kind {
        "data:image/png" => dimensions(&bytes, b"\x89PNG\r\n\x1a\n", 2048),
        "data:image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "data:image/gif" => bytes.starts_with(b"GIF89a") || bytes.starts_with(b"GIF87a"),
        "data:image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn valid_editor_background(source: &str) -> bool {
    let Some((kind, encoded)) = source.split_once(";base64,") else {
        return false;
    };
    let format = match kind {
        "data:image/png" => image::ImageFormat::Png,
        "data:image/jpeg" => image::ImageFormat::Jpeg,
        _ => return false,
    };
    if source.len() > 768 * 1024 {
        return false;
    }
    let Ok(bytes) = STANDARD.decode(encoded) else {
        return false;
    };
    image::ImageReader::with_format(std::io::Cursor::new(bytes), format)
        .into_dimensions()
        .is_ok_and(|(width, height)| (1..=2048).contains(&width) && (1..=2048).contains(&height))
}

const COLORS: &[&str] = &[
    "shell",
    "paper",
    "surface",
    "raised",
    "ink",
    "secondary",
    "muted",
    "faint",
    "line",
    "border-strong",
    "hover",
    "accent",
    "accent-soft",
    "accent-line",
    "green",
    "active-line",
    "selection",
    "primary",
    "primary-ink",
    "terminal",
    "terminal-foreground",
    "terminal-cursor",
    "terminal-selection",
    "terminal-black",
    "terminal-red",
    "terminal-green",
    "terminal-yellow",
    "terminal-blue",
    "terminal-magenta",
    "terminal-cyan",
    "terminal-white",
    "terminal-bright-black",
    "terminal-bright-red",
    "terminal-bright-green",
    "terminal-bright-yellow",
    "terminal-bright-blue",
    "terminal-bright-magenta",
    "terminal-bright-cyan",
    "terminal-bright-white",
    "editor-foreground",
    "syntax-keyword",
    "syntax-function",
    "syntax-comment",
    "syntax-string",
    "syntax-number",
    "syntax-type",
    "syntax-punctuation",
    "syntax-meta",
];

fn validate_theme(entry: &ThemeEntry) -> Result<(), String> {
    let theme = &entry.manifest;
    if !valid_id(&entry.id)
        || entry.name.trim().is_empty()
        || entry.name.chars().count() > 70
        || entry.description.chars().count() > 400
        || entry.copyright.as_ref().is_some_and(|text| {
            text.chars().count() > 140
                || text
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
        })
        || theme.version != 1
        || !matches!(theme.base.as_str(), "midnight" | "paper" | "monochrome")
        || theme.sprites.len() > 12
    {
        return Err("Invalid Devyy theme".into());
    }
    for (key, value) in &theme.colors {
        if !COLORS.contains(&key.as_str())
            || !matches!(value.len(), 7 | 9)
            || !value.starts_with('#')
            || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return Err("Invalid theme color".into());
        }
    }
    let layout = theme.layout.as_object().ok_or("Invalid theme layout")?;
    let range = |value: &Value, min: f64, max: f64| {
        value.as_f64().is_some_and(|n| (min..=max).contains(&n))
    };
    for (key, value) in layout {
        let valid = match key.as_str() {
            "fontSize" => range(value, 10., 28.),
            "lineHeight" => range(value, 1., 2.5),
            "radius" => range(value, 0., 24.),
            "fontFamily" => matches!(value.as_str(), Some("system" | "menlo" | "monospace")),
            _ => false,
        };
        if !valid {
            return Err("Invalid theme layout setting".into());
        }
    }
    let mut ids = std::collections::HashSet::new();
    for sprite in &theme.sprites {
        if sprite.id.is_empty()
            || sprite.id.len() > 64
            || !ids.insert(&sprite.id)
            || !valid_sprite(&sprite.image)
            || !(0. ..=100.).contains(&sprite.x)
            || !(0. ..=100.).contains(&sprite.y)
            || !(1. ..=100.).contains(&sprite.width)
            || !(-360. ..=360.).contains(&sprite.rotation)
            || !(0. ..=1.).contains(&sprite.opacity)
            || !matches!(sprite.layer.as_str(), "behind" | "above")
            || sprite
                .anchor
                .as_deref()
                .is_some_and(|anchor| anchor != "titlebar")
        {
            return Err("Invalid theme sprite".into());
        }
    }
    if theme.editor_background.as_ref().is_some_and(|background| {
        !valid_editor_background(&background.image)
            || !(0. ..=1.).contains(&background.opacity)
            || !matches!(background.fit.as_str(), "cover" | "contain")
            || !(0. ..=100.).contains(&background.x)
            || !(0. ..=100.).contains(&background.y)
    }) {
        return Err("Invalid editor background".into());
    }
    if let Some(icon) = &theme.app_icon {
        icon_bytes(icon)?;
    }
    Ok(())
}

fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("store-themes"))
}

fn save_theme(app: &AppHandle, theme: &ThemeEntry) -> Result<(), String> {
    use std::io::Write;
    validate_theme(theme)?;
    let dir = themes_dir(app)?;
    let bytes = serde_json::to_vec(theme).map_err(|e| e.to_string())?;
    if bytes.len() > THEME_LIMIT + 4096 {
        return Err("The theme is too large".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.persist(dir.join(format!("{}.json", theme.id)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn store_theme_details(id: String) -> Result<ThemeEntry, String> {
    if !valid_id(&id) {
        return Err("Invalid theme ID".into());
    }
    let theme: ThemeEntry = serde_json::from_value(get(&format!("themes/{id}")).await?)
        .map_err(|_| "Invalid theme download")?;
    if theme.id != id {
        return Err("The store returned a different theme".into());
    }
    validate_theme(&theme)?;
    Ok(theme)
}

#[tauri::command]
pub async fn store_install_theme(app: AppHandle, id: String) -> Result<ThemeEntry, String> {
    let theme = store_theme_details(id).await?;
    save_theme(&app, &theme)?;
    Ok(theme)
}

#[tauri::command]
pub async fn store_restore_themes(app: AppHandle, entries: Vec<ThemeEntry>) -> Result<(), String> {
    if entries.len() > 24
        || serde_json::to_vec(&entries)
            .map_err(|e| e.to_string())?
            .len()
            > 8 * 1024 * 1024
    {
        return Err("The synchronized theme library is too large".into());
    }
    for entry in &entries {
        validate_theme(entry)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        for entry in entries {
            save_theme(&app, &entry)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn store_import_theme(app: AppHandle, path: PathBuf) -> Result<ThemeEntry, String> {
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > THEME_LIMIT as u64 {
        return Err("The theme exceeds 2 MB".into());
    }
    let mut document: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid theme JSON")?;
    if document.get("manifest").is_none() {
        document = json!({ "manifest": document });
    }
    document["id"] = json!(format!("local-{}", uuid::Uuid::new_v4()));
    document["author"] = json!("Local import");
    document
        .as_object_mut()
        .ok_or("Invalid theme file")?
        .remove("creator");
    if document["name"]
        .as_str()
        .is_none_or(|name| name.trim().is_empty())
    {
        document["name"] = json!("Imported theme");
    }
    let theme: ThemeEntry = serde_json::from_value(document).map_err(|_| "Invalid theme file")?;
    save_theme(&app, &theme)?;
    Ok(theme)
}

#[tauri::command]
pub fn store_local_theme(app: AppHandle, id: String) -> Result<ThemeEntry, String> {
    if !valid_id(&id) {
        return Err("Invalid theme ID".into());
    }
    let mut file =
        fs::File::open(themes_dir(&app)?.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::take(&mut file, (THEME_LIMIT + 4097) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > THEME_LIMIT + 4096 {
        return Err("The theme is too large".into());
    }
    let theme = serde_json::from_slice(&bytes).map_err(|_| "Invalid installed theme")?;
    validate_theme(&theme)?;
    Ok(theme)
}

#[tauri::command]
pub fn store_installed_themes(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = themes_dir(&app)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut themes: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|file| {
            let path = file.ok()?.path();
            let id = path.file_stem()?.to_str()?;
            (path.extension().is_some_and(|ext| ext == "json") && valid_id(id))
                .then(|| id.to_owned())
        })
        .collect();
    themes.sort();
    Ok(themes)
}

#[tauri::command]
pub fn store_remove_theme(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid theme ID".into());
    }
    fs::remove_file(themes_dir(&app)?.join(format!("{id}.json"))).map_err(|e| e.to_string())
}
