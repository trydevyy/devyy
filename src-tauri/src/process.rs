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

use std::{
    collections::VecDeque,
    io::{BufRead, Read},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
pub fn executable(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    let names: Vec<String> = if cfg!(windows) && path.extension().is_none() {
        vec![
            format!("{name}.exe"),
            format!("{name}.cmd"),
            format!("{name}.bat"),
            name.into(),
        ]
    } else {
        vec![name.into()]
    };
    if path.is_absolute() {
        return names
            .into_iter()
            .map(PathBuf::from)
            .find(|p| is_executable(p));
    }
    tool_directories()
        .into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| is_executable(path))
}
fn is_executable(path: &Path) -> bool {
    let Ok(info) = path.metadata() else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if info.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    info.is_file()
}

fn tool_directories() -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    if cfg!(unix) {
        directories.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/snap/bin",
            ]
            .map(PathBuf::from),
        );
        if let Some(home) = std::env::var_os("HOME") {
            let base = PathBuf::from(home);
            directories.extend([
                base.join(".local/bin"),
                base.join(".cargo/bin"),
                base.join(".gemini/bin"),
                base.join(".opencode/bin"),
            ]);
        }
    }
    if cfg!(windows) {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let base = PathBuf::from(home);
            directories.extend([
                base.join(".local/bin"),
                base.join(".cargo/bin"),
                base.join(".gemini/bin"),
                base.join(".opencode/bin"),
            ]);
        }
        if let Some(roaming) = std::env::var_os("APPDATA") {
            directories.push(PathBuf::from(roaming).join("npm"));
        }
        if let Some(programs) = std::env::var_os("ProgramFiles") {
            let base = PathBuf::from(programs);
            directories.extend([
                base.join("Git/cmd"),
                base.join("GitHub CLI"),
                base.join("Google/antigravity-cli"),
            ]);
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local);
            directories.extend([
                base.join("Microsoft/WinGet/Links"),
                base.join("agy/bin"),
                base.join("Programs/Antigravity/bin"),
                base.join("opencode/bin"),
            ]);
        }
    }
    directories
}

pub fn with_tool_path(command: &mut Command) {
    let mut directories = tool_directories();
    let mut seen = std::collections::HashSet::new();
    directories.retain(|directory| seen.insert(directory.clone()));
    if let Ok(path) = std::env::join_paths(directories) {
        command.env("PATH", path);
    }
}
pub fn command(binary: &str) -> Command {
    let path = executable(binary).unwrap_or_else(|| PathBuf::from(binary));
    #[allow(unused_mut)]
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: LSP/adapter processes use pipes.
    }
    command
}

pub(crate) const DIAGNOSTIC_LIMIT: usize = 32 * 1024;
const LOG_LINE_LIMIT: usize = 4096;

pub(crate) fn bounded(text: &str, max: usize) -> &str {
    &text[..text.floor_char_boundary(max.min(text.len()))]
}

#[derive(Default)]
pub(crate) struct RecentLogs(Mutex<VecDeque<String>>);

impl RecentLogs {
    pub fn push(&self, channel: &str, text: &str) {
        if let Ok(mut logs) = self.0.lock() {
            if logs.len() >= 32 {
                logs.pop_front();
            }
            logs.push_back(format!(
                "[{}] {}",
                bounded(channel, 100),
                bounded(text.trim_end(), LOG_LINE_LIMIT)
            ));
        }
    }

    pub fn snapshot(&self) -> String {
        let Ok(logs) = self.0.lock() else {
            return String::new();
        };
        let mut bytes = 0;
        let mut selected = Vec::new();
        for line in logs.iter().rev() {
            bytes += line.len() + 1;
            if bytes > DIAGNOSTIC_LIMIT {
                break;
            }
            selected.push(line.as_str());
        }
        selected.reverse();
        selected.join("\n")
    }
}

pub(crate) fn read_process_logs(input: impl Read, mut line: impl FnMut(&str)) {
    let mut reader = std::io::BufReader::new(input);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader
            .by_ref()
            .take(LOG_LINE_LIMIT as u64)
            .read_until(b'\n', &mut bytes)
        {
            Ok(0) | Err(_) => break,
            Ok(_) => line(String::from_utf8_lossy(&bytes).trim_end()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_diagnostics_keep_the_recent_tail_and_valid_utf8() {
        let logs = RecentLogs::default();
        logs.push("host", "oldest");
        let row = "界".repeat(2000);
        for _ in 0..32 {
            logs.push("stderr", &row);
        }
        read_process_logs("first\nsecond\n".as_bytes(), |line| logs.push("node", line));
        let snapshot = logs.snapshot();
        assert!(snapshot.len() <= DIAGNOSTIC_LIMIT);
        assert!(!snapshot.contains("oldest"));
        assert!(snapshot.ends_with("[node] first\n[node] second"));
    }
}
