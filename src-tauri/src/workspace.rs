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
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Open a folder first".into())
}
// All frontend paths are workspace-relative. Canonicalization prevents symlink escapes.
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
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = m
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(format!("{}:{}", modified.as_nanos(), m.len()))
}
fn entries(base: &Path) -> Vec<Entry> {
    let mut out: Vec<Entry> = WalkBuilder::new(base)
        .hidden(false)
        .max_depth(Some(20))
        .filter_entry(|e| {
            !matches!(
                e.file_name().to_str(),
                Some(".git" | "node_modules" | "target" | ".next" | "dist")
            )
        })
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.path() != base)
        .take(30_000)
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
    out.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    out
}

// Reuse the bounded, ignore-aware project listing. Prefer actual logos over app
// icons/favicons, and top-level assets over logos in nested example projects.
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
            let stem = path.file_stem()?.to_str()?.to_lowercase();
            let ext = path.extension()?.to_str()?.to_lowercase();
            let (format, mime) = match ext.as_str() {
                "svg" => (0, "image/svg+xml"),
                "png" => (1, "image/png"),
                "webp" => (2, "image/webp"),
                "jpg" | "jpeg" => (3, "image/jpeg"),
                "ico" => (4, "image/x-icon"),
                _ => return None,
            };
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
    let files = entries(base);
    let logo = project_logo(base, &files);
    WorkspaceInfo {
        root: base.to_string_lossy().into(),
        name: base
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        files,
        logo,
    }
}
#[tauri::command]
pub async fn open_workspace(
    path: String,
    state: State<'_, Workspace>,
) -> Result<WorkspaceInfo, String> {
    let base = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !base.is_dir() {
        return Err("Choose a folder".into());
    }
    let info = workspace_info(&base);
    *state.0.lock().map_err(|e| e.to_string())? = Some(base);
    Ok(info)
}
#[tauri::command]
pub async fn refresh_workspace(state: State<'_, Workspace>) -> Result<WorkspaceInfo, String> {
    Ok(workspace_info(&root(&state)?))
}
#[tauri::command]
pub async fn list_files(state: State<'_, Workspace>) -> Result<Vec<Entry>, String> {
    Ok(entries(&root(&state)?))
}
#[tauri::command]
pub async fn read_file(path: String, state: State<'_, Workspace>) -> Result<Document, String> {
    read_document(&root(&state)?, &path)
}
fn read_document(base: &Path, path: &str) -> Result<Document, String> {
    let full = resolve(base, path, false)?;
    if fs::metadata(&full).map_err(|e| e.to_string())?.len() > 5_000_000 {
        return Err("This file exceeds the 5 MB editing limit".into());
    }
    let content = fs::read_to_string(&full).map_err(|e| e.to_string())?;
    if content.contains('\0') {
        return Err("Binary files cannot be opened in the text editor".into());
    }
    Ok(Document {
        content,
        modified: stamp(&full)?,
    })
}
#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    expected: String,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    write_document(&root(&state)?, &path, &content, &expected)
}
fn write_document(
    base: &Path,
    path: &str,
    content: &str,
    expected: &str,
) -> Result<String, String> {
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
    let full = resolve(&root(&state)?, &path, true)?;
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
    let from = resolve(&base, &path, false)?;
    let to = resolve(&base, &new_path, true)?;
    if to.exists() {
        return Err("A file already exists at that path".into());
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_file(path: String, state: State<'_, Workspace>) -> Result<(), String> {
    let full = resolve(&root(&state)?, &path, false)?;
    // Empty directories only: a typo can never recursively remove a project.
    if full.is_dir() {
        fs::remove_dir(full)
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
                let hay = if options.case_sensitive {
                    text.to_string()
                } else {
                    text.to_lowercase()
                };
                if let Some(column) = hay.find(&needle) {
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

#[cfg(test)]
mod tests {
    use super::*;
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
        // A decodable 1px PNG with trailing padding reproduces the old size cutoff.
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
        // A corrupt higher-ranked image must not hide a valid logo.
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
