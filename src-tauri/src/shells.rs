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

use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
    pub is_default: bool,
}
fn executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn locate(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|p| p.join(name))
            .find(|p| executable(p))
    })
}
fn profile(path: PathBuf, default: bool) -> ShellProfile {
    let basename = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("shell")
        .to_ascii_lowercase();
    let name = match basename.as_str() {
        "zsh" => "zsh",
        "bash" => "Bash",
        "sh" => "POSIX shell",
        "fish" => "fish",
        "nu" => "Nushell",
        "pwsh" => "PowerShell",
        "powershell" => "Windows PowerShell",
        "cmd" => "Command Prompt",
        "wsl" => "WSL",
        other => other,
    }
    .to_owned();
    let args = match basename.as_str() {
        "pwsh" | "powershell" => vec!["-NoLogo".into()],
        "cmd" | "wsl" => vec![],
        "nu" => vec!["--login".into()],
        _ if cfg!(unix) => vec!["-l".into()],
        _ => vec!["--login".into()],
    };
    let path = path.to_string_lossy().into_owned();
    ShellProfile {
        id: path.clone(),
        name,
        path,
        args,
        is_default: default,
    }
}
pub fn discover() -> Vec<ShellProfile> {
    let mut candidates = Vec::new();
    #[cfg(unix)]
    {
        if let Some(shell) = std::env::var_os("SHELL") {
            candidates.push(PathBuf::from(shell));
        }
        if let Ok(shells) = std::fs::read_to_string("/etc/shells") {
            candidates.extend(
                shells
                    .lines()
                    .map(str::trim)
                    .filter(|s| s.starts_with('/') && !s.contains(char::is_whitespace))
                    .map(PathBuf::from),
            );
        }
        candidates.extend(
            [
                "/bin/zsh",
                "/bin/bash",
                "/bin/sh",
                "/usr/bin/fish",
                "/opt/homebrew/bin/fish",
                "/usr/local/bin/fish",
            ]
            .map(PathBuf::from),
        );
        for name in ["zsh", "bash", "fish", "nu", "pwsh"] {
            if let Some(path) = locate(name) {
                candidates.push(path);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(shell) = std::env::var_os("COMSPEC") {
            candidates.push(PathBuf::from(shell));
        }
        for name in [
            "pwsh.exe",
            "powershell.exe",
            "cmd.exe",
            "bash.exe",
            "wsl.exe",
        ] {
            if let Some(path) = locate(name) {
                candidates.push(path);
            }
        }
        if let Some(root) = std::env::var_os("SystemRoot") {
            let root = PathBuf::from(root);
            candidates.push(root.join("System32/WindowsPowerShell/v1.0/powershell.exe"));
            candidates.push(root.join("System32/cmd.exe"));
            candidates.push(root.join("System32/wsl.exe"));
        }
        if let Some(root) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(&root).join("PowerShell/7/pwsh.exe"));
            candidates.push(PathBuf::from(root).join("Git/bin/bash.exe"));
        }
    }
    let mut seen = HashSet::new();
    let mut profiles = Vec::new();
    for path in candidates {
        if !executable(&path)
            || matches!(
                path.file_name().and_then(|s| s.to_str()),
                Some("false" | "nologin")
            )
        {
            continue;
        }
        let identity = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(identity) {
            continue;
        }
        profiles.push(profile(path, profiles.is_empty()));
    }
    profiles
}
pub fn select(id: Option<&str>) -> Result<ShellProfile, String> {
    let profiles = discover();
    match id.filter(|id| !id.is_empty()) {
        Some(id) => profiles.into_iter().find(|p| p.id == id).ok_or_else(|| {
            "This shell is no longer available. Choose another profile in Terminal settings.".into()
        }),
        None => profiles
            .into_iter()
            .next()
            .ok_or_else(|| "No supported shell was found on this system.".into()),
    }
}
#[tauri::command]
pub async fn terminal_profiles() -> Result<Vec<ShellProfile>, String> {
    tauri::async_runtime::spawn_blocking(discover)
        .await
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_are_executable_unique_and_selections_must_be_discovered() {
        let profiles = discover();
        assert!(!profiles.is_empty());
        assert!(profiles[0].is_default);
        let mut identities = HashSet::new();
        for p in profiles {
            assert!(executable(Path::new(&p.path)));
            assert!(identities.insert(std::fs::canonicalize(&p.path).unwrap()));
            assert_eq!(select(Some(&p.id)).unwrap().id, p.id);
        }
        assert!(select(Some("/not/a/real/shell")).is_err());
    }
}
