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

use std::collections::HashMap;
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime,
};

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let application = Submenu::new(app, "Devyy", true)?;
    application.append(&MenuItem::with_id(
        app,
        "about",
        "About Devyy",
        true,
        None::<&str>,
    )?)?;
    application.append(&PredefinedMenuItem::separator(app)?)?;
    application.append(&MenuItem::with_id(
        app,
        "settings",
        "Preferences…",
        true,
        None::<&str>,
    )?)?;
    application.append(&MenuItem::with_id(
        app,
        "setup",
        "Set Up devyy…",
        true,
        None::<&str>,
    )?)?;
    #[cfg(target_os = "macos")]
    {
        application.append(&PredefinedMenuItem::services(app, None)?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::hide(app, None)?)?;
        application.append(&PredefinedMenuItem::hide_others(app, None)?)?;
        application.append(&PredefinedMenuItem::show_all(app, None)?)?;
    }
    application.append(&PredefinedMenuItem::separator(app)?)?;
    application.append(&MenuItem::with_id(
        app,
        "quit-devyy",
        "Quit devyy",
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;
    menu.append(&application)?;
    for (name, items) in [
        (
            "File",
            vec![
                ("new", "New File…"),
                ("open", "Open Folder…"),
                ("-", ""),
                ("save", "Save"),
                ("save-all", "Save All"),
                ("-", ""),
                ("close", "Close Tab"),
                ("close-all", "Close All Tabs"),
            ],
        ),
        ("Edit", vec![("undo", "Undo"), ("redo", "Redo")]),
        (
            "Selection",
            vec![
                ("select-all-devyy", "Select All"),
                ("format", "Format Document"),
                ("wrap", "Word Wrap"),
            ],
        ),
        (
            "View",
            vec![
                ("commands", "Command Palette…"),
                ("files", "Go to File…"),
                ("global", "Search Workspace…"),
                ("extensions", "Extensions…"),
                ("ai", "AI Assistant"),
                ("ai-settings", "AI Providers…"),
                ("-", ""),
                ("sidebar", "Toggle Sidebar"),
                ("terminal", "Toggle Panel"),
                ("split", "Split Editor"),
                ("focus", "Focus Mode"),
                ("maximize-panel", "Maximize / Restore Panel"),
                ("reset-layout", "Reset Panel Sizes"),
            ],
        ),
        (
            "Go",
            vec![
                ("goto", "Go to Line…"),
                ("definition", "Go to Definition"),
                ("next-tab", "Next Tab"),
                ("previous-tab", "Previous Tab"),
                ("focus-editor", "Focus Editor"),
            ],
        ),
        (
            "Terminal",
            vec![
                ("new-terminal", "New Terminal"),
                ("split-terminal", "Split Terminal"),
                ("-", ""),
                ("next-terminal", "Next Terminal"),
                ("previous-terminal", "Previous Terminal"),
                ("rename-terminal", "Rename Terminal…"),
                ("clear-terminal", "Clear Terminal"),
                ("close-terminal", "Close Terminal"),
                ("-", ""),
                ("run", "Run Project"),
            ],
        ),
    ] {
        let submenu = Submenu::new(app, name, true)?;
        for (id, label) in items {
            if id == "-" {
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
            } else {
                submenu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
            }
        }
        if name == "Edit" {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            submenu.append(&PredefinedMenuItem::cut(app, None)?)?;
            submenu.append(&PredefinedMenuItem::copy(app, None)?)?;
            submenu.append(&PredefinedMenuItem::paste(app, None)?)?;
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            submenu.append(&MenuItem::with_id(
                app,
                "find",
                "Find and Replace…",
                true,
                None::<&str>,
            )?)?;
        }
        menu.append(&submenu)?;
    }
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "close-window-devyy",
                "Close Window",
                true,
                None::<&str>,
            )?,
        ],
    )?;
    menu.append(&window)?;
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if let Some(window) = app.get_webview_window("main") {
            if let Some(action) = id.strip_prefix("tray:") {
                if action == "hide" {
                    let _ = window.hide();
                    return;
                }
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if action == "show" {
                    return;
                }
            }
            let id = id.strip_prefix("tray:").unwrap_or(id);
            if id == "quit-devyy" || id == "close-window-devyy" {
                let _ = window.close();
            } else if id == "select-all-devyy" {
                let _ = window.eval("document.execCommand('selectAll')");
            } else {
                if let Ok(id) = serde_json::to_string(id) {
                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('devyy-native-command',{{detail:{id}}}))"));
                }
            }
        }
    });
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = Menu::new(app)?;
    for (id, title) in [
        ("tray:show", "Show Devyy"),
        ("tray:hide", "Hide Devyy"),
        ("-", ""),
        ("tray:open", "Open Folder..."),
        ("tray:settings", "Settings"),
        ("tray:new-terminal", "New Terminal"),
        ("tray:ai", "AI Assistant"),
        ("-", ""),
        ("tray:quit-devyy", "Quit Devyy"),
    ] {
        if id == "-" {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        } else {
            menu.append(&MenuItem::with_id(app, id, title, true, None::<&str>)?)?;
        }
    }
    let mut builder = TrayIconBuilder::with_id("devyy")
        .tooltip("Devyy")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(not(windows)))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn set_menu_shortcuts(app: AppHandle, bindings: HashMap<String, String>) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    fn collect(
        items: Vec<MenuItemKind<tauri::Wry>>,
        out: &mut HashMap<String, MenuItem<tauri::Wry>>,
    ) -> tauri::Result<()> {
        for item in items {
            match item {
                MenuItemKind::MenuItem(item) => {
                    out.insert(item.id().as_ref().to_owned(), item);
                }
                MenuItemKind::Submenu(submenu) => collect(submenu.items()?, out)?,
                _ => {}
            }
        }
        Ok(())
    }
    let mut items = HashMap::new();
    collect(menu.items().map_err(|e| e.to_string())?, &mut items).map_err(|e| e.to_string())?;
    for id in bindings.keys() {
        if let Some(item) = items.get(id) {
            item.set_accelerator(None::<&str>)
                .map_err(|e| e.to_string())?;
        }
    }
    let mut errors = Vec::new();
    for (id, binding) in bindings {
        if binding.is_empty() {
            continue;
        }
        let accelerator = binding
            .split('+')
            .map(|part| match part {
                "Mod" => "CmdOrCtrl",
                "Ctrl" => "Control",
                "Meta" => "Super",
                "`" => "Backquote",
                "\\" => "Backslash",
                "[" => "BracketLeft",
                "]" => "BracketRight",
                "," => "Comma",
                "." => "Period",
                "/" => "Slash",
                "=" => "Equal",
                "-" => "Minus",
                other => other,
            })
            .collect::<Vec<_>>()
            .join("+");
        if let Some(item) = items.get(&id) {
            if let Err(error) = item.set_accelerator(Some(accelerator)) {
                errors.push(format!("{id}: {error}"));
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(())
}
