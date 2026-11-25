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

use crate::{
    language_config::ServerConfig,
    process::{read_process_logs, RecentLogs},
    workspace::{root, Workspace},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;
#[derive(Clone)]
struct ResourceGrant {
    owner: String,
    roots: Vec<PathBuf>,
}
pub enum ExtensionFailure {
    Exited {
        status: String,
        logs: String,
    },
    Execution {
        id: Option<String>,
        error: String,
        stack: String,
        logs: String,
    },
}

#[derive(Default)]
pub struct ExtensionHost {
    client: Mutex<Option<Arc<Client>>>,
    on_failure: Option<fn(&AppHandle, ExtensionFailure)>,
    pub servers: Arc<Mutex<HashMap<String, ServerConfig>>>,
    epoch: Arc<AtomicU64>,
    documents: Mutex<HashMap<String, (String, String, u64)>>,
    resources: Arc<Mutex<HashMap<String, ResourceGrant>>>,
}
struct Client {
    child: Arc<Mutex<Child>>,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next: AtomicU64,
    root: Option<String>,
    stopped: AtomicBool,
    ended: Arc<AtomicBool>,
    initialized: Mutex<bool>,
}
impl Client {
    fn stop(&self) {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut child) = self.child.lock() {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            #[cfg(windows)]
            {
                let _ = crate::process::command("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
            if self.ended.load(Ordering::Acquire) {
                return Err("Extension host exited. See Output: Extension Host.".into());
            }
            pending.insert(id, tx);
        }
        let sent = (|| {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            writeln!(
                stdin,
                "{}",
                json!({"id":id,"method":method,"params":params})
            )
            .and_then(|_| stdin.flush())
            .map_err(|e| e.to_string())
        })();
        if let Err(e) = sent {
            let _ = self.pending.lock().map(|mut p| p.remove(&id));
            return Err(e);
        }
        let response = if matches!(
            method,
            "command" | "resolveView" | "initialize" | "pseudoTerminalOpen" | "pseudoTerminalInput"
        ) {
            rx.recv().map_err(|e| e.to_string())
        } else {
            rx.recv_timeout(Duration::from_secs(20))
                .map_err(|e| e.to_string())
        };
        let _ = self.pending.lock().map(|mut p| p.remove(&id));
        let response =
            response.map_err(|_| format!("Extension host did not respond to {method}"))?;
        if let Some(error) = response.get("error") {
            return Err(error.as_str().unwrap_or("Extension host error").to_owned());
        }
        Ok(response["result"].clone())
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.stop();
    }
}
fn start(
    app: &AppHandle,
    state: &ExtensionHost,
    workspace_root: Option<String>,
) -> Result<Arc<Client>, String> {
    let node = crate::process::executable("node").ok_or("Install Node.js 20 or newer to run JavaScript extensions. Themes, syntax and bundled native language servers work without it.")?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runtime = data.join("extension-host");
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let script = runtime.join("host.cjs");
    fs::write(&script, include_str!("../extension-host/host.cjs")).map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("workspace-activation.cjs"),
        include_str!("../extension-host/workspace-activation.cjs"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("lsp-transport.cjs"),
        include_str!("../extension-host/lsp-transport.cjs"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("types.cjs"),
        include_str!("../extension-host/types.cjs"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("runtime.cjs"),
        include_str!("../extension-host/runtime.cjs"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("quick-input.cjs"),
        include_str!("../extension-host/quick-input.cjs"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        runtime.join("messages.cjs"),
        include_str!("../../public/extension-messages.js"),
    )
    .map_err(|e| e.to_string())?;
    let mut command = crate::process::command(&node.to_string_lossy());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    crate::process::with_tool_path(&mut command);
    let mut child = command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Extension host stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Extension host stdout unavailable")?;
    let logs = Arc::new(RecentLogs::default());
    let (drained, drain_finished) = mpsc::channel();
    if let Some(stderr) = child.stderr.take() {
        let logs = logs.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            read_process_logs(stderr, |line| {
                logs.push("stderr", line);
                let _ = app.emit(
                    "extension-host",
                    json!({"event":"output","payload":{
                        "name":"Extension Host","text":line,"level":"warn"
                    }}),
                );
            });
            let _ = drained.send(());
        });
    }
    let child = Arc::new(Mutex::new(child));
    let process = child.clone();
    let ended = Arc::new(AtomicBool::new(false));
    let reader_ended = ended.clone();
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let responses = pending.clone();
    let handle = app.clone();
    let on_failure = state.on_failure;
    let servers = state.servers.clone();
    let epoch = state.epoch.clone();
    let resources = state.resources.clone();
    resources.lock().map_err(|e| e.to_string())?.clear();
    let generation = epoch.fetch_add(1, Ordering::SeqCst) + 1;
    servers.lock().map_err(|e| e.to_string())?.clear();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            if reader
                .by_ref()
                .take(16_000_001)
                .read_until(b'\n', &mut bytes)
                .unwrap_or(0)
                == 0
                || bytes.len() > 16_000_000
            {
                break;
            }
            let Ok(message) = serde_json::from_slice::<Value>(&bytes) else {
                logs.push("stdout", &String::from_utf8_lossy(&bytes));
                continue;
            };
            if epoch.load(Ordering::SeqCst) != generation {
                break;
            }
            if let Some(id) = message["id"].as_u64() {
                if let Ok(mut map) = responses.lock() {
                    if let Some(tx) = map.remove(&id) {
                        let _ = tx.send(message);
                    }
                }
            } else if let Some(event) = message["event"].as_str() {
                let payload = &message["payload"];
                if matches!(event, "output" | "outputReplace") {
                    if let Some(text) = payload["text"].as_str() {
                        logs.push(payload["name"].as_str().unwrap_or("Extension Host"), text);
                    }
                }
                if event == "hostError"
                    || (event == "extensionStatus" && message["payload"]["status"] == "error")
                {
                    if let Some(report) = on_failure {
                        report(
                            &handle,
                            ExtensionFailure::Execution {
                                id: payload["id"].as_str().map(str::to_owned),
                                error: payload["error"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .chars()
                                    .take(4096)
                                    .collect(),
                                stack: payload["stack"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .chars()
                                    .take(8192)
                                    .collect(),
                                logs: logs.snapshot(),
                            },
                        );
                    }
                }
                if event == "languageServer" {
                    if let Ok(config) =
                        serde_json::from_value::<ServerConfig>(message["payload"].clone())
                    {
                        if crate::language_config::validate(&config).is_ok() {
                            if let Ok(mut all) = servers.lock() {
                                all.insert(config.language.clone(), config);
                            }
                        }
                    }
                }
                if event == "webviewResources" {
                    let p = &message["payload"];
                    if let (Some(token), Some(owner), Some(roots)) =
                        (p["token"].as_str(), p["id"].as_str(), p["roots"].as_array())
                    {
                        if token.len() <= 128 && roots.len() <= 64 {
                            let roots = roots
                                .iter()
                                .filter_map(|p| p.as_str().map(PathBuf::from))
                                .collect();
                            if let Ok(mut grants) = resources.lock() {
                                grants.insert(
                                    token.to_owned(),
                                    ResourceGrant {
                                        owner: owner.to_owned(),
                                        roots,
                                    },
                                );
                            }
                        }
                    }
                    continue;
                }
                if event == "webviewClosed" {
                    if let Some(id) = message["payload"]["id"].as_str() {
                        if let Ok(mut grants) = resources.lock() {
                            grants.retain(|_, grant| grant.owner != id);
                        }
                    }
                }
                let _ = handle.emit("extension-host", &message);
            }
        }
        let unexpected = epoch.load(Ordering::SeqCst) == generation;
        reader_ended.store(true, Ordering::Release);
        if let Ok(mut map) = responses.lock() {
            for (id, tx) in map.drain() {
                let _ = tx.send(
                    json!({"id":id,"error":"Extension host exited. See Output: Extension Host."}),
                );
            }
        }
        if unexpected {
            let _ = drain_finished.recv_timeout(Duration::from_millis(300));
            let status = process
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok().flatten())
                .map(|status| format!("Extension host ended with {status}"))
                .unwrap_or_else(|| {
                    "Extension host output closed before an exit status was available.".into()
                });
            if let Ok(mut servers) = servers.lock() {
                if epoch.load(Ordering::SeqCst) == generation {
                    servers.clear();
                    let _ = handle.emit(
                        "extension-host",
                        json!({"event":"hostExit","payload":{"error":status}}),
                    );
                }
            }
            if let Some(report) = on_failure {
                report(
                    &handle,
                    ExtensionFailure::Exited {
                        status,
                        logs: logs.snapshot(),
                    },
                );
            }
        }
    });
    let client = Arc::new(Client {
        child,
        stdin: Mutex::new(stdin),
        pending,
        next: AtomicU64::new(1),
        root: workspace_root.clone(),
        stopped: AtomicBool::new(false),
        ended,
        initialized: Mutex::new(false),
    });
    Ok(client)
}
#[tauri::command]
pub async fn extension_host_request(
    method: String,
    params: Option<Value>,
    app: AppHandle,
    workspace: State<'_, Workspace>,
) -> Result<Value, String> {
    if ![
        "status",
        "restart",
        "activateLanguage",
        "command",
        "tree",
        "treeCommand",
        "treeMenuCommand",
        "resolveView",
        "webviewMessage",
        "webviewState",
        "closeWebview",
        "workbenchResponse",
        "editorState",
        "documentSaved",
        "readDocument",
        "saveVirtualDocument",
        "fileOperations",
        "handleUri",
        "terminalState",
        "pseudoTerminalOpen",
        "pseudoTerminalInput",
        "pseudoTerminalResize",
        "languageFeature",
        "languageServerMessage",
    ]
    .contains(&method.as_str())
    {
        return Err("Unknown extension host method".into());
    }
    let workspace_root = root(&workspace)
        .ok()
        .map(|p| crate::workspace::display_path(&p));
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExtensionHost>();
        let client = {
            let mut slot = state.client.lock().map_err(|e| e.to_string())?;
            let dead = slot.as_ref().is_some_and(|c| {
                c.ended.load(Ordering::Acquire) || c.child
                    .lock()
                    .map(|mut child| child.try_wait().ok().flatten().is_some())
                    .unwrap_or(true)
            });
            if method == "restart"
                || dead
                || slot.as_ref().is_some_and(|c| c.root != workspace_root)
            {
                state.epoch.fetch_add(1, Ordering::SeqCst);
                if let Some(previous) = slot.take() {
                    previous.stop();
                }
                state.documents.lock().map_err(|e| e.to_string())?.clear();
                state.servers.lock().map_err(|e| e.to_string())?.clear();
            }
            if slot.is_none() {
                *slot = Some(start(&app, &state, workspace_root)?);
            }
            slot.as_ref().unwrap().clone()
        };
        if matches!(method.as_str(), "restart" | "status" | "activateLanguage" | "command" | "tree" | "treeCommand" | "resolveView" | "handleUri") {
            let mut initialized = client.initialized.lock().map_err(|e| e.to_string())?;
            if !*initialized {
                let enabled: Vec<_> = crate::extensions::for_app(&app)?.into_iter().filter(|e| e.enabled).collect();
                let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
                client.request("initialize", json!({"workspaceRoot":client.root,"storageRoot":data.join("extension-state"),"extensions":enabled,"webviewOrigin":if cfg!(any(windows, target_os = "android")){"http://devyy-extension.localhost"}else{"devyy-extension://localhost"}}))?;
                *initialized = true;
            }
        }
        if method == "closeWebview" {
            if let Some(id) = params.as_ref().and_then(|p| p["id"].as_str()) {
                state
                    .documents
                    .lock()
                    .map_err(|e| e.to_string())?
                    .retain(|_, (owner, _, _)| owner != id);
            }
        }
        client.request(
            if method == "restart" {
                "status"
            } else {
                &method
            },
            params.unwrap_or(json!({})),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

pub const WEBVIEW_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http://localhost:* http://127.0.0.1:* devyy-extension: http://devyy-extension.localhost; style-src 'unsafe-inline' data: https: devyy-extension: http://devyy-extension.localhost; img-src data: blob: https: devyy-extension: http://devyy-extension.localhost; font-src data: https: devyy-extension: http://devyy-extension.localhost; connect-src https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* devyy-extension: http://devyy-extension.localhost; worker-src blob: devyy-extension: http://devyy-extension.localhost; frame-src https:; form-action https:; base-uri devyy-extension: http://devyy-extension.localhost";
#[tauri::command]
pub fn extension_webview_document(
    id: String,
    html: String,
    revision: Option<u64>,
    state: State<'_, ExtensionHost>,
) -> Result<String, String> {
    if id.len() > 512 || html.len() > 10_000_000 {
        return Err("Extension view is too large".into());
    }
    let mut docs = state.documents.lock().map_err(|e| e.to_string())?;
    let token = store_document(&mut docs, id, html, revision)?;
    Ok(if cfg!(any(windows, target_os = "android")) {
        format!("http://devyy-extension.localhost/{token}")
    } else {
        format!("devyy-extension://localhost/{token}")
    })
}
fn store_document(
    docs: &mut HashMap<String, (String, String, u64)>,
    id: String,
    html: String,
    revision: Option<u64>,
) -> Result<String, String> {
    let previous = docs.iter().find(|(_, (owner, _, _))| owner == &id);
    let next = revision.unwrap_or_else(|| {
        previous
            .map(|(_, (_, _, version))| version + 1)
            .unwrap_or(1)
    });
    if let Some((token, (_, _, version))) = previous {
        if next <= *version {
            return Ok(token.clone());
        }
    }
    docs.retain(|_, (owner, _, _)| owner != &id);
    if docs.len() >= 32 {
        return Err("Close an extension view before opening another".into());
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    docs.insert(token.clone(), (id, html, next));
    Ok(token)
}
fn resource_file(grant: &ResourceGrant, index: usize, relative: &str) -> Result<PathBuf, String> {
    let root = grant
        .roots
        .get(index)
        .ok_or("Unknown resource root")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let decoded = percent_encoding::percent_decode_str(relative)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let file = root
        .join(decoded.as_ref())
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("Resource is outside localResourceRoots".into());
    }
    if file.metadata().map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
        return Err("Webview resource is too large".into());
    }
    Ok(file)
}
pub fn webview_response<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let state = app.state::<ExtensionHost>();
    let route = request.uri().path().trim_start_matches('/');
    let mut builder = tauri::http::Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if request.method() == tauri::http::Method::OPTIONS {
        return builder
            .status(204)
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .body(Vec::new())
            .unwrap();
    }
    if let Some(resource) = route.strip_prefix("resource/") {
        let mut parts = resource.splitn(3, '/');
        let token = parts.next().unwrap_or_default();
        let index = parts.next().and_then(|s| s.parse::<usize>().ok());
        let relative = parts.next().unwrap_or_default();
        let grant = state
            .resources
            .lock()
            .ok()
            .and_then(|all| all.get(token).cloned());
        let file = grant
            .zip(index)
            .and_then(|(grant, index)| resource_file(&grant, index, relative).ok());
        if let Some(file) = file {
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            if let Ok(bytes) = fs::read(file) {
                return builder
                    .status(200)
                    .header("Content-Type", mime.as_ref())
                    .body(if request.method() == tauri::http::Method::HEAD {
                        Vec::new()
                    } else {
                        bytes
                    })
                    .unwrap();
            }
        }
        return builder.status(404).body(Vec::new()).unwrap();
    }
    let document = state
        .documents
        .lock()
        .ok()
        .and_then(|docs| docs.get(route).map(|(_, html, _)| html.clone()));
    builder = builder
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", WEBVIEW_CSP);
    builder
        .status(if document.is_some() { 200 } else { 404 })
        .body(document.unwrap_or_default().into_bytes())
        .unwrap()
}

impl ExtensionHost {
    #[allow(dead_code)] // Standalone extension smoke examples use the default host.
    pub fn with_failure_reporting(on_failure: fn(&AppHandle, ExtensionFailure)) -> Self {
        Self {
            on_failure: Some(on_failure),
            ..Self::default()
        }
    }

    pub fn shutdown(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut slot) = self.client.lock() {
            if let Some(client) = slot.take() {
                client.stop();
            }
        }
        if let Ok(mut servers) = self.servers.lock() {
            servers.clear();
        }
        if let Ok(mut resources) = self.resources.lock() {
            resources.clear();
        }
        if let Ok(mut docs) = self.documents.lock() {
            docs.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn superseded_webview_documents_cannot_replace_the_latest_html() {
        let mut docs = HashMap::new();
        let token = store_document(&mut docs, "view".into(), "latest".into(), Some(2)).unwrap();
        let stale = store_document(&mut docs, "view".into(), "stale".into(), Some(1)).unwrap();
        assert_eq!(token, stale);
        assert_eq!(docs[&token].1, "latest");
    }
    #[test]
    fn resources_load_nested_modules_and_block_traversal() {
        let root = tempfile::tempdir().unwrap();
        let assets = root.path().join("assets");
        fs::create_dir_all(assets.join("nested")).unwrap();
        fs::write(assets.join("nested/chunk.js"), "export default 1").unwrap();
        fs::write(root.path().join("private.json"), "secret").unwrap();
        let grant = ResourceGrant {
            owner: "view".into(),
            roots: vec![assets.clone()],
        };
        assert_eq!(
            resource_file(&grant, 0, "nested/chunk.js").unwrap(),
            assets.join("nested/chunk.js").canonicalize().unwrap()
        );
        assert!(resource_file(&grant, 0, "%2e%2e/private.json").is_err());
        assert!(resource_file(&grant, 1, "nested/chunk.js").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                root.path().join("private.json"),
                assets.join("escape.json"),
            )
            .unwrap();
            assert!(resource_file(&grant, 0, "escape.json").is_err());
        }
    }
}
