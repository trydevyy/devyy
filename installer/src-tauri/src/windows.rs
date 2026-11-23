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

use crate::engine::{Environment, Manifest};
use std::{os::windows::process::CommandExt, path::Path, process::Command};
const CREATE_NO_WINDOW: u32 = 0x08000000;
use winreg::{enums::HKEY_CURRENT_USER, RegKey};
const UNINSTALL: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Devyy";
fn script(source: &str, manifest: &Manifest) -> Result<(), String> {
    let status = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", source])
        .env("DEVYY_INSTALL_DIR", &manifest.directory)
        .env(
            "DEVYY_DESKTOP_SHORTCUT",
            if manifest.desktop { "1" } else { "0" },
        )
        .env("DEVYY_MENU_SHORTCUT", if manifest.menu { "1" } else { "0" })
        .output()
        .map_err(|e| e.to_string())?;
    if !status.status.success() {
        return Err(format!(
            "Windows could not update Devyy shortcuts: {}",
            String::from_utf8_lossy(&status.stderr)
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }
    Ok(())
}
pub fn register(_environment: &Environment, manifest: &Manifest) -> Result<(), String> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = user.create_subkey(UNINSTALL).map_err(|e| e.to_string())?;
    let executable = manifest.directory.join("app/devyy.exe");
    let remove = format!(
        "\"{}\"",
        manifest.directory.join(&manifest.uninstaller).display()
    );
    for (name, value) in [
        ("DisplayName", "Devyy".to_owned()),
        ("DisplayVersion", manifest.version.clone()),
        ("Publisher", "Devyy contributors".into()),
        (
            "InstallLocation",
            manifest.directory.to_string_lossy().into_owned(),
        ),
        ("DisplayIcon", executable.to_string_lossy().into_owned()),
        ("UninstallString", remove.clone()),
        ("QuietUninstallString", format!("{remove} --silent")),
        (
            "URLInfoAbout",
            "https://www.devyy.dev".into(),
        ),
    ] {
        key.set_value(name, &value).map_err(|e| e.to_string())?;
    }
    key.set_value("NoModify", &1u32)
        .map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32)
        .map_err(|e| e.to_string())?;
    let size: u64 = manifest
        .files
        .iter()
        .filter_map(|p| std::fs::metadata(manifest.directory.join(p)).ok())
        .map(|m| m.len())
        .sum();
    key.set_value(
        "EstimatedSize",
        &((size / 1024).min(u32::MAX as u64) as u32),
    )
    .map_err(|e| e.to_string())?;
    let (app_path, _) = user
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\devyy.exe")
        .map_err(|e| e.to_string())?;
    app_path
        .set_value("", &executable.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;
    let (protocol, _) = user
        .create_subkey("Software\\Classes\\devyy")
        .map_err(|e| e.to_string())?;
    protocol
        .set_value("", &"URL:Devyy")
        .map_err(|e| e.to_string())?;
    protocol
        .set_value("URL Protocol", &"")
        .map_err(|e| e.to_string())?;
    protocol
        .create_subkey("shell\\open\\command")
        .map_err(|e| e.to_string())?
        .0
        .set_value("", &format!("\"{}\" \"%1\"", executable.display()))
        .map_err(|e| e.to_string())?;

    crate::windows_file_associations::register(&executable, None, Some(manifest.explorer_context_menu))
        .map_err(|error| error.to_string())?;
    script(include_str!("../../scripts/shortcuts.ps1"), manifest)
}
pub fn unregister(_environment: &Environment, manifest: &Manifest) -> Result<(), String> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = user.open_subkey(UNINSTALL) {
        if key
            .get_value::<String, _>("InstallLocation")
            .is_ok_and(|p| Path::new(&p) == manifest.directory)
        {
            user.delete_subkey_all(UNINSTALL)
                .map_err(|e| e.to_string())?;
        }
    }
    let app_key = "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\devyy.exe";
    if user
        .open_subkey(app_key)
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok())
        .is_some_and(|p| Path::new(&p) == manifest.directory.join("app/devyy.exe"))
    {
        user.delete_subkey_all(app_key).map_err(|e| e.to_string())?;
    }
    let protocol = "Software\\Classes\\devyy";
    if user
        .open_subkey(format!("{protocol}\\shell\\open\\command"))
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok())
        .is_some_and(|value| {
            value
                == format!(
                    "\"{}\" \"%1\"",
                    manifest.directory.join("app/devyy.exe").display()
                )
        })
    {
        user.delete_subkey_all(protocol)
            .map_err(|e| e.to_string())?;
    }
    crate::windows_file_associations::unregister(&manifest.directory.join("app/devyy.exe"))
        .map_err(|error| error.to_string())?;
    script(include_str!("../../scripts/remove-shortcuts.ps1"), manifest)
}

fn message(text: &str, flags: u32) -> i32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW;
    let text: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Devyy Setup".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), flags) }
}
pub fn show_error(error: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR;
    message(error, MB_ICONERROR);
}
pub fn ensure_webview() -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IDYES, MB_ICONINFORMATION, MB_YESNO};
    use winreg::enums::HKEY_LOCAL_MACHINE;
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for path in [
            "Software\\Microsoft\\EdgeUpdate\\Clients",
            "Software\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients",
        ] {
            if let Ok(clients) = RegKey::predef(hive).open_subkey(path) {
                for id in clients.enum_keys().flatten() {
                    if let Ok(client) = clients.open_subkey(id) {
                        let name = client.get_value::<String, _>("name").unwrap_or_default();
                        if name.to_lowercase().contains("webview2")
                            && client
                                .get_value::<String, _>("pv")
                                .is_ok_and(|v| !v.is_empty() && v != "0.0.0.0")
                        {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    if message("Devyy uses Microsoft Edge WebView2 to display its interface. Download and install Microsoft's WebView2 Runtime to continue?",MB_YESNO|MB_ICONINFORMATION)!=IDYES {return Err("WebView2 is required to open Devyy Setup. Run the installer again when you're ready.".into());}
    let directory = tempfile::Builder::new()
        .prefix("devyy-webview2-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let bootstrap = directory.path().join("MicrosoftEdgeWebView2Setup.exe");
    let output = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("../../scripts/webview2.ps1"),
        ])
        .env("DEVYY_WEBVIEW_BOOTSTRAPPER", &bootstrap)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "WebView2 installation could not finish. {}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }
    Ok(())
}

pub fn wait_for_launcher(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return Ok(());
    }
    let status = unsafe { WaitForSingleObject(handle, 5000) };
    unsafe { CloseHandle(handle) };
    if status != WAIT_OBJECT_0 {
        return Err("Devyy's uninstall launcher is still running. Close it and try again.".into());
    }
    Ok(())
}
