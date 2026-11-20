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

mod account;
mod ai;
mod app_info;
mod appearance;
mod associations;
mod debug;
mod extension_host;
mod extension_secrets;
mod extension_servers;
mod extensions;
mod git;
mod github;
mod language_config;
mod lsp;
mod menus;
mod process;
mod remote;
mod setup_import;
mod shells;
mod terminal;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, cwd| {
        associations::enqueue(
            app,
            associations::launch_paths(arguments.into_iter().skip(1), std::path::Path::new(&cwd)),
        );
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("context-menu-policy")
                .js_init_script_on_all_frames(include_str!("../../public/context-menu.js"))
                .build(),
        )
        .register_uri_scheme_protocol("devyy-extension", |context, request| {
            extension_host::webview_response(context.app_handle(), &request)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(account::Accounts::default())
        .manage(remote::Remotes::default())
        .manage(ai::AiState::default())
        .manage(ai::agent::AccessState::default())
        .manage(extension_secrets::ExtensionSecrets::default())
        .manage(workspace::Workspace::default())
        .manage(associations::OpenTargets::default())
        .manage(terminal::Terminals::default())
        .manage(lsp::LanguageServers::default())
        .manage(debug::Debugger::default())
        .manage(extensions::ExtensionStore::default())
        .manage(extension_host::ExtensionHost::default())
        .setup(|app| {
            menus::install(app.handle())?;
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if url.scheme() == "devyy" && url.host_str() == Some("account") {
                            let _ = handle.emit("devyy-account-callback", url.as_str());
                        }
                    }
                });
            }
            associations::enqueue(app.handle(), std::env::args().skip(1).collect());
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = appearance::set_appearance(window, "midnight".into(), true) {
                    eprintln!("Native material unavailable; using a solid window: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account::account_begin,
            account::account_finish,
            account::account_request,
            account::account_disconnect,
            remote::remote_list,
            remote::remote_stop,
            remote::ssh_forward,
            remote::port_forward,
            remote::ssh_mount_workspace,
            github::github_status,
            github::github_login,
            github::github_git_identity,
            ai::ai_providers,
            ai::ai_save_provider,
            ai::ai_chat,
            ai::agent::ai_workspace_access,
            ai::ai_cancel,
            ai::ai_account,
            ai::ai_models,
            ai::ai_runtime,
            ai::ai_install_runtime,
            ai::ai_delete_provider,
            appearance::set_appearance,
            setup_import::detect_ide_settings,
            setup_import::read_ide_settings,
            extension_host::extension_host_request,
            extension_secrets::extension_secret,
            extension_host::extension_webview_document,
            extensions::search_extensions,
            extensions::extension_details,
            extensions::list_extensions,
            extensions::install_extension,
            extensions::install_vsix,
            extensions::set_extension_enabled,
            extensions::uninstall_extension,
            extensions::extension_asset,
            extensions::extension_icon,
            app_info::build_info,
            associations::default_app_status,
            associations::set_default_app,
            associations::take_open_targets,
            app_info::check_updates,
            workspace::read_preview_image,
            workspace::read_preview_media,
            menus::set_menu_shortcuts,
            workspace::open_workspace,
            workspace::refresh_workspace,
            workspace::list_files,
            workspace::list_directory,
            workspace::read_file,
            workspace::write_file,
            workspace::create_file,
            workspace::rename_file,
            workspace::delete_file,
            workspace::search_workspace,
            git::git_init,
            git::git_status,
            git::git_pull,
            git::git_diff,
            git::git_diff_files,
            git::git_stage_all,
            git::git_discard,
            git::git_branches,
            git::git_branch_details,
            git::git_branch_action,
            git::git_submodules,
            git::git_submodule_action,
            git::git_switch_branch,
            git::git_history,
            git::git_graph,
            git::git_commit_files,
            git::git_commit_details,
            git::git_commit_diff,
            git::git_stage,
            git::git_commit,
            git::vcs_get_provider,
            git::vcs_set_provider,
            git::vcs_status,
            git::vcs_checkpoint,
            shells::terminal_profiles,
            terminal::terminal_create,
            terminal::terminal_pid,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            debug::debug_start,
            debug::debug_request,
            debug::debug_program,
            debug::debug_stop,
            language_config::list_language_servers,
            language_config::save_language_server,
            lsp::lsp_start,
            lsp::lsp_request,
            lsp::lsp_stop,
            lsp::lsp_stop_language,
            lsp::lsp_respond,
            lsp::file_uri,
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start devyy")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                associations::enqueue(
                    app,
                    urls.iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect(),
                );
            }
            if let tauri::RunEvent::Exit = event {
                app.state::<ai::AiState>().shutdown();
                app.state::<extension_host::ExtensionHost>().shutdown();
            }
        });
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
            .manage(ai::AiState::default())
            .manage(workspace::Workspace::default())
            .invoke_handler(tauri::generate_handler![
                workspace::open_workspace,
                workspace::refresh_workspace,
                workspace::read_file,
                workspace::write_file,
                workspace::search_workspace,
                git::git_init,
                git::git_stage,
                git::git_commit,
                git::git_status,
                git::git_pull,
                git::git_diff_files,
                git::git_stage_all,
                git::git_discard,
                git::git_branches,
                git::git_branch_details,
                git::git_branch_action,
                git::git_submodules,
                git::git_submodule_action,
                git::git_switch_branch,
                git::git_history
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
        let original_branch = status["branch"].as_str().unwrap();
        std::fs::write(base.join("main.rs"), "fn staged() {}\n").unwrap();
        call("git_stage_all", json!({"staged": false}));
        std::fs::write(base.join("main.rs"), "fn working() {}\n").unwrap();
        let staged = call("git_diff_files", json!({"path":"main.rs", "staged":true}));
        assert_eq!(staged["original"], "fn main() {}\n");
        assert_eq!(staged["modified"], "fn staged() {}\n");
        let working = call("git_diff_files", json!({"path":"main.rs", "staged":false}));
        assert_eq!(working["original"], "fn staged() {}\n");
        assert_eq!(working["modified"], "fn working() {}\n");
        call("git_discard", json!({"path":"main.rs"}));
        assert_eq!(
            std::fs::read_to_string(base.join("main.rs")).unwrap(),
            "fn staged() {}\n"
        );
        call("git_stage_all", json!({"staged":true}));
        let unstaged = call("git_status", json!({}));
        assert_eq!(unstaged["changes"][0]["index"], " ");
        call("git_stage_all", json!({"staged":false}));
        call("git_commit", json!({"message":"Review changes"}));
        assert_eq!(call("git_history", json!({})).as_array().unwrap().len(), 2);
        call(
            "git_switch_branch",
            json!({"branch":"devyy-checkpoint", "create":true}),
        );
        assert_eq!(call("git_status", json!({}))["branch"], "devyy-checkpoint");
        call(
            "git_switch_branch",
            json!({"branch":original_branch, "create":false}),
        );
        assert!(call("git_branches", json!({}))
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "devyy-checkpoint"));
        let source = tempfile::tempdir().unwrap();
        let source_path = source.path();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Devyy fixture"],
            vec!["config", "user.email", "fixture@devyy.local"],
            vec!["config", "commit.gpgsign", "false"],
            vec!["config", "core.hooksPath", "disabled-hooks"],
        ] {
            assert!(crate::process::command("git")
                .current_dir(source_path)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        std::fs::write(source_path.join("library.rs"), "original library").unwrap();
        assert!(crate::process::command("git")
            .current_dir(source_path)
            .args(["add", "."])
            .output()
            .unwrap()
            .status
            .success());
        assert!(crate::process::command("git")
            .current_dir(source_path)
            .args(["commit", "-m", "Library"])
            .output()
            .unwrap()
            .status
            .success());
        assert!(crate::process::command("git")
            .current_dir(&base)
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source_path.to_str().unwrap(),
                "packages/shared"
            ])
            .output()
            .unwrap()
            .status
            .success());
        let modules = call("git_submodules", json!({}));
        assert_eq!(modules[0]["path"], "packages/shared");
        assert_eq!(modules[0]["initialized"], true);
        std::fs::write(base.join("packages/shared/library.rs"), "working library").unwrap();
        let selected = json!({"repository":"packages/shared"});
        let child = call("git_status", selected.clone());
        assert_eq!(child["changes"][0]["path"], "packages/shared/library.rs");
        call(
            "git_stage",
            json!({"repository":"packages/shared", "path":"packages/shared/library.rs", "staged":false}),
        );
        assert_eq!(
            call("git_status", selected.clone())["changes"][0]["index"],
            "M"
        );
        let child_diff = call(
            "git_diff_files",
            json!({"repository":"packages/shared", "path":"packages/shared/library.rs", "staged":true}),
        );
        assert_eq!(child_diff["original"], "original library");
        assert_eq!(child_diff["modified"], "working library");
        assert!(call("git_branch_details", selected.clone())
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["name"] == "main"));
        call(
            "git_switch_branch",
            json!({"repository":"packages/shared", "branch":"library-work", "create":true}),
        );
        assert_eq!(call("git_status", selected)["branch"], "library-work");
        assert_eq!(call("git_status", json!({}))["branch"], original_branch);
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
