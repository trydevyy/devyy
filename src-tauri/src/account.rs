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
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Accounts {
    pending: Mutex<HashMap<String, Pending>>,
}
struct Pending {
    server: String,
    verifier: String,
    started: Instant,
}
fn random() -> String {
    let mut value = [0; 32];
    SystemRandom::new().fill(&mut value).unwrap();
    URL_SAFE_NO_PAD.encode(value)
}
pub const ACCOUNT_ORIGIN: &str = "https://api.devyy.dev";
const WEBSITE_ORIGIN: &str = "https://www.devyy.dev";

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
fn entry(server: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("Devyy Account", server).map_err(|e| e.to_string())
}
pub fn token(server: &str) -> Result<String, String> {
    entry(server)?
        .get_password()
        .map_err(|_| "Sign in to your Devyy account first".into())
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|e| e.to_string())
}
async fn decode(mut response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The server response was interrupted")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("The account response exceeded 2 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "The Devyy server returned an invalid response")?;
    if !status.is_success() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("The Devyy server rejected this request")
            .to_owned());
    }
    Ok(value)
}
#[tauri::command]
pub fn account_begin(state: tauri::State<'_, Accounts>) -> Result<Value, String> {
    let server = ACCOUNT_ORIGIN.to_owned();
    let verifier = random();
    let nonce = random();
    let challenge =
        URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref());
    let mut pending = state.pending.lock().unwrap();
    pending.retain(|_, p| p.started.elapsed() < Duration::from_secs(600));
    if pending.len() > 4 {
        pending.clear();
    }
    pending.insert(
        nonce.clone(),
        Pending {
            server: server.clone(),
            verifier,
            started: Instant::now(),
        },
    );
    let mut url = reqwest::Url::parse(&format!("{WEBSITE_ORIGIN}/authorize/")).unwrap();
    url.query_pairs_mut()
        .append_pair("state", &nonce)
        .append_pair("challenge", &challenge)
        .append_pair("device", &format!("Devyy on {}", std::env::consts::OS));
    Ok(json!({"url":url.as_str()}))
}
#[tauri::command]
pub async fn account_finish(url: String, app: tauri::AppHandle) -> Result<Value, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid account callback")?;
    if url.scheme() != "devyy" || url.host_str() != Some("account") || url.path() != "/callback" {
        return Err("Unknown account callback".into());
    }
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let nonce = query.get("state").ok_or("Missing sign-in state")?;
    let code = query.get("code").ok_or("Missing authorization code")?;
    let pending = app
        .state::<Accounts>()
        .pending
        .lock()
        .unwrap()
        .remove(nonce)
        .ok_or("Start sign-in from Devyy again")?;
    if pending.started.elapsed() > Duration::from_secs(600) {
        return Err("Sign-in expired. Start again.".into());
    }
    let value = decode(
        client()?
            .post(format!("{}/api/desktop/token", pending.server))
            .json(&json!({"code":code,"verifier":pending.verifier}))
            .send()
            .await
            .map_err(|_| "Could not reach the account server")?,
    )
    .await?;
    let token = value["token"].as_str().ok_or("Missing device credential")?;
    if token.len() > 4096 {
        return Err("Invalid device credential".into());
    }
    entry(&pending.server)?
        .set_password(token)
        .map_err(|e| format!("Could not save the device credential: {e}"))?;
    let _ = app.emit("devyy-account-changed", pending.server.clone());
    Ok(json!({"server":pending.server,"connected":true}))
}
#[tauri::command]
pub async fn account_request(
    path: String,
    method: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let server = ACCOUNT_ORIGIN.to_owned();
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
    let token = token(&server)?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client()?
        .request(method, format!("{server}/api{path}"))
        .bearer_auth(token);
    if let Some(body) = body {
        if body.to_string().len() > 1024 * 1024 {
            return Err("Sync payload exceeds 1 MiB".into());
        }
        request = request.json(&body);
    }
    decode(
        request
            .send()
            .await
            .map_err(|_| "Could not reach your Devyy server")?,
    )
    .await
}
#[tauri::command]
pub async fn account_disconnect() -> Result<(), String> {
    let server = ACCOUNT_ORIGIN.to_owned();
    if let Ok(token) = token(&server) {
        let _ = client()?
            .post(format!("{server}/api/logout"))
            .bearer_auth(token)
            .send()
            .await;
    }
    match entry(&server)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
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
