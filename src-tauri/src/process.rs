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
    path::{Path, PathBuf},
    process::Command,
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
        return names.into_iter().map(PathBuf::from).find(|p| p.is_file());
    }
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
        if let Some(programs) = std::env::var_os("ProgramFiles") {
            let base = PathBuf::from(programs);
            directories.extend([base.join("Git/cmd"), base.join("GitHub CLI")]);
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local);
            directories.extend([
                base.join("Microsoft/WinGet/Links"),
                base.join("Programs/Antigravity/bin"),
                base.join("opencode/bin"),
            ]);
        }
    }
    directories
        .into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
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
