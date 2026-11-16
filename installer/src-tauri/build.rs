use std::{env, fs, path::PathBuf};
fn main() {
    println!("cargo:rerun-if-env-changed=DEVYY_INSTALLER_PAYLOAD");
    println!("cargo:rerun-if-env-changed=DEVYY_MAC_APP_PATH");
    let package =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../package.json");
    println!("cargo:rerun-if-changed={}", package.display());
    let package: serde_json::Value = serde_json::from_slice(&fs::read(package).unwrap()).unwrap();
    println!(
        "cargo:rustc-env=DEVYY_PACKAGE_VERSION={}",
        package["version"].as_str().unwrap()
    );
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let source = env::var_os("DEVYY_INSTALLER_PAYLOAD")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../payload/devyy.zip")
        });
    println!("cargo:rerun-if-changed={}", source.display());
    if source.exists() {
        fs::copy(&source, out.join("devyy.zip")).expect("read installer payload");
        println!("cargo:rustc-env=DEVYY_HAS_PAYLOAD=1");
    } else {
        if env::var("PROFILE").as_deref() == Ok("release")
            && env::var_os("DEVYY_INSTALLER_ALLOW_PREVIEW").is_none()
            && !(env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
                && env::var_os("DEVYY_MAC_APP_PATH")
                    .map(PathBuf::from)
                    .is_some_and(|p| p.join("Contents/Info.plist").is_file()))
        {
            panic!(
                "A release installer requires a payload. Run npm run payload in installer first."
            );
        }
        fs::write(out.join("devyy.zip"), []).unwrap();
        println!("cargo:rustc-env=DEVYY_HAS_PAYLOAD=0");
    }
    tauri_build::build();
}
