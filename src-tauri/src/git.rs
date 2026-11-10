use crate::workspace::{resolve, root, Workspace};
use serde::Serialize;
use std::{path::Path, process::Command};
use tauri::State;
#[derive(Serialize)]
pub struct Change {
    pub path: String,
    pub index: String,
    pub worktree: String,
}
#[derive(Serialize)]
pub struct GitState {
    pub branch: String,
    pub changes: Vec<Change>,
}
fn git(base: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(base)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into())
}
#[tauri::command]
pub async fn git_status(state: State<'_, Workspace>) -> Result<GitState, String> {
    let base = root(&state)?;
    let branch = git(&base, &["branch", "--show-current"])?;
    let prefix = git(&base, &["rev-parse", "--show-prefix"])?;
    let prefix = prefix.trim_end_matches('\n');
    let raw = git(
        &base,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )?;
    let mut records = raw.split('\0').filter(|s| !s.is_empty());
    let mut changes = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let index = &record[0..1];
        let worktree = &record[1..2];
        if index == "R" || index == "C" {
            records.next();
        }
        let Some(path) = record[3..].strip_prefix(prefix) else {
            continue;
        };
        changes.push(Change {
            path: path.into(),
            index: index.into(),
            worktree: worktree.into(),
        });
    }
    Ok(GitState {
        branch: if branch.trim().is_empty() {
            "detached".into()
        } else {
            branch.trim().into()
        },
        changes,
    })
}
#[tauri::command]
pub async fn git_diff(
    path: String,
    staged: bool,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let base = root(&state)?;
    let mut args = vec!["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", &path]);
    let diff = git(&base, &args)?;
    if diff.is_empty() && !staged {
        if let Ok(full) = resolve(&base, &path, false) {
            if let Ok(content) = std::fs::read_to_string(full) {
                return Ok(format!("New or unchanged file: {path}\n\n{content}"));
            }
        }
    }
    Ok(diff)
}
#[tauri::command]
pub async fn git_stage(
    path: String,
    staged: bool,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let base = root(&state)?;
    // git uses a pathspec, so literal mode prevents wildcard interpretation.
    if staged {
        if git(&base, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            git(
                &base,
                &["--literal-pathspecs", "restore", "--staged", "--", &path],
            )?;
        } else {
            git(
                &base,
                &["--literal-pathspecs", "rm", "--cached", "--", &path],
            )?;
        }
    } else {
        git(&base, &["--literal-pathspecs", "add", "--", &path])?;
    }
    Ok(())
}
#[tauri::command]
pub async fn git_commit(message: String, state: State<'_, Workspace>) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first".into());
    }
    git(&root(&state)?, &["commit", "-m", &message])
}
