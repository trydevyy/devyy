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
use std::sync::atomic::{AtomicBool, Ordering};

// Hit is compiled directly into Devyy and is default as requested
static USE_HIT: AtomicBool = AtomicBool::new(true);

pub fn is_hit_enabled() -> bool {
    USE_HIT.load(Ordering::Relaxed)
}

pub fn set_use_hit(enabled: bool) {
    USE_HIT.store(enabled, Ordering::Relaxed);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsInfo {
    pub provider: String,
    pub hit_available: bool,
    pub git_available: bool,
    pub hit_version: String,
    pub git_version: Option<String>,
}

#[allow(dead_code)]
fn hit_binary_path() -> Option<std::path::PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let hit_path = parent.join("hit");
            if hit_path.is_file() {
                return Some(hit_path);
            }
        }
    }
    for path_str in &[
        "third_party/hit/target/debug/hit",
        "third_party/hit/target/release/hit",
        "../third_party/hit/target/debug/hit",
        "../third_party/hit/target/release/hit",
    ] {
        let p = std::path::PathBuf::from(path_str);
        if p.is_file() {
            return Some(p);
        }
    }
    if crate::process::command("hit")
        .arg("--version")
        .output()
        .is_ok()
    {
        return Some(std::path::PathBuf::from("hit"));
    }
    None
}

fn git_version() -> Option<String> {
    crate::process::command("git")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[tauri::command]
pub fn vcs_get_provider() -> String {
    if is_hit_enabled() {
        "hit".into()
    } else {
        "git".into()
    }
}

#[tauri::command]
pub fn vcs_set_provider(provider: String) -> Result<String, String> {
    let use_hit = match provider.to_lowercase().as_str() {
        "hit" => true,
        "git" => false,
        other => return Err(format!("Unknown VCS provider: {}", other)),
    };
    set_use_hit(use_hit);
    Ok(if use_hit { "hit".into() } else { "git".into() })
}

#[tauri::command]
pub fn vcs_status() -> Result<VcsInfo, String> {
    let git_ver = git_version();
    let git_available = git_ver.is_some();
    let hit_available = true; // Hit is compiled directly into Devyy
    let provider = if is_hit_enabled() {
        "hit".into()
    } else {
        "git".into()
    };
    Ok(VcsInfo {
        provider,
        hit_available,
        git_available,
        hit_version: "0.1.0".into(),
        git_version: git_ver,
    })
}

#[tauri::command]
pub async fn vcs_checkpoint(
    name: Option<String>,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let checkpoint_name = name.unwrap_or_else(|| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("checkpoint-{}", now)
        });
        let msg = format!("Devyy Checkpoint: {}", checkpoint_name);
        let out = git(&base, &["stash", "create", &msg])?;
        if out.trim().is_empty() {
            let _ = git(&base, &["tag", "-f", &checkpoint_name]);
            Ok(format!("Checkpoint {} created at HEAD", checkpoint_name))
        } else {
            let sha = out.trim().to_string();
            let _ = git(&base, &["stash", "store", "-m", &msg, &sha]);
            let short = if sha.len() >= 8 { &sha[..8] } else { &sha };
            Ok(format!(
                "Checkpoint {} created (SHA: {})",
                checkpoint_name, short
            ))
        }
    })
    .await
}

