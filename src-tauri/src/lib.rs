mod app_info;
mod appearance;
mod debug;
mod git;
mod lsp;
mod menus;
mod shells;
mod terminal;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(workspace::Workspace::default())
        .manage(terminal::Terminals::default())
        .manage(lsp::LanguageServers::default())
        .manage(debug::Debugger::default())
        .setup(|app| {
            menus::install(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = appearance::set_appearance(window, "midnight".into(), true) {
                    eprintln!("Native material unavailable; using a solid window: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            appearance::set_appearance,
            app_info::build_info,
            app_info::check_updates,
            workspace::read_preview_image,
            menus::set_menu_shortcuts,
            workspace::open_workspace,
            workspace::refresh_workspace,
            workspace::list_files,
            workspace::read_file,
            workspace::write_file,
            workspace::create_file,
            workspace::rename_file,
            workspace::delete_file,
            workspace::search_workspace,
            git::git_status,
            git::git_diff,
            git::git_stage,
            git::git_commit,
            shells::terminal_profiles,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            debug::debug_start,
            debug::debug_request,
            debug::debug_program,
            debug::debug_stop,
            lsp::lsp_start,
            lsp::lsp_request,
            lsp::lsp_stop,
            lsp::file_uri,
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start devyy");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use serde_json::{json, Value};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    #[test]
    fn frontend_commands_open_read_search_save_stage_and_commit_real_files() {
        let base = std::env::temp_dir().join(format!("devyy-ipc-test-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("main.rs"), "fn main() { println!(\"hello\"); }\n").unwrap();
        for args in [
            vec!["init"],
            vec!["config", "user.email", "test@devyy.local"],
            vec!["config", "user.name", "devyy Test"],
        ] {
            assert!(std::process::Command::new("git")
                .current_dir(&base)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        let app = mock_builder()
            .manage(workspace::Workspace::default())
            .invoke_handler(tauri::generate_handler![
                workspace::open_workspace,
                workspace::refresh_workspace,
                workspace::read_file,
                workspace::write_file,
                workspace::search_workspace,
                git::git_stage,
                git::git_commit,
                git::git_status
            ])
            .build(mock_context(noop_assets()))
            .unwrap();
        let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let call = |cmd: &str, body: Value| -> Value {
            get_ipc_response(
                &view,
                InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.into(),
                },
            )
            .unwrap()
            .deserialize()
            .unwrap()
        };
        let opened = call("open_workspace", json!({"path":base.to_str().unwrap()}));
        assert!(opened["logo"].is_null());
        std::fs::write(
            base.join("logo.svg"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
        )
        .unwrap();
        let refreshed = call("refresh_workspace", json!({}));
        assert!(refreshed["logo"]
            .as_str()
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        std::fs::remove_file(base.join("logo.svg")).unwrap();
        assert!(opened["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["path"] == "main.rs"));
        let doc = call("read_file", json!({"path":"main.rs"}));
        assert!(doc["content"].as_str().unwrap().contains("hello"));
        call(
            "write_file",
            json!({"path":"main.rs","content":"fn main() {}\n","expected":doc["modified"]}),
        );
        assert_eq!(
            std::fs::read_to_string(base.join("main.rs")).unwrap(),
            "fn main() {}\n"
        );
        let matches = call(
            "search_workspace",
            json!({"options":{"query":"main","case_sensitive":true}}),
        );
        assert_eq!(matches[0]["line"], 1);
        call("git_stage", json!({"path":"main.rs","staged":false}));
        call("git_commit", json!({"message":"Initial code"}));
        let status = call("git_status", json!({}));
        assert!(status["changes"].as_array().unwrap().is_empty());
        std::fs::create_dir(base.join("nested")).unwrap();
        std::fs::write(base.join("nested/child.rs"), "nested file").unwrap();
        call("open_workspace", json!({"path":base.join("nested")}));
        let nested = call("git_status", json!({}));
        assert_eq!(nested["changes"][0]["path"], "child.rs");
        std::fs::remove_dir_all(base).unwrap();
    }
}

#[cfg(test)]
mod tool_tests;
