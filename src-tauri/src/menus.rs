use std::collections::HashMap;
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime,
};

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let application = Submenu::new(app, "devyy", true)?;
    application.append(&MenuItem::with_id(
        app,
        "about",
        "About devyy",
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
    // Route quit through the window close handler so unsaved changes are protected.
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
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if let Some(window) = app.get_webview_window("main") {
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
    // Clear first so reassignment never temporarily registers a duplicate accelerator.
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
