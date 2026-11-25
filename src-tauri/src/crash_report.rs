use crate::process::{bounded, DIAGNOSTIC_LIMIT};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

fn add_diagnostics(mut report: String, title: &str, details: &str) -> String {
    if !details.trim().is_empty() {
        report.push_str(&format!(
            "\n{title}\n{}\n",
            bounded(details, DIAGNOSTIC_LIMIT)
        ));
    }
    report
}

fn write_report(path: &Path, report: &str) -> std::io::Result<()> {
    use std::io::Write;
    let directory = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    std::fs::create_dir_all(directory)?;
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    file.write_all(report.as_bytes())?;
    file.persist(path)?;
    Ok(())
}

fn report(kind: &str, location: &str) -> String {
    format!(
        "Devyy {} ({})\nRevision: {}\nFailure: {kind}\nLocation: {location}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        env!("DEVYY_REVISION"),
    )
}

pub fn install(app: &AppHandle) {
    let Ok(cache) = app.path().app_cache_dir() else {
        return;
    };
    if std::fs::create_dir_all(&cache).is_err() {
        return;
    }
    let path = cache.join("pending-crash.txt");
    if let Ok(previous) = std::fs::read_to_string(&path) {
        let summary = previous
            .split("\n\n")
            .next()
            .unwrap_or(&previous)
            .to_owned();
        offer(app, summary, previous, Some(path.clone()), &path);
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
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("Non-string panic payload");
        let report = add_diagnostics(report("Native Rust panic", &location), "Error", message);
        let report = add_diagnostics(
            report,
            "Rust backtrace",
            &std::backtrace::Backtrace::force_capture().to_string(),
        );
        let _ = write_report(&path, &report);
        original(info);
    }));
}

pub fn extension_failure(app: &AppHandle, failure: crate::extension_host::ExtensionFailure) {
    use crate::extension_host::ExtensionFailure;
    let (kind, id, error, stack, logs) = match failure {
        ExtensionFailure::Exited { status, logs } => (
            "Extension host exited unexpectedly",
            None,
            status,
            String::new(),
            logs,
        ),
        ExtensionFailure::Execution {
            id,
            error,
            stack,
            logs,
        } => ("Extension execution failed", id, error, stack, logs),
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
    let summary = report(kind, location);
    let details = add_diagnostics(summary.clone(), "Error", &error);
    let details = add_diagnostics(details, "Extension stack trace", &stack);
    let details = add_diagnostics(details, "Recent extension host output", &logs);
    save_and_offer(app, summary, details);
}

#[tauri::command]
pub fn report_frontend_crash(
    window: tauri::WebviewWindow,
    kind: String,
    line: u32,
    error: Option<String>,
    stack: Option<String>,
) {
    if window.label() != "main" {
        return;
    }
    let kind = match kind.as_str() {
        "error" => "Uncaught webview error",
        "rejection" => "Unhandled webview promise rejection",
        _ => return,
    };
    let summary = report(kind, &format!("Webview line {line}"));
    let details = add_diagnostics(summary.clone(), "Error", error.as_deref().unwrap_or(""));
    let details = add_diagnostics(
        details,
        "Webview stack trace",
        stack.as_deref().unwrap_or(""),
    );
    save_and_offer(window.app_handle(), summary, details);
}

fn save_and_offer(app: &AppHandle, summary: String, report: String) {
    let Ok(cache) = app.path().app_cache_dir() else {
        return;
    };
    let path = cache.join("last-crash.txt");
    offer(app, summary, report, None, &path);
}

fn offer(app: &AppHandle, summary: String, report: String, pending: Option<PathBuf>, path: &Path) {
    let url = crate::webhook::url();
    if url.is_some() && PROMPT_OPEN.swap(true, Ordering::AcqRel) {
        return;
    }
    let saved = pending.is_some() || write_report(path, &report).is_ok();
    let Some(url) = url else {
        return;
    };
    let review = if saved {
        format!(" You can review it at {}.", path.display())
    } else {
        String::new()
    };
    let handle = app.clone();
    app.dialog()
        .message(format!("Send this crash report to the Devyy team?\n\n{summary}\nThe attachment includes available logs and stack traces.{review}"))
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
