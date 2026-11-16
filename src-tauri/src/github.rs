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

use crate::{
    ai::{self, AiState},
    process,
};
use serde_json::{json, Value};
use std::{process::Stdio, time::Duration};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn run(binary: &str, args: &[&str]) -> Result<String, String> {
    let mut command = tokio::process::Command::from(process::command(binary));
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output())
        .await
        .map_err(|_| "GitHub request timed out")?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(1000)
            .collect());
    }
    if output.stdout.len() > 2 * 1024 * 1024 {
        return Err("GitHub response exceeded the size limit".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
async fn git_value(key: &str) -> String {
    run("git", &["config", "--global", "--get", key])
        .await
        .unwrap_or_default()
}
#[tauri::command]
pub async fn github_status() -> Result<Value, String> {
    let git = process::executable("git");
    #[allow(unused_mut)]
    let mut git_installed = git.is_some();
    #[cfg(target_os = "macos")]
    if git.as_deref() == Some(std::path::Path::new("/usr/bin/git")) {
        git_installed = run("xcode-select", &["--print-path"]).await.is_ok();
    }
    let gh = process::executable("gh");
    let (name, email) = if git_installed {
        (git_value("user.name").await, git_value("user.email").await)
    } else {
        (String::new(), String::new())
    };
    let mut value = json!({"gitInstalled":git_installed,"cliInstalled":gh.is_some(),"connected":false,"gitName":name,"gitEmail":email});
    if gh.is_none()
        || run("gh", &["auth", "status", "--hostname", "github.com"])
            .await
            .is_err()
    {
        return Ok(value);
    }
    let user: Value =
        serde_json::from_str(&run("gh", &["api", "--hostname", "github.com", "user"]).await?)
            .map_err(|_| "GitHub returned an invalid profile")?;
    let login = user["login"]
        .as_str()
        .ok_or("GitHub returned no account name")?;
    let mut email = user["email"].as_str().unwrap_or("").to_string();
    if email.is_empty() {
        if let Ok(emails) = run("gh", &["api", "--hostname", "github.com", "user/emails"]).await {
            if let Ok(Value::Array(emails)) = serde_json::from_str::<Value>(&emails) {
                email = emails
                    .iter()
                    .find(|e| e["primary"] == true && e["verified"] == true)
                    .and_then(|e| e["email"].as_str())
                    .unwrap_or("")
                    .into();
            }
        }
    }
    if email.is_empty() {
        email = format!(
            "{}+{login}@users.noreply.github.com",
            user["id"].as_u64().ok_or("GitHub returned no account ID")?
        );
    }
    value["connected"] = json!(true);
    value["account"] = json!({"login":login,"name":user["name"].as_str().filter(|n|!n.is_empty()).unwrap_or(login),"email":email,"avatarUrl":user["avatar_url"]});
    Ok(value)
}
fn device_code(line: &str) -> Option<&str> {
    line.split_whitespace().find(|word| {
        word.len() == 9
            && word.as_bytes()[4] == b'-'
            && word
                .bytes()
                .enumerate()
                .all(|(i, b)| i == 4 || b.is_ascii_uppercase() || b.is_ascii_digit())
    })
}
#[tauri::command]
pub async fn github_login(
    app: AppHandle,
    state: State<'_, AiState>,
    request_id: String,
    setup_git: bool,
) -> Result<Value, String> {
    if process::executable("gh").is_none() {
        return Err("Install GitHub CLI, then choose Check again.".into());
    }
    let (_guard, mut cancel) = ai::job(&state, &request_id, "github")?;
    let work = async {
        let mut command = tokio::process::Command::from(process::command("gh"));
        command.env(
            "GH_BROWSER",
            if cfg!(windows) {
                "cmd /c echo"
            } else {
                "/bin/echo"
            },
        );
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        command
            .args([
                "auth",
                "login",
                "--hostname",
                "github.com",
                "--git-protocol",
                "https",
                "--web",
                "--scopes",
                "read:user,user:email",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let _registration = ai::register_process(&app, child.id());
        let mut stdin = child
            .stdin
            .take()
            .ok_or("GitHub login input is unavailable")?;
        stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
        drop(stdin);
        let stdout = child
            .stdout
            .take()
            .ok_or("GitHub login output is unavailable")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("GitHub login output is unavailable")?;
        let read = |reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>| {
            let app = app.clone();
            let id = request_id.clone();
            async move {
                let mut lines = BufReader::new(reader).lines();
                let mut total = 0;
                while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
                    total += line.len();
                    if total > 256 * 1024 {
                        return Err("GitHub login output exceeded the size limit".to_string());
                    }
                    if let Some(code) = device_code(&line) {
                        let _ = app.emit("devyy-github-auth", json!({"requestId":id,"code":code,"url":"https://github.com/login/device"}));
                    }
                }
                Ok::<_, String>(())
            }
        };
        let (_, _, status) =
            tokio::try_join!(read(Box::new(stdout)), read(Box::new(stderr)), async {
                child.wait().await.map_err(|e| e.to_string())
            })?;
        if !status.success() {
            return Err("GitHub sign-in did not complete. Try again or check GitHub CLI with gh auth status.".into());
        }
        if setup_git {
            run("gh", &["auth", "setup-git", "--hostname", "github.com"]).await?;
        }
        github_status().await
    };
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(600), work) => result.map_err(|_|"GitHub sign-in expired. Try again.".to_string())?,
        _ = cancel.changed() => Err("GitHub sign-in cancelled".into())
    }
}
fn valid_identity(name: &str, email: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 200
        || email.len() > 254
        || !email.contains('@')
        || [name, email].iter().any(|v| v.contains(['\n', '\r', '\0']))
    {
        return Err("Enter a Git name and valid email address.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn github_git_identity(name: String, email: String) -> Result<(), String> {
    save_identity(&["--global"], &name, &email).await
}
async fn save_identity(scope: &[&str], name: &str, email: &str) -> Result<(), String> {
    valid_identity(name, email)?;
    let config = |tail: &[&str]| {
        let mut args = vec!["config".to_string()];
        args.extend(scope.iter().map(|s| s.to_string()));
        args.extend(tail.iter().map(|s| s.to_string()));
        args
    };
    let invoke = |args: Vec<String>| async move {
        run("git", &args.iter().map(String::as_str).collect::<Vec<_>>()).await
    };
    let previous = invoke(config(&["--get", "user.name"]))
        .await
        .unwrap_or_default();
    invoke(config(&["--replace-all", "--", "user.name", name.trim()])).await?;
    if let Err(error) = invoke(config(&["--replace-all", "--", "user.email", email.trim()])).await {
        let rollback = if previous.is_empty() {
            config(&["--unset-all", "user.name"])
        } else {
            config(&["--replace-all", "--", "user.name", &previous])
        };
        let _ = invoke(rollback).await;
        return Err(error);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn writes_only_the_requested_git_config_and_keeps_values_literal() {
        if process::executable("git").is_none() {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("test gitconfig");
        let scope = ["--file", file.to_str().unwrap()];
        save_identity(&scope, "Dev $(echo literal)", "dev@example.test")
            .await
            .unwrap();
        assert_eq!(
            run(
                "git",
                &[
                    "config",
                    "--file",
                    file.to_str().unwrap(),
                    "--get",
                    "user.name"
                ]
            )
            .await
            .unwrap(),
            "Dev $(echo literal)"
        );
        assert!(save_identity(&scope, "Invalid\nName", "other@example.test")
            .await
            .is_err());
        assert_eq!(
            run(
                "git",
                &[
                    "config",
                    "--file",
                    file.to_str().unwrap(),
                    "--get",
                    "user.email"
                ]
            )
            .await
            .unwrap(),
            "dev@example.test"
        );
    }
    #[test]
    fn codes_and_identities_are_validated() {
        assert_eq!(
            device_code("! First copy your one-time code: ABCD-1234"),
            Some("ABCD-1234")
        );
        assert_eq!(device_code("no device code here"), None);
        assert!(valid_identity("Dev", "dev@example.test").is_ok());
        assert!(valid_identity("Dev\nother", "dev@example.test").is_err());
        assert!(valid_identity("Dev", "invalid").is_err());
    }
}
