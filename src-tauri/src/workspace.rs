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

use base64::{engine::general_purpose::STANDARD, Engine};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

#[derive(Default)]
pub struct Workspace(pub Mutex<Option<PathBuf>>);
#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub directory: bool,
}
#[derive(Serialize)]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
    pub files: Vec<Entry>,
    pub logo: Option<String>,
    #[serde(rename = "remotePath", skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
}
#[derive(Serialize)]
pub struct Document {
    pub content: String,
    pub modified: String,
}
#[derive(Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
    pub column: usize,
}
#[derive(Deserialize)]
pub struct SearchOptions {
    pub query: String,
    pub case_sensitive: bool,
}

pub fn root(state: &Workspace) -> Result<PathBuf, String> {
    let path = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Open a folder first".to_string())?;
    Ok(path)
}
pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", unc)
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}
pub fn resolve(base: &Path, relative: &str, create: bool) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Expected a relative path inside this workspace".into());
    }
    let joined = base.join(path);
    let check = if create && !joined.exists() {
        joined.parent().ok_or("Invalid file path")?
    } else {
        &joined
    };
    let canonical = check.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(base) {
        return Err("Path is outside the workspace".into());
    }
    Ok(joined)
}
fn stamp(path: &Path) -> Result<String, String> {
    stamp_metadata(&fs::metadata(path).map_err(|e| e.to_string())?)
}
fn stamp_metadata(m: &fs::Metadata) -> Result<String, String> {
    let modified = m
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(format!("{}:{}", modified.as_nanos(), m.len()))
}
fn scan_entries(base: &Path, depth: usize, limit: usize) -> Vec<Entry> {
    let mut out: Vec<Entry> = WalkBuilder::new(base)
        .hidden(false)
        .max_depth(Some(depth))
        .filter_entry(|e| {
            !matches!(
                e.file_name().to_str(),
                Some(".git" | "node_modules" | "target" | ".next" | "dist")
            )
        })
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.path() != base)
        .take(limit)
        .map(|e| Entry {
            path: e
                .path()
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/"),
            name: e.file_name().to_string_lossy().into(),
            directory: e.file_type().is_some_and(|f| f.is_dir()),
        })
        .collect();
    out.sort_by_cached_key(|entry| (!entry.directory, entry.path.to_lowercase()));
    out
}

fn entries(base: &Path) -> Vec<Entry> {
    scan_entries(base, 20, 30_000)
}
fn explorer_entries(base: &Path, depth: usize, limit: usize) -> Vec<Entry> {
    let mut pending = std::collections::VecDeque::from([(base.to_path_buf(), depth)]);
    let mut out = Vec::new();
    while let Some((dir, remaining)) = pending.pop_front() {
        if remaining == 0 || out.len() >= limit {
            continue;
        }
        let Ok(items) = fs::read_dir(&dir) else {
            continue;
        };
        let mut items: Vec<_> = items.filter_map(Result::ok).collect();
        items.sort_by_cached_key(|e| e.file_name());
        for item in items {
            if dir != base && out.len() >= limit {
                break;
            }
            if item.file_name() == ".git" {
                continue;
            }
            let Ok(kind) = item.file_type() else {
                continue;
            };
            let path = item.path();
            let directory = kind.is_dir();
            let name = item.file_name().to_string_lossy().into_owned();
            out.push(Entry {
                path: path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                name: name.clone(),
                directory,
            });
            if directory
                && !matches!(
                    name.as_str(),
                    "node_modules" | "target" | ".next" | "dist" | ".venv" | "vendor" | "build"
                )
            {
                pending.push_back((path, remaining - 1));
            }
        }
    }
    out.sort_by_cached_key(|e| (!e.directory, e.path.to_lowercase()));
    out
}
fn directory_entries(base: &Path, path: &str) -> Result<Vec<Entry>, String> {
    let dir = resolve(base, path, false)?;
    let mut out = Vec::new();
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        if item.file_name() == ".git" {
            continue;
        }
        out.push(Entry {
            path: item
                .path()
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/"),
            name: item.file_name().to_string_lossy().into_owned(),
            directory: item.file_type().map_err(|e| e.to_string())?.is_dir(),
        });
    }
    out.sort_by_cached_key(|e| (!e.directory, e.name.to_lowercase()));
    Ok(out)
}
#[tauri::command]
pub async fn list_directory(
    path: String,
    state: State<'_, Workspace>,
) -> Result<Vec<Entry>, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.directory(&path).await;
    }
    background(move || directory_entries(&base, &path)).await?
}

