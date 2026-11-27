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

use super::{cli, opencode_directory, register_process, CliProcessTree, Provider, MAX_EVENT};
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) async fn claude<R: Runtime>(
    app: &AppHandle<R>,
    provider: &Provider,
) -> Result<Value, String> {
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut command = cli(provider)?;
    // Use the Agent SDK control protocol without sending a user prompt or loading project settings.
    command
        .args([
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--setting-sources=",
            "--settings",
            r#"{"disableAllHooks":true}"#,
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--no-session-persistence",
        ])
        .env("CLAUDE_CODE_ENTRYPOINT", "sdk")
        .env("ENABLE_CLAUDEAI_MCP_SERVERS", "false")
        .env("CLAUDE_CODE_AUTO_CONNECT_IDE", "0")
        .env("CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL", "1")
        .current_dir(scratch.path());
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start Claude Code to check plan limits.")?;
    let _registration = register_process(app, child.id());
    let _tree = CliProcessTree(child.id());
    let mut input = child.stdin.take().ok_or("Claude Code input unavailable.")?;
    let mut output = BufReader::new(
        child
            .stdout
            .take()
            .ok_or("Claude Code output unavailable.")?,
    );
    let result = tokio::time::timeout(PROBE_TIMEOUT, async {
        for (id, request) in [
            ("init", json!({"subtype":"initialize"})),
            (
                "usage",
                json!({"subtype":"get_usage","skip_behaviors":true}),
            ),
        ] {
            let message = json!({"type":"control_request","request_id":id,"request":request});
            input
                .write_all(format!("{message}\n").as_bytes())
                .await
                .ok()?;
            input.flush().await.ok()?;
            loop {
                let mut line = Vec::new();
                (&mut output)
                    .take(MAX_EVENT as u64)
                    .read_until(b'\n', &mut line)
                    .await
                    .ok()?;
                if line.is_empty() || line.len() >= MAX_EVENT {
                    return None;
                }
                let Ok(event) = serde_json::from_slice::<Value>(&line) else {
                    continue;
                };
                let response = &event["response"];
                if event["type"] != "control_response" || response["request_id"] != id {
                    continue;
                }
                if response["subtype"] != "success" {
                    return None;
                }
                if id == "usage" {
                    return Some(claude_limits(&response["response"]));
                }
                break;
            }
        }
        None
    })
    .await;
    match result {
        Ok(value) => Ok(value.unwrap_or(Value::Null)),
        Err(_) => Err("Claude Code took too long to check plan limits.".into()),
    }
}

fn claude_limits(response: &Value) -> Value {
    if response["rate_limits_available"] != true {
        return Value::Null;
    }
    let limits = &response["rate_limits"];
    let mut windows = Map::new();
    for (id, label) in [
        ("five_hour", "5-hour allowance"),
        ("seven_day", "Weekly allowance"),
        ("seven_day_oauth_apps", "Weekly connected apps allowance"),
        ("seven_day_opus", "Weekly Opus allowance"),
        ("seven_day_sonnet", "Weekly Sonnet allowance"),
    ] {
        let row = &limits[id];
        if let Some(percent) = row["utilization"]
            .as_f64()
            .filter(|percent| *percent >= 0.0)
        {
            windows.insert(
                id.into(),
                json!({
                    "rateLimitType": id, "label": label, "utilization": percent / 100.0,
                    "resetsAt": row["resets_at"],
                }),
            );
        }
    }
    if let Some(rows) = limits["model_scoped"].as_array() {
        for (index, row) in rows.iter().enumerate() {
            let (Some(name), Some(percent)) = (
                row["display_name"].as_str(),
                row["utilization"]
                    .as_f64()
                    .filter(|percent| *percent >= 0.0),
            ) else {
                continue;
            };
            let id = format!("model_{index}");
            windows.insert(
                id.clone(),
                json!({
                    "rateLimitType": id, "label": format!("Weekly · {name}"),
                    "utilization": percent / 100.0, "resetsAt": row["resets_at"],
                }),
            );
        }
    }
    let extra = &limits["extra_usage"];
    if extra["is_enabled"] == true {
        let amount_ratio = extra["used_credits"]
            .as_f64()
            .zip(extra["monthly_limit"].as_f64())
            .filter(|(used, limit)| *used >= 0.0 && *limit > 0.0)
            .map(|(used, limit)| used / limit);
        if let Some(utilization) = amount_ratio.or_else(|| {
            extra["utilization"]
                .as_f64()
                .filter(|percent| *percent >= 0.0)
                .map(|percent| percent / 100.0)
        }) {
            windows.insert("monthly_spend".into(), json!({
                "rateLimitType":"monthly_spend","label":"Monthly extra usage budget","utilization":utilization,
            }));
        }
    }
    if windows.is_empty() {
        Value::Null
    } else {
        json!({"claudeWindows":windows})
    }
}

