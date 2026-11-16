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

use crate::workspace::{resolve, root, Workspace};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

fn merge_json(target: &mut Value, source: Value) {
    if let Value::Object(source) = source {
        for (key, value) in source {
            if value.is_object() && target[&key].is_object() {
                merge_json(&mut target[&key], value);
            } else {
                target[key] = value;
            }
        }
    }
}
type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;
struct Client {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next: AtomicU64,
    server_key: String,
    initialize_result: Value,
}
impl Client {
    fn send(&self, message: Value) -> Result<(), String> {
        send(&self.stdin, message)
    }
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, tx);
        if let Err(error) =
            self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
        {
            let _ = self.pending.lock().map(|mut p| p.remove(&id));
            return Err(error);
        }
        let result = rx.recv_timeout(Duration::from_secs(if method == "initialize" {
            60
        } else {
            30
        }));
        let _ = self.pending.lock().map(|mut p| p.remove(&id));
        let response = result.map_err(|_| format!("Language server timed out: {method}"))?;
        if let Some(error) = response.get("error") {
            return Err(error.to_string());
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}
fn send(stdin: &Arc<Mutex<ChildStdin>>, message: Value) -> Result<(), String> {
    let body = message.to_string();
    let mut stream = stdin.lock().map_err(|e| e.to_string())?;
    write!(stream, "Content-Length: {}\r\n\r\n{}", body.len(), body)
        .and_then(|_| stream.flush())
        .map_err(|e| e.to_string())
}
#[derive(Default)]
pub struct LanguageServers(
    Mutex<HashMap<String, Arc<Client>>>,
    AtomicU64,
    tokio::sync::Mutex<()>,
    Arc<Mutex<HashMap<String, Arc<Mutex<ChildStdin>>>>>,
);
#[derive(Clone, Serialize)]
struct LspEvent {
    language: String,
    params: Value,
}
#[tauri::command]
pub async fn lsp_start<R: tauri::Runtime>(
    language: String,
    app: AppHandle<R>,
    state: State<'_, LanguageServers>,
    workspace: State<'_, Workspace>,
) -> Result<Value, String> {
    let _starting = state.2.lock().await;
    let workspace_root = root(&workspace).ok();
    let base = workspace_root
        .clone()
        .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let generation = state.1.load(Ordering::SeqCst);
    let config = crate::language_config::configs(&app)?
        .into_iter()
        .find(|s| s.language == language && s.enabled)
        .ok_or("No language server configured for this language")?;
    let shared = config
        .client_id
        .as_ref()
        .map(|id| format!("{}:{id}", config.source.as_deref().unwrap_or("custom")))
        .unwrap_or_else(|| language.clone());
    let fingerprint = ring::digest::digest(&ring::digest::SHA256, json!({"command":config.command,"args":config.args,"env":config.env,"cwd":config.cwd,"settings":config.settings,"options":config.initialization_options,"capabilities":config.client_capabilities}).to_string().as_bytes());
    let server_key = format!("{shared}:{fingerprint:?}");
    {
        let mut clients = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = clients
            .values()
            .find(|c| c.server_key == server_key)
            .cloned()
        {
            let result = existing.initialize_result.clone();
            clients.insert(language, existing);
            return Ok(result);
        }
    }
    let binary = config.command;
    let cwd = config
        .cwd
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| base.clone());
    let environment = config.env;
    let args = config.args;
    let configuration = config.settings;
    let initial_configuration = configuration.clone();
    let initialization_options = config.initialization_options;
    let client_capabilities = config.client_capabilities;
    let lang = language.clone();
    let writers = state.3.clone();
    let client = tauri::async_runtime::spawn_blocking(move || {
        let mut child = crate::process::command(&binary).args(args).current_dir(&cwd).envs(environment).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Install {binary} to enable language intelligence: {e}"))?;
        if let Some(stderr) = child.stderr.take() {
            let app = app.clone(); let language = lang.clone();
            std::thread::spawn(move || { let mut reader=BufReader::new(stderr); loop { let mut line=String::new(); match reader.by_ref().take(65536).read_line(&mut line) { Ok(0)|Err(_)=>break, _=>{ let _=app.emit("lsp-output", json!({"language":language,"text":line})); } } } });
        }
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("Language server stdin unavailable")?));
        writers.lock().map_err(|e|e.to_string())?.insert(lang.clone(),stdin.clone());
        let stdout = child.stdout.take().ok_or("Language server stdout unavailable")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let responses = pending.clone(); let writer = stdin.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut size = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 { return; }
                    if line == "\r\n" || line == "\n" { break; }
                    if let Some(length) = line.to_ascii_lowercase().strip_prefix("content-length:") { size = length.trim().parse().unwrap_or(0); }
                }
                if size == 0 || size > 16_000_000 { return; }
                let mut body = vec![0; size];
                if reader.read_exact(&mut body).is_err() { return; }
                let Ok(message) = serde_json::from_slice::<Value>(&body) else { continue };
                if message.get("method").is_some() && message.get("id").is_some() {
                    let result = if message["method"] == "workspace/configuration" {
                        Value::Array(message["params"]["items"].as_array().map(|items| items.iter().map(|item| { let section=item["section"].as_str().unwrap_or(""); if section.is_empty() {configuration.clone()} else {section.split('.').fold(&configuration,|value,key| &value[key]).clone()} }).collect()).unwrap_or_default())
                    } else if ["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create", "workspace/workspaceFolders"].contains(&message["method"].as_str().unwrap_or("")) { Value::Null } else {
                        let _ = app.emit("lsp-server-message", json!({"language":lang,"method":message["method"],"params":message["params"],"id":message["id"]}));
                        continue;
                    };
                    let _ = send(&writer, json!({"jsonrpc":"2.0","id":message["id"],"result":result}));
                } else if let Some(id) = message["id"].as_u64() {
                    if let Ok(mut map) = responses.lock() { if let Some(tx) = map.remove(&id) { let _ = tx.send(message); } }
                } else if message["method"] == "textDocument/publishDiagnostics" {
                    let _ = app.emit("lsp-diagnostics", LspEvent { language: lang.clone(), params: message["params"].clone() });
                } else if message.get("method").is_some() {
                    let _ = app.emit("lsp-server-message", json!({"language":lang,"method":message["method"],"params":message["params"]}));
                }
            }
        });
        let mut client = Client { child, stdin, pending, next: AtomicU64::new(1), server_key, initialize_result: Value::Null };
        let uri = workspace_root.as_ref().and_then(|base|tauri::Url::from_directory_path(base).ok()).map(|u|u.to_string());
        let folders = uri.as_ref().map(|uri|json!([{"uri":uri,"name":base.file_name().unwrap_or_default().to_string_lossy()}]));
        let mut capabilities=json!({"window":{"workDoneProgress":true},"workspace":{"configuration":true,"workspaceFolders":true},"textDocument":{"completion":{"completionItem":{"snippetSupport":true,"insertReplaceSupport":true},"completionList":{"itemDefaults":["editRange","insertTextFormat"]}},"publishDiagnostics":{"relatedInformation":true}},"general":{"positionEncodings":["utf-16"]}});
        merge_json(&mut capabilities, json!({"textDocument": {
            "inlayHint": {"dynamicRegistration": false},
            "codeLens": {"dynamicRegistration": false},
            "semanticTokens": {
                "dynamicRegistration": false,
                "requests": {"range": false, "full": true},
                "tokenTypes": ["namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property", "enumMember", "event", "function", "method", "macro", "keyword", "modifier", "comment", "string", "number", "regexp", "operator", "decorator"],
                "tokenModifiers": ["declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification", "documentation", "defaultLibrary"],
                "formats": ["relative"], "overlappingTokenSupport": false, "multilineTokenSupport": false
            }
        }}));
        merge_json(&mut capabilities, client_capabilities);
        let initialized = client.request("initialize", json!({"processId":std::process::id(),"initializationOptions":initialization_options,"rootUri":uri,"workspaceFolders":folders,"capabilities":capabilities}));
        client.initialize_result = match initialized {Ok(result)=>result,Err(error)=>{let _=client.child.kill();let _=client.child.wait();return Err(error);}};
        client.send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}))?;
        client.send(json!({"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":initial_configuration}}))?;
        Ok(Arc::new(client))
    }).await.map_err(|e| e.to_string())??;
    if generation != state.1.load(Ordering::SeqCst) {
        return Err("Workspace changed while starting the language server".into());
    }
    let result = client.initialize_result.clone();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(language, client);
    Ok(result)
}
#[tauri::command]
pub fn file_uri(path: String, workspace: State<Workspace>) -> Result<String, String> {
    tauri::Url::from_file_path(resolve(&root(&workspace)?, &path, false)?)
        .map(|u| u.to_string())
        .map_err(|_| "Invalid file URI".into())
}
#[tauri::command]
pub async fn lsp_request(
    language: String,
    method: String,
    params: Value,
    notification: bool,
    state: State<'_, LanguageServers>,
) -> Result<Value, String> {
    let client = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&language)
        .cloned()
        .ok_or("Language server not running")?;
    tauri::async_runtime::spawn_blocking(move || {
        if notification {
            client.send(json!({"jsonrpc":"2.0","method":method,"params":params}))?;
            Ok(Value::Null)
        } else {
            client.request(&method, params)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn lsp_stop_language(
    language: String,
    state: State<'_, LanguageServers>,
) -> Result<(), String> {
    let _starting = state.2.lock().await;
    let mut clients = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(key) = clients.get(&language).map(|c| c.server_key.clone()) {
        let removed: Vec<_> = clients
            .iter()
            .filter(|(_, c)| c.server_key == key)
            .map(|(language, _)| language.clone())
            .collect();
        clients.retain(|_, c| c.server_key != key);
        if let Ok(mut writers) = state.3.lock() {
            for language in removed {
                writers.remove(&language);
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn lsp_respond(
    language: String,
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
    state: State<'_, LanguageServers>,
) -> Result<(), String> {
    let writer = state
        .3
        .lock()
        .map_err(|e| e.to_string())?
        .get(&language)
        .cloned()
        .ok_or("Language server is no longer running")?;
    let mut response = json!({"jsonrpc":"2.0","id":id});
    if let Some(error) = error {
        response["error"] = error;
    } else {
        response["result"] = result.unwrap_or(Value::Null);
    }
    send(&writer, response)
}
#[tauri::command]
pub async fn lsp_stop(state: State<'_, LanguageServers>) -> Result<(), String> {
    state.1.fetch_add(1, Ordering::SeqCst);
    state.3.lock().map_err(|e| e.to_string())?.clear();
    let mut clients = state.0.lock().map_err(|e| e.to_string())?;
    for (_, client) in clients.drain() {
        if let Ok(mut client) = Arc::try_unwrap(client) {
            let _ = client.child.kill();
            let _ = client.child.wait();
        }
    }
    Ok(())
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;
    #[tokio::test]
    async fn stdio_ipc_pipe_and_socket_servers_initialize_exchange_custom_requests_and_publish_diagnostics(
    ) {
        let node = crate::process::executable("node")
            .expect("Node.js is required by the extension-host tests");
        for transport in 0..4 {
            let base = tempfile::tempdir().unwrap();
            std::fs::write(
                base.path().join("server.cjs"),
                include_str!("../../scripts/fixtures/language-server.cjs"),
            )
            .unwrap();
            std::fs::write(
                base.path().join("bridge.cjs"),
                include_str!("../extension-host/lsp-transport.cjs"),
            )
            .unwrap();
            let args = if transport == 0 {
                vec![
                    base.path()
                        .join("server.cjs")
                        .to_string_lossy()
                        .into_owned(),
                    "--stdio".into(),
                ]
            } else {
                vec![
                    base.path()
                        .join("bridge.cjs")
                        .to_string_lossy()
                        .into_owned(),
                    transport.to_string(),
                    base.path()
                        .join("server.cjs")
                        .to_string_lossy()
                        .into_owned(),
                ]
            };
            let configs:Vec<_>=["fixture","fixturetwo"].iter().map(|language|json!({"language":language,"command":node,"args":args,"env":{"DEVYY_LSP_FIXTURE":"works"},"cwd":base.path(),"clientId":"shared-fixture","source":"test.fixture","initializationOptions":{"fixture":true}})).collect();
            std::fs::write(
                base.path().join("language-servers.json"),
                serde_json::to_vec(&configs).unwrap(),
            )
            .unwrap();
            let mut context = tauri::test::mock_context(tauri::test::noop_assets());
            context.config_mut().app.app_directories_override = Some(
                tauri::utils::config::AppDirectoriesOverride::Root(base.path().to_path_buf()),
            );
            let app = tauri::test::mock_builder()
                .manage(LanguageServers::default())
                .manage(Workspace(Mutex::new(Some(base.path().to_path_buf()))))
                .build(context)
                .unwrap();
            let handle = app.handle().clone();
            app.listen("lsp-server-message", move |event| {
                let p: Value = serde_json::from_str(event.payload()).unwrap();
                let handle = handle.clone();
                if p["method"] == "fixture/authorize" {
                    tauri::async_runtime::spawn(async move {
                        lsp_respond(
                            p["language"].as_str().unwrap().into(),
                            p["id"].clone(),
                            Some(json!(p["params"]["value"])),
                            None,
                            handle.state(),
                        )
                        .await
                        .unwrap();
                    });
                }
            });
            let (tx, rx) = mpsc::channel();
            app.listen("lsp-diagnostics", move |event| {
                let _ = tx.send(event.payload().to_owned());
            });
            let result = lsp_start(
                "fixture".into(),
                app.handle().clone(),
                app.state(),
                app.state(),
            )
            .await
            .unwrap();
            assert_eq!(result["fixtureReply"], 42);
            lsp_start(
                "fixturetwo".into(),
                app.handle().clone(),
                app.state(),
                app.state(),
            )
            .await
            .unwrap();
            let query = |language: &str, method: &str, params: Value, notification: bool| {
                lsp_request(
                    language.into(),
                    method.into(),
                    params,
                    notification,
                    app.state(),
                )
            };
            let original = query("fixture", "fixture/echo", json!({"value":7}), false)
                .await
                .unwrap();
            let alias = query("fixturetwo", "fixture/echo", json!({}), false)
                .await
                .unwrap();
            assert_eq!(original["pid"], alias["pid"]);
            assert_eq!(original["env"], "works");
            assert_eq!(
                std::path::Path::new(original["cwd"].as_str().unwrap())
                    .canonicalize()
                    .unwrap(),
                base.path().canonicalize().unwrap()
            );
            assert_eq!(original["params"]["value"], 7);
            query("fixture","textDocument/didOpen",json!({"textDocument":{"uri":"file:///fixture.test","languageId":"fixture","version":1,"text":"x"}}),true).await.unwrap();
            let diagnostic: Value =
                serde_json::from_str(&rx.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
            assert_eq!(
                diagnostic["params"]["diagnostics"][0]["message"],
                "Fixture diagnostic"
            );
            assert_eq!(
                query("fixture", "fixture/echo", json!({}), false)
                    .await
                    .unwrap()["opened"],
                true
            );
            lsp_stop_language("fixture".into(), app.state())
                .await
                .unwrap();
            assert!(query("fixturetwo", "fixture/echo", json!({}), false)
                .await
                .is_err());
        }
    }
}

#[cfg(test)]
mod real_server_test {
    use super::*;
    use tauri::Listener;
    #[tokio::test]
    #[ignore = "Requires clangd on PATH"]
    async fn real_clangd_process_reports_c_diagnostics() {
        let base = tempfile::tempdir().unwrap();
        std::fs::write(
            base.path().join("main.c"),
            "int main(void) { return unknown_symbol; }\n",
        )
        .unwrap();
        std::fs::write(base.path().join("language-servers.json"),serde_json::to_vec(&json!([{"language":"c","command":"clangd","args":["--background-index=false","--log=error"]}])).unwrap()).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(base.path().to_path_buf()),
        );
        let app = tauri::test::mock_builder()
            .manage(LanguageServers::default())
            .manage(Workspace(Mutex::new(Some(base.path().to_path_buf()))))
            .build(context)
            .unwrap();
        let (tx, rx) = mpsc::channel();
        app.listen("lsp-diagnostics", move |event| {
            let _ = tx.send(event.payload().to_owned());
        });
        lsp_start("c".into(), app.handle().clone(), app.state(), app.state())
            .await
            .unwrap();
        let uri = tauri::Url::from_file_path(base.path().join("main.c"))
            .unwrap()
            .to_string();
        lsp_request("c".into(),"textDocument/didOpen".into(),json!({"textDocument":{"uri":uri,"languageId":"c","version":1,"text":"int main(void) { return unknown_symbol; }\n"}}),true,app.state()).await.unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            let raw = rx
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .unwrap();
            let p: Value = serde_json::from_str(&raw).unwrap();
            if p["params"]["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| {
                    d["message"]
                        .as_str()
                        .unwrap_or("")
                        .contains("unknown_symbol")
                })
            {
                break;
            }
        }
        lsp_stop(app.state()).await.unwrap();
    }
}
