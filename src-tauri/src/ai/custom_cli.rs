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

use super::*;
use tokio::io::AsyncReadExt;

struct ProcessTree(Option<u32>);
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            stop_process_tree(pid);
        }
    }
}
fn json_event<R: tauri::Runtime>(app: &AppHandle<R>, id: &str, value: Value) -> Result<(), String> {
    match value["type"].as_str().unwrap_or("") {
        "delta" | "text" => if let Some(text) = value["text"].as_str().or(value["delta"].as_str()) { emit(app, id, "delta", json!(text)); },
        "reasoning" => if let Some(text) = value["text"].as_str() { emit(app, id, "reasoning", json!(text)); },
        "usage" => emit(app, id, "usage", value.get("usage").unwrap_or(&value).clone()),
        "cost" => emit(app, id, "cost", json!({"amount":value["amount"],"currency":"USD"})),
        "error" => return Err(value["message"].as_str().unwrap_or("CLI provider reported an error").into()),
        "done" => {},
        _ => return Err("Unknown CLI event. Use text, delta, reasoning, usage, cost, error or done JSONL events.".into()),
    }
    Ok(())
}
pub(super) async fn chat<R: tauri::Runtime>(
    app: &AppHandle<R>,
    p: &Provider,
    r: &ChatRequest,
) -> Result<(), String> {
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut command = cli(p)?;
    command
        .args(p.args.iter().map(|arg| arg.replace("{model}", &p.model)))
        .current_dir(scratch.path())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", p.name))?;
    let mut tree = ProcessTree(child.id());
    let _registration = register_process(app, child.id());
    let mut stdout = child.stdout.take().ok_or("CLI output is unavailable")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("CLI error output is unavailable")?;
    let mut stdin = child.stdin.take().ok_or("CLI input is unavailable")?;
    let input = if p.cli_json {
        serde_json::to_vec(
            &json!({"system":SYSTEM,"messages":r.messages,"model":p.model,"stream":true}),
        )
        .map_err(|e| e.to_string())?
    } else {
        format!("{SYSTEM}\n\n{}\n\nassistant:\n", transcript(&r.messages)).into_bytes()
    };
    let write = async move {
        stdin.write_all(&input).await.map_err(|e| e.to_string())?;
        stdin.shutdown().await.map_err(|e| e.to_string())?;
        drop(stdin);
        Ok::<_, String>(())
    };
    let read = async {
        let mut bytes = Vec::new();
        let mut total = 0usize;
        loop {
            let mut chunk = [0u8; 4096];
            let n = stdout.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            total += n;
            if total > 4 * 1024 * 1024 {
                return Err("CLI response exceeded the size limit".to_string());
            }
            bytes.extend_from_slice(&chunk[..n]);
            if p.cli_json {
                while let Some(end) = bytes.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = bytes.drain(..=end).collect();
                    if line.iter().all(u8::is_ascii_whitespace) {
                        continue;
                    }
                    json_event(
                        app,
                        &r.request_id,
                        serde_json::from_slice(&line)
                            .map_err(|_| "CLI returned invalid JSONL".to_string())?,
                    )?;
                }
                if bytes.len() > MAX_EVENT {
                    return Err("CLI event exceeded the size limit".into());
                }
            } else {
                let valid = match std::str::from_utf8(&bytes) {
                    Ok(_) => bytes.len(),
                    Err(e) if e.error_len().is_none() => e.valid_up_to(),
                    Err(_) => return Err("CLI output must be UTF-8".into()),
                };
                if valid > 0 {
                    emit(
                        app,
                        &r.request_id,
                        "delta",
                        json!(std::str::from_utf8(&bytes[..valid]).unwrap()),
                    );
                    bytes.drain(..valid);
                }
            }
        }
        if !bytes.is_empty() {
            if p.cli_json {
                json_event(
                    app,
                    &r.request_id,
                    serde_json::from_slice(&bytes)
                        .map_err(|_| "CLI returned incomplete JSONL".to_string())?,
                )?;
            } else {
                return Err("CLI returned incomplete UTF-8".into());
            }
        }
        Ok(())
    };
    let errors = async {
        let mut kept = Vec::new();
        let mut chunk = [0; 2048];
        loop {
            let n = stderr.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if kept.len() < 8192 {
                kept.extend_from_slice(&chunk[..n.min(8192 - kept.len())]);
            }
        }
        Ok::<_, String>(String::from_utf8_lossy(&kept).trim().to_string())
    };
    let ((), (), error, status) = tokio::time::timeout(Duration::from_secs(180), async {
        tokio::try_join!(write, read, errors, async {
            child.wait().await.map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|_| "CLI provider timed out after three minutes".to_string())??;
    tree.0 = None;
    if !status.success() {
        return Err(format!(
            "{} exited with {}{}",
            p.name,
            status,
            if error.is_empty() {
                String::new()
            } else {
                format!(": {error}")
            }
        ));
    }
    Ok(())
}
