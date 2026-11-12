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
use tauri::{AppHandle, Emitter, State};

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;
struct Client {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next: AtomicU64,
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
        let result = rx.recv_timeout(Duration::from_secs(15));
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
pub struct LanguageServers(Mutex<HashMap<String, Arc<Client>>>, AtomicU64);
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
) -> Result<(), String> {
    if state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(&language)
    {
        return Ok(());
    }
    let base = root(&workspace)?;
    let generation = state.1.load(Ordering::SeqCst);
    let config = crate::language_config::configs(&app)?
        .into_iter()
        .find(|s| s.language == language && s.enabled)
        .ok_or("No language server configured for this language")?;
    let binary = config.command;
    let args = config.args;
    let configuration = config.settings;
    let initial_configuration = configuration.clone();
    let initialization_options = config.initialization_options;
    let lang = language.clone();
    let client = tauri::async_runtime::spawn_blocking(move || {
        let mut child = crate::process::command(&binary).args(args).current_dir(&base).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("Install {binary} to enable language intelligence: {e}"))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("Language server stdin unavailable")?));
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
                    } else { Value::Null };
                    let _ = send(&writer, json!({"jsonrpc":"2.0","id":message["id"],"result":result}));
                } else if let Some(id) = message["id"].as_u64() {
                    if let Ok(mut map) = responses.lock() { if let Some(tx) = map.remove(&id) { let _ = tx.send(message); } }
                } else if message["method"] == "textDocument/publishDiagnostics" {
                    let _ = app.emit("lsp-diagnostics", LspEvent { language: lang.clone(), params: message["params"].clone() });
                }
            }
        });
        let mut client = Client { child, stdin, pending, next: AtomicU64::new(1) };
        let uri = tauri::Url::from_directory_path(&base).map_err(|_| "Invalid workspace URI")?.to_string();
        let initialized = client.request("initialize", json!({"processId":std::process::id(),"initializationOptions":initialization_options,"rootUri":uri,"workspaceFolders":[{"uri":uri,"name":base.file_name().unwrap_or_default().to_string_lossy()}],"capabilities":{"workspace":{"configuration":true},"textDocument":{"completion":{"completionItem":{"snippetSupport":false}},"publishDiagnostics":{"relatedInformation":true}},"general":{"positionEncodings":["utf-16"]}}}));
        if let Err(error) = initialized { let _ = client.child.kill(); let _ = client.child.wait(); return Err(error); }
        client.send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}))?;
        client.send(json!({"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":initial_configuration}}))?;
        Ok(Arc::new(client))
    }).await.map_err(|e| e.to_string())??;
    if generation != state.1.load(Ordering::SeqCst) {
        return Err("Workspace changed while starting the language server".into());
    }
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(language, client);
    Ok(())
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
pub async fn lsp_stop(state: State<'_, LanguageServers>) -> Result<(), String> {
    state.1.fetch_add(1, Ordering::SeqCst);
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
