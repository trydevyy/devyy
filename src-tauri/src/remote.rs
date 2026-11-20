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

use crate::account;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::watch;
#[derive(Default)]
pub struct Remotes {
    jobs: Mutex<HashMap<String, Job>>,
    mounts: Mutex<Vec<WorkspaceMount>>,
}
struct Job {
    cancel: watch::Sender<bool>,
    info: Connection,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    id: String,
    kind: String,
    label: String,
    local_port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOptions {
    host: String,
    user: String,
    ssh_port: u16,
    local_port: u16,
    remote_port: u16,
    #[serde(default)]
    password: Option<String>,
}

async fn create_askpass_script(_password: &str) -> Result<std::path::PathBuf, String> {
    let script_id = uuid::Uuid::new_v4();
    #[cfg(windows)]
    let script_path = std::env::temp_dir().join(format!("devyy-askpass-{}.cmd", script_id));
    #[cfg(not(windows))]
    let script_path = std::env::temp_dir().join(format!("devyy-askpass-{}.sh", script_id));

    #[cfg(windows)]
    tokio::fs::write(&script_path, b"@echo off\r\necho %DEVYY_SSH_PASS%\r\n")
        .await
        .map_err(|e| format!("Could not create askpass script: {}", e))?;

    #[cfg(not(windows))]
    {
        tokio::fs::write(
            &script_path,
            b"#!/bin/sh\nprintf '%s\\n' \"$DEVYY_SSH_PASS\"\n",
        )
        .await
        .map_err(|e| format!("Could not create askpass script: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700));
        }
    }

    Ok(script_path)
}

fn valid_host(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && !s.starts_with('-')
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-_:".contains(&c))
}
#[tauri::command]
pub fn remote_list(app: tauri::AppHandle) -> Vec<Connection> {
    app.state::<Remotes>()
        .jobs
        .lock()
        .unwrap()
        .values()
        .map(|job| job.info.clone())
        .collect()
}
#[tauri::command]
pub fn remote_stop(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(job) = app.state::<Remotes>().jobs.lock().unwrap().remove(&id) {
        let _ = job.cancel.send(true);
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_forward(app: tauri::AppHandle, options: SshOptions) -> Result<String, String> {
    if !valid_host(&options.host)
        || !valid_host(&options.user)
        || options.user.contains(':')
        || options.local_port == 0
        || options.remote_port == 0
        || options.ssh_port == 0
    {
        return Err("Enter a valid SSH host, user and ports".into());
    }
    let executable =
        crate::process::executable("ssh").ok_or("Install OpenSSH to use SSH forwarding")?;
    let id = format!("ssh-{}", options.local_port);
    if app
        .state::<Remotes>()
        .jobs
        .lock()
        .unwrap()
        .contains_key(&id)
    {
        return Err("That local port is already managed by Devyy".into());
    }
    let bind = format!(
        "127.0.0.1:{}:127.0.0.1:{}",
        options.local_port, options.remote_port
    );

    let has_password = options
        .password
        .as_ref()
        .map(|p| !p.is_empty())
        .unwrap_or(false);

    let mut temp_askpass_path: Option<std::path::PathBuf> = None;
    if has_password {
        if let Some(ref pass) = options.password {
            temp_askpass_path = Some(create_askpass_script(pass).await?);
        }
    }

    let mut cmd = tokio::process::Command::new(executable);
    let mut args = vec![
        "-N".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        if has_password {
            "BatchMode=no".to_string()
        } else {
            "BatchMode=yes".to_string()
        },
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=20".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
    ];

    if has_password {
        args.push("-o".to_string());
        args.push("NumberOfPasswordPrompts=1".to_string());
        if let Some(ref pass) = options.password {
            cmd.env("DEVYY_SSH_PASS", pass);
        }
        if let Some(ref path) = temp_askpass_path {
            cmd.env("SSH_ASKPASS", path);
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            cmd.env("DISPLAY", ":0");
        }
    }

    args.push("-p".to_string());
    args.push(options.ssh_port.to_string());
    args.push("-L".to_string());
    args.push(bind);
    args.push("--".to_string());
    args.push(format!("{}@{}", options.user, options.host));

    let mut child = cmd
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    // Poll for up to 1500ms to detect quick connection or authentication failures
    let mut exited = false;
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Some(_) = child.try_wait().map_err(|e| e.to_string())? {
            exited = true;
            break;
        }
    }

    if let Some(ref path) = temp_askpass_path {
        let _ = tokio::fs::remove_file(path).await;
    }

    if exited {
        let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
        let stderr = String::from_utf8_lossy(&output.stderr);
        let trimmed = stderr.trim();
        if trimmed.contains("Permission denied") {
            return Err(format!("AUTH_PASSWORD_REQUIRED: {}", trimmed));
        }
        return Err(format!(
            "SSH could not connect: {}. Use your terminal to accept the host key or unlock your SSH agent first.",
            trimmed.chars().take(800).collect::<String>()
        ));
    }
    let (cancel, mut rx) = watch::channel(false);
    app.state::<Remotes>().jobs.lock().unwrap().insert(
        id.clone(),
        Job {
            cancel: cancel.clone(),
            info: Connection {
                id: id.clone(),
                kind: "ssh".into(),
                label: format!("{}@{}", options.user, options.host),
                local_port: options.local_port,
                url: None,
            },
        },
    );
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let errors = child.stderr.take().unwrap();
        let drain = tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut text = Vec::new();
            let _ = errors.take(8192).read_to_end(&mut text).await;
            text
        });
        tokio::select! {_ =rx.changed()=>{let _=child.kill().await;},result=child.wait()=>{if result.is_err()||result.is_ok_and(|s|!s.success()){let _=app.emit("devyy-remote-error","The SSH connection ended. Check your network and SSH agent.");}}}
        drain.abort();
        let remotes = app.state::<Remotes>();
        let mut jobs = remotes.jobs.lock().unwrap();
        if jobs
            .get(&task_id)
            .is_some_and(|job| job.cancel.same_channel(&cancel))
        {
            jobs.remove(&task_id);
        }
        drop(jobs);
        let _ = app.emit("devyy-remote-changed", ());
    });
    Ok(id)
}
#[tauri::command]
pub async fn port_forward(
    app: tauri::AppHandle,
    server_url: String,
    tunnel_id: String,
    port: u16,
    protocol: Option<String>,
) -> Result<String, String> {
    if port == 0
        || tunnel_id.is_empty()
        || !tunnel_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err("Choose a valid tunnel and local port".into());
    }
    let is_https = protocol.as_deref() == Some("https");
    let server = account::server(&server_url)?;
    let token = account::token(&server)?;
    let url = format!(
        "{}/api/tunnels/{tunnel_id}/connect",
        server
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1)
    );
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = url.into_client_request().map_err(|e| e.to_string())?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|_| "Invalid device credential")?,
    );
    let (socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|_| "Could not connect the forwarded port. Check your account and server.")?;
    let id = format!("port-{tunnel_id}");
    let (cancel, mut rx) = watch::channel(false);
    {
        let state = app.state::<Remotes>();
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.contains_key(&id) {
            return Err("This port is already forwarded".into());
        }
        jobs.insert(
            id.clone(),
            Job {
                cancel: cancel.clone(),
                info: Connection {
                    id: id.clone(),
                    kind: "port".into(),
                    label: format!("localhost:{port}"),
                    local_port: port,
                    url: None,
                },
            },
        );
    }
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let (mut tx, mut stream) = socket.split();
        let (responses, mut queue) = tokio::sync::mpsc::channel::<Value>(32);
        let slots = Arc::new(tokio::sync::Semaphore::new(8));
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .danger_accept_invalid_certs(true)
            .no_proxy()
            .build()
            .unwrap();
        loop {
            tokio::select! {_ =rx.changed()=>break,response=queue.recv()=>{let Some(response)=response else{break};if tx.send(tokio_tungstenite::tungstenite::Message::Text(response.to_string().into())).await.is_err(){break;}},incoming=stream.next()=>{match incoming{Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text)))=>{if text.len()>1500*1024{break;}let Ok(value)=serde_json::from_str::<Value>(&text) else{break;};let id=value["id"].as_str().unwrap_or("").to_owned();let Ok(slot)=slots.clone().try_acquire_owned()else{let _=responses.try_send(json!({"id":id,"status":503,"body":STANDARD.encode("Forwarding is busy"),"headers":[]}));continue;};let client=client.clone();let responses=responses.clone();tokio::spawn(async move{let _slot=slot;let result=forward_request(&client,port,is_https,&value).await.unwrap_or_else(|message|json!({"status":502,"body":STANDARD.encode(message),"headers":[]}));let mut result=result;result["id"]=json!(id);let _=responses.send(result).await;});},Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(bytes)))=>{let _=tx.send(tokio_tungstenite::tungstenite::Message::Pong(bytes)).await;},Some(Ok(tokio_tungstenite::tungstenite::Message::Pong(_)))=>{},_=>break}}}
        }
        let remotes = app.state::<Remotes>();
        let mut jobs = remotes.jobs.lock().unwrap();
        if jobs
            .get(&task_id)
            .is_some_and(|job| job.cancel.same_channel(&cancel))
        {
            jobs.remove(&task_id);
        }
        drop(jobs);
        let _ = app.emit("devyy-remote-changed", ());
    });
    Ok(id)
}
async fn forward_request(
    client: &reqwest::Client,
    port: u16,
    is_https: bool,
    value: &Value,
) -> Result<Value, String> {
    let path = value["path"].as_str().ok_or("Missing forwarded path")?;
    if !path.starts_with('/') || path.starts_with("//") || path.contains(['\\', '\r', '\n']) {
        return Err("Invalid forwarded path".into());
    }
    let scheme = if is_https { "https" } else { "http" };
    let url = reqwest::Url::parse(&format!("{scheme}://127.0.0.1:{port}{path}"))
        .map_err(|_| "Invalid local URL")?;
    if url.host_str() != Some("127.0.0.1") || url.port() != Some(port) {
        return Err("Only the selected local port can be forwarded".into());
    }
    let method = reqwest::Method::from_bytes(value["method"].as_str().unwrap_or("GET").as_bytes())
        .map_err(|_| "Invalid forwarded method")?;
    if method == reqwest::Method::CONNECT {
        return Err("CONNECT is not supported".into());
    }
    let body = STANDARD
        .decode(value["body"].as_str().unwrap_or(""))
        .map_err(|_| "Invalid request body")?;
    if body.len() > 1024 * 1024 {
        return Err("Request exceeds 1 MiB".into());
    }
    let mut request = client.request(method, url).body(body);
    if let Some(headers) = value["headers"].as_array() {
        for h in headers {
            if let (Some(k), Some(v)) = (h[0].as_str(), h[1].as_str()) {
                if !matches!(
                    k.to_lowercase().as_str(),
                    "authorization"
                        | "cookie"
                        | "host"
                        | "connection"
                        | "upgrade"
                        | "transfer-encoding"
                        | "content-length"
                ) {
                    request = request.header(k, v);
                }
            }
        }
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "The local application is not responding")?;
    let status = response.status().as_u16();
    let headers: Vec<_> = response
        .headers()
        .iter()
        .filter(|(k, _)| {
            !matches!(
                k.as_str(),
                "set-cookie" | "transfer-encoding" | "content-length" | "connection"
            )
        })
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_owned(), v.to_owned()))
        })
        .collect();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Local response interrupted")?
    {
        if body.len() + chunk.len() > 1024 * 1024 {
            return Err("Response exceeds 1 MiB".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(json!({"status":status,"headers":headers,"body":STANDARD.encode(body)}))
}

#[derive(Clone)]
pub(crate) struct SshWorkspace {
    pub host: String,
    pub user: String,
    pub port: u16,
    path: String,
    pub mount: std::path::PathBuf,
}

static WORKSPACES: Mutex<Vec<SshWorkspace>> = Mutex::new(Vec::new());

pub(crate) fn ssh_workspace(path: &std::path::Path) -> Option<SshWorkspace> {
    WORKSPACES
        .lock()
        .ok()?
        .iter()
        .find(|entry| path.starts_with(&entry.mount))
        .cloned()
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

impl SshWorkspace {
    pub fn destination(&self) -> String {
        format!("{}@{}", self.user, self.host)
    }

    pub fn remote_directory(&self, local: &std::path::Path) -> String {
        let base = if self.path.starts_with('/') {
            shell_quote(&self.path)
        } else {
            format!("\"$HOME\"/{}", shell_quote(&self.path))
        };
        let relative = local
            .strip_prefix(&self.mount)
            .unwrap_or(local)
            .to_string_lossy();
        if relative.is_empty() {
            base
        } else {
            format!("{base}/{}", shell_quote(&relative.replace('\\', "/")))
        }
    }

    pub fn command_at(
        &self,
        local: &std::path::Path,
        script: &str,
    ) -> Result<std::process::Command, String> {
        self.ensure_mounted()?;
        let mut command = crate::process::command("ssh");
        command.args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-p",
            &self.port.to_string(),
            &self.destination(),
        ]);
        command.arg(format!(
            "cd {} && sh -c {}",
            self.remote_directory(local),
            shell_quote(script)
        ));
        Ok(command)
    }

    pub fn ensure_mounted(&self) -> Result<(), String> {
        if is_mounted(&self.mount) {
            Ok(())
        } else {
            Err("The SSH workspace disconnected. Reopen it in Remote Explorer.".into())
        }
    }
}

fn is_mounted(mount: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        mount
            .parent()
            .and_then(|parent| std::fs::metadata(parent).ok())
            .zip(std::fs::metadata(mount).ok())
            .is_some_and(|(local, remote)| local.dev() != remote.dev())
    }
    #[cfg(not(unix))]
    {
        std::fs::metadata(mount).is_ok_and(|metadata| metadata.is_dir())
    }
}

