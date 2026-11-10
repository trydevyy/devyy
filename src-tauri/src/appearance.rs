use serde::Serialize;
use tauri::{Theme, WebviewWindow};

#[derive(Serialize)]
pub struct Appearance {
    material: &'static str,
}

/// This synchronous command runs on the UI thread: AppKit views must be modified there.
/// Native material is behind the webview; editor surfaces stay opaque for readability.
#[tauri::command]
pub fn set_appearance(
    window: WebviewWindow,
    theme: String,
    vibrancy: bool,
) -> Result<Appearance, String> {
    let theme = match theme.as_str() {
        "paper" => Theme::Light,
        "midnight" => Theme::Dark,
        _ => return Err("Unknown color theme".into()),
    };
    window.set_theme(Some(theme)).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
        // Applying the material adds an NSVisualEffectView. Remove the previous
        // instance first so theme changes and repeated requests never stack blur views.
        clear_vibrancy(&window).map_err(|e| e.to_string())?;
        if vibrancy {
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::Sidebar,
                Some(NSVisualEffectState::FollowsWindowActiveState),
                None,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Appearance {
            material: if vibrancy { "vibrancy" } else { "solid" },
        })
    }
    #[cfg(target_os = "windows")]
    {
        // Mica avoids the resize/dragging performance problems of Acrylic.
        if vibrancy {
            window_vibrancy::apply_mica(&window, Some(theme == Theme::Dark))
                .map_err(|e| e.to_string())?;
        } else {
            window_vibrancy::clear_mica(&window).map_err(|e| e.to_string())?;
        }
        Ok(Appearance {
            material: if vibrancy { "mica" } else { "solid" },
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = vibrancy;
        Ok(Appearance { material: "solid" })
    }
}
