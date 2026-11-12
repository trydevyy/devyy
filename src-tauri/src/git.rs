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
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        let message = String::from_utf8_lossy(&result.stderr).trim().to_owned();
        return Err(if message.is_empty() {
            format!("Git {} failed", args.first().unwrap_or(&"command"))
        } else {
            message
        });
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
        // Resolve the nearest existing ancestor, including paths with several new directories.
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
        args.extend(["--", &path]);
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
    fn commit_file(base: &Path, path: &str, content: &str) {
        std::fs::write(base.join(path), content).unwrap();
        git(base, &["add", "--", path]).unwrap();
        git(base, &["commit", "-m", content]).unwrap();
    }
    fn add_module(base: &Path, source: &Path, path: &str) {
        git(
            base,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                source.to_str().unwrap(),
                path,
            ],
        )
        .unwrap();
    }
    #[test]
    fn remote_branches_track_and_local_branches_rename_delete_and_fast_forward() {
        let temp = repository();
        let base = temp.path();
        commit_file(base, "file.txt", "initial");
        git(base, &["remote", "add", "origin", base.to_str().unwrap()]).unwrap();
        git(base, &["update-ref", "refs/remotes/origin/topic", "HEAD"]).unwrap();
        git(
            base,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/topic",
            ],
        )
        .unwrap();
        let details = branches(base).unwrap();
        assert_eq!(details.len(), 2); // Symbolic remote HEAD must not be offered as a branch.
        assert!(details
            .iter()
            .any(|item| item.remote && item.name == "origin/topic"));
        switch_branch(base, "refs/remotes/origin/topic", false, None).unwrap();
        assert_eq!(status(base).unwrap().branch, "topic");
        assert_eq!(
            status(base).unwrap().upstream.as_deref(),
            Some("origin/topic")
        );
        switch_branch(base, "main", false, None).unwrap();
        switch_branch(base, "refs/remotes/origin/topic", false, None).unwrap();
        branch_action(base, "rename", "refs/heads/topic", Some("renamed")).unwrap();
        assert_eq!(status(base).unwrap().branch, "renamed");
        commit_file(base, "file.txt", "new commit");
        switch_branch(base, "main", false, None).unwrap();
        assert!(branch_action(base, "delete", "refs/heads/renamed", None).is_err());
        branch_action(base, "merge", "refs/heads/renamed", None).unwrap();
        // The tracked upstream must also contain the branch before safe deletion.
        git(
            base,
            &[
                "update-ref",
                "refs/remotes/origin/topic",
                "refs/heads/renamed",
            ],
        )
        .unwrap();
        branch_action(base, "delete", "refs/heads/renamed", None).unwrap();
        assert!(!branches(base)
            .unwrap()
            .iter()
            .any(|item| item.name == "renamed"));
        assert!(switch_branch(base, "--force", true, None).is_err());
        assert!(branch_action(base, "delete", "refs/heads/main", None).is_err());
    }
    #[test]
    fn branch_switching_preserves_dirty_files_and_refuses_overwrites_and_divergent_updates() {
        let temp = repository();
        let base = temp.path();
        commit_file(base, "file.txt", "initial");
        switch_branch(base, "feature", true, None).unwrap();
        commit_file(base, "file.txt", "feature");
        switch_branch(base, "main", false, None).unwrap();
        std::fs::write(base.join("file.txt"), "unsaved work").unwrap();
        assert!(switch_branch(base, "feature", false, None).is_err());
        assert_eq!(
            std::fs::read_to_string(base.join("file.txt")).unwrap(),
            "unsaved work"
        );
        commit_file(base, "file.txt", "divergent");
        assert!(branch_action(base, "merge", "refs/heads/feature", None).is_err());
        assert_eq!(
            std::fs::read_to_string(base.join("file.txt")).unwrap(),
            "divergent"
        );
        switch_branch(base, "from-feature", true, Some("refs/heads/feature")).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join("file.txt")).unwrap(),
            "feature"
        );
    }
    #[test]
    fn branch_lists_mark_other_worktrees_and_refuse_deleting_them() {
        let temp = repository();
        let other = tempfile::tempdir().unwrap();
        let base = temp.path();
        commit_file(base, "file.txt", "initial");
        git(
            base,
            &[
                "worktree",
                "add",
                "-b",
                "other",
                other.path().join("tree").to_str().unwrap(),
            ],
        )
        .unwrap();
        let details = branches(base).unwrap();
        assert!(details
            .iter()
            .any(|item| item.name == "other" && item.worktree.is_some()));
        assert!(branch_action(base, "delete", "refs/heads/other", None).is_err());
    }
    #[test]
    fn submodules_support_spaces_dirty_status_initialization_and_scoped_operations() {
        let source = repository();
        commit_file(source.path(), "lib.rs", "initial library");
        let temp = repository();
        let canonical = temp.path().canonicalize().unwrap();
        let base = canonical.as_path();
        commit_file(base, "root.txt", "root");
        add_module(base, source.path(), "packages/shared library");
        git(base, &["commit", "-am", "Add module"]).unwrap();
        let entries = submodules(base).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "packages/shared library");
        assert!(entries[0].initialized);
        assert!(!entries[0].dirty);
        assert_eq!(
            entries[0].head.as_deref(),
            Some(entries[0].expected.as_str())
        );
        let child = repository_base(base, Some(&entries[0].path)).unwrap();
        std::fs::write(child.join("lib.rs"), "modified library").unwrap();
        assert!(submodules(base).unwrap()[0].dirty);
        let local = local_path(Some(&entries[0].path), "packages/shared library/lib.rs").unwrap();
        stage(&child, local, false).unwrap();
        assert_eq!(status(&child).unwrap().changes[0].index, "M");
        assert_eq!(status(base).unwrap().changes[0].index, " ");
        assert_eq!(
            diff_files(&child, local, true).unwrap().modified,
            "modified library"
        );
        assert!(local_path(Some(&entries[0].path), "root.txt").is_err());
        assert!(repository_base(base, Some("../outside")).is_err());
        // Discard only in this temporary fixture, then test the cached initialization path.
        git(&child, &["reset", "--hard", "HEAD"]).unwrap();
        git(
            base,
            &["submodule", "deinit", "--", "packages/shared library"],
        )
        .unwrap();
        assert!(!submodules(base).unwrap()[0].initialized);
        assert!(repository_base(base, Some("packages/shared library")).is_err());
        submodule_action(base, "update", Some("packages/shared library"), None).unwrap();
        assert!(submodules(base).unwrap()[0].initialized);
        submodule_action(base, "sync", Some("packages/shared library"), None).unwrap();
        assert!(submodule_action(base, "update", Some("root.txt"), None).is_err());
        let diff = diff_files(base, "packages/shared library", false).unwrap();
        assert!(diff.modified.starts_with("Subproject commit "));
        #[cfg(unix)]
        {
            std::fs::remove_dir_all(&child).unwrap();
            std::os::unix::fs::symlink(source.path(), &child).unwrap();
            assert!(diff_files(base, "packages/shared library", false).is_err());
            assert!(!submodules(base).unwrap()[0].initialized);
        }
    }
    #[test]
    fn nested_submodules_are_discovered_and_targeted_through_their_parent_repository() {
        let leaf = repository();
        commit_file(leaf.path(), "leaf.txt", "leaf");
        let middle = repository();
        commit_file(middle.path(), "middle.txt", "middle");
        add_module(middle.path(), leaf.path(), "inner library");
        git(middle.path(), &["commit", "-am", "Nested module"]).unwrap();
        let parent = repository();
        let canonical = parent.path().canonicalize().unwrap();
        let base = canonical.as_path();
        commit_file(base, "parent.txt", "parent");
        add_module(base, middle.path(), "modules/middle");
        git(
            base,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "update",
                "--init",
                "--recursive",
            ],
        )
        .unwrap();
        let entries = submodules(base).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].parent, "modules/middle");
        assert_eq!(entries[1].path, "modules/middle/inner library");
        submodule_action(base, "sync", Some("modules/middle/inner library"), None).unwrap();
        submodule_action(base, "update", Some("modules/middle/inner library"), None).unwrap();
        assert!(submodule_action(
            base,
            "add",
            Some("../escape"),
            Some("https://example.com/repo.git")
        )
        .is_err());
        assert!(submodule_action(base, "add", Some("safe"), Some("--bad-option")).is_err());
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
