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
use tauri::{Theme, WebviewWindow};

#[derive(Serialize)]
pub struct Appearance {
    material: &'static str,
}

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
    let bytes: &[u8] = if theme == Theme::Dark {
        include_bytes!("../icons/theme-dark.png")
    } else {
        include_bytes!("../icons/theme-light.png")
    };
    window
        .set_icon(tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use objc2::AnyThread;
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;
        if let Some(main) = MainThreadMarker::new() {
            let data = NSData::with_bytes(bytes);
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                unsafe {
                    NSApplication::sharedApplication(main).setApplicationIconImage(Some(&image));
                }
            }
        }
        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
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
        let mica =
            vibrancy && window_vibrancy::apply_mica(&window, Some(theme == Theme::Dark)).is_ok();
        if !mica {
            let _ = window_vibrancy::clear_mica(&window);
        }
        window
            .set_background_color(Some(if mica {
                tauri::window::Color(0, 0, 0, 0)
            } else if theme == Theme::Dark {
                tauri::window::Color(27, 28, 30, 255)
            } else {
                tauri::window::Color(237, 237, 238, 255)
            }))
            .map_err(|e| e.to_string())?;
        Ok(Appearance {
            material: if mica { "mica" } else { "solid" },
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = vibrancy;
        window
            .set_background_color(Some(if theme == Theme::Dark {
                tauri::window::Color(27, 28, 30, 255)
            } else {
                tauri::window::Color(237, 237, 238, 255)
            }))
            .map_err(|e| e.to_string())?;
        Ok(Appearance { material: "solid" })
    }
}
