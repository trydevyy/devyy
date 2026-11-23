use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

fn report(kind: &str, location: &str) -> String {
    format!(
        "Devyy {} ({})\nRevision: {}\nFailure: {kind}\nLocation: {location}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        env!("DEVYY_REVISION"),
    )
}

pub fn install(app: &AppHandle) {
    if crate::webhook::url().is_none() {
        return;
    }
    let Ok(cache) = app.path().app_cache_dir() else {
        return;
    };
    if std::fs::create_dir_all(&cache).is_err() {
        return;
    }
    let path = cache.join("pending-crash.txt");
    if let Ok(previous) = std::fs::read_to_string(&path) {
        offer(app, previous, Some(path.clone()));
    }
    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|source| {
                let file = source
                    .file()
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or("unknown");
                format!("{file}:{}", source.line())
            })
            .unwrap_or_else(|| "unknown".into());
        if let Ok(mut file) = tempfile::NamedTempFile::new_in(&cache) {
            use std::io::Write;
            if file
                .write_all(report("Native Rust panic", &location).as_bytes())
                .is_ok()
            {
                let _ = file.persist(&path);
            }
        }
        original(info);
    }));
}

pub fn extension_failure(app: &AppHandle, failure: crate::extension_host::ExtensionFailure) {
    use crate::extension_host::ExtensionFailure;
    let (kind, id) = match failure {
        ExtensionFailure::Exited => ("Extension host exited unexpectedly", None),
        ExtensionFailure::Execution { id } => ("Extension execution failed", id),
    };
    let location = id
        .as_deref()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        })
        .unwrap_or("Extension host process");
    offer(app, report(kind, location), None);
}

#[tauri::command]
pub fn report_frontend_crash(window: tauri::WebviewWindow, kind: String, line: u32) {
    if window.label() != "main" {
        return;
    }
    let kind = match kind.as_str() {
        "error" => "Uncaught webview error",
        "rejection" => "Unhandled webview promise rejection",
        _ => return,
    };
    offer(
        window.app_handle(),
        report(kind, &format!("Webview line {line}")),
        None,
    );
}

fn offer(app: &AppHandle, report: String, pending: Option<PathBuf>) {
    let Some(url) = crate::webhook::url() else {
        return;
    };
    if PROMPT_OPEN.swap(true, Ordering::AcqRel) {
        return;
    }
    let handle = app.clone();
    app.dialog()
        .message(format!("Send this crash report to the Devyy team?\n\n{report}"))
        .title("Devyy crash report")
        .buttons(MessageDialogButtons::OkCancelCustom("Send report".into(), "Discard".into()))
        .show(move |approved| {
            tauri::async_runtime::spawn(async move {
                if !approved || upload(url, report.clone()).await {
                    if let Some(path) = pending {
                        if std::fs::read_to_string(&path).as_deref().ok() == Some(report.as_str()) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                } else {
                    let message = if pending.is_some() {
                        "Could not send the crash report. Devyy will offer it again on the next launch."
                    } else {
                        "Could not send the crash report."
                    };
                    handle.dialog().message(message).title("Devyy crash report").show(|_| {});
                }
                PROMPT_OPEN.store(false, Ordering::Release);
            });
        });
}

async fn upload(url: reqwest::Url, report: String) -> bool {
    use reqwest::{
        multipart::{Form, Part},
        redirect::Policy,
        Client,
    };
    let Ok(client) = Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(Policy::none())
        .build()
    else {
        return false;
    };
    client
        .post(url)
        .query(&[("wait", "true")])
        .multipart(Form::new().part("files[0]", Part::text(report).file_name("devyy-crash.txt")))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}
