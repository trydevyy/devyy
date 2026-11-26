use crate::app_info::{latest_release, Release, ReleaseAsset};
use ring::digest::{Context, SHA256};
use serde::Serialize;
use std::{
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const MAX_SUMS: u64 = 256 * 1024;
const RELEASE_PREFIX: &str = "https://github.com/trydevyy/devyy/releases/download/";

#[derive(Default)]
pub struct Updater(AtomicBool);

struct UpdateGuard<'a>(&'a AtomicBool);
impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn progress(app: &AppHandle, stage: &'static str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "devyy-update-progress",
        Progress {
            stage,
            downloaded,
            total,
        },
    );
}

fn asset<'a>(release: &'a Release, name: &str) -> Option<&'a ReleaseAsset> {
    let expected = format!("{RELEASE_PREFIX}{}/{name}", release.tag_name);
    release
        .assets
        .iter()
        .find(|a| a.name == name && a.browser_download_url == expected)
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("devyy/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("Unexpected release download redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn response(
    client: &reqwest::Client,
    asset: &ReleaseAsset,
    limit: u64,
) -> Result<reqwest::Response, String> {
    if asset.size == 0 || asset.size > limit {
        return Err("The release asset has an invalid size.".into());
    }
    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("Could not download {}: {}", asset.name, e.without_url()))?;
    if response
        .content_length()
        .is_some_and(|length| length != asset.size)
    {
        return Err("The release asset size changed. Check for updates again.".into());
    }
    Ok(response)
}