pub(super) async fn opencode<R: Runtime>(
    app: &AppHandle<R>,
    provider: &Provider,
) -> Result<Value, String> {
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut cmd = cli(provider)?;
    cmd.args(["api", "GET", "/api/experimental/usage/limits"])
        .env("PWD", opencode_directory(scratch.path())?)
        .current_dir(scratch.path())
        .stdin(std::process::Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|_| "Could not start OpenCode to check plan limits.")?;
    let _registration = register_process(app, child.id());
    let _tree = CliProcessTree(child.id());
    let stdout = child.stdout.take().ok_or("OpenCode output unavailable.")?;
    tokio::time::timeout(PROBE_TIMEOUT, async {
        let mut output = Vec::new();
        stdout
            .take(MAX_EVENT as u64)
            .read_to_end(&mut output)
            .await
            .map_err(|e| e.to_string())?;
        if output.len() >= MAX_EVENT {
            return Err("OpenCode usage report exceeded the size limit.".into());
        }
        let success = child.wait().await.map_err(|e| e.to_string())?.success();
        if !success {
            // Older CLIs do not expose this API.
            return Ok(Value::Null);
        }
        Ok(serde_json::from_slice::<Value>(&output)
            .map(|response| opencode_limits(&response["data"]))
            .unwrap_or(Value::Null))
    })
    .await
    .map_err(|_| "OpenCode took too long to check plan limits.")?
}

fn opencode_limits(data: &Value) -> Value {
    let mut windows = Vec::new();
    for (id, label) in [
        ("rolling", "Go · Session"),
        ("weekly", "Go · Weekly"),
        ("monthly", "Go · Monthly"),
    ] {
        let row = &data["go"][id];
        if let Some(percent) = row["percent"].as_f64() {
            windows.push(json!({
                "label": label, "usedPercent": if row["limited"] == true {100.0} else {percent},
                "resetsAt": row["resetsAt"].as_f64().map(|ms| ms / 1000.0),
            }));
        }
    }
    if let Some(budgets) = data["budgets"].as_array() {
        for budget in budgets {
            let Some(limit) = budget["limit"].as_f64().filter(|limit| *limit >= 0.0) else {
                continue;
            };
            let scope = if budget["shared"] == true || budget["scope"] == "combined" {
                "Shared"
            } else {
                "Individual"
            };
            let reset = budget["resetsAt"].as_f64().map(|ms| ms / 1000.0);
            let mut add = |coverage: &str, spent: &Value| {
                if let Some(spent) = spent.as_f64().filter(|spent| *spent >= 0.0) {
                    windows.push(json!({
                        "label": format!("Console · {scope} · {coverage}"),
                        "usedPercent": if limit > 0.0 { spent / limit * 100.0 } else { 100.0 },
                        "resetsAt": reset,
                    }));
                }
            };
            let models = budget["models"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            if budget["per"] == "model"
                && budget["coverage"] == "models"
                && !models.is_empty()
                && models.iter().all(|model| model["spent"].is_number())
            {
                for model in models {
                    add(model["name"].as_str().unwrap_or("Model"), &model["spent"]);
                }
            } else {
                let coverage = match (budget["per"].as_str(), budget["coverage"].as_str()) {
                    (Some("model"), _) => "Most used model".into(),
                    (_, Some("all")) => "All spend".into(),
                    _ => models
                        .iter()
                        .filter_map(|model| model["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                };
                add(
                    if coverage.is_empty() {
                        "Models"
                    } else {
                        &coverage
                    },
                    &budget["spent"],
                );
            }
        }
    }
    if windows.is_empty() {
        Value::Null
    } else {
        json!({"planWindows":windows})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_account_percentages_convert_to_stream_fractions() {
        let limits = claude_limits(&json!({
            "rate_limits_available":true,
            "rate_limits":{
                "five_hour":{"utilization":25,"resets_at":"2026-11-27T15:00:00Z"},
                "seven_day":{"utilization":null},
                "model_scoped":[{"display_name":"Sonnet","utilization":42}],
                "extra_usage":{"is_enabled":true,"used_credits":5,"monthly_limit":20}
            }
        }));
        assert_eq!(limits["claudeWindows"]["five_hour"]["utilization"], 0.25);
        assert!(limits["claudeWindows"]["seven_day"].is_null());
        assert_eq!(
            limits["claudeWindows"]["model_0"]["label"],
            "Weekly · Sonnet"
        );
        assert_eq!(
            limits["claudeWindows"]["monthly_spend"]["utilization"],
            0.25
        );
        assert!(claude_limits(&json!({"rate_limits_available":false})).is_null());
    }

    #[test]
    fn opencode_reports_go_limits_and_scoped_console_budgets() {
        let limits = opencode_limits(&json!({
            "go":{"rolling":{"percent":86,"limited":true,"resetsAt":1795791600000u64}},
            "budgets":[{
                "limit":100,"spent":60,"shared":true,"per":"model","coverage":"models",
                "models":[{"name":"First","spent":40},{"name":"Second","spent":20}]
            }]
        }));
        let windows = limits["planWindows"].as_array().unwrap();
        assert_eq!(windows.len(), 3);
        assert_eq!(windows[0]["usedPercent"], 100.0);
        assert_eq!(windows[0]["resetsAt"], 1795791600.0);
        assert_eq!(windows[1]["label"], "Console · Shared · First");
        assert_eq!(windows[2]["usedPercent"], 20.0);
        assert!(opencode_limits(&Value::Null).is_null());
    }
}
