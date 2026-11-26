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

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Accounts {
    attempt: AtomicU64,
}
fn random() -> String {
    let mut value = [0; 32];
    SystemRandom::new().fill(&mut value).unwrap();
    URL_SAFE_NO_PAD.encode(value)
}
pub const ACCOUNT_ORIGIN: &str = "https://api.devyy.dev";
const AUTH_ORIGIN: &str = "https://auth.devyy.dev";

#[tauri::command]
pub fn account_origin() -> &'static str {
    #[cfg(debug_assertions)]
    if std::env::var("DEVYY_LOCAL_ACCOUNT").as_deref() == Ok("1") {
        return "http://localhost:8787";
    }
    ACCOUNT_ORIGIN
}

fn auth_origin() -> &'static str {
    if account_origin() != ACCOUNT_ORIGIN {
        return "http://localhost:3001";
    }
    AUTH_ORIGIN
}

#[cfg(test)]
fn server(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Enter a valid Devyy server URL")?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Use the server origin without a path, credentials or query".into());
    }
    if url.scheme() != "https"
        && !(cfg!(debug_assertions)
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1")))
    {
        return Err(
            "Devyy accounts require HTTPS; local HTTP is available in development builds".into(),
        );
    }
    Ok(value.trim_end_matches('/').into())
}
fn entry(server: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new("Devyy Account", server)
}

#[cfg(target_os = "linux")]
fn credential_path(app: &tauri::AppHandle, server: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(if server == ACCOUNT_ORIGIN {
            "account-token"
        } else {
            "account-token-local"
        }))
}

pub fn token(_app: &tauri::AppHandle, server: &str) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    if let Ok(token) = credential_path(_app, server).and_then(|path| {
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        if !metadata.is_file()
            || metadata.permissions().mode() & 0o077 != 0
            || metadata.len() > 4096
        {
            return Err("Invalid account credential file".into());
        }
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    }) {
        return if token.is_empty() {
            Err("Sign in to your Devyy account first".into())
        } else {
            Ok(token)
        };
    }
    entry(server)
        .and_then(|entry| entry.get_password())
        .map_err(|error| match error {
            keyring::Error::NoEntry => "Sign in to your Devyy account first".into(),
            error => format!("Could not read the Devyy credential store: {error}"),
        })
}

fn save_token(_app: &tauri::AppHandle, server: &str, token: &str) -> Result<(), String> {
    let result = entry(server)
        .and_then(|entry| entry.set_password(token))
        .map_err(|e| e.to_string());
    #[cfg(target_os = "linux")]
    {
        let path = credential_path(_app, server)?;
        if result.is_ok() {
            remove_credential_file(&path)?;
            return Ok(());
        }
        // Keep a private local credential when Linux has no Secret Service.
        write_credential_file(&path, token)
    }
    #[cfg(not(target_os = "linux"))]
    result
}

#[cfg(target_os = "linux")]
fn write_credential_file(path: &std::path::Path, token: &str) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Missing credential directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staged
        .write_all(token.as_bytes())
        .map_err(|e| e.to_string())?;
    staged.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn remove_credential_file(path: &std::path::Path) -> Result<bool, String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

pub fn client() -> Result<reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> =
        std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("devyy/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(35))
                .build()
                .map_err(|e| e.to_string())
        })
        .clone()
}

pub(crate) fn connection_error(error: &reqwest::Error, service: &str) -> String {
    if error.is_timeout() {
        format!("{service} did not respond in time")
    } else if error.is_connect() {
        format!("Could not connect to {service}. Check your connection or proxy.")
    } else {
        format!("Could not complete the request to {service}")
    }
}

async fn decode(mut response: reqwest::Response) -> Result<Value, String> {
    let limit = if response.url().path() == "/api/sync" {
        8 * 1024 * 1024 + 4096
    } else {
        2 * 1024 * 1024
    };
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The server response was interrupted")?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("The account response exceeded its size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Sign in to your Devyy account first".into());
    }
    let decoded = serde_json::from_slice::<Value>(&bytes);
    if !status.is_success() {
        return Err(decoded
            .ok()
            .and_then(|value| value["error"].as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("The Devyy server returned HTTP {}", status.as_u16())));
    }
    decoded.map_err(|_| "The Devyy server returned invalid JSON".into())
}
#[tauri::command]
pub fn account_begin(app: tauri::AppHandle) -> Result<Value, String> {
    let verifier = random();
    let nonce = random();
    let challenge =
        URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref());
    let attempt = app
        .state::<Accounts>()
        .attempt
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let mut url = reqwest::Url::parse(&format!("{}/authorize/", auth_origin())).unwrap();
    url.query_pairs_mut()
        .append_pair("state", &nonce)
        .append_pair("challenge", &challenge)
        .append_pair("device", &format!("Devyy on {}", std::env::consts::OS))
        .append_pair("poll", "1");
    tauri::async_runtime::spawn(async move {
        if let Err(error) = poll(&app, attempt, &nonce, &verifier).await {
            if app.state::<Accounts>().attempt.load(Ordering::SeqCst) == attempt {
                let _ = app.emit("devyy-account-error", error);
            }
        }
    });
    Ok(json!({"url":url.as_str()}))
}

