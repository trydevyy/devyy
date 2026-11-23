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

use crate::{debug, lsp, terminal, workspace};
use serde_json::{json, Value};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
    webview::InvokeRequest,
    Listener,
};
fn app() -> tauri::App<MockRuntime> {
    mock_builder()
        .manage(workspace::Workspace::default())
        .manage(terminal::Terminals::default())
        .manage(lsp::LanguageServers::default())
        .manage(debug::Debugger::default())
        .invoke_handler(tauri::generate_handler![
            workspace::open_workspace,
            crate::app_info::build_info,
            crate::shells::terminal_profiles,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            lsp::lsp_start,
            lsp::file_uri,
            lsp::lsp_request,
            lsp::lsp_stop,
            debug::debug_start,
            debug::debug_request,
            debug::debug_program,
            debug::debug_stop
        ])
        .build(mock_context(noop_assets()))
        .unwrap()
}
fn call(view: &tauri::WebviewWindow<MockRuntime>, command: &str, body: Value) -> Value {
    get_ipc_response(
        view,
        InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .unwrap()
    .deserialize()
    .unwrap()
}
fn event(rx: &mpsc::Receiver<String>, name: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let raw = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("No {name} event received"));
        let value: Value = serde_json::from_str(&raw).unwrap();
        if value["event"] == name {
            return value;
        }
    }
}
#[test]
fn build_metadata_reports_actual_native_os_and_compilation_time() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let info = call(&view, "build_info", json!({}));
    assert_eq!(info["version"], env!("CARGO_PKG_VERSION"));
    assert!(!info["osBuild"].as_str().unwrap().is_empty());
    assert_eq!(info["arch"], std::env::consts::ARCH);
    let time = info["builtAt"].as_str().unwrap().parse::<u64>().unwrap();
    assert!(time > 1_700_000_000);
    assert!(
        time <= std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    );
}
// These tests send POSIX commands straight to the PTY, without a terminal
// emulator to answer input negotiation from shells such as fish.
#[cfg(unix)]
fn posix_test_profile() -> Option<String> {
    if cfg!(target_os = "linux") {
        return crate::shells::discover()
            .into_iter()
            .find(|profile| profile.name == "Bash")
            .map(|profile| profile.id);
    }
    None
}