fn checksum_line(contents: &str, filename: &str) -> Result<Option<String>, String> {
    let mut found = None;
    for line in contents.lines() {
        let Some((digest, name)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let name = name.trim_start().trim_start_matches('*');
        if name.strip_prefix("./").unwrap_or(name) != filename {
            continue;
        }
        if digest.len() != 64 || !digest.bytes().all(|v| v.is_ascii_hexdigit()) || found.is_some() {
            return Err("Invalid checksum entry for this release asset.".into());
        }
        found = Some(digest.to_ascii_lowercase());
    }
    Ok(found)
}

async fn release_checksum(
    client: &reqwest::Client,
    release: &Release,
    package: &ReleaseAsset,
    platform: &str,
) -> Result<String, String> {
    for filename in [
        "SHA256SUMS.txt".to_owned(),
        format!("SHA256SUMS-{platform}.txt"),
    ] {
        let Some(sums) = asset(release, &filename) else {
            continue;
        };
        let mut response = response(client, sums, MAX_SUMS).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read release checksums")?
        {
            if bytes.len() as u64 + chunk.len() as u64 > MAX_SUMS {
                return Err("Release checksum file is too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let contents =
            std::str::from_utf8(&bytes).map_err(|_| "Release checksum file is invalid")?;
        if let Some(sum) = checksum_line(contents, &package.name)? {
            if let Some(digest) = &package.digest {
                if !digest.eq_ignore_ascii_case(&format!("sha256:{sum}")) {
                    return Err("GitHub and the release checksum disagree.".into());
                }
            }
            return Ok(sum);
        }
    }
    Err("This release has no checksum for your package.".into())
}

async fn download(
    app: &AppHandle,
    client: &reqwest::Client,
    package: &ReleaseAsset,
    target: &Path,
    expected: &str,
) -> Result<(), String> {
    let mut response = response(client, package, MAX_DOWNLOAD).await?;
    let mut file = tokio::fs::File::create(target)
        .await
        .map_err(|e| e.to_string())?;
    let mut hash = Context::new(&SHA256);
    let mut size = 0u64;
    let mut last = Instant::now();
    progress(app, "downloading", 0, Some(package.size));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The update download was interrupted")?
    {
        size += chunk.len() as u64;
        if size > package.size {
            return Err("Update download exceeded its expected size.".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if last.elapsed() >= Duration::from_millis(100) {
            progress(app, "downloading", size, Some(package.size));
            last = Instant::now();
        }
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    progress(app, "verifying", size, Some(package.size));
    let actual: String = hash
        .finish()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if size != package.size || actual != expected {
        return Err("The downloaded update failed its SHA-256 verification.".into());
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq)]
#[allow(dead_code)] // Each platform constructs only its own installation formats.
enum Format {
    Binary,
    AppImage,
    Debian,
    MacBundle,
}

struct Installation {
    target: PathBuf,
    binary: PathBuf,
    format: Format,
}

fn installation() -> Result<Installation, String> {
    let binary = std::env::current_exe().map_err(|e| e.to_string())?;
    if cfg!(debug_assertions) {
        return Err("Automatic installation is available in release builds.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let target = binary
            .ancestors()
            .nth(3)
            .filter(|path| path.extension() == Some(OsStr::new("app")))
            .ok_or("Move Devyy to Applications before updating.")?
            .to_path_buf();
        return Ok(Installation {
            target,
            binary,
            format: Format::MacBundle,
        });
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(path) = std::env::var_os("APPIMAGE") {
            let target =
                fs::canonicalize(path).map_err(|_| "Could not locate the installed AppImage")?;
            return Ok(Installation {
                target,
                binary,
                format: Format::AppImage,
            });
        }
        if binary.parent() == Some(Path::new("/usr/bin"))
            || binary.parent() == Some(Path::new("/bin"))
        {
            if Command::new("/usr/bin/dpkg-query")
                .args(["-W", "-f=${Status}", "devyy"])
                .output()
                .is_ok_and(|out| out.status.success() && out.stdout == b"install ok installed")
            {
                return Ok(Installation {
                    target: binary.clone(),
                    binary,
                    format: Format::Debian,
                });
            }
            return Err("This copy of Devyy is managed by the system. Update it through your package manager.".into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    Ok(Installation {
        target: binary.clone(),
        binary,
        format: Format::Binary,
    })
}

fn replace(target: &Path, staged: &Path, backup: &Path) -> io::Result<()> {
    fs::rename(target, backup)?;
    if let Err(error) = fs::rename(staged, target) {
        fs::rename(backup, target)?;
        return Err(error);
    }
    Ok(())
}

#[cfg(unix)]
fn unix_restart(
    parent: u32,
    target: &Path,
    temporary: &Path,
    image: bool,
    bundle: bool,
) -> io::Result<std::process::Child> {
    let script = r#"
        tries=0
        while kill -0 "$1" 2>/dev/null; do
            tries=$((tries+1))
            [ "$tries" -lt 300 ] || exit 1
            sleep 0.1
        done
        launch() {
            if [ "$4" = bundle ]; then
                /usr/bin/open -n "$2"
            else
                "$2" </dev/null >/dev/null 2>&1 &
                child=$!
                sleep 1
                kill -0 "$child" 2>/dev/null || wait "$child"
            fi
        }
        if ! launch "$@"; then
            if [ -e "$3/previous" ]; then
                mv -- "$2" "$3/failed" && mv -- "$3/previous" "$2" && launch "$@"
            fi
            exit 1
        fi
        rm -rf -- "$3"
    "#;
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", script, "devyy-restart", &parent.to_string()])
        .arg(target)
        .arg(temporary)
        .arg(if bundle { "bundle" } else { "executable" })
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if image {
        cmd.env_remove("APPIMAGE")
            .env_remove("APPDIR")
            .env_remove("ARGV0")
            .env_remove("OWD")
            .env_remove("LD_LIBRARY_PATH");
    }
    cmd.spawn()
}

fn apply(
    installation: Installation,
    stage: tempfile::TempDir,
    package: PathBuf,
) -> Result<(), String> {
    let target = &installation.target;
    #[cfg(unix)]
    {
        let backup = stage.path().join("previous");
        if installation.format == Format::Debian {
            let status = Command::new("/usr/bin/pkexec")
                .arg("/usr/bin/dpkg")
                .arg("-i")
                .arg(&package)
                .status()
                .map_err(|_| {
                    "The Debian update needs pkexec and your system’s authorization agent."
                })?;
            if !status.success() {
                return Err("The Debian package was not installed. Check system authorization and package manager status.".into());
            }
        } else {
            let staged = if installation.format == Format::MacBundle {
                let bundle = stage.path().join("Devyy.app");
                let status = Command::new("/usr/bin/ditto")
                    .args(["-x", "-k"])
                    .arg(&package)
                    .arg(stage.path())
                    .status()
                    .map_err(|e| e.to_string())?;
                let relative = installation
                    .binary
                    .strip_prefix(target)
                    .map_err(|e| e.to_string())?;
                if !status.success()
                    || !bundle.join(relative).is_file()
                    || !bundle.join("Contents/Info.plist").is_file()
                {
                    return Err(
                        "The macOS update does not contain a compatible Devyy app bundle.".into(),
                    );
                }
                bundle
            } else {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&package, fs::Permissions::from_mode(0o755))
                    .map_err(|e| e.to_string())?;
                package
            };
            if let Err(error) = replace(target, &staged, &backup) {
                if backup.exists() {
                    let saved = stage.keep();
                    return Err(format!(
                        "Could not replace or restore Devyy: {error}. Recovery files: {}",
                        saved.display()
                    ));
                }
                return Err(format!("Could not replace Devyy: {error}"));
            }
        }
        if let Err(error) = unix_restart(
            std::process::id(),
            target,
            stage.path(),
            installation.format == Format::AppImage,
            installation.format == Format::MacBundle,
        ) {
            if backup.exists() {
                if let Err(restore) = replace(target, &backup, &stage.path().join("failed")) {
                    let saved = stage.keep();
                    return Err(format!(
                        "Could not restart or restore Devyy: {restore}. Recovery files: {}",
                        saved.display()
                    ));
                }
            }
            return Err(format!("Could not restart Devyy: {error}"));
        }
        let _ = stage.keep();
        Ok(())
    }
    #[cfg(windows)]
    {
        let helper = stage.path().join("devyy-update-helper.exe");
        fs::copy(&installation.binary, &helper).map_err(|e| e.to_string())?;
        Command::new(&helper)
            .arg("--devyy-apply-update")
            .arg(std::process::id().to_string())
            .arg(target)
            .arg(package)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start the update helper: {e}"))?;
        let _ = stage.keep();
        Ok(())
    }
}

#[cfg(windows)]
pub fn run_helper() -> Option<Result<(), String>> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject},
    };
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(OsStr::new("--devyy-apply-update")) {
        return None;
    }
    Some((|| {
        let pid = args
            .next()
            .and_then(|arg| arg.to_str()?.parse::<u32>().ok())
            .ok_or("Invalid update parent")?;
        let target: PathBuf = args.next().ok_or("Missing update destination")?.into();
        let package: PathBuf = args.next().ok_or("Missing update payload")?.into();
        let helper = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = helper.parent().ok_or("Invalid update helper location")?;
        if package.parent() != Some(dir)
            || dir.parent() != target.parent()
            || package.file_name() != Some(OsStr::new("update.payload"))
            || target.extension() != Some(OsStr::new("exe"))
        {
            return Err("Invalid update staging paths".into());
        }
        let handle = unsafe { OpenProcess(0x0010_0000, 0, pid) }; // SYNCHRONIZE
        if !handle.is_null() {
            let result = unsafe { WaitForSingleObject(handle, 90_000) };
            unsafe { CloseHandle(handle) };
            if result != 0 {
                return Err("Devyy did not close before the update timed out.".into());
            }
        }
        let backup = dir.join("previous.exe");
        replace(&target, &package, &backup).map_err(|e| format!("Could not replace Devyy: {e}"))?;
        if let Err(error) = Command::new(&target)
            .env("DEVYY_UPDATE_CLEANUP", dir)
            .spawn()
        {
            replace(&target, &backup, &package)
                .map_err(|e| format!("Could not restore Devyy: {e}"))?;
            return Err(format!("Could not restart Devyy: {error}"));
        }
        let _ = fs::remove_file(backup);

        Ok(())
    })())
}

#[cfg(windows)]
pub fn clean_previous_helper() {
    let Some(dir) = std::env::var_os("DEVYY_UPDATE_CLEANUP").map(PathBuf::from) else {
        return;
    };
    std::env::remove_var("DEVYY_UPDATE_CLEANUP");
    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    if dir.parent() != executable.parent()
        || !dir
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.starts_with(".devyy-update-"))
        || !fs::symlink_metadata(&dir).is_ok_and(|metadata| metadata.is_dir())
    {
        return;
    }
    std::thread::spawn(move || {
        let helper = dir.join("devyy-update-helper.exe");
        // Windows keeps the helper image locked until its process exits.
        for _ in 0..30 {
            let result = fs::remove_file(&helper);
            if result.is_ok() || result.is_err_and(|e| e.kind() == io::ErrorKind::NotFound) {
                let _ = fs::remove_dir(dir);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, Updater>,
    version: String,
) -> Result<(), String> {
    if state.0.swap(true, Ordering::AcqRel) {
        return Err("An update is already in progress.".into());
    }
    let _guard = UpdateGuard(&state.0);
    let installation = tauri::async_runtime::spawn_blocking(installation)
        .await
        .map_err(|e| e.to_string())??;
    progress(&app, "checking", 0, None);
    let release = latest_release()
        .await?
        .ok_or("There is no published update.")?;
    let latest = semver::Version::parse(release.tag_name.trim_start_matches('v'))
        .map_err(|_| "Invalid release version")?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| "Invalid installed version")?;
    if release.draft
        || release.prerelease
        || !latest.pre.is_empty()
        || latest <= current
        || latest.to_string() != version
    {
        return Err("The available release changed. Check for updates again.".into());
    }
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "x86",
        _ => return Err("There is no update package for this architecture.".into()),
    };
    let platform = format!("{}-{arch}", std::env::consts::OS);
    let suffix = match installation.format {
        Format::MacBundle => ".app.zip",
        Format::AppImage => ".AppImage",
        Format::Debian => ".deb",
        Format::Binary if cfg!(windows) => ".exe",
        Format::Binary => "",
    };
    let name = format!("Devyy-{latest}-{platform}{suffix}");
    let package =
        asset(&release, &name).ok_or("There is no update package for this installation.")?;
    let client = download_client()?;
    let checksum = release_checksum(&client, &release, package, &platform).await?;
    let builder = &mut tempfile::Builder::new();
    builder.prefix(".devyy-update-");
    let stage = if installation.format == Format::Debian {
        builder.tempdir()
    } else {
        builder.tempdir_in(
            installation
                .target
                .parent()
                .ok_or("Invalid update destination")?,
        )
    }
    .map_err(|e| format!("Could not stage the update beside this installation: {e}"))?;
    let payload = stage.path().join("update.payload");
    download(&app, &client, package, &payload, &checksum).await?;
    progress(&app, "installing", package.size, Some(package.size));
    tauri::async_runtime::spawn_blocking(move || apply(installation, stage, payload))
        .await
        .map_err(|e| e.to_string())??;
    progress(&app, "restarting", package.size, Some(package.size));
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checksum_lists_match_exact_filenames_and_reject_duplicates() {
        let hash = "a".repeat(64);
        let sums = format!("{hash}  Devyy-linux-x64\n{hash} *Devyy-linux-x64.AppImage\n");
        assert_eq!(
            checksum_line(&sums, "Devyy-linux-x64.AppImage").unwrap(),
            Some(hash.clone())
        );
        assert_eq!(
            checksum_line(&sums, "Devyy-macos-arm64.app.zip").unwrap(),
            None
        );
        assert!(checksum_line(&sums.repeat(2), "Devyy-linux-x64.AppImage").is_err());
        assert!(checksum_line("broken  Devyy-linux-x64", "Devyy-linux-x64").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn restart_waits_for_the_old_process_and_launches_the_replacement() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir_in(dir.path()).unwrap();
        let executable = dir.path().join("Test Devyy");
        let marker = dir.path().join("Test Devyy.marker");
        fs::write(&executable, "#!/bin/sh\nprintf launched > \"$0.marker\"\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let mut parent = Command::new("/bin/sh")
            .args(["-c", "sleep 0.2"])
            .spawn()
            .unwrap();
        let mut restart =
            unix_restart(parent.id(), &executable, stage.path(), false, false).unwrap();
        assert!(!marker.exists());
        assert!(parent.wait().unwrap().success());
        assert!(restart.wait().unwrap().success());
        assert_eq!(fs::read_to_string(marker).unwrap(), "launched");
        assert!(!stage.path().exists());
    }

    #[test]
    fn failed_replacement_restores_previous_executable() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("devyy");
        fs::write(&target, "previous").unwrap();
        assert!(replace(
            &target,
            &dir.path().join("missing"),
            &dir.path().join("backup")
        )
        .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "previous");
    }
}
