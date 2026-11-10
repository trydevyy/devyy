//! Run on macOS with `cargo run --example appearance_smoke` after building the frontend.
//! Unlike a mock-runtime test, this creates real AppKit views on the main thread.
#[path = "../src/appearance.rs"]
mod appearance;
#[path = "../src/menus.rs"]
mod menus;
use tauri::Manager;

#[cfg(target_os = "macos")]
fn check_window_controls(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;
    // The example runs on AppKit's main thread and borrows the live Tauri window.
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
            // Include repeated enables to exercise the idempotent material lifecycle.
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
            // Tao applies the custom inset during the first draw. Check after
            // AppKit has laid out the titlebar, on its main thread.
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