#[test]
#[cfg(unix)]
fn terminal_runs_a_real_shell_and_closes_it() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let base = std::env::temp_dir();
    call(&view, "open_workspace", json!({"path":base}));
    let (tx, rx) = mpsc::channel();
    app.listen("terminal-output", move |e| {
        let _ = tx.send(e.payload().to_owned());
    });
    let id = call(
        &view,
        "terminal_create",
        json!({"cols":80,"rows":24,"profile":posix_test_profile()}),
    );
    call(
        &view,
        "terminal_write",
        json!({"id":id,"data":"printf '\\104\\105\\126\\131\\131\\137\\117\\113\\012'\r"}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut output = String::new();
    while !output.contains("DEVYY_OK") {
        let raw = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        let payload: Value = serde_json::from_str(&raw).unwrap();
        let bytes: Vec<u8> = serde_json::from_value(payload["data"].clone()).unwrap();
        output.push_str(&String::from_utf8_lossy(&bytes));
    }
    call(&view, "terminal_close", json!({"id":id}));
}
#[test]
#[cfg(unix)]
fn selected_shell_profile_is_discovered_and_used_by_native_ipc() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    call(
        &view,
        "open_workspace",
        json!({"path":std::env::temp_dir()}),
    );
    let profiles = call(&view, "terminal_profiles", json!({}));
    let bash = profiles
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "Bash")
        .expect("Bash must be installed for this test");
    let (tx, rx) = mpsc::channel();
    app.listen("terminal-output", move |e| {
        let _ = tx.send(e.payload().to_owned());
    });
    let id = call(
        &view,
        "terminal_create",
        json!({"cols":80,"rows":24,"profile":bash["id"]}),
    );
    call(
        &view,
        "terminal_write",
        json!({"id":id,"data":"printf '\\104\\105\\126\\131\\131\\137\\102\\101\\123\\110:%s\\n' \"$BASH_VERSION\"\r"}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut output = String::new();
    while !output.contains("DEVYY_BASH:") {
        let raw = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        let payload: Value = serde_json::from_str(&raw).unwrap();
        let bytes: Vec<u8> = serde_json::from_value(payload["data"].clone()).unwrap();
        output.push_str(&String::from_utf8_lossy(&bytes));
    }
    let version = output.split("DEVYY_BASH:").last().unwrap().trim_start();
    assert!(
        version.starts_with(|c: char| c.is_ascii_digit()),
        "Expected Bash version, got {output}"
    );
    call(&view, "terminal_close", json!({"id":id}));
}
#[test]
#[ignore = "Requires python-lsp-server on PATH"]
fn language_server_returns_python_completions_over_real_stdio() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let base = std::env::temp_dir().join(format!("devyy-lsp-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    std::fs::write(base.join("main.py"), "import os\nos.pa\n").unwrap();
    call(&view, "open_workspace", json!({"path":base}));
    call(&view, "lsp_start", json!({"language":"python"}));
    let uri = call(&view, "file_uri", json!({"path":"main.py"}));
    call(
        &view,
        "lsp_request",
        json!({"language":"python","method":"textDocument/didOpen","notification":true,"params":{"textDocument":{"uri":uri,"languageId":"python","version":1,"text":"import os\nos.pa\n"}}}),
    );
    let result = call(
        &view,
        "lsp_request",
        json!({"language":"python","method":"textDocument/completion","notification":false,"params":{"textDocument":{"uri":uri},"position":{"line":1,"character":5}}}),
    );
    let items = result
        .as_array()
        .or_else(|| result["items"].as_array())
        .unwrap();
    assert!(items.iter().any(|item| item["label"]
        .as_str()
        .unwrap_or_default()
        .starts_with("path")));
    call(&view, "lsp_stop", json!({}));
    std::fs::remove_dir_all(base).unwrap();
}
#[test]
#[ignore = "Requires python3 with debugpy installed on PATH"]
fn debugger_launches_stops_inspects_variables_and_disconnects() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let base = std::env::temp_dir().join(format!("devyy-debug-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let program = base.join("main.py");
    std::fs::write(&program, "value = 41\nvalue += 1\nprint(value)\n").unwrap();
    call(&view, "open_workspace", json!({"path":base}));
    let (tx, rx) = mpsc::channel();
    app.listen("debug-event", move |e| {
        let _ = tx.send(e.payload().to_owned());
    });
    call(&view, "debug_start", json!({"kind":"python"}));
    std::thread::scope(|scope| {
        let launch=scope.spawn(||call(&view,"debug_request",json!({"command":"launch","arguments":{"program":program,"cwd":base,"stopOnEntry":true,"console":"internalConsole"}})));
        event(&rx, "initialized");
        call(
            &view,
            "debug_request",
            json!({"command":"setBreakpoints","arguments":{"source":{"path":program},"breakpoints":[{"line":2}]}}),
        );
        call(
            &view,
            "debug_request",
            json!({"command":"configurationDone","arguments":{}}),
        );
        launch.join().unwrap();
        let stopped = event(&rx, "stopped");
        let thread = stopped["body"]["threadId"].clone();
        call(
            &view,
            "debug_request",
            json!({"command":"continue","arguments":{"threadId":thread}}),
        );
        event(&rx, "stopped");
        let stack = call(
            &view,
            "debug_request",
            json!({"command":"stackTrace","arguments":{"threadId":thread}}),
        );
        let frame = stack["stackFrames"][0]["id"].clone();
        let scopes = call(
            &view,
            "debug_request",
            json!({"command":"scopes","arguments":{"frameId":frame}}),
        );
        let local = scopes["scopes"][0]["variablesReference"].clone();
        let variables = call(
            &view,
            "debug_request",
            json!({"command":"variables","arguments":{"variablesReference":local}}),
        );
        assert!(variables["variables"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["name"] == "value" && v["value"] == "41"));
        call(&view, "debug_stop", json!({}));
    });
    std::fs::remove_dir_all(base).unwrap();
}

#[test]
#[cfg(unix)]
fn terminal_sessions_keep_independent_shell_state_and_survive_closing_a_neighbor() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    call(
        &view,
        "open_workspace",
        json!({"path":std::env::temp_dir()}),
    );
    let (tx, rx) = mpsc::channel();
    app.listen("terminal-output", move |e| {
        let _ = tx.send(e.payload().to_owned());
    });
    let profile = posix_test_profile();
    let a = call(
        &view,
        "terminal_create",
        json!({"cols":80,"rows":24,"profile":profile}),
    );
    let b = call(
        &view,
        "terminal_create",
        json!({"cols":100,"rows":30,"profile":profile}),
    );
    assert_ne!(a, b);
    call(
        &view,
        "terminal_write",
        json!({"id":a,"data":"export DEVYY_SESSION=alpha; printf 'SESSION=%s\\n' \"$DEVYY_SESSION\"\r"}),
    );
    call(
        &view,
        "terminal_write",
        json!({"id":b,"data":"export DEVYY_SESSION=beta; printf 'SESSION=%s\\n' \"$DEVYY_SESSION\"\r"}),
    );
    let mut outputs = std::collections::HashMap::<u64, String>::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !outputs
        .get(&a.as_u64().unwrap())
        .is_some_and(|s| s.contains("SESSION=alpha"))
        || !outputs
            .get(&b.as_u64().unwrap())
            .is_some_and(|s| s.contains("SESSION=beta"))
    {
        let payload: Value = serde_json::from_str(
            &rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap(),
        )
        .unwrap();
        let bytes: Vec<u8> = serde_json::from_value(payload["data"].clone()).unwrap();
        outputs
            .entry(payload["id"].as_u64().unwrap())
            .or_default()
            .push_str(&String::from_utf8_lossy(&bytes));
    }
    assert!(!outputs[&a.as_u64().unwrap()].contains("SESSION=beta"));
    assert!(!outputs[&b.as_u64().unwrap()].contains("SESSION=alpha"));
    call(
        &view,
        "terminal_resize",
        json!({"id":b,"cols":120,"rows":40}),
    );
    call(&view, "terminal_close", json!({"id":a}));
    call(
        &view,
        "terminal_write",
        json!({"id":b,"data":"printf 'SURVIVED=%s\\n' \"$DEVYY_SESSION\"\r"}),
    );
    let mut output = String::new();
    while !output.contains("SURVIVED=beta") {
        let payload: Value = serde_json::from_str(
            &rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap(),
        )
        .unwrap();
        if payload["id"] != b {
            continue;
        }
        let bytes: Vec<u8> = serde_json::from_value(payload["data"].clone()).unwrap();
        output.push_str(&String::from_utf8_lossy(&bytes));
    }
    call(&view, "terminal_close", json!({"id":b}));
}

#[test]
#[cfg(windows)]
fn windows_conpty_sessions_run_independently_and_close_cleanly() {
    let app = app();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let parent = tempfile::tempdir().unwrap();
    let directory = parent.path().join("Devyy terminal test");
    std::fs::create_dir(&directory).unwrap();
    call(&view, "open_workspace", json!({"path": directory}));
    let expected_directory = format!("{}>", directory.display()).to_lowercase();
    let profiles = call(&view, "terminal_profiles", json!({}));
    let cmd = profiles
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "Command Prompt")
        .unwrap();
    let (tx, rx) = mpsc::channel();
    app.listen("terminal-output", move |e| {
        let _ = tx.send(e.payload().to_owned());
    });
    let a = call(
        &view,
        "terminal_create",
        json!({"cols":80,"rows":24,"profile":cmd["id"]}),
    );
    let b = call(
        &view,
        "terminal_create",
        json!({"cols":80,"rows":24,"profile":cmd["id"]}),
    );
    assert_ne!(a, b);
    let commands = [
        (
            &a,
            "set DEVYY_MARKER=DEVYY_\recho %DEVYY_MARKER%WINDOWS_A\r",
        ),
        (
            &b,
            "set DEVYY_MARKER=DEVYY_\recho %DEVYY_MARKER%WINDOWS_B\r",
        ),
    ];
    let mut started = std::collections::HashSet::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut outputs = std::collections::HashMap::<u64, String>::new();
    while !outputs
        .get(&a.as_u64().unwrap())
        .is_some_and(|s| s.contains("DEVYY_WINDOWS_A"))
        || !outputs
            .get(&b.as_u64().unwrap())
            .is_some_and(|s| s.contains("DEVYY_WINDOWS_B"))
    {
        let payload: Value = serde_json::from_str(
            &rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap(),
        )
        .unwrap();
        let bytes: Vec<u8> = serde_json::from_value(payload["data"].clone()).unwrap();
        let output = outputs.entry(payload["id"].as_u64().unwrap()).or_default();
        output.push_str(&String::from_utf8_lossy(&bytes));
        // ConPTY asks a real terminal for its cursor position before CMD starts.
        if output.contains("\x1b[6n") && started.insert(payload["id"].as_u64().unwrap()) {
            let (id, command) = commands
                .iter()
                .find(|(id, _)| **id == payload["id"])
                .unwrap();
            call(
                &view,
                "terminal_write",
                json!({"id":id,"data": format!("\x1b[1;1R{command}")}),
            );
        }
    }
    for output in outputs.values() {
        assert!(
            output.to_lowercase().contains(&expected_directory),
            "{output:?}"
        );
    }
    assert!(!outputs[&a.as_u64().unwrap()].contains("DEVYY_WINDOWS_B"));
    assert!(!outputs[&b.as_u64().unwrap()].contains("DEVYY_WINDOWS_A"));
    call(
        &view,
        "terminal_resize",
        json!({"id":b,"cols":100,"rows":30}),
    );
    call(&view, "terminal_close", json!({"id":a}));
    call(&view, "terminal_close", json!({"id":b}));
}
