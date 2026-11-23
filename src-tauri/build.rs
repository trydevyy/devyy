#[path = "../shared/seal_webhook.rs"]
mod seal_webhook;

fn main() {
    println!("cargo:rerun-if-changed=../shared/seal_webhook.rs");
    seal_webhook::seal_webhook("DEVYY_CRASH_WEBHOOK_URL");
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
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("windows-msvc")) {
        // Tauri's resource is linked only into application binaries. Use the
        // linker for the manifest so test harnesses also load Common Controls v6.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("configure Devyy");
    } else {
        tauri_build::build();
    }
}
