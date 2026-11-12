//! Open VSX packages and declarative contributions. Runtime activation lives in
//! a separate Node process, never in the editor webview.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
const API: &str = "https://open-vsx.org/api";
const PACKAGE_LIMIT: usize = 1024 * 1024 * 1024;
const EXPANDED_LIMIT: u64 = 4 * 1024 * 1024 * 1024;
const FILE_LIMIT: u64 = 1024 * 1024 * 1024;
const ASSET_LIMIT: u64 = 4 * 1024 * 1024;
#[derive(Default)]
pub struct ExtensionStore(pub Arc<Mutex<()>>);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionInstallProgress {
    id: String,
    request_id: Option<String>,
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}
fn report_install_progress(
    app: &AppHandle,
    id: &str,
    request_id: &Option<String>,
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
) {
    let _ = app.emit(
        "extension-install-progress",
        ExtensionInstallProgress {
            id: id.to_ascii_lowercase(),
            request_id: request_id.clone(),
            phase,
            downloaded,
            total,
        },
    );
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub description: String,
    pub install_path: String,
    pub enabled: bool,
    pub has_runtime: bool,
    pub icon: Option<String>,
    pub contributes: Value,
    #[serde(default)]
    pub extension_dependencies: Vec<String>,
    #[serde(default)]
    pub extension_pack: Vec<String>,
}
pub fn directory<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn valid_part(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
fn id_parts(id: &str) -> Result<(&str, &str), String> {
    let (publisher, name) = id.split_once('.').ok_or("Invalid extension identifier")?;
    if !valid_part(publisher) || !valid_part(name) {
        return Err("Invalid extension identifier".into());
    }
    Ok((publisher, name))
}
fn read_value(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > ASSET_LIMIT {
        return Err("Extension asset is too large".into());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    json5::from_str(data.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())
}
fn manifest(base: &Path) -> Result<InstalledExtension, String> {
    let value = read_value(&base.join("package.json"))?;
    let publisher = value["publisher"]
        .as_str()
        .ok_or("Missing extension publisher")?;
    let name = value["name"].as_str().ok_or("Missing extension name")?;
    let id = format!("{publisher}.{name}");
    id_parts(&id)?;
    let version = value["version"]
        .as_str()
        .ok_or("Missing extension version")?;
    semver::Version::parse(version).map_err(|_| "Invalid extension version")?;
    let relations = |key: &str| -> Result<Vec<String>, String> {
        let Some(value) = value.get(key) else {
            return Ok(Vec::new());
        };
        let values = value
            .as_array()
            .ok_or_else(|| format!("{key} must be an array"))?;
        values
            .iter()
            .map(|entry| {
                let id = entry
                    .as_str()
                    .ok_or_else(|| format!("Invalid {key} identifier"))?;
                id_parts(id)?;
                Ok(id.to_ascii_lowercase())
            })
            .collect()
    };
    Ok(InstalledExtension {
        id,
        name: value["displayName"].as_str().unwrap_or(name).into(),
        publisher: publisher.into(),
        version: version.into(),
        description: value["description"].as_str().unwrap_or("").into(),
        install_path: crate::workspace::display_path(base),
        enabled: !base.join(".devyy-disabled").exists(),
        has_runtime: value["main"].is_string() || value["browser"].is_string(),
        icon: value["icon"]
            .as_str()
            .and_then(|icon| icon_data(base, icon).ok()),
        extension_dependencies: relations("extensionDependencies")?,
        extension_pack: relations("extensionPack")?,
        contributes: value["contributes"]
            .as_object()
            .map(|_| value["contributes"].clone())
            .unwrap_or(json!({})),
    })
}
fn icon_data(base: &Path, path: &str) -> Result<String, String> {
    use base64::Engine;
    let file = base
        .join(safe_relative(path)?)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !file.starts_with(base.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Icon is outside the extension".into());
    }
    let mime = match file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return Err("Unsupported icon format".into()),
    };
    if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("Icon exceeds 1 MB".into());
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD
            .encode(fs::read(file).map_err(|e| e.to_string())?)
    ))
}
pub fn for_app<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Vec<InstalledExtension>, String> {
    Ok(installed(&directory(app)?))
}
fn installed(base: &Path) -> Vec<InstalledExtension> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten().take(1000) {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if let Ok(extension) = manifest(&entry.path()) {
                if extension
                    .id
                    .eq_ignore_ascii_case(&entry.file_name().to_string_lossy())
                {
                    result.push(extension);
                }
            }
        }
    }
    result.sort_by_key(|e| e.name.to_lowercase());
    result
}
fn safe_relative(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains(['\\', ':', '\0'])
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err("Invalid extension asset path".into());
    }
    Ok(path.to_path_buf())
}
fn asset(base: &Path, value: &str) -> Result<String, String> {
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let path = base
        .join(safe_relative(value)?)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(&base) {
        return Err("Asset is outside the extension".into());
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > ASSET_LIMIT {
        return Err("Extension asset is too large".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}
fn unpack(
    mut reader: impl Read + Seek,
    destination: &Path,
    expected: Option<&str>,
) -> Result<InstalledExtension, String> {
    if reader
        .seek(std::io::SeekFrom::End(0))
        .map_err(|e| e.to_string())?
        > PACKAGE_LIMIT as u64
    {
        return Err("Extension package exceeds the 1 GiB archive limit".into());
    }
    reader.rewind().map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Invalid VSIX: {e}"))?;
    if archive.len() > 20000 {
        return Err("Too many files in extension package".into());
    }
    let mut total = 0u64;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().to_owned();
        let Some(relative) = name.strip_prefix("extension/") else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        let path = safe_relative(relative.trim_end_matches('/'))?;
        if file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("Symlinks are not allowed in extension packages".into());
        }
        // Deny Windows device names and case collisions on every host for portable packages.
        for part in path.components() {
            if let Component::Normal(part) = part {
                let part = part.to_string_lossy();
                let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                if part.ends_with([' ', '.'])
                    || matches!(
                        stem.as_str(),
                        "CON"
                            | "PRN"
                            | "AUX"
                            | "NUL"
                            | "COM1"
                            | "COM2"
                            | "COM3"
                            | "COM4"
                            | "COM5"
                            | "COM6"
                            | "COM7"
                            | "COM8"
                            | "COM9"
                            | "LPT1"
                            | "LPT2"
                            | "LPT3"
                            | "LPT4"
                            | "LPT5"
                            | "LPT6"
                            | "LPT7"
                            | "LPT8"
                            | "LPT9"
                    )
                {
                    return Err("Extension contains a non-portable filename".into());
                }
            }
        }
        if !names.insert(relative.trim_end_matches('/').to_ascii_lowercase()) {
            return Err("Extension contains duplicate paths".into());
        }
        total = total
            .checked_add(file.size())
            .ok_or("Invalid package size")?;
        if total > EXPANDED_LIMIT {
            return Err("Unpacked extension exceeds the 4 GiB extraction limit".into());
        }
        if file.size() > FILE_LIMIT {
            return Err("Extension file exceeds the 1 GiB file limit".into());
        }
        let output = destination.join(path);
        if file.is_dir() {
            fs::create_dir_all(output).map_err(|e| e.to_string())?;
            continue;
        }
        fs::create_dir_all(output.parent().ok_or("Invalid extension path")?)
            .map_err(|e| e.to_string())?;
        let mut out = fs::File::create(&output).map_err(|e| e.to_string())?;
        let expected_size = file.size();
        let copied = std::io::copy(&mut file.by_ref().take(expected_size + 1), &mut out)
            .map_err(|e| e.to_string())?;
        if copied != expected_size {
            return Err("Extension file does not match its declared size".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if file.unix_mode().is_some_and(|m| m & 0o111 != 0) {
                fs::set_permissions(output, fs::Permissions::from_mode(0o755))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    let installed = manifest(destination)?;
    if expected.is_some_and(|id| !id.eq_ignore_ascii_case(&installed.id)) {
        return Err("Downloaded extension does not match its registry identifier".into());
    }
    Ok(installed)
}
fn install_package(
    root: &Path,
    reader: impl Read + Seek,
    expected: Option<&str>,
) -> Result<InstalledExtension, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staging = root.join(format!(".install-{stamp}"));
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut extension = unpack(reader, &staging, expected)?;
        let target = root.join(extension.id.to_ascii_lowercase());
        extension.install_path = crate::workspace::display_path(&target);
        let backup = root.join(format!(".previous-{stamp}"));
        if target.join(".devyy-disabled").exists() {
            fs::write(staging.join(".devyy-disabled"), b"").map_err(|e| e.to_string())?;
            extension.enabled = false;
        }
        if target.exists() {
            fs::rename(&target, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&staging, &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(error.to_string());
        }
        let _ = fs::remove_dir_all(backup);
        Ok(extension)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}
#[cfg(test)]
fn install_bytes(
    root: &Path,
    bytes: &[u8],
    expected: Option<&str>,
) -> Result<InstalledExtension, String> {
    install_package(root, std::io::Cursor::new(bytes), expected)
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("devyy/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}
async fn bounded(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = response.error_for_status().map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|s| s > limit as u64) {
        return Err(format!(
            "Registry response exceeds its {} MiB limit",
            limit / (1024 * 1024)
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > limit {
            return Err(format!(
                "Registry response exceeds its {} MiB limit",
                limit / (1024 * 1024)
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn download_package_with_progress(
    response: reqwest::Response,
    root: &Path,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<tempfile::NamedTempFile, String> {
    use tokio::io::AsyncWriteExt;
    let mut response = response.error_for_status().map_err(|e| e.to_string())?;
    let total = response.content_length().filter(|size| *size > 0);
    if response
        .content_length()
        .is_some_and(|size| size > PACKAGE_LIMIT as u64)
    {
        return Err("Extension download exceeds the 1 GiB archive limit".into());
    }
    let package = tempfile::Builder::new()
        .prefix(".download-")
        .suffix(".vsix")
        .tempfile_in(root)
        .map_err(|e| e.to_string())?;
    let mut output =
        tokio::fs::File::from_std(package.as_file().try_clone().map_err(|e| e.to_string())?);
    let mut size = 0u64;
    let mut last_report = Instant::now();
    progress(0, total);
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        size = size
            .checked_add(chunk.len() as u64)
            .ok_or("Invalid package size")?;
        if size > PACKAGE_LIMIT as u64 {
            return Err("Extension download exceeds the 1 GiB archive limit".into());
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write extension download: {e}"))?;
        if last_report.elapsed() >= Duration::from_millis(100) {
            progress(size, total);
            last_report = Instant::now();
        }
    }
    output.flush().await.map_err(|e| e.to_string())?;
    // Close the writer before extraction; NamedTempFile removes partial and
    // completed downloads on every exit path, including failed installations.
    drop(output);
    progress(size, total);
    Ok(package)
}
#[cfg(test)]
async fn download_package(
    response: reqwest::Response,
    root: &Path,
) -> Result<tempfile::NamedTempFile, String> {
    download_package_with_progress(response, root, |_, _| {}).await
}
fn platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", _) => "darwin-x64",
        ("windows", "aarch64") => "win32-arm64",
        ("windows", _) => "win32-x64",
        ("linux", "aarch64") => "linux-arm64",
        _ => "linux-x64",
    }
}
#[tauri::command]
pub async fn search_extensions(query: String, offset: Option<u32>) -> Result<Value, String> {
    let response = client()?
        .get(format!("{API}/-/search"))
        .query(&[
            ("query", query.chars().take(200).collect::<String>()),
            ("size", "24".into()),
            ("offset", offset.unwrap_or(0).min(10000).to_string()),
            ("targetPlatform", platform().into()),
        ])
        .send()
        .await
        .map_err(|e| format!("Open VSX is unavailable: {e}"))?;
    serde_json::from_slice(&bounded(response, 4 * 1024 * 1024).await?).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn extension_details(id: String) -> Result<Value, String> {
    let (publisher, name) = id_parts(&id)?;
    let client = client()?;
    let response = client
        .get(format!("{API}/{publisher}/{name}/{}/latest", platform()))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = if response.status() == reqwest::StatusCode::NOT_FOUND {
        client
            .get(format!("{API}/{publisher}/{name}/universal/latest"))
            .send()
            .await
            .map_err(|e| e.to_string())?
    } else {
        response
    };
    serde_json::from_slice(&bounded(response, 4 * 1024 * 1024).await?).map_err(|e| e.to_string())
}
fn validate_registry_platform(details: &Value, target: &str) -> Result<(), String> {
    match details["targetPlatform"].as_str() {
        None | Some("universal") => Ok(()),
        Some(actual) if actual == target => Ok(()),
        Some(actual) => Err(format!("This extension package targets {actual}; Devyy needs {target}. Install a compatible platform build.")),
    }
}
#[tauri::command]
pub async fn list_extensions(app: AppHandle) -> Result<Vec<InstalledExtension>, String> {
    let root = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || installed(&root))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn install_extension(
    id: String,
    request_id: Option<String>,
    app: AppHandle,
    state: State<'_, ExtensionStore>,
) -> Result<InstalledExtension, String> {
    report_install_progress(&app, &id, &request_id, "resolving", 0, None);
    let details = extension_details(id.clone()).await?;
    validate_registry_platform(&details, platform())?;
    let url = details["files"]["download"]
        .as_str()
        .ok_or("This extension has no downloadable package")?;
    if !url.starts_with("https://open-vsx.org/api/") {
        return Err("Invalid registry download URL".into());
    }
    let root = directory(&app)?;
    let response = client()?
        .get(url)
        .timeout(Duration::from_secs(15 * 60))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let package = download_package_with_progress(response, &root, |downloaded, total| {
        report_install_progress(&app, &id, &request_id, "downloading", downloaded, total);
    })
    .await?;
    let size = package
        .as_file()
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    report_install_progress(&app, &id, &request_id, "installing", size, Some(size));
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        install_package(
            &root,
            package.reopen().map_err(|e| e.to_string())?,
            Some(&id),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn install_vsix(
    path: String,
    app: AppHandle,
    state: State<'_, ExtensionStore>,
) -> Result<InstalledExtension, String> {
    let path = PathBuf::from(path);
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|v| !v.eq_ignore_ascii_case("vsix"))
    {
        return Err("Choose a .vsix extension package".into());
    }
    let root = directory(&app)?;
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let package = fs::File::open(path).map_err(|e| e.to_string())?;
        install_package(&root, package, None)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_extension_enabled(
    id: String,
    enabled: bool,
    app: AppHandle,
    state: State<'_, ExtensionStore>,
) -> Result<(), String> {
    id_parts(&id)?;
    let base = directory(&app)?.join(id.to_lowercase());
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        manifest(&base)?;
        let path = base.join(".devyy-disabled");
        if enabled {
            if path.exists() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        } else {
            fs::write(path, b"").map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn uninstall_extension(
    id: String,
    app: AppHandle,
    state: State<'_, ExtensionStore>,
) -> Result<(), String> {
    id_parts(&id)?;
    let base = directory(&app)?.join(id.to_lowercase());
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        if base.exists() {
            fs::remove_dir_all(base).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn extension_asset(id: String, path: String, app: AppHandle) -> Result<String, String> {
    id_parts(&id)?;
    let base = directory(&app)?.join(id.to_lowercase());
    tauri::async_runtime::spawn_blocking(move || {
        let installed = manifest(&base)?;
        if !installed.enabled {
            return Err("Extension is disabled".into());
        }
        asset(&base, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extension_icon(id: String, path: String, app: AppHandle) -> Result<String, String> {
    id_parts(&id)?;
    let base = directory(&app)?.join(id.to_lowercase());
    tauri::async_runtime::spawn_blocking(move || {
        if !manifest(&base)?.enabled {
            return Err("Extension is disabled".into());
        }
        icon_data(&base, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    fn vsix(files: Vec<(&str, &str)>) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, text) in files {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn package_relationships_are_exposed_and_validated() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("package.json");
        fs::write(&file, r#"{"publisher":"test","name":"bundle","version":"1.0.0","extensionDependencies":["Test.Core"],"extensionPack":["test.tools"]}"#).unwrap();
        let package = manifest(directory.path()).unwrap();
        assert_eq!(package.extension_dependencies, vec!["test.core"]);
        assert_eq!(package.extension_pack, vec!["test.tools"]);
        fs::write(&file, r#"{"publisher":"test","name":"bundle","version":"1.0.0","extensionDependencies":["../invalid"]}"#).unwrap();
        assert!(manifest(directory.path()).is_err());
    }
    #[test]
    fn packages_install_atomically_and_assets_cannot_escape() {
        let root = std::env::temp_dir().join(format!("devyy-vsix-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let package = vsix(vec![
            (
                "extension/package.json",
                r#"{"publisher":"test","name":"language","version":"1.0.0","icon":"icon.svg","contributes":{"languages":[{"id":"test"}]}}"#,
            ),
            ("extension/syntaxes/test.json", "{}"),
            (
                "extension/icon.svg",
                "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            ),
        ]);
        let installed = install_bytes(&root, &package, Some("test.language")).unwrap();
        assert_eq!(installed.version, "1.0.0");
        assert!(installed
            .icon
            .as_ref()
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        assert!(icon_data(&root.join("test.language"), "../icon.svg").is_err());
        fs::write(root.join("test.language/.devyy-disabled"), b"").unwrap();
        let disabled = manifest(&root.join("test.language")).unwrap();
        assert!(!disabled.enabled);
        assert!(disabled.icon.is_some());
        assert_eq!(
            asset(&root.join("test.language"), "./syntaxes/test.json").unwrap(),
            "{}"
        );
        assert!(asset(&root.join("test.language"), "../package.json").is_err());
        assert!(install_bytes(&root, &package, Some("other.id")).is_err());
        assert_eq!(
            manifest(&root.join("test.language")).unwrap().version,
            "1.0.0"
        );
        for bad in [
            "extension/../escape",
            "extension/C:/escape",
            "extension/foo\\bar",
            "extension/CON.txt",
        ] {
            assert!(install_bytes(&root, &vsix(vec![(bad, "bad")]), None).is_err());
        }
        assert!(!root.join("escape").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn large_native_members_install_and_oversized_archives_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let package = tempfile::tempfile().unwrap();
        let mut zip = zip::ZipWriter::new(package);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("extension/package.json", options).unwrap();
        zip.write_all(br#"{"publisher":"test","name":"large","version":"1.0.0"}"#)
            .unwrap();
        zip.start_file("extension/native/tool", options).unwrap();
        let chunk = [0u8; 1024 * 1024];
        for _ in 0..260 {
            zip.write_all(&chunk).unwrap();
        }
        let package = zip.finish().unwrap();
        let installed = install_package(root.path(), package, Some("test.large")).unwrap();
        assert_eq!(
            fs::metadata(Path::new(&installed.install_path).join("native/tool"))
                .unwrap()
                .len(),
            260 * 1024 * 1024
        );
        let oversized = tempfile::tempfile().unwrap();
        oversized.set_len(PACKAGE_LIMIT as u64 + 1).unwrap();
        let error = install_package(root.path(), oversized, Some("test.large"))
            .err()
            .unwrap();
        assert!(error.contains("1 GiB archive limit"));
        assert_eq!(
            manifest(&root.path().join("test.large")).unwrap().version,
            "1.0.0"
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
    async fn response_fixture(response: Vec<u8>) -> reqwest::Response {
        use std::io::{BufRead, BufReader};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                    break;
                }
            }
            let _ = socket.write_all(&response);
        });
        client()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap()
    }
    #[test]
    fn downloads_stream_without_content_length_and_remove_partial_files_on_failure() {
        tauri::async_runtime::block_on(async {
            let root = tempfile::tempdir().unwrap();
            let mut raw = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
            raw.extend_from_slice(b"streamed package");
            let package = download_package(response_fixture(raw).await, root.path())
                .await
                .unwrap();
            assert_eq!(fs::read(package.path()).unwrap(), b"streamed package");
            drop(package);
            let oversized = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                PACKAGE_LIMIT as u64 + 1
            );
            let error =
                download_package(response_fixture(oversized.into_bytes()).await, root.path())
                    .await
                    .unwrap_err();
            assert!(error.contains("1 GiB archive limit"));
            let truncated =
                b"HTTP/1.1 200 OK\r\nContent-Length: 1024\r\nConnection: close\r\n\r\npartial"
                    .to_vec();
            assert!(
                download_package(response_fixture(truncated).await, root.path())
                    .await
                    .is_err()
            );
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        });
    }
    #[test]
    fn progress_reports_actual_bytes_with_and_without_a_content_length() {
        tauri::async_runtime::block_on(async {
            let root = tempfile::tempdir().unwrap();
            for known in [false, true] {
                let body = vec![7u8; 128 * 1024];
                let length = if known {
                    format!("Content-Length: {}\r\n", body.len())
                } else {
                    String::new()
                };
                let mut raw =
                    format!("HTTP/1.1 200 OK\r\n{length}Connection: close\r\n\r\n").into_bytes();
                raw.extend_from_slice(&body);
                let mut events = Vec::new();
                let package = download_package_with_progress(
                    response_fixture(raw).await,
                    root.path(),
                    |downloaded, total| events.push((downloaded, total)),
                )
                .await
                .unwrap();
                let total = known.then_some(body.len() as u64);
                assert_eq!(events.first(), Some(&(0, total)));
                assert_eq!(events.last(), Some(&(body.len() as u64, total)));
                assert!(events.windows(2).all(|pair| pair[0].0 <= pair[1].0));
                assert_eq!(fs::read(package.path()).unwrap(), body);
            }
        });
    }
    #[test]
    #[ignore = "Downloads the actual large Codex and Claude Code packages from Open VSX"]
    fn live_large_ai_extensions_download_and_install() {
        tauri::async_runtime::block_on(async {
            let root = tempfile::tempdir().unwrap();
            for id in ["openai.chatgpt", "anthropic.claude-code"] {
                let details = extension_details(id.into()).await.unwrap();
                let response = client()
                    .unwrap()
                    .get(details["files"]["download"].as_str().unwrap())
                    .timeout(Duration::from_secs(15 * 60))
                    .send()
                    .await
                    .unwrap();
                let package = download_package(response, root.path()).await.unwrap();
                let size = package.as_file().metadata().unwrap().len();
                let installed =
                    install_package(root.path(), package.reopen().unwrap(), Some(id)).unwrap();
                assert!(installed.id.eq_ignore_ascii_case(id));
                assert!(Path::new(&installed.install_path)
                    .join("package.json")
                    .is_file());
                println!(
                    "LARGE_VSIX_OK {} {} compressed_bytes={size}",
                    installed.id, installed.version
                );
                fs::remove_dir_all(installed.install_path).unwrap();
            }
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        });
    }
    #[test]
    #[ignore = "Requires access to Open VSX"]
    fn live_open_vsx_package_installs_and_exposes_real_theme_assets() {
        tauri::async_runtime::block_on(async {
            let details = extension_details("sainnhe.everforest".into())
                .await
                .unwrap();
            let response = client()
                .unwrap()
                .get(details["files"]["download"].as_str().unwrap())
                .send()
                .await
                .unwrap();
            let bytes = bounded(response, PACKAGE_LIMIT).await.unwrap();
            let root = std::env::temp_dir().join(format!("devyy-live-vsix-{}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            let installed = install_bytes(&root, &bytes, Some("sainnhe.everforest")).unwrap();
            let themes = installed.contributes["themes"].as_array().unwrap();
            assert!(!themes.is_empty());
            let path = themes[0]["path"].as_str().unwrap();
            assert!(asset(&root.join("sainnhe.everforest"), path)
                .unwrap()
                .contains("tokenColors"));
            fs::remove_dir_all(root).unwrap();
        });
    }
    #[test]
    #[ignore = "Downloads Pyright from Open VSX and requires Node.js"]
    fn live_open_vsx_pyright_is_discovered_and_returns_real_completions() {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        use std::sync::mpsc;
        struct ChildGuard(std::process::Child);
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let root = std::env::temp_dir().join(format!("devyy-live-pyright-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let extension = tauri::async_runtime::block_on(async {
            let details = extension_details("ms-pyright.pyright".into())
                .await
                .unwrap();
            let response = client()
                .unwrap()
                .get(details["files"]["download"].as_str().unwrap())
                .send()
                .await
                .unwrap();
            let bytes = bounded(response, PACKAGE_LIMIT).await.unwrap();
            install_bytes(&root, &bytes, Some("ms-pyright.pyright")).unwrap()
        });
        let config = crate::extension_servers::discover(&[extension]).remove(0);
        assert_eq!(config.language, "python");
        let mut child = ChildGuard(
            crate::process::command(&config.command)
                .args(config.args)
                .current_dir(&root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let mut input = child.0.stdin.take().unwrap();
        let mut output = BufReader::new(child.0.stdout.take().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || loop {
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                if output.read_line(&mut line).unwrap_or(0) == 0 {
                    return;
                }
                if line == "\r\n" || line == "\n" {
                    break;
                }
                if let Some(size) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = size.trim().parse().unwrap();
                }
            }
            if length == 0 || length > 16_000_000 {
                return;
            }
            let mut bytes = vec![0; length];
            if output.read_exact(&mut bytes).is_err() {
                return;
            }
            if tx
                .send(serde_json::from_slice::<Value>(&bytes).unwrap())
                .is_err()
            {
                return;
            }
        });
        let mut send = |value: Value| {
            let text = value.to_string();
            write!(input, "Content-Length: {}\r\n\r\n{}", text.len(), text).unwrap();
            input.flush().unwrap();
        };
        let uri = tauri::Url::from_directory_path(&root).unwrap().to_string();
        send(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":std::process::id(),"rootUri":uri,"capabilities":{}}}),
        );
        loop {
            let response = rx.recv_timeout(Duration::from_secs(30)).unwrap();
            if response["id"] == 1 {
                assert!(response["error"].is_null(), "{response}");
                break;
            }
        }
        send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
        let file = root.join("sample.py");
        fs::write(&file, "import os\nos.pa").unwrap();
        let file_uri = tauri::Url::from_file_path(file).unwrap().to_string();
        send(
            json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":file_uri,"languageId":"python","version":1,"text":"import os\nos.pa"}}}),
        );
        send(
            json!({"jsonrpc":"2.0","id":2,"method":"textDocument/completion","params":{"textDocument":{"uri":file_uri},"position":{"line":1,"character":5}}}),
        );
        loop {
            let response = rx.recv_timeout(Duration::from_secs(30)).unwrap();
            if response["id"] == 2 {
                assert!(response["error"].is_null(), "{response}");
                let items = response["result"]["items"]
                    .as_array()
                    .or_else(|| response["result"].as_array())
                    .unwrap();
                assert!(
                    items.iter().any(|item| item["label"] == "path"),
                    "Expected os.path completion: {response}"
                );
                break;
            }
        }
        drop(child);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn extension_ids_and_paths_are_portable() {
        for id in ["../escape", "a.b/c", "a.b.c", "a.", ".b", "a.b:c"] {
            assert!(id_parts(id).is_err());
        }
        assert!(id_parts("rust-lang.rust-analyzer").is_ok());
        for p in ["/absolute", "../escape", "a/../../b", "C:\\foo", "a\0b"] {
            assert!(safe_relative(p).is_err());
        }
    }
}

#[cfg(test)]
mod platform_validation_tests {
    use super::*;
    #[test]
    fn native_packages_must_match_the_running_platform() {
        assert!(validate_registry_platform(
            &serde_json::json!({"targetPlatform":"darwin-arm64"}),
            "darwin-arm64"
        )
        .is_ok());
        assert!(validate_registry_platform(
            &serde_json::json!({"targetPlatform":"universal"}),
            "win32-x64"
        )
        .is_ok());
        assert!(validate_registry_platform(
            &serde_json::json!({"targetPlatform":"alpine-arm64"}),
            "darwin-arm64"
        )
        .unwrap_err()
        .contains("alpine-arm64"));
    }
}
