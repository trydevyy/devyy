fn main() {
    use std::{
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    let built_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let revision = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|r| r.status.success())
        .map(|r| String::from_utf8_lossy(&r.stdout).trim().to_owned())
        .unwrap_or_else(|| "local".into());
    println!("cargo:rustc-env=DEVYY_BUILT_AT={built_at}");
    println!("cargo:rustc-env=DEVYY_REVISION={revision}");
    tauri_build::build()
}
