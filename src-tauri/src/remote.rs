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
    #[serde(flatten)]
    credentials: crate::ssh::Credentials,
    local_port: u16,
    remote_port: u16,
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
    if options.local_port == 0 || options.remote_port == 0 {
        return Err("Choose valid local and remote ports.".into());
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", options.local_port))
        .await
        .map_err(|error| format!("Could not listen on port {}: {error}", options.local_port))?;
    let id = format!("ssh-{}", options.local_port);
    let label = format!("{}@{}", options.credentials.user, options.credentials.host);
    let session = Arc::new(crate::ssh::connect(options.credentials).await?);
    let (cancel, mut stop) = watch::channel(false);
    app.state::<Remotes>().jobs.lock().unwrap().insert(
        id.clone(),
        Job {
            cancel: cancel.clone(),
            info: Connection {
                id: id.clone(),
                kind: "ssh".into(),
                label,
                local_port: options.local_port,
                url: None,
            },
        },
    );
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut streams = tokio::task::JoinSet::new();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                _ = stop.changed() => break,
                _ = heartbeat.tick() => if session.is_closed() { break; },
                _ = streams.join_next(), if !streams.is_empty() => {},
                result = listener.accept(), if streams.len() < 64 => {
                    let Ok((mut socket, from)) = result else { break; };
                    let session = Arc::clone(&session);
                    let port = options.remote_port;
                    streams.spawn(async move {
                        let channel = session.channel_open_direct_tcpip("127.0.0.1", u32::from(port), "127.0.0.1", u32::from(from.port())).await;
                        if let Ok(channel) = channel {
                            let _ = tokio::io::copy_bidirectional(&mut socket, &mut channel.into_stream()).await;
                        }
                    });
                }
            }
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
#[tauri::command]
pub async fn port_forward(
    app: tauri::AppHandle,
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
    let server = account::ACCOUNT_ORIGIN;
    let token = account::token(&app, server)?;
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
        let (responses, mut queue) = tokio::sync::mpsc::channel::<Value>(64);
        let slots = Arc::new(tokio::sync::Semaphore::new(16));
        let active_ws_streams = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::<
            String,
            tokio::sync::mpsc::Sender<Value>,
        >::new()));
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .danger_accept_invalid_certs(true)
            .no_proxy()
            .build()
            .unwrap();
        loop {
            tokio::select! {
                _ = rx.changed() => break,
                response = queue.recv() => {
                    let Some(response) = response else { break; };
                    if tx.send(tokio_tungstenite::tungstenite::Message::Text(response.to_string().into())).await.is_err() {
                        break;
                    }
                },
                incoming = stream.next() => {
                    match incoming {
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                            if text.len() > 1500 * 1024 { break; }
                            let Ok(value) = serde_json::from_str::<Value>(&text) else { break; };

                            match value["type"].as_str() {
                                Some("ws_open") => {
                                    let stream_id = value["stream_id"].as_str().unwrap_or("").to_owned();
                                    let path = value["path"].as_str().unwrap_or("/").to_owned();
                                    let ws_streams = active_ws_streams.clone();
                                    let to_server = responses.clone();
                                    tokio::spawn(async move {
                                        handle_local_ws(port, is_https, stream_id, path, ws_streams, to_server).await;
                                    });
                                }
                                Some("ws_client_msg") => {
                                    let stream_id = value["stream_id"].as_str().unwrap_or("");
                                    let streams = active_ws_streams.lock().await;
                                    if let Some(sender) = streams.get(stream_id) {
                                        let _ = sender.try_send(value);
                                    }
                                }
                                Some("ws_client_close") => {
                                    let stream_id = value["stream_id"].as_str().unwrap_or("");
                                    let mut streams = active_ws_streams.lock().await;
                                    streams.remove(stream_id);
                                }
                                _ => {
                                    let id = value["id"].as_str().unwrap_or("").to_owned();
                                    let Ok(slot) = slots.clone().try_acquire_owned() else {
                                        let _ = responses.try_send(json!({
                                            "id": id,
                                            "status": 503,
                                            "body": STANDARD.encode("Forwarding is busy"),
                                            "headers": []
                                        }));
                                        continue;
                                    };
                                    let client = client.clone();
                                    let responses = responses.clone();
                                    tokio::spawn(async move {
                                        let _slot = slot;
                                        let result = forward_request(&client, port, is_https, &value).await.unwrap_or_else(|message| {
                                            json!({"status": 502, "body": STANDARD.encode(message), "headers": []})
                                        });
                                        let mut result = result;
                                        result["id"] = json!(id);
                                        let _ = responses.send(result).await;
                                    });
                                }
                            }
                        },
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(bytes))) => {
                            let _ = tx.send(tokio_tungstenite::tungstenite::Message::Pong(bytes)).await;
                        },
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Pong(_))) => {},
                        _ => break
                    }
                }
            }
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

async fn handle_local_ws(
    port: u16,
    is_https: bool,
    stream_id: String,
    path: String,
    streams_map: Arc<
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::mpsc::Sender<Value>>>,
    >,
    to_server: tokio::sync::mpsc::Sender<Value>,
) {
    let scheme = if is_https { "wss" } else { "ws" };
    let url_str = format!("{scheme}://127.0.0.1:{port}{path}");
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let Ok(request) = url_str.into_client_request() else {
        let _ = to_server
            .send(json!({
                "stream_id": stream_id,
                "event": "close",
            }))
            .await;
        return;
    };

    let connect_res = tokio_tungstenite::connect_async(request).await;
    let (local_ws, _) = match connect_res {
        Ok(ws) => ws,
        Err(_) => {
            let _ = to_server
                .send(json!({
                    "stream_id": stream_id,
                    "event": "close",
                }))
                .await;
            return;
        }
    };

    let (mut local_sink, mut local_stream) = local_ws.split();
    let (client_tx, mut client_rx) = tokio::sync::mpsc::channel::<Value>(64);

    {
        let mut map = streams_map.lock().await;
        map.insert(stream_id.clone(), client_tx);
    }

    let s_id = stream_id.clone();
    let to_srv = to_server.clone();

    loop {
        tokio::select! {
            from_client = client_rx.recv() => {
                let Some(msg) = from_client else { break; };
                if let Some(text) = msg["data"].as_str() {
                    if local_sink.send(tokio_tungstenite::tungstenite::Message::Text(text.into())).await.is_err() {
                        break;
                    }
                } else if let Some(bin_b64) = msg["data_bin"].as_str() {
                    if let Ok(bin) = STANDARD.decode(bin_b64) {
                        if local_sink.send(tokio_tungstenite::tungstenite::Message::Binary(bin.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
            from_local = local_stream.next() => {
                match from_local {
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(txt))) => {
                        let _ = to_srv.send(json!({
                            "stream_id": s_id,
                            "event": "message",
                            "data": txt.to_string(),
                        })).await;
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(bin))) => {
                        let _ = to_srv.send(json!({
                            "stream_id": s_id,
                            "event": "message",
                            "data_bin": STANDARD.encode(bin),
                        })).await;
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    {
        let mut map = streams_map.lock().await;
        map.remove(&s_id);
    }

    let _ = to_srv
        .send(json!({
            "stream_id": s_id,
            "event": "close",
        }))
        .await;
}