async fn background<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}
const MAX_LOGO_BYTES: u64 = 5 * 1024 * 1024;

fn project_logo(base: &Path, files: &[Entry]) -> Option<String> {
    let project_name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mut candidates: Vec<_> = files
        .iter()
        .filter(|entry| !entry.directory)
        .filter_map(|entry| {
            let path = Path::new(&entry.path);
            let ext = path.extension()?.to_str()?.to_lowercase();
            let (format, mime) = match ext.as_str() {
                "svg" => (0, "image/svg+xml"),
                "png" => (1, "image/png"),
                "webp" => (2, "image/webp"),
                "jpg" | "jpeg" => (3, "image/jpeg"),
                "ico" => (4, "image/x-icon"),
                _ => return None,
            };
            let stem = path.file_stem()?.to_str()?.to_lowercase();
            let brand = if matches!(stem.as_str(), "logo" | "logomark" | "logo-mark") {
                0
            } else if stem.starts_with("logo-")
                || stem.starts_with("logo_")
                || stem.starts_with("logo.")
                || stem.starts_with("logo@")
                || stem.ends_with("-logo")
                || stem.ends_with("_logo")
                || stem == project_name
            {
                1
            } else if matches!(stem.as_str(), "app-icon" | "icon" | "favicon") {
                2
            } else {
                return None;
            };
            let depth = path.components().count();
            Some((
                (brand, depth, format, entry.path.to_lowercase()),
                &entry.path,
                mime,
            ))
        })
        .collect();
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    for (_, relative, mime) in candidates {
        let Some(data) = (|| {
            let path = resolve(base, relative, false).ok()?;
            let metadata = fs::metadata(&path).ok()?;
            if !metadata.is_file() || metadata.len() > MAX_LOGO_BYTES {
                return None;
            }
            let mut data = Vec::new();
            fs::File::open(path)
                .ok()?
                .take(MAX_LOGO_BYTES + 1)
                .read_to_end(&mut data)
                .ok()?;
            if data.is_empty() || data.len() as u64 > MAX_LOGO_BYTES {
                return None;
            }
            let valid = match mime {
                "image/svg+xml" => std::str::from_utf8(&data).ok()?.contains("<svg"),
                "image/png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
                "image/jpeg" => data.starts_with(&[0xff, 0xd8, 0xff]),
                "image/webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
                "image/x-icon" => data.starts_with(&[0, 0, 1, 0]),
                _ => false,
            };
            valid.then_some(data)
        })() else {
            continue;
        };
        return Some(format!("data:{mime};base64,{}", STANDARD.encode(data)));
    }
    None
}

fn workspace_info(base: &Path) -> WorkspaceInfo {
    let files = explorer_entries(base, 20, 30_000);
    let logo = project_logo(base, &files);
    WorkspaceInfo {
        root: display_path(base),
        name: base
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        files,
        logo,
        remote_path: None,
    }
}
#[tauri::command]
pub async fn open_workspace(
    path: String,
    state: State<'_, Workspace>,
) -> Result<WorkspaceInfo, String> {
    let requested = PathBuf::from(&path);
    if let Some(ssh) = crate::ssh::workspace(&requested) {
        let info = ssh.info(&requested, 2, 2048).await?;
        set_root(&state, requested)?;
        return Ok(info);
    }
    let (base, info) = background(move || {
        let base = PathBuf::from(path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if std::env::temp_dir()
            .join("devyy-remote-workspaces")
            .canonicalize()
            .is_ok_and(|legacy| base.starts_with(legacy))
        {
            return Err(
                "This was a downloaded SSH workspace. Open the server again in Remote Explorer."
                    .into(),
            );
        }
        if !base.is_dir() {
            return Err("Choose a folder".to_string());
        }
        let files = explorer_entries(&base, 2, 2048);
        let info = WorkspaceInfo {
            root: display_path(&base),
            name: base
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            logo: project_logo(&base, &files),
            remote_path: None,
            files,
        };
        Ok::<_, String>((base, info))
    })
    .await??;
    set_root(&state, base)?;
    Ok(info)
}
fn set_root(state: &Workspace, path: PathBuf) -> Result<(), String> {
    let previous = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .replace(path.clone());
    if let Some(previous) = previous.filter(|previous| previous != &path) {
        crate::ssh::release(&previous);
    }
    Ok(())
}

#[tauri::command]
pub fn close_ssh_workspace(path: String, state: State<'_, Workspace>) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    if active.as_ref() != Some(&path) || crate::ssh::workspace(&path).is_none() {
        return Err("That SSH workspace is no longer active.".into());
    }
    crate::ssh::release(&path);
    *active = None;
    Ok(())
}

