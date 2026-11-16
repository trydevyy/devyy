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

use crate::workspace::{root, Workspace};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTerminalOptions {
    shell_path: Option<String>,
    shell_args: Option<serde_json::Value>,
    cwd: Option<serde_json::Value>,
    env: Option<HashMap<String, Option<String>>>,
    strict_env: Option<bool>,
}
pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Session>>,
    next: AtomicU32,
}
#[derive(Clone, Serialize)]
struct Output {
    id: u32,
    data: Vec<u8>,
}
#[tauri::command]
pub async fn terminal_create<R: tauri::Runtime>(
    app: AppHandle<R>,
    workspace: State<'_, Workspace>,
    cols: u16,
    rows: u16,
    profile: Option<String>,
    options: Option<ExtensionTerminalOptions>,
) -> Result<u32, String> {
    let base = root(&workspace).or_else(|_| app.path().home_dir().map_err(|e| e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        create_session(app, base, cols, rows, profile, options)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn create_session<R: tauri::Runtime>(
    app: AppHandle<R>,
    base: std::path::PathBuf,
    cols: u16,
    rows: u16,
    profile: Option<String>,
    options: Option<ExtensionTerminalOptions>,
) -> Result<u32, String> {
    let shell = crate::shells::select(profile.as_deref())?;
    let state = app.state::<Terminals>();
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let options = options.unwrap_or_default();
    let mut cmd = CommandBuilder::new(options.shell_path.as_deref().unwrap_or(&shell.path));
    if let Some(args) = options.shell_args {
        if let Some(args) = args.as_array() {
            cmd.args(args.iter().filter_map(|s| s.as_str()));
        } else if let Some(args) = args.as_str() {
            cmd.arg(args);
        }
    } else if options.shell_path.is_none() {
        cmd.args(&shell.args);
    }
    let cwd = options
        .cwd
        .as_ref()
        .and_then(|v| v.as_str().or_else(|| v["fsPath"].as_str()))
        .map(std::path::PathBuf::from)
        .unwrap_or(base);
    cmd.cwd(cwd);
    if options.strict_env.unwrap_or(false) {
        cmd.env_clear();
    }
    for (key, value) in options.env.unwrap_or_default() {
        if let Some(value) = value {
            cmd.env(key, value);
        } else {
            cmd.env_remove(key);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pty.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pty.slave);
    let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Session {
            master: pty.master,
            writer,
            child,
        },
    );
    let events = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = events.emit(
                        "terminal-output",
                        Output {
                            id,
                            data: buf[..n].to_vec(),
                        },
                    );
                }
            }
        }
        let _ = events.emit("terminal-exit", id);
    });
    Ok(id)
}
#[tauri::command]
pub fn terminal_write(id: u32, data: String, state: State<Terminals>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal has closed")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn terminal_resize(
    id: u32,
    cols: u16,
    rows: u16,
    state: State<Terminals>,
) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .ok_or("Terminal has closed")?
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn terminal_close(id: u32, state: State<Terminals>) -> Result<(), String> {
    if let Some(mut session) = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
impl Drop for Terminals {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for (_, mut s) in sessions.drain() {
                let _ = s.child.kill();
                let _ = s.child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn terminal_pid(id: u32, state: State<Terminals>) -> Result<Option<u32>, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions
        .get(&id)
        .ok_or("Terminal has closed")?
        .child
        .process_id())
}
