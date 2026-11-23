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

use serde::Serialize;
#[cfg(target_os = "linux")]
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
#[cfg(windows)]
use tauri_plugin_opener::OpenerExt;
fn types() -> impl Iterator<Item = (&'static str, &'static str)> {
    crate::file_types::types().iter().flat_map(|file_type| {
        file_type
            .ext
            .iter()
            .map(|ext| (ext.as_str(), file_type.mime_type.as_str()))
    })
}
const APP_ID: &str = "xyz.devyy.editor";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    extension: String,
    mime: String,
    handler: Option<String>,
    is_default: bool,
}
fn mime(extension: &str) -> Result<&'static str, String> {
    types()
        .find(|(ext, _)| *ext == extension)
        .map(|(_, mime)| mime)
        .ok_or("Unsupported file extension".into())
}
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_void, CString};
    type CF = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: CF,
            text: *const std::ffi::c_char,
            encoding: u32,
        ) -> CF;
        fn CFStringGetCString(
            string: CF,
            buffer: *mut std::ffi::c_char,
            size: isize,
            encoding: u32,
        ) -> bool;
        fn CFRelease(value: CF);
    }
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn UTTypeCreatePreferredIdentifierForTag(class: CF, tag: CF, conforms: CF) -> CF;
        fn LSCopyDefaultRoleHandlerForContentType(uti: CF, roles: u32) -> CF;
        fn LSSetDefaultRoleHandlerForContentType(uti: CF, roles: u32, bundle: CF) -> i32;
    }
    struct Owned(CF);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }
    fn string(text: &str) -> Result<Owned, String> {
        let text = CString::new(text).map_err(|e| e.to_string())?;
        let value =
            unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), 0x08000100) };
        if value.is_null() {
            Err("Could not create association identifier".into())
        } else {
            Ok(Owned(value))
        }
    }
    fn uti(extension: &str) -> Result<Owned, String> {
        let tag = string("public.filename-extension")?;
        let ext = string(extension)?;
        let value =
            unsafe { UTTypeCreatePreferredIdentifierForTag(tag.0, ext.0, std::ptr::null()) };
        if value.is_null() {
            Err("Could not resolve the file type".into())
        } else {
            Ok(Owned(value))
        }
    }
    pub fn handler(extension: &str) -> Result<Option<String>, String> {
        let uti = uti(extension)?;
        let value = Owned(unsafe { LSCopyDefaultRoleHandlerForContentType(uti.0, 0xffffffff) });
        if value.0.is_null() {
            return Ok(None);
        }
        let mut buffer = vec![0i8; 4096];
        if !unsafe {
            CFStringGetCString(
                value.0,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                0x08000100,
            )
        } {
            return Err("Could not read the default application".into());
        }
        Ok(Some(
            unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }
                .to_string_lossy()
                .into(),
        ))
    }
    pub fn set(extension: &str) -> Result<(), String> {
        let uti = uti(extension)?;
        let bundle = string(super::APP_ID)?;
        let status = unsafe { LSSetDefaultRoleHandlerForContentType(uti.0, 0xffffffff, bundle.0) };
        if status != 0 {
            Err(format!("macOS could not set this association (error {status}). Install Devyy in Applications, then try again."))
        } else {
            Ok(())
        }
    }
}
fn handler(extension: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        mac::handler(extension).ok().flatten()
    }
    #[cfg(target_os = "linux")]
    {
        crate::process::command("xdg-mime")
            .args(["query", "default", mime(extension).ok()?])
            .output()
            .ok()
            .filter(|r| r.status.success())
            .map(|r| String::from_utf8_lossy(&r.stdout).trim().into())
    }
    #[cfg(windows)]
    {
        crate::windows_file_associations::handler(extension)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        let _ = extension;
        None
    }
}
#[tauri::command]
pub async fn default_app_status() -> Result<Vec<Association>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        types()
            .map(|(extension, mime)| {
                let handler = handler(extension);
                let is_default = handler.as_deref().is_some_and(|id| {
                    id == APP_ID
                        || id.starts_with("xyz.devyy.editor.")
                        || id.starts_with("app.devvy.editor.")
                        || id == "devyy.desktop"
                        || id.starts_with("Devyy.")
                        || id.eq_ignore_ascii_case("Applications\\devyy.exe")
                });
                Association {
                    extension: extension.to_string(),
                    mime: mime.to_string(),
                    handler,
                    is_default,
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}
#[cfg(target_os = "linux")]
fn register_linux(extension: &str) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("Home directory unavailable")?;
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(home).join(".local/share"));
    let applications = data.join("applications");
    std::fs::create_dir_all(&applications).map_err(|e| e.to_string())?;
    let executable = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_exe().map_err(|e| e.to_string())?);
    let exec = executable
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('%', "%%")
        .replace(['\n', '\r'], "");
    let mime_types = types().map(|(_, mime)| mime).collect::<Vec<_>>().join(";");
    let icons = data.join("icons/hicolor/128x128/apps");
    std::fs::create_dir_all(&icons).map_err(|e| e.to_string())?;
    std::fs::write(
        icons.join("devyy.png"),
        include_bytes!("../icons/128x128.png"),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(applications.join("devyy.desktop"),format!("[Desktop Entry]\nType=Application\nName=Devyy\nExec=\"{exec}\" %F\nIcon=devyy\nTerminal=false\nCategories=Development;IDE;\nMimeType={mime_types};\n")).map_err(|e|e.to_string())?;
    let mime_root = data.join("mime");
    let packages = mime_root.join("packages");
    std::fs::create_dir_all(&packages).map_err(|e| e.to_string())?;
    std::fs::write(packages.join(format!("devyy-{extension}.xml")),format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><mime-info xmlns=\"http://www.freedesktop.org/standards/shared-mime-info\"><mime-type type=\"{}\"><comment>{extension} source or document</comment><glob pattern=\"*.{extension}\" weight=\"60\"/></mime-type></mime-info>",mime(extension)?)).map_err(|e|e.to_string())?;
    if !crate::process::command("update-mime-database")
        .arg(&mime_root)
        .output()
        .map_err(|_| "Install shared-mime-info to register this file type".to_string())?
        .status
        .success()
    {
        return Err("The desktop could not register this MIME type".into());
    }
    let _ = crate::process::command("update-desktop-database")
        .arg(&applications)
        .status();
    Ok(())
}
#[cfg(windows)]
fn register_windows(extension: Option<&str>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    crate::windows_file_associations::register(&exe, extension, None)
        .map_err(|error| format!("Could not register Devyy in Windows: {error}"))
}
#[tauri::command]
pub async fn set_default_app(
    app: AppHandle,
    extension: String,
) -> Result<serde_json::Value, String> {
    mime(&extension)?;
    let selected = extension.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            mac::set(&selected)?;
        }
        #[cfg(target_os = "linux")]
        {
            register_linux(&selected)?;
            if !crate::process::command("xdg-mime")
                .args(["default", "devyy.desktop", mime(&selected)?])
                .status()
                .map_err(|e| e.to_string())?
                .success()
            {
                return Err("The desktop could not update its MIME association".into());
            }
        }
        #[cfg(windows)]
        {
            register_windows(Some(&selected))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    #[cfg(windows)]
    {
        app.opener()
            .open_url(
                "ms-settings:defaultapps?registeredAppUser=Devyy",
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::json!({"changed":false,"openedSettings":true}));
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(
            serde_json::json!({"changed":handler(&extension).as_deref().is_some_and(|id|id==APP_ID||id=="devyy.desktop"),"openedSettings":false}),
        )
    }
}
#[tauri::command]
pub async fn set_all_default_apps(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            for (ext, _) in types() {
                let _ = mac::set(ext);
            }
        }
        #[cfg(target_os = "linux")]
        {
            for (ext, _) in types() {
                let _ = register_linux(ext);
                if let Ok(m) = mime(ext) {
                    let _ = crate::process::command("xdg-mime")
                        .args(["default", "devyy.desktop", m])
                        .status();
                }
            }
        }
        #[cfg(windows)]
        {
            register_windows(None)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    #[cfg(windows)]
    {
        app.opener()
            .open_url(
                "ms-settings:defaultapps?registeredAppUser=Devyy",
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::json!({"changed":false,"openedSettings":true}));
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(serde_json::json!({"changed":true,"openedSettings":false}))
    }
}
#[derive(Default)]
pub struct OpenTargets(pub std::sync::Mutex<Vec<String>>);
pub fn launch_paths(
    arguments: impl IntoIterator<Item = impl Into<std::ffi::OsString>>,
    cwd: &std::path::Path,
) -> Vec<String> {
    arguments
        .into_iter()
        .map(Into::into)
        .filter(|argument| !argument.is_empty() && !argument.to_string_lossy().starts_with('-'))
        .map(|argument| {
            let path = std::path::PathBuf::from(argument);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
            .to_string_lossy()
            .into_owned()
        })
        .collect()
}
pub fn enqueue(app: &AppHandle, paths: Vec<String>) {
    use tauri::Emitter;
    let paths: Vec<_> = paths
        .into_iter()
        .filter(|p| std::path::Path::new(p).exists())
        .take(32)
        .collect();
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = app.state::<OpenTargets>().0.lock() {
        pending.extend(paths);
        pending.truncate(64);
    }
    let _ = app.emit("devyy-open-targets", ());
}
#[derive(Serialize)]
pub struct OpenTarget {
    path: String,
    directory: bool,
}
#[tauri::command]
pub fn take_open_targets(state: tauri::State<'_, OpenTargets>) -> Vec<OpenTarget> {
    state
        .0
        .lock()
        .map(|mut p| std::mem::take(&mut *p))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| {
            let full = std::path::PathBuf::from(path).canonicalize().ok()?;
            Some(OpenTarget {
                path: crate::workspace::display_path(&full),
                directory: full.is_dir(),
            })
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secondary_launches_resolve_files_against_the_callers_directory() {
        let cwd = tempfile::tempdir().unwrap();
        let file = cwd.path().join("source file.rs");
        std::fs::write(&file, "source").unwrap();
        let targets = launch_paths(
            vec!["source file.rs", "--wait", &file.to_string_lossy()],
            cwd.path(),
        );
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0], file.to_string_lossy());
        assert_eq!(targets[0], targets[1]);
    }
    #[test]
    fn association_types_are_explicit() {
        for supported in ["rs", "mjs", "jsonc", "yml", "vue", "cpp", "ps1", "csv"] {
            assert!(mime(supported).is_ok(), "{supported} should be associated");
        }
        for invalid in ["../../shell", "exe", "rs\nExec=evil", ".rs", ""] {
            assert!(mime(invalid).is_err());
        }
    }
}