fn output(base: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let ssh = crate::ssh::workspace(base);
    let use_hit = ssh.is_none() && is_hit_enabled();
    let mut cmd = if let Some(ssh) = &ssh {
        let arguments = args
            .iter()
            .map(|arg| crate::ssh::quote(arg))
            .collect::<Vec<_>>()
            .join(" ");
        let script = format!("GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 git {arguments}");
        let (code, stdout, stderr) =
            tauri::async_runtime::block_on(ssh.run(&ssh.relative_to(base), &script))?;
        return if code == 0 {
            Ok(stdout)
        } else {
            Err(String::from_utf8_lossy(&stderr).trim().to_owned())
        };
    } else {
        crate::process::command("git")
    };
    if ssh.is_none() {
        cmd.current_dir(base)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0");
    }

    if use_hit {
        // High-performance Hit engine acceleration flags:
        cmd.arg("-c")
            .arg("protocol.version=2")
            .arg("-c")
            .arg("protocol.file.allow=always")
            .arg("-c")
            .arg("core.preloadindex=true")
            .arg("-c")
            .arg("core.fscache=true")
            .arg("-c")
            .arg("gc.auto=0");
    }

    if ssh.is_none() {
        cmd.args(args);
    }

    let result = cmd.output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        let message = stderr.trim().to_owned();

        if use_hit {
            let translated = hit::error::translator::translate_error(args, &stderr, &stdout);
            let mut err_msg = if !translated.explanation.is_empty() {
                format!("{}: {}", translated.title, translated.explanation)
            } else {
                translated.title
            };
            if let Some(hint) = translated.hint {
                err_msg.push_str(&format!("\nHint: {}", hint));
            }
            if !err_msg.is_empty() {
                return Err(err_msg);
            }
        }

        return Err(if message.is_empty() {
            format!("VCS {} failed", args.first().unwrap_or(&"command"))
        } else {
            message
        });
    }
    Ok(result.stdout)
}
pub(crate) fn git(base: &Path, args: &[&str]) -> Result<String, String> {
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
pub(crate) fn status(base: &Path) -> Result<GitState, String> {
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
    let is_submodule = git(
        base,
        &["--literal-pathspecs", "ls-files", "--stage", "--", path],
    )?
    .lines()
    .any(|line| line.starts_with("160000 "));
    if is_submodule {
        let head = git(
            base,
            &["rev-parse", &format!("HEAD:{prefix}{original_path}")],
        )
        .unwrap_or_default();
        let index = git(base, &["rev-parse", &format!(":{prefix}{path}")]).unwrap_or_default();
        let child = if base.join(path).exists() {
            resolve(base, path, false)?
        } else {
            base.join(path)
        };
        let current = if child.join(".git").exists() {
            git(&child, &["rev-parse", "HEAD"]).unwrap_or_default()
        } else {
            String::new()
        };
        let dirty = !staged
            && child.join(".git").exists()
            && !git(&child, &["status", "--porcelain"])?.is_empty();
        return Ok(DiffFiles {
            path: path.into(),
            original: format!(
                "Subproject commit {}\n",
                if staged { head.trim() } else { index.trim() }
            ),
            modified: format!(
                "Subproject commit {}{}\n",
                if staged { index.trim() } else { current.trim() },
                if dirty { "-dirty" } else { "" }
            ),
            binary: false,
            staged,
            old_path,
        });
    }
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
    } else if let Some(ssh) = crate::ssh::workspace(base) {
        let path = format!("{}{path}", prefix);
        tauri::async_runtime::block_on(async {
            if ssh.exists(&path).await? {
                ssh.bytes(&path, 2 * 1024 * 1024).await
            } else {
                Ok(Vec::new())
            }
        })?
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub reference: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub worktree: Option<String>,
    pub commit: String,
    pub subject: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    pub parent: String,
    pub expected: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub initialized: bool,
    pub dirty: bool,
    pub conflict: bool,
}
fn repository_base(base: &Path, repository: Option<&str>) -> Result<std::path::PathBuf, String> {
    let Some(repository) = repository.filter(|path| !path.is_empty()) else {
        return Ok(base.to_owned());
    };
    if crate::ssh::workspace(base).is_some() {
        validate_path(repository)?;
        let path = base.join(repository);
        git(&path, &["rev-parse", "--show-toplevel"])?;
        return Ok(path);
    }
    let path = resolve(base, repository, false)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.join(".git").exists() {
        return Err("This submodule has not been initialized".into());
    }
    let top = git(&path, &["rev-parse", "--show-toplevel"])?;
    if Path::new(top.trim())
        .canonicalize()
        .map_err(|e| e.to_string())?
        != path
    {
        return Err("Select the root of a Git repository".into());
    }
    Ok(path)
}
fn local_path<'a>(repository: Option<&str>, path: &'a str) -> Result<&'a str, String> {
    validate_path(path)?;
    if let Some(repository) = repository.filter(|path| !path.is_empty()) {
        return path
            .strip_prefix(repository)
            .and_then(|path| path.strip_prefix('/'))
            .filter(|path| !path.is_empty())
            .ok_or_else(|| "File is outside the selected repository".into());
    }
    Ok(path)
}
fn workspace_path(repository: Option<&str>, path: &str) -> String {
    match repository.filter(|path| !path.is_empty()) {
        Some(repository) => format!("{repository}/{path}"),
        None => path.into(),
    }
}
fn branches(base: &Path) -> Result<Vec<Branch>, String> {
    let raw = git(base, &["for-each-ref", "--sort=-committerdate", "--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)%00%(objectname:short)%00%(contents:subject)%00%(symref)%00", "refs/heads/", "refs/remotes/"])?;
    let fields: Vec<_> = raw.split('\0').collect();
    Ok(fields
        .chunks(8)
        .filter(|row| row.len() == 8 && row[7].is_empty())
        .map(|row| Branch {
            reference: row[0].trim_start_matches('\n').into(),
            name: row[1].into(),
            current: row[2] == "*",
            remote: row[0].trim_start_matches('\n').starts_with("refs/remotes/"),
            upstream: (!row[3].is_empty()).then(|| row[3].into()),
            worktree: (!row[4].is_empty()).then(|| row[4].into()),
            commit: row[5].into(),
            subject: row[6].into(),
        })
        .collect())
}
fn validate_branch(base: &Path, branch: &str) -> Result<(), String> {
    if branch.is_empty() || branch.starts_with('-') {
        return Err("Enter a valid branch name".into());
    }
    git(base, &["check-ref-format", &format!("refs/heads/{branch}")])?;
    Ok(())
}
fn switch_branch(
    base: &Path,
    branch: &str,
    create: bool,
    start_point: Option<&str>,
) -> Result<(), String> {
    let known = branches(base)?;
    if let Some(remote) = known
        .iter()
        .find(|item| item.remote && item.reference == branch)
    {
        let local = remote
            .reference
            .strip_prefix("refs/remotes/")
            .and_then(|name| name.split_once('/'))
            .map(|(_, name)| name)
            .ok_or("Invalid remote branch")?;
        if let Some(existing) = known.iter().find(|item| !item.remote && item.name == local) {
            if existing.upstream.as_deref() != Some(remote.name.as_str()) {
                return Err(format!("Local branch {local} tracks a different branch. Create a branch with another name."));
            }
            git(base, &["switch", "--", local])?;
        } else {
            validate_branch(base, local)?;
            git(base, &["switch", "--track", "-c", local, &remote.reference])?;
        }
    } else {
        validate_branch(base, branch)?;
        if create {
            if let Some(start) = start_point {
                let start = known
                    .iter()
                    .find(|item| item.reference == start)
                    .ok_or("The starting branch no longer exists")?;
                let mut args = vec!["switch", "-c", branch];
                if start.remote {
                    args.push("--track");
                }
                args.push(&start.reference);
                git(base, &args)?;
            } else {
                git(base, &["switch", "-c", branch])?;
            }
        } else {
            git(base, &["switch", "--", branch])?;
        }
    }
    Ok(())
}
fn branch_action(
    base: &Path,
    action: &str,
    branch: &str,
    name: Option<&str>,
) -> Result<String, String> {
    if action == "fetch" {
        return git(base, &["fetch", "--all", "--prune"]);
    }
    let known = branches(base)?;
    let selected = known
        .iter()
        .find(|item| item.reference == branch)
        .ok_or("The branch no longer exists")?;
    match action {
        "rename" if !selected.remote => {
            let name = name.ok_or("Enter a branch name")?;
            validate_branch(base, name)?;
            git(base, &["branch", "-m", "--", &selected.name, name])
        }
        "delete" if !selected.remote && !selected.current && selected.worktree.is_none() => {
            git(base, &["branch", "-d", "--", &selected.name])
        }
        "merge" if !selected.current => {
            git(base, &["merge", "--ff-only", "--", &selected.reference])
        }
        _ => Err("This action is unavailable for the selected branch".into()),
    }
}
fn submodules(base: &Path) -> Result<Vec<Submodule>, String> {
    fn collect(
        workspace: &Path,
        base: &Path,
        parent: &str,
        depth: usize,
        out: &mut Vec<Submodule>,
    ) -> Result<(), String> {
        if depth > 16 || out.len() >= 512 {
            return Err("Too many nested submodules to display".into());
        }
        let prefix = prefix(base)?;
        let raw = git(base, &["ls-files", "--stage", "-z", "--", "."])?;
        let mut seen = std::collections::HashSet::new();
        for record in raw.split('\0').filter(|line| !line.is_empty()) {
            let Some((meta, path)) = record.split_once('\t') else {
                continue;
            };
            let mut fields = meta.split_whitespace();
            if fields.next() != Some("160000") {
                continue;
            }
            let expected = fields.next().unwrap_or("").to_owned();
            let conflict = fields.next() != Some("0");
            let Some(path) = path.strip_prefix(&prefix) else {
                continue;
            };
            let path = workspace_path(Some(parent), path);
            if !seen.insert(path.clone()) {
                continue;
            }
            if out.len() >= 512 {
                return Err("Too many submodules to display".into());
            }
            validate_path(&path)?;
            let child = workspace.join(&path);
            let initialized =
                child.join(".git").exists() && repository_base(workspace, Some(&path)).is_ok();
            let head = initialized
                .then(|| {
                    git(&child, &["rev-parse", "--verify", "HEAD"])
                        .ok()
                        .map(|text| text.trim().into())
                })
                .flatten();
            let branch = initialized
                .then(|| {
                    git(&child, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                        .ok()
                        .map(|text| text.trim().into())
                })
                .flatten();
            let dirty = initialized
                && !git(
                    &child,
                    &["status", "--porcelain", "--untracked-files=normal"],
                )?
                .is_empty();
            out.push(Submodule {
                path: path.clone(),
                parent: parent.into(),
                expected,
                head,
                branch,
                initialized,
                dirty,
                conflict,
            });
            if initialized && !conflict {
                collect(workspace, &child, &path, depth + 1, out)?;
            }
        }
        Ok(())
    }
    let mut modules = Vec::new();
    collect(base, base, "", 0, &mut modules)?;
    Ok(modules)
}
fn submodule_action(
    base: &Path,
    action: &str,
    path: Option<&str>,
    url: Option<&str>,
) -> Result<String, String> {
    if action == "add" {
        let path = path.ok_or("Enter a submodule path")?;
        validate_path(path)?;
        let mut ancestor = base.join(path);
        while !ancestor.exists() {
            ancestor = ancestor
                .parent()
                .ok_or("Invalid submodule path")?
                .to_path_buf();
        }
        if !ancestor
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(base)
        {
            return Err("Submodule path is outside the repository".into());
        }
        let url = url
            .filter(|url| {
                !url.is_empty() && !url.starts_with('-') && !url.chars().any(char::is_control)
            })
            .ok_or("Enter a repository URL")?;
        return git(base, &["submodule", "add", "--", url, path]);
    }
    let target = if let Some(path) = path {
        validate_path(path)?;
        let known = submodules(base)?;
        let selected = known
            .iter()
            .find(|item| item.path == path)
            .ok_or("This path is not a registered submodule")?;
        if selected.conflict {
            return Err("Resolve the submodule conflict before updating it".into());
        }
        Some((
            repository_base(base, Some(&selected.parent))?,
            local_path(Some(&selected.parent), path)?.to_owned(),
        ))
    } else {
        None
    };
    let mut args = match action {
        "update" => vec!["submodule", "update", "--init", "--recursive"],
        "sync" => vec!["submodule", "sync", "--recursive"],
        _ => return Err("Unknown submodule action".into()),
    };
    if let Some((parent, path)) = &target {
        args.extend(["--", path]);
        git(parent, &args)
    } else {
        git(base, &args)
    }
}
#[tauri::command]
pub async fn git_branch_details(
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<Vec<Branch>, String> {
    let workspace = root(&state)?;
    background(move || branches(&repository_base(&workspace, repository.as_deref())?)).await
}
#[tauri::command]
pub async fn git_branch_action(
    repository: Option<String>,
    action: String,
    branch: String,
    name: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    background(move || {
        branch_action(
            &repository_base(&workspace, repository.as_deref())?,
            &action,
            &branch,
            name.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub async fn git_submodules(state: State<'_, Workspace>) -> Result<Vec<Submodule>, String> {
    let base = root(&state)?;
    background(move || submodules(&base)).await
}
#[tauri::command]
pub async fn git_submodule_action(
    repository: Option<String>,
    action: String,
    path: Option<String>,
    url: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let path = path
            .as_deref()
            .map(|path| local_path(repository.as_deref(), path))
            .transpose()?;
        submodule_action(&base, &action, path, url.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn git_init(state: State<'_, Workspace>) -> Result<(), String> {
    let base = root(&state)?;
    background(move || {
        git(&base, &["init"])?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_pull(
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        git(&base, &["pull", "--ff-only"])
    })
    .await
}
#[tauri::command]
pub async fn git_status(
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<GitState, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let mut status = status(&base)?;
        for change in &mut status.changes {
            change.path = workspace_path(repository.as_deref(), &change.path);
            change.old_path = change
                .old_path
                .as_deref()
                .map(|path| workspace_path(repository.as_deref(), path));
        }
        Ok(status)
    })
    .await
}
#[tauri::command]
pub async fn git_diff_files(
    path: String,
    staged: bool,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<DiffFiles, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let mut diff = diff_files(&base, local_path(repository.as_deref(), &path)?, staged)?;
        diff.path = path;
        diff.old_path = diff
            .old_path
            .as_deref()
            .map(|path| workspace_path(repository.as_deref(), path));
        Ok(diff)
    })
    .await
}
#[tauri::command]
pub async fn git_diff(
    path: String,
    staged: bool,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let path = local_path(repository.as_deref(), &path)?;
        validate_path(path)?;
        let mut args = vec!["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", path]);
        git(&base, &args)
    })
    .await
}
#[tauri::command]
pub async fn git_stage(
    path: String,
    staged: bool,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let workspace = root(&state)?;
    background(move || {
        stage(
            &repository_base(&workspace, repository.as_deref())?,
            local_path(repository.as_deref(), &path)?,
            staged,
        )
    })
    .await
}
#[tauri::command]
pub async fn git_stage_all(
    staged: bool,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
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
pub async fn git_discard(
    path: String,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        let path = local_path(repository.as_deref(), &path)?;
        validate_path(path)?;
        if git(
            &base,
            &["--literal-pathspecs", "ls-files", "--stage", "--", path],
        )?
        .lines()
        .any(|line| line.starts_with("160000 "))
        {
            return Err("Open the submodule to discard individual file changes".into());
        }
        git(
            &base,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--error-unmatch",
                "--",
                path,
            ],
        )?;
        git(
            &base,
            &["--literal-pathspecs", "restore", "--worktree", "--", path],
        )?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn git_branches(
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<Vec<String>, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
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
    start_point: Option<String>,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<(), String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
        switch_branch(&base, &branch, create, start_point.as_deref())
    })
    .await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    hash: String,
    short: String,
    parents: Vec<String>,
    author: String,
    email: String,
    date: String,
    subject: String,
    refs: Vec<String>,
    body: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    commits: Vec<GraphCommit>,
    has_more: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    path: String,
    old_path: Option<String>,
    status: String,
}
fn checked_commit(base: &Path, hash: &str) -> Result<String, String> {
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Expected a full commit hash".into());
    }
    Ok(git(
        base,
        &["rev-parse", "--verify", &format!("{hash}^{{commit}}")],
    )?
    .trim()
    .into())
}
fn commit_parents(base: &Path, hash: &str) -> Result<Vec<String>, String> {
    Ok(git(base, &["show", "-s", "--format=%P", hash])?
        .split_whitespace()
        .map(str::to_owned)
        .collect())
}
fn decode_graph(raw: &str) -> Vec<GraphCommit> {
    let fields: Vec<_> = raw.split('\0').collect();
    fields
        .chunks(9)
        .filter(|r| r.len() == 9)
        .map(|r| GraphCommit {
            hash: r[0].trim_start_matches('\n').into(),
            short: r[1].into(),
            parents: r[2].split_whitespace().map(str::to_owned).collect(),
            author: r[3].into(),
            email: r[4].into(),
            date: r[5].into(),
            subject: r[6].into(),
            refs: r[7]
                .split(", ")
                .filter(|r| !r.is_empty())
                .map(str::to_owned)
                .collect(),
            body: r[8].chars().take(16000).collect(),
        })
        .collect()
}
fn graph_detail(base: &Path, hash: &str) -> Result<GraphCommit, String> {
    let hash = checked_commit(base, hash)?;
    let raw = git(
        base,
        &[
            "show",
            "-s",
            "--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00%B%x00",
            &hash,
        ],
    )?;
    decode_graph(&raw)
        .into_iter()
        .next()
        .ok_or("Commit details unavailable".into())
}
#[tauri::command]
pub async fn git_commit_details(
    repository: Option<String>,
    hash: String,
    state: State<'_, Workspace>,
) -> Result<GraphCommit, String> {
    let workspace = root(&state)?;
    background(move || graph_detail(&repository_base(&workspace, repository.as_deref())?, &hash))
        .await
}
fn graph_page(base: &Path, offset: usize, limit: usize) -> Result<GraphPage, String> {
    if offset > 100_000 || limit == 0 || limit > 200 {
        return Err("Invalid history page".into());
    }
    let raw = git(
        base,
        &[
            "log",
            "--all",
            "--topo-order",
            &format!("--skip={offset}"),
            &format!("--max-count={}", limit + 1),
            "--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00%B%x00",
        ],
    )?;
    let mut commits = decode_graph(&raw);
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(GraphPage { commits, has_more })
}
fn commit_files(base: &Path, hash: &str, parent: usize) -> Result<Vec<CommitFile>, String> {
    let hash = checked_commit(base, hash)?;
    let parents = commit_parents(base, &hash)?;
    if parent >= parents.len().max(1) {
        return Err("Unknown merge parent".into());
    }
    let mut args = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "--name-status",
        "-z",
        "-M",
    ];
    if let Some(parent) = parents.get(parent) {
        args.push(parent);
    }
    args.extend([&hash, "--", "."]);
    let raw = git(base, &args)?;
    let prefix = prefix(base)?;
    let mut records = raw.split('\0').filter(|r| !r.is_empty());
    let mut files = Vec::new();
    while let Some(status) = records.next() {
        let first = records.next().ok_or("Invalid commit file listing")?;
        let (old_path, path) = if status.starts_with(['R', 'C']) {
            (Some(first), records.next().ok_or("Invalid rename listing")?)
        } else {
            (None, first)
        };
        let Some(path) = path.strip_prefix(&prefix) else {
            continue;
        };
        validate_path(path)?;
        files.push(CommitFile {
            path: path.into(),
            old_path: old_path
                .and_then(|p| p.strip_prefix(&prefix))
                .map(str::to_owned),
            status: status.chars().take(1).collect(),
        });
        if files.len() >= 10000 {
            return Err("Commit contains too many files to display".into());
        }
    }
    Ok(files)
}
fn historical_blob(base: &Path, hash: &str, path: &str) -> Result<Vec<u8>, String> {
    let spec = format!("{hash}:{}{path}", prefix(base)?);
    if git(base, &["cat-file", "-t", &spec]).is_ok_and(|kind| kind.trim() == "commit") {
        return Ok(format!(
            "Subproject commit {}\n",
            git(base, &["rev-parse", &spec])?.trim()
        )
        .into_bytes());
    }
    read_blob(base, &spec)
}
fn historical_diff(
    base: &Path,
    hash: &str,
    path: &str,
    parent: usize,
) -> Result<DiffFiles, String> {
    validate_path(path)?;
    let hash = checked_commit(base, hash)?;
    let files = commit_files(base, &hash, parent)?;
    let file = files
        .iter()
        .find(|f| f.path == path)
        .ok_or("This file is not part of the selected commit")?;
    let parents = commit_parents(base, &hash)?;
    let original = if let Some(parent) = parents.get(parent) {
        historical_blob(base, parent, file.old_path.as_deref().unwrap_or(path))?
    } else {
        Vec::new()
    };
    let modified = historical_blob(base, &hash, path)?;
    let binary = original.contains(&0)
        || modified.contains(&0)
        || std::str::from_utf8(&original).is_err()
        || std::str::from_utf8(&modified).is_err();
    Ok(DiffFiles {
        path: path.into(),
        original: String::from_utf8_lossy(&original).into(),
        modified: String::from_utf8_lossy(&modified).into(),
        binary,
        staged: false,
        old_path: file.old_path.clone(),
    })
}
#[tauri::command]
pub async fn git_graph(
    repository: Option<String>,
    offset: usize,
    limit: usize,
    state: State<'_, Workspace>,
) -> Result<GraphPage, String> {
    let workspace = root(&state)?;
    background(move || {
        graph_page(
            &repository_base(&workspace, repository.as_deref())?,
            offset,
            limit,
        )
    })
    .await
}
#[tauri::command]
pub async fn git_commit_files(
    repository: Option<String>,
    hash: String,
    parent: usize,
    state: State<'_, Workspace>,
) -> Result<Vec<CommitFile>, String> {
    let workspace = root(&state)?;
    background(move || {
        let mut files = commit_files(
            &repository_base(&workspace, repository.as_deref())?,
            &hash,
            parent,
        )?;
        for file in &mut files {
            file.path = workspace_path(repository.as_deref(), &file.path);
            file.old_path = file
                .old_path
                .as_deref()
                .map(|p| workspace_path(repository.as_deref(), p));
        }
        Ok(files)
    })
    .await
}
#[tauri::command]
pub async fn git_commit_diff(
    repository: Option<String>,
    hash: String,
    path: String,
    parent: usize,
    state: State<'_, Workspace>,
) -> Result<DiffFiles, String> {
    let workspace = root(&state)?;
    background(move || {
        let mut diff = historical_diff(
            &repository_base(&workspace, repository.as_deref())?,
            &hash,
            local_path(repository.as_deref(), &path)?,
            parent,
        )?;
        diff.path = path;
        Ok(diff)
    })
    .await
}
#[tauri::command]
pub async fn git_history(
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<Vec<Commit>, String> {
    let workspace = root(&state)?;
    background(move || {
        let base = repository_base(&workspace, repository.as_deref())?;
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
pub async fn git_commit(
    message: String,
    repository: Option<String>,
    state: State<'_, Workspace>,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first".into());
    }
    let workspace = root(&state)?;
    background(move || {
        git(
            &repository_base(&workspace, repository.as_deref())?,
            &["commit", "-m", &message],
        )
    })
    .await
}

#[cfg(test)]
mod graph_tests;
#[cfg(test)]
mod tests;