async fn poll(
    app: &tauri::AppHandle,
    attempt: u64,
    nonce: &str,
    verifier: &str,
) -> Result<(), String> {
    let client = client()?;
    let started = Instant::now();
    let current = || app.state::<Accounts>().attempt.load(Ordering::SeqCst) == attempt;
    while started.elapsed() < Duration::from_secs(600) && current() {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if !current() {
            return Ok(());
        }
        let response = client
            .post(format!("{}/api/desktop/poll", account_origin()))
            .json(&json!({"state":nonce,"verifier":verifier}))
            .send()
            .await;
        let Ok(response) = response else { continue };
        if response.status() == reqwest::StatusCode::NO_CONTENT
            || response.status().is_server_error()
        {
            continue;
        }
        let value = decode(response).await?;
        let token = value["token"]
            .as_str()
            .filter(|token| token.len() <= 4096)
            .ok_or("Missing or invalid device credential")?;
        if current() {
            let credential_app = app.clone();
            let token = token.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                if credential_app
                    .state::<Accounts>()
                    .attempt
                    .load(Ordering::SeqCst)
                    == attempt
                {
                    save_token(&credential_app, account_origin(), &token)?;
                }
                Ok::<_, String>(())
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|error| format!("Could not save the device credential: {error}"))?;
            if current() {
                let _ = app.emit("devyy-account-changed", account_origin());
            }
        }
        return Ok(());
    }
    if current() {
        Err("Sign-in expired. Start again from Devyy.".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn account_request(
    app: tauri::AppHandle,
    path: String,
    method: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let server = account_origin().to_owned();
    let allowed = matches!(
        path.as_str(),
        "/me" | "/sync" | "/sessions" | "/logout" | "/tunnels"
    ) || ["/sessions/", "/tunnels/"].iter().any(|prefix| {
        path.strip_prefix(prefix).is_some_and(|id| {
            !id.is_empty()
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
        })
    });
    if !allowed || !["GET", "PUT", "POST", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err("Unsupported account operation".into());
    }
    // Linux Secret Service and OS keychains may block on IPC. Keep this off
    // the async workers that also service requests from the webview.
    let credential_app = app.clone();
    let credential_server = server.clone();
    let token =
        tauri::async_runtime::spawn_blocking(move || token(&credential_app, &credential_server))
            .await
            .map_err(|e| e.to_string())??;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client()?
        .request(method, format!("{server}/api{path}"))
        .bearer_auth(token);
    if let Some(body) = body {
        let limit = if path == "/sync" {
            8 * 1024 * 1024
        } else {
            1024 * 1024
        };
        if body.to_string().len() > limit {
            return Err("The account request exceeds its size limit".into());
        }
        request = request.json(&body);
    }
    decode(
        request
            .send()
            .await
            .map_err(|error| connection_error(&error, "the Devyy API"))?,
    )
    .await
}
#[tauri::command]
pub async fn account_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<Accounts>()
        .attempt
        .fetch_add(1, Ordering::SeqCst);
    let server = account_origin().to_owned();
    if let Ok(token) = token(&app, &server) {
        let _ = client()?
            .post(format!("{server}/api/logout"))
            .bearer_auth(token)
            .send()
            .await;
    }
    let deletion = entry(&server).and_then(|entry| entry.delete_credential());
    #[cfg(target_os = "linux")]
    {
        let path = credential_path(&app, &server)?;
        if matches!(deletion, Ok(()) | Err(keyring::Error::NoEntry)) {
            remove_credential_file(&path)?;
        } else {
            // Suppress any stale keyring entry if the service comes back later.
            write_credential_file(&path, "")?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    match deletion {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_origins_are_bounded() {
        assert!(server("https://www.devyy.dev").is_ok());
        assert!(server("https://x.devyy.dev/path").is_err());
        assert!(server("https://user:pass@devyy.dev").is_err());
        assert!(server("http://example.com").is_err());
    }
}