#[tauri::command]
pub async fn refresh_workspace(
    shallow: Option<bool>,
    state: State<'_, Workspace>,
) -> Result<WorkspaceInfo, String> {
    let base = root(&state)?;
    let shallow = shallow.unwrap_or(false);
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.info(&base, if shallow { 1 } else { 3 }, 2048).await;
    }
    background(move || {
        if !shallow {
            return workspace_info(&base);
        }
        // Polling only needs the root. Expanded folders are refreshed
        // separately, and the frontend retains the full search index.
        WorkspaceInfo {
            root: display_path(&base),
            name: base
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            files: explorer_entries(&base, 1, 2048),
            logo: None,
            remote_path: None,
        }
    })
    .await
}
#[tauri::command]
pub async fn list_files(state: State<'_, Workspace>) -> Result<Vec<Entry>, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.entries(12, 10000).await;
    }
    background(move || explorer_entries(&base, 20, 30_000)).await
}
#[tauri::command]
pub async fn read_file(path: String, state: State<'_, Workspace>) -> Result<Document, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.read(&path).await;
    }
    background(move || read_document(&base, &path)).await?
}
fn read_document(base: &Path, path: &str) -> Result<Document, String> {
    const MAX_BYTES: u64 = 5_000_000;
    let full = resolve(base, path, false)?;
    let mut file = fs::File::open(&full).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Only regular files can be opened in the text editor".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("This file exceeds the 5 MB editing limit".into());
    }
    let mut content = String::with_capacity(metadata.len() as usize);
    (&mut file)
        .take(MAX_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() as u64 > MAX_BYTES {
        return Err("This file exceeds the 5 MB editing limit".into());
    }
    if content.contains('\0') {
        return Err("Binary files cannot be opened in the text editor".into());
    }
    let modified = stamp_metadata(&metadata)?;
    if modified != stamp_metadata(&file.metadata().map_err(|e| e.to_string())?)? {
        return Err("The file changed while opening it. Try again.".into());
    }
    Ok(Document { content, modified })
}
#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    expected: String,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.write(&path, &content, &expected).await;
    }
    write_document(&base, &path, &content, &expected)
}
fn write_document(
    base: &Path,
    path: &str,
    content: &str,
    expected: &str,
) -> Result<String, String> {
    if expected == "devyy:new" {
        let full = resolve(base, path, true)?;
        let mut file =
            tempfile::NamedTempFile::new_in(full.parent().ok_or("Invalid new file path")?)
                .map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.persist_noclobber(&full).map_err(|_|"A file appeared at this path. Reopen it before saving to avoid overwriting its contents.".to_string())?;
        return stamp(&full);
    }
    let full = resolve(base, path, false)?;
    if stamp(&full)? != expected {
        return Err(
            "File changed on disk. Reopen it before saving to avoid overwriting external changes."
                .into(),
        );
    }
    fs::write(&full, content).map_err(|e| e.to_string())?;
    stamp(&full)
}
#[tauri::command]
pub async fn create_file(
    path: String,
    directory: bool,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.create(&path, directory).await;
    }
    let full = resolve(&base, &path, true)?;
    if directory {
        fs::create_dir(full).map_err(|e| e.to_string())
    } else {
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(full)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub async fn rename_file(
    path: String,
    new_path: String,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.rename(&path, &new_path).await;
    }
    let from = resolve(&base, &path, false)?;
    let to = resolve(&base, &new_path, true)?;
    if to.exists() {
        return Err("A file already exists at that path".into());
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_file(path: String, state: State<'_, Workspace>) -> Result<(), String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.delete(&path).await;
    }
    tauri::async_runtime::spawn_blocking(move || delete_path(&base, &path))
        .await
        .map_err(|e| e.to_string())?
}
fn delete_path(base: &Path, path: &str) -> Result<(), String> {
    let full = resolve(base, path, false)?;
    let metadata = fs::symlink_metadata(&full).map_err(|e| e.to_string())?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(full)
    } else {
        fs::remove_file(full)
    }
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn search_workspace(
    options: SearchOptions,
    state: State<'_, Workspace>,
) -> Result<Vec<SearchMatch>, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return ssh.search(options).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if options.query.is_empty() {
            return Vec::new();
        }
        let needle = if options.case_sensitive {
            options.query.clone()
        } else {
            options.query.to_lowercase()
        };
        let mut results = Vec::new();
        for entry in entries(&base).into_iter().filter(|e| !e.directory) {
            let Ok(full) = resolve(&base, &entry.path, false) else {
                continue;
            };
            if fs::metadata(&full)
                .map(|m| m.len() > 1_000_000)
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(content) = fs::read_to_string(full) else {
                continue;
            };
            if content.contains('\0') {
                continue;
            }
            for (line, text) in content.lines().enumerate() {
                let column = if options.case_sensitive {
                    text.find(&needle)
                } else {
                    text.to_lowercase().find(&needle)
                };
                if let Some(column) = column {
                    results.push(SearchMatch {
                        path: entry.path.clone(),
                        line: line + 1,
                        text: text.chars().take(500).collect(),
                        column,
                    });
                    if results.len() >= 500 {
                        return results;
                    }
                }
            }
        }
        results
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_preview_image(
    path: String,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        let mime = mime_guess::from_path(&path)
            .first()
            .filter(|mime| mime.type_() == "image")
            .ok_or("Unsupported image format")?;
        return Ok(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(ssh.bytes(&path, 8 * 1024 * 1024).await?)
        ));
    }
    tauri::async_runtime::spawn_blocking(move || preview_image(&base, &path))
        .await
        .map_err(|e| e.to_string())?
}
fn preview_image(base: &Path, path: &str) -> Result<String, String> {
    let full = resolve(base, path, false)?;
    let mime = match full
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        _ => return Err("Unsupported image format".into()),
    };
    let file = fs::File::open(full).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Image exceeds 8 MiB".into());
    }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn read_preview_media(
    path: String,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let base = root(&state)?;
    if let Some(ssh) = crate::ssh::workspace(&base) {
        let mime = mime_guess::from_path(&path)
            .first()
            .filter(|mime| matches!(mime.type_().as_str(), "audio" | "video"))
            .ok_or("Unsupported media format")?;
        return Ok(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(ssh.bytes(&path, 32 * 1024 * 1024).await?)
        ));
    }
    background(move || {
        let full = resolve(&base, &path, false)?;
        let mime = match full
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "m4a" => "audio/mp4",
            "flac" => "audio/flac",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "ogv" => "video/ogg",
            "mov" => "video/quicktime",
            _ => return Err("Unsupported media format".to_string()),
        };
        let file = fs::File::open(full).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("Media exceeds the 32 MiB preview limit".into());
        }
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deleting_nonempty_folders_stays_inside_the_workspace() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path().canonicalize().unwrap();
        fs::create_dir_all(base.join("folder/nested")).unwrap();
        fs::write(base.join("folder/nested/file.rs"), "data").unwrap();
        fs::write(base.join("keep.rs"), "keep").unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("keep.txt"), "outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), base.join("folder/link")).unwrap();
        assert!(delete_path(&base, "").is_err());
        assert!(delete_path(&base, ".").is_err());
        assert!(delete_path(&base, "../keep.txt").is_err());
        delete_path(&base, "folder").unwrap();
        assert!(!base.join("folder").exists());
        assert!(base.join("keep.rs").exists());
        assert!(outside.path().join("keep.txt").exists());
    }
    #[test]
    fn preview_images_are_bounded_and_confined_to_the_workspace() {
        let base = std::env::temp_dir().join(format!("devyy-preview-{}", std::process::id()));
        fs::create_dir_all(base.join("assets")).unwrap();
        let base = base.canonicalize().unwrap();
        fs::write(base.join("assets/image.svg"), "<svg/>").unwrap();
        assert!(preview_image(&base, "assets/image.svg")
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        fs::write(base.join("text.txt"), "text").unwrap();
        assert!(preview_image(&base, "text.txt").is_err());
        assert!(preview_image(&base, "../image.svg").is_err());
        let big = fs::File::create(base.join("big.png")).unwrap();
        big.set_len(8 * 1024 * 1024 + 1).unwrap();
        assert!(preview_image(&base, "big.png")
            .unwrap_err()
            .contains("8 MiB"));
        #[cfg(unix)]
        {
            let outside = base.with_extension("svg");
            fs::write(&outside, "<svg/>").unwrap();
            std::os::unix::fs::symlink(&outside, base.join("escape.svg")).unwrap();
            assert!(preview_image(&base, "escape.svg").is_err());
            fs::remove_file(outside).unwrap();
        }
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn discovers_asset_png_above_the_previous_512_kib_limit() {
        let base = std::env::temp_dir().join(format!("devyy-large-logo-{}", std::process::id()));
        fs::create_dir_all(base.join("assets")).unwrap();
        let base = base.canonicalize().unwrap();
        let mut png = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=").unwrap();
        png.resize(700 * 1024, 0);
        fs::write(base.join("assets/logo.png"), &png).unwrap();
        let info = workspace_info(&base);
        assert!(info
            .files
            .iter()
            .any(|entry| entry.path == "assets/logo.png"));
        let logo = info.logo.unwrap();
        assert_eq!(
            STANDARD
                .decode(logo.strip_prefix("data:image/png;base64,").unwrap())
                .unwrap(),
            png
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn discovers_logos_in_assets_and_prefers_them_over_favicons() {
        let base = std::env::temp_dir().join(format!("devyy-logo-test-{}", std::process::id()));
        fs::create_dir_all(base.join("public/assets")).unwrap();
        let base = base.canonicalize().unwrap();
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"8\"/></svg>";
        fs::write(base.join("public/assets/logo.svg"), svg).unwrap();
        fs::write(base.join("favicon.ico"), [0, 0, 1, 0, 1, 0]).unwrap();
        fs::write(base.join("logo.png"), b"not an image").unwrap();
        assert_eq!(
            workspace_info(&base).logo,
            Some(format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(svg)
            ))
        );
        fs::write(base.join("logo.svg"), b"<svg>root brand</svg>").unwrap();
        assert_eq!(
            workspace_info(&base).logo,
            Some(format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(b"<svg>root brand</svg>")
            ))
        );
        fs::remove_file(base.join("logo.svg")).unwrap();
        fs::remove_file(base.join("public/assets/logo.svg")).unwrap();
        assert!(workspace_info(&base)
            .logo
            .unwrap()
            .starts_with("data:image/x-icon;base64,"));
        fs::remove_file(base.join("favicon.ico")).unwrap();
        assert!(workspace_info(&base).logo.is_none());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn logo_scan_ignores_generated_assets_and_bounds_image_reads() {
        let base = std::env::temp_dir().join(format!("devyy-logo-bounds-{}", std::process::id()));
        fs::create_dir_all(base.join("node_modules/package")).unwrap();
        let base = base.canonicalize().unwrap();
        fs::write(base.join("node_modules/package/logo.svg"), b"<svg/>").unwrap();
        let oversized = fs::File::create(base.join("logo.png")).unwrap();
        oversized.set_len(MAX_LOGO_BYTES + 1).unwrap();
        assert!(workspace_info(&base).logo.is_none());
        #[cfg(unix)]
        {
            let outside = base.with_extension("svg");
            fs::write(&outside, b"<svg/>").unwrap();
            std::os::unix::fs::symlink(&outside, base.join("logo.svg")).unwrap();
            assert!(workspace_info(&base).logo.is_none());
            fs::remove_file(outside).unwrap();
        }
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn saving_refuses_external_changes_and_preserves_disk_content() {
        let base = std::env::temp_dir().join(format!("devyy-save-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        fs::write(base.join("main.rs"), "original").unwrap();
        let doc = read_document(&base, "main.rs").unwrap();
        let stamp = write_document(&base, "main.rs", "saved", &doc.modified).unwrap();
        assert_eq!(fs::read_to_string(base.join("main.rs")).unwrap(), "saved");
        fs::write(base.join("main.rs"), "changed externally").unwrap();
        assert!(write_document(&base, "main.rs", "would overwrite", &stamp).is_err());
        assert_eq!(
            fs::read_to_string(base.join("main.rs")).unwrap(),
            "changed externally"
        );
        fs::write(base.join("binary"), [0, 1, 2]).unwrap();
        assert!(read_document(&base, "binary").is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn explorer_budget_never_hides_root_siblings() {
        let folder = tempfile::tempdir().unwrap();
        let base = folder.path();
        fs::create_dir_all(base.join(".cache/deep")).unwrap();
        for n in 0..40 {
            fs::write(base.join(format!(".cache/deep/{n}")), "").unwrap();
        }
        fs::create_dir(base.join("src")).unwrap();
        fs::write(base.join("src/main.rs"), "").unwrap();
        fs::write(base.join("README.md"), "").unwrap();
        let listed = explorer_entries(base, 20, 12);
        assert!(listed.iter().any(|e| e.path == "README.md"));
        assert!(listed.iter().any(|e| e.path == "src/main.rs"));
        assert_eq!(listed.len(), 12);
    }
    #[test]
    fn file_listing_respects_gitignore_and_excludes_generated_directories() {
        let base = std::env::temp_dir().join(format!("devyy-list-test-{}", std::process::id()));
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::create_dir_all(base.join("target")).unwrap();
        fs::write(base.join(".gitignore"), "secret.txt\n").unwrap();
        fs::write(base.join("secret.txt"), "secret").unwrap();
        fs::write(base.join("target/generated.rs"), "generated").unwrap();
        fs::write(base.join("main.rs"), "fn main() {}").unwrap();
        let listed = entries(&base);
        assert!(listed.iter().any(|f| f.path == "main.rs"));
        assert!(!listed.iter().any(|f| f.path == "secret.txt"
            || f.path.starts_with("target")
            || f.path.starts_with(".git/")));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn explorer_includes_ignored_files_and_loads_generated_children_on_demand() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::create_dir_all(base.join("target/debug")).unwrap();
        fs::write(base.join(".gitignore"), "secret.txt\ntarget/\n").unwrap();
        fs::write(base.join("secret.txt"), "secret").unwrap();
        fs::write(base.join("target/debug/app"), "binary").unwrap();
        let listed = explorer_entries(&base, 20, 30_000);
        assert!(listed.iter().any(|e| e.path == "secret.txt"));
        assert!(listed.iter().any(|e| e.path == "target" && e.directory));
        assert!(!listed
            .iter()
            .any(|e| e.path.starts_with("target/") || e.path.starts_with(".git/")));
        assert_eq!(
            directory_entries(&base, "target").unwrap()[0].path,
            "target/debug"
        );
        assert!(directory_entries(&base, "../").is_err());
        assert!(!entries(&base).iter().any(|e| e.path == "secret.txt"));
    }
    #[test]
    fn prevents_workspace_traversal() {
        let base = std::env::temp_dir().canonicalize().unwrap();
        for path in ["../secret", "/etc/passwd", "", ".", "a/../../secret"] {
            assert!(resolve(&base, path, true).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn prevents_symlink_escape() {
        let base = std::env::temp_dir().join(format!("devyy-path-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        std::os::unix::fs::symlink("/", base.join("outside")).unwrap();
        assert!(resolve(&base.canonicalize().unwrap(), "outside/etc/passwd", false).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}

#[cfg(test)]
mod opening_tests {
    use super::*;
    #[test]
    fn opening_uses_a_bounded_snapshot_and_new_file_saves_never_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(base.join("src/deep/nested")).unwrap();
        std::fs::write(base.join("src/main.rs"), "main").unwrap();
        std::fs::write(base.join("src/deep/nested/lib.rs"), "deep").unwrap();
        let early = scan_entries(&base, 2, 2048);
        assert!(early.iter().any(|f| f.path == "src/main.rs"));
        assert!(!early.iter().any(|f| f.path == "src/deep/nested/lib.rs"));
        assert!(entries(&base)
            .iter()
            .any(|f| f.path == "src/deep/nested/lib.rs"));
        let stamp = write_document(&base, "new.rs", "new content", "devyy:new").unwrap();
        assert!(!stamp.is_empty());
        assert!(write_document(&base, "new.rs", "overwrite", "devyy:new").is_err());
        assert_eq!(
            std::fs::read_to_string(base.join("new.rs")).unwrap(),
            "new content"
        );
    }
    #[test]
    #[ignore = "Developer performance measurement against the current workspace"]
    fn benchmark_open_snapshot() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let early = explorer_entries(base, 2, 2048);
            let elapsed = start.elapsed();
            let start = std::time::Instant::now();
            let all = explorer_entries(base, 20, 30_000);
            println!(
                "snapshot: {} entries in {:?}; full index: {} entries in {:?}",
                early.len(),
                elapsed,
                all.len(),
                start.elapsed()
            );
        }
    }
}
