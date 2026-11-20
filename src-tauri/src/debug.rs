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

type Responses = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;
struct Adapter {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Responses,
    sequence: AtomicU64,
}
impl Adapter {
    fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(seq, tx);
        let message =
            json!({"seq":seq,"type":"request","command":command,"arguments":arguments}).to_string();
        let sent = self
            .stdin
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|mut stdin| {
                write!(
                    stdin,
                    "Content-Length: {}\r\n\r\n{}",
                    message.len(),
                    message
                )
                .and_then(|_| stdin.flush())
                .map_err(|e| e.to_string())
            });
        if let Err(error) = sent {
            let _ = self.pending.lock().map(|mut p| p.remove(&seq));
            return Err(error);
        }
        let received = rx.recv_timeout(Duration::from_secs(30));
        let _ = self.pending.lock().map(|mut p| p.remove(&seq));
        let response = received.map_err(|_| format!("Debug adapter timed out: {command}"))?;
        if response["success"] == false {
            return Err(response["message"]
                .as_str()
                .unwrap_or("Debug adapter rejected the request")
                .into());
        }
        Ok(response["body"].clone())
    }
}
impl Drop for Adapter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
pub struct Debugger(Mutex<Option<Arc<Adapter>>>);
#[tauri::command]
pub async fn debug_start<R: tauri::Runtime>(
    kind: String,
    app: AppHandle<R>,
    state: State<'_, Debugger>,
    workspace: State<'_, Workspace>,
) -> Result<(), String> {
    if state.0.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Stop the current debug session first".into());
    }
    let base = root(&workspace)?;
    if crate::remote::ssh_workspace(&base).is_some() {
        return Err("Use the remote terminal to start a debugger on this SSH server.".into());
    }
    let adapter = tauri::async_runtime::spawn_blocking(move || -> Result<Arc<Adapter>, String> {
        let mut cmd = match kind.as_str() { "python" => { let binary = if cfg!(windows) { "python" } else { "python3" }; let mut c = crate::process::command(binary); c.args(["-m", "debugpy.adapter"]); c }, "lldb" => crate::process::command("lldb-dap"), _ => return Err("Choose LLDB or Python as the debug adapter".into()) };
        let mut child = cmd.current_dir(base).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("Debug adapter unavailable. Install lldb-dap (LLVM) or debugpy (Python): {e}"))?;
        let stdin = child.stdin.take().ok_or("Missing debug adapter stdin")?;
        let stdout = child.stdout.take().ok_or("Missing debug adapter stdout")?;
        let pending: Responses = Arc::new(Mutex::new(HashMap::new()));
        let responses = pending.clone();
        std::thread::spawn(move || {
            let mut stream = BufReader::new(stdout);
            loop {
                let mut size = 0usize;
                loop {
                    let mut line = String::new();
                    if stream.read_line(&mut line).unwrap_or(0) == 0 { let _ = app.emit("debug-event", json!({"event":"adapterExited"})); return; }
                    if line.trim().is_empty() { break; }
                    if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") { size = n.trim().parse().unwrap_or(0); }
                }
                if size == 0 || size > 16_000_000 { return; }
                let mut bytes = vec![0; size];
                if stream.read_exact(&mut bytes).is_err() { return; }
                let Ok(message) = serde_json::from_slice::<Value>(&bytes) else { continue };
                if message["type"] == "response" { if let Some(seq) = message["request_seq"].as_u64() { if let Ok(mut map) = responses.lock() { if let Some(tx) = map.remove(&seq) { let _ = tx.send(message); } } } }
                else if message["type"] == "event" { let _ = app.emit("debug-event", message); }
            }
        });
        let adapter = Arc::new(Adapter { child, stdin: Mutex::new(stdin), pending, sequence: AtomicU64::new(1) });
        adapter.request("initialize", json!({"clientID":"devyy","clientName":"devyy","adapterID":kind,"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true,"supportsRunInTerminalRequest":false}))?;
        Ok(adapter)
    }).await.map_err(|e| e.to_string())??;
    *state.0.lock().map_err(|e| e.to_string())? = Some(adapter);
    Ok(())
}
#[tauri::command]
pub async fn debug_request(
    command: String,
    arguments: Value,
    state: State<'_, Debugger>,
) -> Result<Value, String> {
    let adapter = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No debug session is running")?;
    tauri::async_runtime::spawn_blocking(move || adapter.request(&command, arguments))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn debug_program(path: String, workspace: State<Workspace>) -> Result<String, String> {
    Ok(resolve(&root(&workspace)?, &path, false)?
        .to_string_lossy()
        .into())
}
#[tauri::command]
pub async fn debug_stop(state: State<'_, Debugger>) -> Result<(), String> {
    let adapter = state.0.lock().map_err(|e| e.to_string())?.take();
    if let Some(adapter) = adapter {
        tauri::async_runtime::spawn_blocking(move || {
            let _ = adapter.request("disconnect", json!({"terminateDebuggee":true}));
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
