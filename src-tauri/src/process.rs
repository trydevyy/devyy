//! Resolve CLI programs consistently for desktop launches and Windows npm shims.
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
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
            .find(|p| p.is_file())
    })
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
