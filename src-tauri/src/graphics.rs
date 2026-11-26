use std::path::PathBuf;

fn preference_file() -> Option<PathBuf> {
    Some(
        dirs::config_dir()?
            .join("xyz.devyy.editor")
            .join("software-rendering"),
    )
}

fn enabled() -> bool {
    preference_file().is_none_or(|path| !path.is_file())
}

// WebView2 reads its browser arguments when the webview process starts.
pub(crate) fn configure_before_launch() {
    #[cfg(windows)]
    if !enabled() {
        let key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        let mut args = std::env::var_os(key).unwrap_or_default();
        args.push(" --disable-gpu");
        std::env::set_var(key, args);
    }
}

pub(crate) fn configure_window(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let software = !enabled();
        if software {
            _window.with_webview(move |webview| {
                use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                if let Some(settings) = webview.inner().settings() {
                    settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
                }
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn hardware_acceleration() -> bool {
    enabled()
}

#[tauri::command]
pub fn set_hardware_acceleration(enabled: bool) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        return Err("macOS manages hardware acceleration for WKWebView.".into());
    }
    let path = preference_file().ok_or("Could not locate Devyy’s configuration directory.")?;
    if enabled {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    let dir = path
        .parent()
        .ok_or("Could not locate Devyy’s configuration directory.")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let flag = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    flag.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
