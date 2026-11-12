use crate::workspace::{resolve, root, Workspace};
use serde::Serialize;
use std::path::{Component, Path};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub index: String,
    pub worktree: String,
    pub old_path: Option<String>,
}
#[derive(Serialize)]
pub struct GitState {
    pub branch: String,
    pub changes: Vec<Change>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFiles {
    pub path: String,
    pub original: String,
    pub modified: String,
    pub binary: bool,
    pub staged: bool,
    pub old_path: Option<String>,
}
#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}
fn output(base: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let result = crate::process::command("git")
        .current_dir(base)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().into());
    }
    Ok(result.stdout)
}
fn git(base: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&output(base, args)?).into())
}
async fn background<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}
fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Expected a relative file path inside this workspace".into());
    }
    Ok(())
}
fn prefix(base: &Path) -> Result<String, String> {
    Ok(git(base, &["rev-parse", "--show-prefix"])?
        .trim_end_matches(['\r', '\n'])
        .into())
}
fn status(base: &Path) -> Result<GitState, String> {
    let branch = git(base, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_else(|_| "detached".into())
        .trim()
        .to_owned();
    let prefix = prefix(base)?;
    let raw = git(
        base,
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
        if record.len() < 4 || !record.is_char_boundary(3) {
            continue;
        }
        let index = &record[0..1];
        let worktree = &record[1..2];
        let old_path = if matches!(index, "R" | "C") || matches!(worktree, "R" | "C") {
            records
                .next()
                .and_then(|path| path.strip_prefix(&prefix))
                .map(str::to_owned)
        } else {
            None
        };
        let Some(path) = record[3..].strip_prefix(&prefix) else {
            continue;
        };
        changes.push(Change {
            path: path.into(),
            index: index.into(),
            worktree: worktree.into(),
            old_path,
        });
    }
    let upstream = git(
        base,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|s| s.trim().to_owned());
    let counts = git(
        base,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut counts = counts.split_whitespace();
    Ok(GitState {
        branch,
        changes,
        upstream,
        ahead: counts.next().and_then(|s| s.parse().ok()).unwrap_or(0),
        behind: counts.next().and_then(|s| s.parse().ok()).unwrap_or(0),
    })
}
fn read_blob(base: &Path, spec: &str) -> Result<Vec<u8>, String> {
    if output(base, &["cat-file", "-e", spec]).is_err() {
        return Ok(Vec::new());
    }
    let size = git(base, &["cat-file", "-s", spec])?
        .trim()
        .parse::<u64>()
        .map_err(|e| e.to_string())?;
    if size > 2 * 1024 * 1024 {
        return Err("This file is too large for the visual diff (2 MiB limit).".into());
    }
    output(base, &["show", spec])
}
fn diff_files(base: &Path, path: &str, staged: bool) -> Result<DiffFiles, String> {
    validate_path(path)?;
    let state = status(base)?;
    let change = state.changes.iter().find(|change| change.path == path);
    let old_path = change.and_then(|change| change.old_path.clone());
    let prefix = prefix(base)?;
    let original_path = if staged {
        old_path.as_deref().unwrap_or(path)
    } else {
        path
    };
    let original = read_blob(
        base,
        &format!(
            "{}:{}{}",
            if staged { "HEAD" } else { "" },
            prefix,
            original_path
        ),
    )?;
    let modified = if staged {
        read_blob(base, &format!(":{prefix}{path}"))?
    } else if base.join(path).exists() {
        let full = resolve(base, path, false)?;
        if std::fs::metadata(&full).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
            return Err("This file is too large for the visual diff (2 MiB limit).".into());
        }
        std::fs::read(full).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let binary = original.contains(&0)
        || modified.contains(&0)
        || std::str::from_utf8(&original).is_err()
        || std::str::from_utf8(&modified).is_err();
    Ok(DiffFiles {
        path: path.into(),
        original: if binary {
            String::new()
        } else {
            String::from_utf8(original).unwrap()
        },
        modified: if binary {
            String::new()
        } else {
            String::from_utf8(modified).unwrap()
        },
        binary,
        staged,
        old_path,
    })
}
fn stage(base: &Path, path: &str, staged: bool) -> Result<(), String> {
    validate_path(path)?;
    let state = status(base)?;
    let old_path = state
        .changes
        .iter()
        .find(|change| change.path == path)
        .and_then(|change| change.old_path.as_deref());
    let mut args = if staged {
        if git(base, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            vec!["--literal-pathspecs", "restore", "--staged", "--", path]
        } else {
            vec!["--literal-pathspecs", "rm", "--cached", "-r", "--", path]
        }
    } else {
        vec!["--literal-pathspecs", "add", "--", path]
    };
    if let Some(old) = old_path {
        args.push(old);
    }
    git(base, &args)?;
    Ok(())
}
#[tauri::command]
pub async fn git_status(state: State<'_, Workspace>) -> Result<GitState, String> {
    let base = root(&state)?;
    background(move || status(&base)).await
}
#[tauri::command]
pub async fn git_diff_files(
    path: String,
    staged: bool,
    state: State<'_, Workspace>,
) -> Result<DiffFiles, String> {
    let base = root(&state)?;
    background(move || diff_files(&base, &path, staged)).await
}
#[tauri::command]
pub async fn git_diff(
    path: String,
    staged: bool,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let base = root(&state)?;
    background(move || {
        validate_path(&path)?;
        let mut args = vec!["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", &path]);
        git(&base, &args)
    })
    .await
}
#[tauri::command]
pub async fn git_stage(
    path: String,
    staged: bool,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let base = root(&state)?;
    background(move || stage(&base, &path, staged)).await
}
#[tauri::command]
pub async fn git_stage_all(staged: bool, state: State<'_, Workspace>) -> Result<(), String> {
    let base = root(&state)?;
    background(move || {
        if staged {
            if git(&base, &["rev-parse", "--verify", "HEAD"]).is_ok() {
                git(&base, &["restore", "--staged", "--", "."])?;
            } else {
                git(&base, &["rm", "--cached", "-r", "--", "."])?;
            }
        } else {
            git(&base, &["add", "--all", "--", "."])?;
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn git_discard(path: String, state: State<'_, Workspace>) -> Result<(), String> {
    let base = root(&state)?;
    background(move || {
        validate_path(&path)?;
        git(
            &base,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--error-unmatch",
                "--",
                &path,
            ],
        )?;
        git(
            &base,
            &["--literal-pathspecs", "restore", "--worktree", "--", &path],
        )?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn git_branches(state: State<'_, Workspace>) -> Result<Vec<String>, String> {
    let base = root(&state)?;
    background(move || {
        Ok(git(
            &base,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        )?
        .lines()
        .map(str::to_owned)
        .collect())
    })
    .await
}
#[tauri::command]
pub async fn git_switch_branch(
    branch: String,
    create: bool,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let base = root(&state)?;
    background(move || {
        git(&base, &["check-ref-format", "--branch", &branch])?;
        if create {
            git(&base, &["switch", "-c", &branch])?;
        } else {
            git(&base, &["switch", "--", &branch])?;
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn git_history(state: State<'_, Workspace>) -> Result<Vec<Commit>, String> {
    let base = root(&state)?;
    background(move || {
        if git(&base, &["rev-parse", "--verify", "HEAD"]).is_err() {
            return Ok(Vec::new());
        }
        let raw = git(
            &base,
            &[
                "log",
                "-40",
                "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00",
                "--",
                ".",
            ],
        )?;
        let fields: Vec<_> = raw.split('\0').collect();
        Ok(fields
            .chunks(5)
            .filter(|row| row.len() == 5)
            .map(|row| Commit {
                hash: row[0].trim_start_matches('\n').into(),
                short: row[1].into(),
                author: row[2].into(),
                date: row[3].into(),
                subject: row[4].into(),
            })
            .collect())
    })
    .await
}
#[tauri::command]
pub async fn git_commit(message: String, state: State<'_, Workspace>) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first".into());
    }
    let base = root(&state)?;
    background(move || git(&base, &["commit", "-m", &message])).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repository() -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Devyy test"],
            vec!["config", "user.email", "test@devyy.local"],
            vec!["config", "commit.gpgsign", "false"],
            vec!["config", "core.hooksPath", "disabled-hooks"],
        ] {
            git(base, &args).unwrap();
        }
        temp
    }
    #[test]
    fn visual_diffs_keep_head_index_and_worktree_separate() {
        let temp = repository();
        let canonical = temp.path().canonicalize().unwrap();
        let base = canonical.as_path();
        std::fs::write(base.join("file name.rs"), "base\n").unwrap();
        stage(base, "file name.rs", false).unwrap();
        git(base, &["commit", "-m", "Initial"]).unwrap();
        std::fs::write(base.join("file name.rs"), "staged\n").unwrap();
        stage(base, "file name.rs", false).unwrap();
        std::fs::write(base.join("file name.rs"), "working\n").unwrap();
        let staged = diff_files(base, "file name.rs", true).unwrap();
        assert_eq!(staged.original, "base\n");
        assert_eq!(staged.modified, "staged\n");
        let working = diff_files(base, "file name.rs", false).unwrap();
        assert_eq!(working.original, "staged\n");
        assert_eq!(working.modified, "working\n");
        let state = status(base).unwrap();
        assert_eq!(state.changes[0].index, "M");
        assert_eq!(state.changes[0].worktree, "M");
        assert!(diff_files(base, "../outside", false).is_err());
        assert!(stage(base, "../outside", false).is_err());
    }
    #[test]
    fn visual_diffs_handle_unborn_renamed_deleted_binary_and_untracked_files() {
        let temp = repository();
        let canonical = temp.path().canonicalize().unwrap();
        let base = canonical.as_path();
        std::fs::write(base.join("before.txt"), "original\n").unwrap();
        stage(base, "before.txt", false).unwrap();
        assert!(diff_files(base, "before.txt", true)
            .unwrap()
            .original
            .is_empty());
        git(base, &["commit", "-m", "Initial"]).unwrap();
        git(base, &["mv", "before.txt", "after.txt"]).unwrap();
        let renamed = diff_files(base, "after.txt", true).unwrap();
        assert_eq!(renamed.old_path.as_deref(), Some("before.txt"));
        assert_eq!(renamed.original, "original\n");
        std::fs::remove_file(base.join("after.txt")).unwrap();
        let deleted = diff_files(base, "after.txt", false).unwrap();
        assert_eq!(deleted.original, "original\n");
        assert!(deleted.modified.is_empty());
        std::fs::write(base.join("new.txt"), "new\n").unwrap();
        let new = diff_files(base, "new.txt", false).unwrap();
        assert!(new.original.is_empty());
        assert_eq!(new.modified, "new\n");
        std::fs::write(base.join("binary.bin"), [0, 1, 2]).unwrap();
        assert!(diff_files(base, "binary.bin", false).unwrap().binary);
        stage(base, "after.txt", true).unwrap();
        assert!(status(base)
            .unwrap()
            .changes
            .iter()
            .all(|change| change.index.trim().is_empty() || change.index == "?"));
    }
}
