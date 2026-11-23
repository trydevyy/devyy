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
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const APP_ID: &str = "xyz.devyy.editor";
const MANIFEST: &str = ".devyy-install.json";
const LIMIT: u64 = 1024 * 1024 * 1024;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Linux,
    Macos,
}
impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else {
            Self::Linux
        }
    }
}
fn default_explorer_context_menu() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub directory: PathBuf,
    pub desktop: bool,
    pub menu: bool,
    #[serde(default = "default_explorer_context_menu")]
    pub explorer_context_menu: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub id: String,
    pub version: String,
    pub directory: PathBuf,
    pub files: Vec<PathBuf>,
    pub desktop: bool,
    pub menu: bool,
    #[serde(default = "default_explorer_context_menu")]
    pub explorer_context_menu: bool,
    pub platform: Platform,
    pub uninstaller: String,
    pub payload_sha256: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub detail: String,
    pub percent: f64,
}
pub struct Environment {
    pub platform: Platform,
    pub home: PathBuf,
    pub local: PathBuf,
    pub desktop: PathBuf,
    pub uninstaller: PathBuf,
}
impl Environment {
    pub fn current() -> Result<Self, String> {
        let platform = Platform::current();
        let home = std::env::var_os(if platform == Platform::Windows {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .map(PathBuf::from)
        .ok_or("Your home folder could not be found")?;
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local"));
        let desktop = if platform == Platform::Linux {
            std::process::Command::new("xdg-user-dir")
                .arg("DESKTOP")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|v| PathBuf::from(v.trim()))
                .filter(|p| p.is_absolute() && p != &home)
                .unwrap_or_else(|| home.join("Desktop"))
        } else {
            home.join("Desktop")
        };
        let uninstaller = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .unwrap_or(std::env::current_exe().map_err(|e| e.to_string())?);
        Ok(Self {
            platform,
            home,
            local,
            desktop,
            uninstaller,
        })
    }
    pub fn default_directory(&self) -> PathBuf {
        match self.platform {
            Platform::Windows => self.local.join("Programs/Devyy"),
            Platform::Linux => self.home.join(".local/opt/devyy"),
            Platform::Macos => PathBuf::from("/Applications/Devyy.app"),
        }
    }
}
fn emit(progress: &impl Fn(Progress), phase: &str, detail: impl Into<String>, percent: f64) {
    progress(Progress {
        phase: phase.into(),
        detail: detail.into(),
        percent,
    });
}
fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path.components().all(|c| matches!(c, Component::Normal(_)))
        && !path.to_string_lossy().contains(['\0', ':'])
}
fn no_symlink_ancestors(root: &Path, relative: &Path) -> Result<(), String> {
    let mut path = root.to_path_buf();
    for component in relative
        .components()
        .take(relative.components().count().saturating_sub(1))
    {
        path.push(component);
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(
                "An installation folder contains a symbolic link. Choose a different location."
                    .into(),
            );
        }
    }
    Ok(())
}
pub fn read_manifest(root: &Path) -> Result<Manifest, String> {
    let meta = fs::symlink_metadata(root.join(MANIFEST))
        .map_err(|_| "This folder is not a Devyy installation")?;
    if meta.file_type().is_symlink() || meta.len() > 1024 * 1024 {
        return Err("The installation record is invalid".into());
    }
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(root.join(MANIFEST)).map_err(|e| e.to_string())?)
            .map_err(|_| "The installation record is invalid")?;
    let canonical = canonical(root)?;
    if manifest.schema != 1
        || manifest.id != APP_ID
        || manifest.directory != canonical
        || manifest.files.len() > 10000
        || manifest.files.iter().any(|p| !safe_relative(p))
        || !safe_relative(Path::new(&manifest.uninstaller))
    {
        return Err("The installation record does not match this folder".into());
    }
    Ok(manifest)
}
pub(crate) fn canonical(path: &Path) -> Result<PathBuf, String> {
    let result = fs::canonicalize(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let value = result.to_string_lossy();
        if let Some(tail) = value.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{tail}")));
        }
        if let Some(tail) = value.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(tail));
        }
    }
    Ok(result)
}
fn reject_unmanaged_files(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                pending.push(path);
            } else if relative != Path::new(MANIFEST)
                && !manifest.files.iter().any(|file| file == relative)
            {
                return Err("This installation contains added files. Move them to another folder before updating Devyy.".into());
            }
        }
    }
    Ok(())
}
pub fn validate_destination(path: &Path, environment: &Environment) -> Result<(), String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path == environment.home
        || path == environment.desktop
        || path
            .to_string_lossy()
            .contains(['\n', '\r', '\0', '"', '%'])
        || path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Choose a dedicated Devyy folder with an absolute path".into());
    }
    let mut ancestor = Some(path);
    while let Some(p) = ancestor {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Choose an installation folder without symbolic links".into());
        }
        ancestor = p.parent();
    }
    if path.exists()
        && fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        let manifest=read_manifest(path).map_err(|_|"This folder contains other files. Choose an empty folder or an existing Devyy installation.")?;
        reject_unmanaged_files(path, &manifest)?;
    }
    Ok(())
}
fn executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn install(
    environment: &Environment,
    options: &Options,
    payload: &[u8],
    version: &str,
    progress: impl Fn(Progress),
) -> Result<Manifest, String> {
    if environment.platform == Platform::Macos {
        return Err("Use the Devyy disk image on macOS".into());
    }
    validate_destination(&options.directory, environment)?;
    let previous_manifest = read_manifest(&options.directory).ok();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(payload))
        .map_err(|_| "This installer does not contain a valid Devyy download")?;
    if archive.len() == 0 || archive.len() > 10000 {
        return Err("The Devyy package is incomplete".into());
    }
    let total: u64 = (0..archive.len())
        .map(|i| archive.by_index(i).map(|f| f.size()).unwrap_or(LIMIT + 1))
        .try_fold(0u64, |sum, n| sum.checked_add(n))
        .ok_or("The Devyy package is too large")?;
    if total > LIMIT {
        return Err("The Devyy package is too large".into());
    }
    let parent = options
        .directory
        .parent()
        .ok_or("Choose an installation folder")?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create the installation folder: {e}"))?;
    let stage = tempfile::Builder::new()
        .prefix(".devyy-install-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    let mut copied = 0u64;
    emit(&progress, "copy", "Preparing Devyy", 0.0);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().contains('\\') {
            return Err("The package contains an invalid file path".into());
        }
        let relative = entry
            .enclosed_name()
            .filter(|p| safe_relative(p))
            .ok_or("The package contains an invalid file path")?;
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("The package contains a symbolic link".into());
        }
        let relative = PathBuf::from("app").join(relative);
        let destination = stage.path().join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
            continue;
        }
        fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "The package contains conflicting files")?;
        let mut buffer = [0u8; 128 * 1024];
        loop {
            let n = entry
                .read(&mut buffer)
                .map_err(|_| "The Devyy package could not be read")?;
            if n == 0 {
                break;
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            copied += n as u64;
            if copied > LIMIT {
                return Err("The Devyy package is too large".into());
            }
            emit(
                &progress,
                "copy",
                format!(
                    "Copying {}",
                    relative.file_name().unwrap().to_string_lossy()
                ),
                copied as f64 / total.max(1) as f64 * 78.0,
            );
        }
        files.push(relative);
    }
    let app = match environment.platform {
        Platform::Windows => "app/devyy.exe",
        _ => "app/devyy.AppImage",
    };
    if !stage.path().join(app).is_file() {
        return Err("This Devyy package was built for another operating system".into());
    }
    executable(&stage.path().join(app))?;
    let uninstaller = if environment.platform == Platform::Windows {
        "Uninstall Devyy.exe"
    } else if environment
        .uninstaller
        .extension()
        .is_some_and(|e| e == "AppImage")
    {
        "uninstall.AppImage"
    } else {
        "devyy-uninstaller"
    };
    fs::copy(&environment.uninstaller, stage.path().join(uninstaller))
        .map_err(|e| format!("Could not prepare the uninstaller: {e}"))?;
    executable(&stage.path().join(uninstaller))?;
    files.push(uninstaller.into());
    fs::write(
        stage.path().join("devyy.png"),
        include_bytes!("../../assets/devyy.png"),
    )
    .map_err(|e| e.to_string())?;
    files.push("devyy.png".into());
    fs::write(
        stage.path().join("LICENSE"),
        include_bytes!("../../../LICENSE"),
    )
    .map_err(|e| e.to_string())?;
    files.push("LICENSE".into());
    if environment.platform == Platform::Linux {
        let launcher=format!("#!/bin/sh\n# Devyy installer\nDEVYY_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexport APPIMAGE_EXTRACT_AND_RUN=1\nexec \"$DEVYY_DIR/app/devyy.AppImage\" \"$@\"\n");
        fs::write(stage.path().join("devyy"), launcher).map_err(|e| e.to_string())?;
        executable(&stage.path().join("devyy"))?;
        files.push("devyy".into());
        let uninstall=format!("#!/bin/sh\n# Devyy installer\nDEVYY_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexport APPIMAGE_EXTRACT_AND_RUN=1\nexec \"$DEVYY_DIR/{uninstaller}\" --uninstall --install-dir \"$DEVYY_DIR\" \"$@\"\n");
        fs::write(stage.path().join("uninstall.sh"), uninstall).map_err(|e| e.to_string())?;
        executable(&stage.path().join("uninstall.sh"))?;
        files.push("uninstall.sh".into());
    } else {
        fs::write(
            stage.path().join("uninstall.ps1"),
            include_bytes!("../../scripts/uninstall.ps1"),
        )
        .map_err(|e| e.to_string())?;
        files.push("uninstall.ps1".into());
    }
    let backup = tempfile::Builder::new()
        .prefix(".devyy-previous-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let previous = backup.path().join("installation");
    let existed = options.directory.exists();
    if existed {
        fs::rename(&options.directory, &previous)
            .map_err(|e| format!("Close Devyy and try again: {e}"))?;
    }
    if let Err(error) = fs::rename(stage.path(), &options.directory) {
        if existed {
            let _ = fs::rename(&previous, &options.directory);
        }
        return Err(format!("Could not install Devyy: {error}"));
    }
    let root = canonical(&options.directory)?;
    let manifest = Manifest {
        schema: 1,
        id: APP_ID.into(),
        version: version.into(),
        directory: root.clone(),
        files,
        desktop: options.desktop,
        menu: options.menu,
        explorer_context_menu: options.explorer_context_menu,
        platform: environment.platform,
        uninstaller: uninstaller.into(),
        payload_sha256: format!("{:x}", Sha256::digest(payload)),
    };
    let result = (|| {
        fs::write(
            root.join(MANIFEST),
            serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        emit(
            &progress,
            "register",
            "Adding shortcuts and app registration",
            86.0,
        );
        if let Some(old) = &previous_manifest {
            unregister(environment, old)?;
        }
        register(environment, &manifest)?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let _ = unregister(environment, &manifest);
        let _ = fs::remove_dir_all(&root);
        if existed {
            let _ = fs::rename(&previous, &options.directory);
            if let Some(old) = &previous_manifest {
                let _ = register(environment, old);
            }
        }
        return Err(error);
    }
    emit(&progress, "done", "Devyy is ready", 100.0);
    Ok(manifest)
}
fn quoted(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('`', "\\`")
            .replace('$', "\\$")
    )
}
fn marker(root: &Path) -> String {
    format!("X-Devyy-Install-Root={}", root.display())
}
fn owned_write(path: &Path, content: &str, marker: &str) -> Result<(), String> {
    if let Ok(old) = fs::read_to_string(path) {
        if !old.contains(marker) {
            return Err(format!(
                "{} already belongs to another installation",
                path.display()
            ));
        }
    }
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("A shortcut path is a symbolic link".into());
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}
fn linux_entries(environment: &Environment, manifest: &Manifest) -> Vec<(PathBuf, String)> {
    let root = &manifest.directory;
    let identity = marker(root);
    let desktop=format!("[Desktop Entry]\nType=Application\nName=Devyy\nComment=A focused development environment\nExec={} %F\nIcon={}\nTerminal=false\nCategories=Development;IDE;\nMimeType=text/plain;x-scheme-handler/devyy;\nNoDisplay={}\n{}\n",quoted(&root.join("devyy")),root.join("devyy.png").display(),!manifest.menu,identity);
    let remove=format!("[Desktop Entry]\nType=Application\nName=Uninstall Devyy\nExec={}\nIcon={}\nTerminal=false\nCategories=Utility;\nNoDisplay={}\n{}\n",quoted(&root.join("uninstall.sh")),root.join("devyy.png").display(),!manifest.menu,identity);
    let launcher = format!(
        "#!/bin/sh\n# {identity}\nexec {} \"$@\"\n",
        quoted(&root.join("devyy"))
    );
    let mut entries = vec![
        (
            environment
                .home
                .join(".local/share/applications/devyy.desktop"),
            desktop.clone(),
        ),
        (
            environment
                .home
                .join(".local/share/applications/devyy-uninstall.desktop"),
            remove,
        ),
        (environment.home.join(".local/bin/devyy"), launcher),
    ];
    if manifest.desktop {
        entries.push((environment.desktop.join("devyy.desktop"), desktop));
    }
    entries
}
fn register(environment: &Environment, manifest: &Manifest) -> Result<(), String> {
    if environment.platform == Platform::Linux {
        for (path, content) in linux_entries(environment, manifest) {
            owned_write(&path, &content, &marker(&manifest.directory))?;
            executable(&path)?;
        }
    }
    #[cfg(windows)]
    if environment.platform == Platform::Windows {
        crate::windows::register(environment, manifest)?;
    }
    Ok(())
}
fn unregister(environment: &Environment, manifest: &Manifest) -> Result<(), String> {
    if environment.platform == Platform::Linux {
        for (path, _) in linux_entries(environment, manifest) {
            if fs::read_to_string(&path).is_ok_and(|value| {
                value.lines().any(|line| {
                    line == marker(&manifest.directory)
                        || line == format!("# {}", marker(&manifest.directory))
                })
            }) {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(windows)]
    if environment.platform == Platform::Windows {
        crate::windows::unregister(environment, manifest)?;
    }
    Ok(())
}
pub fn uninstall(
    environment: &Environment,
    directory: &Path,
    progress: impl Fn(Progress),
) -> Result<(), String> {
    let manifest = read_manifest(directory)?;
    if manifest.platform != environment.platform {
        return Err("This installation belongs to another operating system".into());
    }
    let root = &manifest.directory;
    for path in &manifest.files {
        no_symlink_ancestors(root, path)?;
    }
    #[cfg(windows)]
    for path in &manifest.files {
        use std::os::windows::fs::OpenOptionsExt;
        let target = root.join(path);
        if target.is_file() {
            let _file = fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(target)
                .map_err(|_| "Close Devyy and try again.")?;
        }
    }
    emit(
        &progress,
        "remove",
        "Removing shortcuts and app registration",
        5.0,
    );
    unregister(environment, &manifest)?;
    for (i, path) in manifest.files.iter().enumerate() {
        let target = root.join(path);
        if target.exists() || fs::symlink_metadata(&target).is_ok() {
            fs::remove_file(&target).map_err(|e| format!("Close Devyy and try again: {e}"))?;
        }
        emit(
            &progress,
            "remove",
            "Removing Devyy",
            5.0 + (i + 1) as f64 / manifest.files.len().max(1) as f64 * 90.0,
        );
    }
    fs::remove_file(root.join(MANIFEST)).map_err(|e| e.to_string())?;
    let mut folders: Vec<_> = manifest
        .files
        .iter()
        .flat_map(|p| {
            p.ancestors()
                .skip(1)
                .filter(|p| !p.as_os_str().is_empty())
                .map(Path::to_path_buf)
        })
        .collect();
    folders.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    folders.dedup();
    for folder in folders {
        let _ = fs::remove_dir(root.join(folder));
    }
    let _ = fs::remove_dir(root);
    emit(&progress, "done", "Devyy has been removed", 100.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, io::Cursor};
    use zip::write::SimpleFileOptions;
    fn payload(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, value) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(value.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn fixture() -> (tempfile::TempDir, Environment, Options) {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let uninstaller = base.join("installer");
        fs::write(&uninstaller, "installer-fixture").unwrap();
        let environment = Environment {
            platform: Platform::Linux,
            home: base.join("home"),
            local: base.join("home/.local"),
            desktop: base.join("home/Desktop"),
            uninstaller,
        };
        fs::create_dir_all(&environment.home).unwrap();
        let options = Options {
            directory: environment.default_directory(),
            desktop: true,
            menu: true,
            explorer_context_menu: true,
        };
        (temp, environment, options)
    }
    #[test]
    fn install_registers_real_launchers_and_uninstall_preserves_unmanaged_files() {
        let (_temp, environment, options) = fixture();
        let events = RefCell::new(Vec::new());
        let manifest = install(
            &environment,
            &options,
            &payload(&[
                ("devyy.AppImage", "ELF-fixture"),
                ("licenses/notice.txt", "license"),
            ]),
            "0.1.0",
            |p| events.borrow_mut().push(p.percent),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(options.directory.join("app/devyy.AppImage")).unwrap(),
            "ELF-fixture"
        );
        assert_eq!(manifest.payload_sha256.len(), 64);
        assert!(environment.desktop.join("devyy.desktop").is_file());
        assert!(environment
            .home
            .join(".local/share/applications/devyy-uninstall.desktop")
            .is_file());
        assert!(
            fs::read_to_string(environment.home.join(".local/bin/devyy"))
                .unwrap()
                .contains("exec")
        );
        assert!(events.borrow().windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(events.borrow().last(), Some(&100.0));
        fs::write(options.directory.join("my-project.txt"), "keep me").unwrap();
        uninstall(&environment, &options.directory, |_| {}).unwrap();
        assert!(!options.directory.join("app/devyy.AppImage").exists());
        assert!(!environment.desktop.join("devyy.desktop").exists());
        assert_eq!(
            fs::read_to_string(options.directory.join("my-project.txt")).unwrap(),
            "keep me"
        );
    }
    #[test]
    fn refuses_unrelated_install_folders_and_package_traversal() {
        let (_temp, environment, options) = fixture();
        fs::create_dir_all(&options.directory).unwrap();
        fs::write(options.directory.join("keep.txt"), "original").unwrap();
        assert!(install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "app")]),
            "1",
            |_| {}
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(options.directory.join("keep.txt")).unwrap(),
            "original"
        );
        fs::remove_file(options.directory.join("keep.txt")).unwrap();
        assert!(install(
            &environment,
            &options,
            &payload(&[("../../escape", "bad"), ("devyy.AppImage", "app")]),
            "1",
            |_| {}
        )
        .is_err());
        assert!(!options.directory.parent().unwrap().join("escape").exists());
        assert!(fs::read_dir(&options.directory).unwrap().next().is_none());
    }
    #[test]
    fn updates_owned_installations_but_never_discards_added_files() {
        let (_temp, environment, options) = fixture();
        install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "old")]),
            "1",
            |_| {},
        )
        .unwrap();
        install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "new")]),
            "2",
            |_| {},
        )
        .unwrap();
        assert_eq!(read_manifest(&options.directory).unwrap().version, "2");
        fs::write(options.directory.join("notes.txt"), "mine").unwrap();
        assert!(install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "would replace")]),
            "3",
            |_| {}
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(options.directory.join("app/devyy.AppImage")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(options.directory.join("notes.txt")).unwrap(),
            "mine"
        );
    }
    #[test]
    fn shortcut_conflicts_roll_back_the_install_without_overwriting_user_files() {
        let (_temp, environment, options) = fixture();
        let bin = environment.home.join(".local/bin/devyy");
        fs::create_dir_all(bin.parent().unwrap()).unwrap();
        fs::write(&bin, "user-script").unwrap();
        assert!(install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "app")]),
            "1",
            |_| {}
        )
        .is_err());
        assert!(!options.directory.exists());
        assert_eq!(fs::read_to_string(bin).unwrap(), "user-script");
        assert!(!environment.desktop.join("devyy.desktop").exists());
    }
    #[test]
    fn uninstall_rejects_a_tampered_manifest() {
        let (_temp, environment, options) = fixture();
        let mut manifest = install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "app")]),
            "1",
            |_| {},
        )
        .unwrap();
        manifest.files.push("../outside".into());
        fs::write(
            options.directory.join(MANIFEST),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(uninstall(&environment, &options.directory, |_| {}).is_err());
        assert!(environment.desktop.join("devyy.desktop").exists());
    }
    #[cfg(unix)]
    #[test]
    fn uninstall_refuses_to_follow_replaced_subfolders() {
        let (_temp, environment, options) = fixture();
        install(
            &environment,
            &options,
            &payload(&[("devyy.AppImage", "app")]),
            "1",
            |_| {},
        )
        .unwrap();
        let external = environment.home.join("outside");
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("devyy.AppImage"), "external").unwrap();
        fs::remove_dir_all(options.directory.join("app")).unwrap();
        std::os::unix::fs::symlink(&external, options.directory.join("app")).unwrap();
        assert!(uninstall(&environment, &options.directory, |_| {}).is_err());
        assert_eq!(
            fs::read_to_string(external.join("devyy.AppImage")).unwrap(),
            "external"
        );
    }
}
