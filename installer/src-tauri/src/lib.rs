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

pub mod engine;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;
use engine::{Environment, Options, Platform, Progress};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};
const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/devyy.zip"));
const VERSION: &str = env!("DEVYY_PACKAGE_VERSION");
#[derive(Default)]
struct State {
    busy: Mutex<bool>,
    installed: Mutex<Option<PathBuf>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    platform: Platform,
    version: String,
    directory: PathBuf,
    uninstall: bool,
    has_payload: bool,
    installed: bool,
    mac_source: Option<PathBuf>,
}
fn directory_arg() -> Option<PathBuf> {
    let args: Vec<_> = std::env::args_os().collect();
    args.windows(2)
        .find(|w| w[0] == "--install-dir")
        .map(|w| PathBuf::from(&w[1]))
}
fn uninstall_mode() -> bool {
    std::env::args_os().any(|v| v == "--uninstall")
}
#[tauri::command]
fn installer_info(app: tauri::AppHandle) -> Result<Info, String> {
    let environment = Environment::current()?;
    let directory = directory_arg().unwrap_or_else(|| environment.default_directory());
    #[cfg(target_os = "macos")]
    let mac_source = macos::source();
    #[cfg(not(target_os = "macos"))]
    let mac_source = None;
    #[cfg(not(target_os = "macos"))]
    let installed = engine::read_manifest(&directory).is_ok();
    #[cfg(target_os = "macos")]
    let installed = mac_source
        .as_ref()
        .is_some_and(|source| macos::installed(source));
    if installed {
        #[cfg(target_os = "macos")]
        let root = macos::destination();
        #[cfg(not(target_os = "macos"))]
        let root = directory.clone();
        *app.state::<State>()
            .installed
            .lock()
            .map_err(|e| e.to_string())? = Some(root);
    }
    Ok(Info {
        mac_source: mac_source.clone(),
        platform: environment.platform,
        version: VERSION.into(),
        installed,
        directory,
        uninstall: uninstall_mode(),
        has_payload: env!("DEVYY_HAS_PAYLOAD") == "1" || mac_source.is_some(),
    })
}
#[tauri::command]
async fn installer_validate_directory(directory: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        engine::validate_destination(&directory, &Environment::current()?)
    })
    .await
    .map_err(|e| e.to_string())?
}
struct Lease<'a>(&'a Mutex<bool>);
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        if let Ok(mut busy) = self.0.lock() {
            *busy = false;
        }
    }
}
#[tauri::command]
async fn installer_install(app: tauri::AppHandle, options: Options) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        {
            let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
            if *busy {
                return Err("An installation is already running".into());
            }
            *busy = true;
        }
        let _lease = Lease(&state.busy);
        let environment = Environment::current()?;
        let manifest = engine::install(&environment, &options, PAYLOAD, VERSION, |progress| {
            let _ = app.emit("installer-progress", progress);
        })?;
        *state.installed.lock().map_err(|e| e.to_string())? = Some(manifest.directory);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn installer_uninstall(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        {
            let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
            if *busy {
                return Err("An operation is already running".into());
            }
            *busy = true;
        }
        let _lease = Lease(&state.busy);
        if !uninstall_mode() {
            return Err("Open Devyy's uninstaller to remove this installation".into());
        }
        let directory = directory_arg().ok_or("The installation folder was not specified")?;
        engine::uninstall(&Environment::current()?, &directory, |progress| {
            let _ = app.emit("installer-progress", progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn installer_launch(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<State>();
    let root = state
        .installed
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Install Devyy first")?;
    #[cfg(target_os = "macos")]
    if root.extension().is_some_and(|e| e == "app") {
        std::process::Command::new("/usr/bin/open")
            .arg(&root)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let manifest = engine::read_manifest(&root)?;
    let executable = if manifest.platform == Platform::Windows {
        root.join("app/devyy.exe")
    } else {
        root.join("devyy")
    };
    std::process::Command::new(executable)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn installer_macos_install(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        {
            let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
            if *busy {
                return Err("An installation is already running".into());
            }
            *busy = true;
        }
        let _lease = Lease(&state.busy);
        let source =
            macos::source().ok_or("The Devyy app is missing. Download the installer again.")?;
        let destination = macos::install(&source, |progress| {
            let _ = app.emit("installer-progress", progress);
        })?;
        *state.installed.lock().map_err(|e| e.to_string())? = Some(destination);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("This installation method is for macOS".into())
    }
}
#[tauri::command]
fn installer_macos_status(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    if let Some(source) = macos::source() {
        if macos::installed(&source) {
            if let Ok(mut root) = app.state::<State>().installed.lock() {
                *root = Some(macos::destination());
            }
            return true;
        }
    }
    let _ = app;
    false
}
#[tauri::command]
fn installer_open_applications() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("/Applications")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    Err("Applications is a macOS folder".into())
}
#[tauri::command]
fn installer_appearance(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let dark = match theme.as_str() {
        "dark" => true,
        "light" => false,
        _ => return Err("Unknown appearance".into()),
    };
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_theme(Some(if dark {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            }))
            .map_err(|e| e.to_string())?;
        window
            .set_background_color(Some(if dark {
                tauri::window::Color(25, 25, 25, 255)
            } else {
                tauri::window::Color(250, 250, 250, 255)
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn relay_uninstaller() -> Result<bool, String> {
    #[cfg(windows)]
    if uninstall_mode() && !std::env::args_os().any(|v| v == "--relayed") {
        let root = directory_arg().ok_or("Missing installation folder")?;
        let manifest = engine::read_manifest(&root)?;
        let current = std::env::current_exe().map_err(|e| e.to_string())?;
        if current
            .parent()
            .and_then(|p| engine::canonical(p).ok())
            .is_some_and(|p| p == manifest.directory)
        {
            let relay = tempfile::Builder::new()
                .prefix("devyy-uninstall-")
                .tempdir()
                .map_err(|e| e.to_string())?
                .keep();
            std::fs::write(relay.join(".devyy-relay"), engine::APP_ID)
                .map_err(|e| e.to_string())?;
            let copy = relay.join("Devyy Uninstaller.exe");
            std::fs::copy(&current, &copy).map_err(|e| e.to_string())?;
            let mut command = std::process::Command::new(copy);
            command
                .args(std::env::args_os().skip(1))
                .arg("--relayed")
                .arg("--relay-dir")
                .arg(&relay);
            command.spawn().map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}
fn cleanup_relay() {
    #[cfg(windows)]
    {
        let args: Vec<_> = std::env::args_os().collect();
        let Some(path) = args
            .windows(2)
            .find(|w| w[0] == "--relay-dir")
            .map(|w| PathBuf::from(&w[1]))
        else {
            return;
        };
        let Ok(path) = engine::canonical(&path) else {
            return;
        };
        let Ok(temp) = engine::canonical(&std::env::temp_dir()) else {
            return;
        };
        if path.parent() != Some(temp.as_path())
            || !path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("devyy-uninstall-"))
            || std::fs::read_to_string(path.join(".devyy-relay"))
                .ok()
                .as_deref()
                != Some(engine::APP_ID)
        {
            return;
        }
        use std::os::windows::process::CommandExt;
        let _=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","Start-Sleep -Seconds 2; Remove-Item -LiteralPath $env:DEVYY_RELAY_DIR -Recurse -Force -ErrorAction SilentlyContinue"]).env("DEVYY_RELAY_DIR",path).creation_flags(0x08000000).spawn();
    }
}
pub fn run() {
    match relay_uninstaller() {
        Ok(true) => return,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
        _ => {}
    }
    if uninstall_mode() && std::env::args_os().any(|v| v == "--silent") {
        let result = (|| {
            engine::uninstall(
                &Environment::current()?,
                &directory_arg().ok_or("Missing installation folder")?,
                |_: Progress| {},
            )
        })();
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        cleanup_relay();
        return;
    }
    #[cfg(windows)]
    if let Err(error) = windows::ensure_webview() {
        windows::show_error(&error);
        cleanup_relay();
        return;
    }
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_drag::init());
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            installer_info,
            installer_install,
            installer_validate_directory,
            installer_uninstall,
            installer_launch,
            installer_macos_install,
            installer_macos_status,
            installer_open_applications,
            installer_appearance
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                cleanup_relay();
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<State>().busy.lock().is_ok_and(|busy| *busy) {
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start Devyy Installer");
}
