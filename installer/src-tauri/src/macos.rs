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

use crate::engine::Progress;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
const ID: &str = "xyz.devyy.editor";
fn bundle_id(path: &Path) -> Option<String> {
    Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(path.join("Contents/Info.plist"))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
}
pub fn source() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let bundle = executable
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))?;
    source_in_bundle(bundle)
}
fn source_in_bundle(bundle: &Path) -> Option<PathBuf> {
    let parent = bundle.parent()?;
    [
        bundle.join("Contents/Resources/payload/Devyy.app"),
        parent.join(".payload/Devyy.app"),
        parent.join("devyy.app"),
    ]
    .into_iter()
    .find(|path| bundle_id(path).as_deref() == Some(ID))
}
pub fn destination() -> PathBuf {
    PathBuf::from("/Applications/Devyy.app")
}
fn digest(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hash.finalize().to_vec())
}
pub fn installed(source: &Path) -> bool {
    let destination = destination();
    bundle_id(&destination).as_deref() == Some(ID)
        && digest(&source.join("Contents/MacOS/Devyy"))
            .ok()
            .zip(digest(&destination.join("Contents/MacOS/Devyy")).ok())
            .is_some_and(|(a, b)| a == b)
}
pub fn install(source: &Path, progress: impl Fn(Progress)) -> Result<PathBuf, String> {
    install_to(source, &destination(), progress)
}
fn install_to(
    source: &Path,
    destination: &Path,
    progress: impl Fn(Progress),
) -> Result<PathBuf, String> {
    if bundle_id(source).as_deref() != Some(ID) {
        return Err("The Devyy app is missing. Download the installer again.".into());
    }
    if destination.exists() {
        if fs::symlink_metadata(destination).is_ok_and(|m| m.file_type().is_symlink())
            || bundle_id(destination).as_deref() != Some(ID)
        {
            return Err(
                "Applications contains another item named Devyy. Move it before installing.".into(),
            );
        }
        if Command::new("/usr/sbin/lsof")
            .args(["-t", "+D"])
            .arg(destination)
            .output()
            .is_ok_and(|o| o.status.success() && !o.stdout.is_empty())
        {
            return Err("Close Devyy before replacing the installed app.".into());
        }
    }
    let parent = destination
        .parent()
        .ok_or("Applications could not be found")?;
    let staging=tempfile::Builder::new().prefix(".devyy-install-").tempdir_in(parent).map_err(|_|"Your account cannot write to Applications. Open Applications and drag Devyy there in Finder to authorize the copy.")?;
    progress(Progress {
        phase: "copy".into(),
        detail: "Copying Devyy to Applications".into(),
        percent: 10.0,
    });
    let staged = staging.path().join("Devyy.app");
    let output = Command::new("/usr/bin/ditto")
        .args(["--rsrc", "--extattr", "--acl"])
        .arg(source)
        .arg(&staged)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Devyy could not be copied. {}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }
    progress(Progress {
        phase: "commit".into(),
        detail: "Finishing the installation".into(),
        percent: 85.0,
    });
    let previous = staging.path().join("previous.app");
    let existed = destination.exists();
    if existed {
        fs::rename(destination, &previous)
            .map_err(|e| format!("Close Devyy and try again: {e}"))?;
    }
    if let Err(error) = fs::rename(staged, destination) {
        if existed {
            let _ = fs::rename(previous, destination);
        }
        return Err(error.to_string());
    }
    progress(Progress {
        phase: "done".into(),
        detail: "Devyy is in Applications".into(),
        percent: 100.0,
    });
    Ok(destination.to_path_buf())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_bundle_metadata_and_refuses_an_unrelated_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.app");
        fs::create_dir_all(source.join("Contents/MacOS")).unwrap();
        fs::write(source.join("Contents/Info.plist"),format!(r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{ID}</string></dict></plist>"#)).unwrap();
        fs::write(source.join("Contents/MacOS/Devyy"), "synthetic executable").unwrap();
        let setup = root.path().join("Install Devyy.app");
        let embedded = setup.join("Contents/Resources/payload/Devyy.app");
        fs::create_dir_all(embedded.parent().unwrap()).unwrap();
        assert!(Command::new("/usr/bin/ditto")
            .arg(&source)
            .arg(&embedded)
            .status()
            .unwrap()
            .success());
        assert_eq!(source_in_bundle(&setup), Some(embedded));
        let destination = root.path().join("Devyy.app");
        install_to(&source, &destination, |_| {}).unwrap();
        assert_eq!(bundle_id(&destination).as_deref(), Some(ID));
        assert_eq!(
            fs::read(destination.join("Contents/MacOS/Devyy")).unwrap(),
            b"synthetic executable"
        );
        fs::remove_file(destination.join("Contents/Info.plist")).unwrap();
        assert!(install_to(&source, &destination, |_| {}).is_err());
    }
}
