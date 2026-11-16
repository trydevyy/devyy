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

use serde::{Deserialize, Serialize};
use std::time::Duration;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    version: &'static str,
    built_at: &'static str,
    revision: &'static str,
    os: &'static str,
    os_build: String,
    arch: &'static str,
}
fn output(command: &str, args: &[&str]) -> Option<String> {
    let result = crate::process::command(command).args(args).output().ok()?;
    if !result.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&result.stdout).trim().to_owned())
}
#[tauri::command]
pub async fn build_info() -> Result<BuildInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        let (os, os_build) = (
            "macOS",
            format!(
                "{} ({})",
                output("/usr/bin/sw_vers", &["-productVersion"]).unwrap_or_default(),
                output("/usr/bin/sw_vers", &["-buildVersion"]).unwrap_or_default()
            ),
        );
        #[cfg(target_os = "windows")]
        let (os, os_build) = (
            "Windows",
            output("cmd", &["/C", "ver"]).unwrap_or_else(|| "Unavailable".into()),
        );
        #[cfg(target_os = "linux")]
        let (os, os_build) = (
            "Linux",
            output("uname", &["-sr"]).unwrap_or_else(|| "Unavailable".into()),
        );
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let (os, os_build) = (std::env::consts::OS, "Unavailable".into());
        BuildInfo {
            version: env!("CARGO_PKG_VERSION"),
            built_at: env!("DEVYY_BUILT_AT"),
            revision: env!("DEVYY_REVISION"),
            os,
            os_build,
            arch: std::env::consts::ARCH,
        }
    })
    .await
    .map_err(|e| e.to_string())
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    status: &'static str,
    version: Option<String>,
    url: Option<String>,
}
fn release_status(release: Release, current: &str) -> Result<UpdateStatus, String> {
    let latest = semver::Version::parse(release.tag_name.trim_start_matches('v'))
        .map_err(|_| "Release version is invalid")?;
    let current = semver::Version::parse(current).map_err(|_| "Build version is invalid")?;
    let newer = !release.draft && !release.prerelease && latest > current;
    let url = release
        .html_url
        .starts_with("https://github.com/trydevyy/devyy/releases/")
        .then_some(release.html_url);
    Ok(UpdateStatus {
        status: if newer { "available" } else { "current" },
        version: Some(latest.to_string()),
        url: if newer { url } else { None },
    })
}
#[tauri::command]
pub async fn check_updates() -> Result<UpdateStatus, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("devyy/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get("https://api.github.com/repos/trydevyy/devyy/releases/latest")
        .send()
        .await
        .map_err(|_| "Could not reach the release server. Try again later.")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateStatus {
            status: "unpublished",
            version: None,
            url: None,
        });
    }
    if !response.status().is_success() {
        return Err(format!(
            "Release server returned {}. Try again later.",
            response.status().as_u16()
        ));
    }
    let mut response = response;
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the release response")?
    {
        if data.len() + chunk.len() > 1024 * 1024 {
            return Err("Release response is too large".into());
        }
        data.extend_from_slice(&chunk);
    }
    let release: Release =
        serde_json::from_slice(&data).map_err(|_| "Release response is invalid")?;
    release_status(release, env!("CARGO_PKG_VERSION"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updates_compare_versions_without_reporting_prereleases_as_upgrades() {
        let release = |version: &str, prerelease| Release {
            tag_name: version.into(),
            html_url: "https://github.com/trydevyy/devyy/releases/tag/v1".into(),
            draft: false,
            prerelease,
        };
        assert_eq!(
            release_status(release("v0.2.0", false), "0.1.0")
                .unwrap()
                .status,
            "available"
        );
        assert_eq!(
            release_status(release("v0.1.0", false), "0.1.0")
                .unwrap()
                .status,
            "current"
        );
        assert_eq!(
            release_status(release("v0.2.0-beta.1", true), "0.1.0")
                .unwrap()
                .status,
            "current"
        );
        assert!(release_status(release("invalid", false), "0.1.0").is_err());
    }
}
