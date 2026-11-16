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

#[path = "../src/appearance.rs"]
mod appearance;
#[path = "../src/menus.rs"]
mod menus;
use tauri::Manager;

#[cfg(target_os = "macos")]
fn check_window_controls(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;
    let native = unsafe { &*(window.ns_window()? as *const NSWindow) };
    let content = native.contentView().ok_or("Missing content view")?;
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        let button = native
            .standardWindowButton(kind)
            .ok_or("Missing window control")?;
        let bounds = button.bounds();
        let center = button.convertPoint_toView(
            NSPoint::new(bounds.size.width / 2.0, bounds.size.height / 2.0),
            Some(&content),
        );
        let from_top = if content.isFlipped() {
            center.y
        } else {
            content.bounds().size.height - center.y
        };
        println!("WINDOW_CONTROL_CENTER x={} y={from_top}", center.x);
        assert!(
            (from_top - 27.0).abs() <= 1.0,
            "Window control must align with the 54px header's center"
        );
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            menus::install(app.handle())?;
            let entries = app.menu().unwrap().items()?;
            assert_eq!(
                entries.len(),
                8,
                "Expected devyy, File, Edit, Selection, View, Go, Terminal and Window menus"
            );
            menus::set_menu_shortcuts(
                app.handle().clone(),
                [
                    ("settings", "Mod+,"),
                    ("files", "Mod+P"),
                    ("sidebar", "Mod+B"),
                    ("split", "Mod+\\"),
                    ("new-terminal", "Ctrl+Shift+`"),
                    ("next-terminal", "Mod+Alt+]"),
                    ("previous-terminal", "Mod+Alt+["),
                ]
                .into_iter()
                .map(|(id, key)| (id.to_owned(), key.to_owned()))
                .collect(),
            )?;
            println!(
                "NATIVE_MENUS_OK: all menu groups installed; customizable accelerators accepted"
            );
            let window = app
                .get_webview_window("main")
                .ok_or("Main window missing")?;
            for (theme, vibrancy) in [
                ("midnight", true),
                ("midnight", true),
                ("paper", true),
                ("paper", false),
                ("midnight", true),
                ("midnight", false),
            ] {
                let result = appearance::set_appearance(window.clone(), theme.into(), vibrancy)?;
                println!(
                    "APPEARANCE_OK {}",
                    serde_json::json!({"theme":theme,"enabled":vibrancy,"result":result})
                );
            }
            assert!(appearance::set_appearance(window.clone(), "invalid".into(), true).is_err());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Native appearance smoke test failed");
    app.run(|handle, event| {
        if let tauri::RunEvent::Ready = event {
            let app = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(750));
                let finish = app.clone();
                app.run_on_main_thread(move || {
                    #[cfg(target_os = "macos")]
                    check_window_controls(&finish.get_webview_window("main").unwrap()).unwrap();
                    finish.exit(0);
                })
                .unwrap();
            });
        }
    });
}
