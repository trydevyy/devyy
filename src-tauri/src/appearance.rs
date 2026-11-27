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
    #[cfg(not(target_os = "macos"))]
    let is_monochrome = theme == "monochrome";
    let theme = match theme.as_str() {
        "paper" => Theme::Light,
        "midnight" | "monochrome" => Theme::Dark,
        _ => return Err("Unknown color theme".into()),
    };
    window.set_theme(Some(theme)).map_err(|e| e.to_string())?;
    let bytes: &[u8] = if theme == Theme::Dark {
        include_bytes!("../icons/theme-dark.png")
    } else {
        include_bytes!("../icons/theme-light.png")
    };
    apply_icon(&window, bytes)?;

    #[cfg(target_os = "macos")]
    {
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
            } else if is_monochrome {
                tauri::window::Color(0, 0, 0, 255)
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
        // Transparent WebKitGTK surfaces can flicker on compositor damage.
        let _ = vibrancy;
        window
            .set_background_color(Some(if is_monochrome {
                tauri::window::Color(0, 0, 0, 255)
            } else if theme == Theme::Dark {
                tauri::window::Color(27, 28, 30, 255)
            } else {
                tauri::window::Color(237, 237, 238, 255)
            }))
            .map_err(|e| e.to_string())?;
        Ok(Appearance { material: "solid" })
    }
}

// AppKit scales runtime icons without masking them. Shape opaque artwork here,
// retaining the platform-neutral source and any already authored silhouettes.
#[cfg(any(target_os = "macos", test))]
fn macos_dock_icon(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use image::{ImageFormat, RgbaImage};
    use std::io::Cursor;
    let source = image::load_from_memory(bytes)
        .map_err(|e| e.to_string())?
        .into_rgba8();
    if source.pixels().any(|p| p[3] < 255) {
        return Ok(bytes.to_vec());
    }
    const SIZE: u32 = 512;
    const TILE: u32 = 432;
    const INSET: u32 = (SIZE - TILE) / 2;
    let artwork = image::imageops::thumbnail(&source, TILE, TILE);
    let mut output = RgbaImage::new(SIZE, SIZE);
    let left = (SIZE - artwork.width()) / 2;
    let top = (SIZE - artwork.height()) / 2;
    for (x, y, pixel) in artwork.enumerate_pixels() {
        let (px, py) = (left + x, top + y);
        let mut covered = 0;
        // Supersampled continuous corners and clear space for the Dock tile.
        for sy in 0..4 {
            for sx in 0..4 {
                let u = ((px as f64 + (sx as f64 + 0.5) / 4.0 - INSET as f64) / TILE as f64 * 2.0
                    - 1.0)
                    .abs();
                let v = ((py as f64 + (sy as f64 + 0.5) / 4.0 - INSET as f64) / TILE as f64 * 2.0
                    - 1.0)
                    .abs();
                if u.powi(5) + v.powi(5) <= 1.0 {
                    covered += 1;
                }
            }
        }
        let mut pixel = *pixel;
        pixel[3] = ((pixel[3] as u32 * covered + 8) / 16) as u8;
        output.put_pixel(px, py, pixel);
    }
    let mut png = Cursor::new(Vec::new());
    output
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png.into_inner())
}

pub(crate) fn apply_icon(window: &WebviewWindow, bytes: &[u8]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let prepared = macos_dock_icon(bytes)?;
    #[cfg(target_os = "macos")]
    let bytes = prepared.as_slice();

    window
        .set_icon(tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let bytes = bytes.to_vec();
        window
            .run_on_main_thread(move || {
                use objc2::{AnyThread, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSImage};
                use objc2_foundation::NSData;
                if let Some(marker) = MainThreadMarker::new() {
                    if let Some(image) =
                        NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&bytes))
                    {
                        unsafe {
                            NSApplication::sharedApplication(marker)
                                .setApplicationIconImage(Some(&image))
                        };
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod dock_icon_tests {
    use super::*;
    use image::{ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    #[test]
    fn opaque_icons_are_masked_once_with_clear_space() {
        let source = RgbaImage::from_pixel(64, 64, Rgba([80, 100, 200, 255]));
        let mut bytes = Cursor::new(Vec::new());
        source.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let result = macos_dock_icon(bytes.get_ref()).unwrap();
        let image = image::load_from_memory(&result).unwrap().into_rgba8();
        assert_eq!(image.dimensions(), (512, 512));
        assert_eq!(image.get_pixel(256, 256).0, [80, 100, 200, 255]);
        assert_eq!(image.get_pixel(40, 40)[3], 0);
        assert_eq!(image.get_pixel(256, 39)[3], 0);
        assert_eq!(image.get_pixel(256, 40)[3], 255);
        assert!(image.pixels().any(|p| p[3] > 0 && p[3] < 255));
        assert_eq!(macos_dock_icon(&result).unwrap(), result);
    }

    #[test]
    fn default_icons_keep_their_authored_transparency() {
        for bytes in [
            include_bytes!("../icons/theme-dark.png").as_slice(),
            include_bytes!("../icons/theme-light.png").as_slice(),
        ] {
            assert_eq!(macos_dock_icon(bytes).unwrap(), bytes);
        }
        assert!(macos_dock_icon(b"invalid PNG").is_err());
    }
}