struct WorkspaceMount {
    // The foreground SSHFS process owns the mount for the lifetime of the app.
    _process: tokio::process::Child,
    _directory: MountDirectory,
}

struct MountDirectory(std::path::PathBuf);

impl Drop for MountDirectory {
    fn drop(&mut self) {
        // An SSHFS directory may still be mounted here. Never recurse into it.
        let _ = std::fs::remove_dir(self.0.join("workspace"));
        let _ = std::fs::remove_dir(&self.0);
    }
}

#[tauri::command]
pub async fn ssh_mount_workspace(
    app: tauri::AppHandle,
    host: String,
    user: String,
    ssh_port: u16,
    remote_path: String,
    password: Option<String>,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    if !valid_host(&host) || !valid_host(&user) || user.contains(':') || ssh_port == 0 {
        return Err("Invalid SSH connection settings".into());
    }
    if remote_path.contains(['\n', '\r', '\0']) {
        return Err("Invalid remote workspace path".into());
    }
    let path = remote_path.trim();
    let path = if path == "~" {
        ""
    } else {
        path.strip_prefix("~/").unwrap_or(path)
    };
    let existing = WORKSPACES
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .rev()
        .find(|entry| {
            entry.host == host && entry.user == user && entry.port == ssh_port && entry.path == path
        })
        .cloned();
    if let Some(existing) = existing {
        if let Ok(Ok(mount)) = tokio::task::spawn_blocking(move || {
            existing.ensure_mounted()?;
            Ok::<_, String>(existing.mount)
        })
        .await
        {
            return Ok(crate::workspace::display_path(&mount));
        }
    }
    let directory = MountDirectory(
        tempfile::tempdir()
            .map_err(|error| error.to_string())?
            .keep(),
    );
    let mount = directory.0.join("workspace");
    #[cfg(not(windows))]
    tokio::fs::create_dir(&mount)
        .await
        .map_err(|error| error.to_string())?;

    #[cfg(windows)]
    let mut cmd = {
        let installed = std::env::var_os("ProgramFiles")
            .map(std::path::PathBuf::from)
            .map(|path| path.join("SSHFS-Win/bin/sshfs-win.exe"))
            .filter(|path| path.is_file());
        let mut command =
            tokio::process::Command::new(installed.unwrap_or_else(|| "sshfs-win.exe".into()));
        command.creation_flags(0x08000000).arg("cmd");
        command
    };
    #[cfg(not(windows))]
    let mut cmd = tokio::process::Command::new("sshfs");

    let host_arg = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.clone()
    };
    cmd.arg(format!("{user}@{host_arg}:{path}"))
        .arg(&mount)
        .arg("-f")
        .args([
            "-p",
            &ssh_port.to_string(),
            "-o",
            "StrictHostKeyChecking=accept-new",
        ])
        .args(["-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15"])
        .args([
            "-o",
            "dir_cache=no",
            "-o",
            "direct_io",
            "-o",
            "transform_symlinks",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let password = password.filter(|value| !value.is_empty());
    if password
        .as_ref()
        .is_some_and(|value| value.contains(['\n', '\r', '\0']))
    {
        return Err("SSH passwords cannot contain a line break or NUL".into());
    }
    if password.is_some() {
        cmd.args(["-o", "password_stdin"])
            .stdin(std::process::Stdio::piped());
    } else {
        cmd.args(["-o", "BatchMode=yes"])
            .stdin(std::process::Stdio::null());
    }
    let mut process = cmd.spawn().map_err(|error| {
        format!("Could not start SSHFS. Install SSHFS, or WinFsp and SSHFS-Win on Windows. {error}")
    })?;
    if let (Some(password), Some(mut stdin)) = (password, process.stdin.take()) {
        stdin
            .write_all(format!("{password}\n").as_bytes())
            .await
            .map_err(|error| error.to_string())?;
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if process
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            let output = process
                .wait_with_output()
                .await
                .map_err(|error| error.to_string())?;
            return Err(format!(
                "Could not mount SSH workspace: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let candidate = mount.clone();
        if tokio::time::timeout_at(
            deadline,
            tokio::task::spawn_blocking(move || is_mounted(&candidate)),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false)
        {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Timed out opening the SSH workspace".into());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    if let Some(mut stderr) = process.stderr.take() {
        tokio::spawn(async move {
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        });
    }
    let mount = mount.canonicalize().map_err(|error| error.to_string())?;
    WORKSPACES
        .lock()
        .map_err(|error| error.to_string())?
        .push(SshWorkspace {
            host,
            user,
            port: ssh_port,
            path: path.to_owned(),
            mount: mount.clone(),
        });
    app.state::<Remotes>()
        .mounts
        .lock()
        .map_err(|error| error.to_string())?
        .push(WorkspaceMount {
            _process: process,
            _directory: directory,
        });
    Ok(crate::workspace::display_path(&mount))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssh_arguments_are_not_shell_commands() {
        assert!(valid_host("example.com"));
        assert!(valid_host("2001:db8::1"));
        assert!(!valid_host("-oProxyCommand=bad"));
        assert!(!valid_host("host; echo x"));
        assert!(!valid_host("user@host"));
    }
}
