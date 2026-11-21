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
    remote: Mutex<HashMap<u32, tokio::sync::mpsc::Sender<RemoteTerminalEvent>>>,
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
    let has_workspace = workspace
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .is_some();
    let base = if has_workspace {
        root(&workspace)?
    } else {
        app.path().home_dir().map_err(|error| error.to_string())?
    };
    if let Some(ssh) = crate::ssh::workspace(&base) {
        return create_remote_terminal(app, ssh, cols, rows).await;
    }
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
    let shell = crate::shells::select(profile.as_deref())?;
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
enum RemoteTerminalEvent {
    Input(String),
    Resize(u16, u16),
}

async fn create_remote_terminal<R: tauri::Runtime>(
    app: AppHandle<R>,
    ssh: std::sync::Arc<crate::ssh::SshWorkspace>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    use russh::ChannelMsg;
    let mut channel = ssh
        .session
        .channel_open_session()
        .await
        .map_err(|error| error.to_string())?;
    channel
        .request_pty(
            true,
            "xterm-256color",
            u32::from(cols.max(1)),
            u32::from(rows.max(1)),
            0,
            0,
            &[],
        )
        .await
        .map_err(|error| error.to_string())?;
    channel
        .exec(true, ssh.shell_command("", "exec \"${SHELL:-/bin/sh}\" -l"))
        .await
        .map_err(|error| error.to_string())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let state = app.state::<Terminals>();
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .remote
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id, tx);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                action = rx.recv() => match action {
                    Some(RemoteTerminalEvent::Input(text)) => if channel.data_bytes(text.into_bytes()).await.is_err() { break; },
                    Some(RemoteTerminalEvent::Resize(cols, rows)) => if channel.window_change(u32::from(cols.max(1)), u32::from(rows.max(1)), 0, 0).await.is_err() { break; },
                    None => break,
                },
                output = channel.wait() => match output {
                    Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = app.emit("terminal-output", Output { id, data: data.to_vec() });
                    }
                    Some(ChannelMsg::Failure) => {
                        let _ = app.emit("terminal-output", Output { id, data: b"SSH server rejected the terminal request.\r\n".to_vec() });
                        break;
                    }
                    Some(ChannelMsg::Eof | ChannelMsg::Close) | None => break,
                    _ => {}
                },
            }
        }
        let _ = channel.close().await;
        if let Ok(mut terminals) = app.state::<Terminals>().remote.lock() {
            terminals.remove(&id);
        }
        let _ = app.emit("terminal-exit", id);
    });
    Ok(id)
}

#[tauri::command]
pub fn terminal_write(id: u32, data: String, state: State<Terminals>) -> Result<(), String> {
    if let Some(remote) = state
        .remote
        .lock()
        .map_err(|error| error.to_string())?
        .get(&id)
    {
        return remote
            .try_send(RemoteTerminalEvent::Input(data))
            .map_err(|error| error.to_string());
    }
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
    if let Some(remote) = state
        .remote
        .lock()
        .map_err(|error| error.to_string())?
        .get(&id)
    {
        return remote
            .try_send(RemoteTerminalEvent::Resize(cols, rows))
            .map_err(|error| error.to_string());
    }
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
    state
        .remote
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id);
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
    if state
        .remote
        .lock()
        .map_err(|error| error.to_string())?
        .contains_key(&id)
    {
        return Ok(None);
    }
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions
        .get(&id)
        .ok_or("Terminal has closed")?
        .child
        .process_id())
}
