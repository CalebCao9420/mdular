use serde::Serialize;
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Copy)]
enum UpdatePrompt {
    /// Startup: only prompt when a newer version exists.
    OnAvailable,
    /// Tray menu: also confirm when already up to date.
    AlwaysNotify,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HudPayload {
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
}

pub fn schedule_startup_check(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(std::time::Duration::from_secs(4));
        if let Err(err) = check_for_updates(app, UpdatePrompt::OnAvailable).await {
            eprintln!("{} updater: {err}", env!("CARGO_PKG_NAME"));
        }
    });
}

pub fn check_updates_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = check_for_updates(app, UpdatePrompt::AlwaysNotify).await {
            eprintln!("{} updater: {err}", env!("CARGO_PKG_NAME"));
        }
    });
}

async fn check_for_updates(app: AppHandle, prompt: UpdatePrompt) -> Result<(), String> {
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        if matches!(prompt, UpdatePrompt::AlwaysNotify) {
            show_message(
                &app,
                "检查更新",
                "当前已是最新版本。",
                MessageDialogKind::Info,
            );
        }
        return Ok(());
    };

    let notes = update.body.clone().unwrap_or_default();
    let message = if notes.is_empty() {
        format!("发现新版本 {}，是否现在下载并安装？", update.version)
    } else {
        format!(
            "发现新版本 {}。\n\n{}\n\n是否现在下载并安装？",
            update.version, notes
        )
    };

    if !ask_yes_no(&app, "软件更新", &message) {
        return Ok(());
    }

    let version = update.version.clone();
    push_hud(
        &app,
        HudPayload {
            phase: "start",
            version: Some(version.clone()),
            percent: None,
            message: None,
            downloaded: None,
            total: None,
        },
    );

    let app_progress = app.clone();
    let app_installing = app.clone();
    let version_installing = version.clone();
    let mut downloaded: u64 = 0;
    let download_result = update
        .download_and_install(
            move |chunk_len, total| {
                downloaded += chunk_len as u64;
                let percent = total
                    .filter(|t| *t > 0)
                    .map(|t| ((downloaded.saturating_mul(100)) / t).min(100) as u32)
                    .unwrap_or(0);
                let message = format_download_message(downloaded, total);
                push_hud(
                    &app_progress,
                    HudPayload {
                        phase: "progress",
                        version: None,
                        percent: Some(percent),
                        message: Some(message),
                        downloaded: Some(downloaded),
                        total,
                    },
                );
                set_taskbar_progress(&app_progress, percent);
            },
            move || {
                push_hud(
                    &app_installing,
                    HudPayload {
                        phase: "installing",
                        version: Some(version_installing.clone()),
                        percent: None,
                        message: None,
                        downloaded: None,
                        total: None,
                    },
                );
            },
        )
        .await;

    clear_taskbar_progress(&app);

    if let Err(err) = download_result {
        let msg = err.to_string();
        push_hud(
            &app,
            HudPayload {
                phase: "error",
                version: None,
                percent: None,
                message: Some(msg.clone()),
                downloaded: None,
                total: None,
            },
        );
        show_message(
            &app,
            "更新失败",
            &format!("下载或安装更新时出错：\n\n{msg}"),
            MessageDialogKind::Error,
        );
        return Err(msg);
    }

    push_hud(
        &app,
        HudPayload {
            phase: "done",
            version: Some(version),
            percent: None,
            message: None,
            downloaded: None,
            total: None,
        },
    );
    app.request_restart();
    #[allow(unreachable_code)]
    Ok(())
}

fn format_download_message(downloaded: u64, total: Option<u64>) -> String {
    match total {
        Some(total) if total > 0 => {
            format!(
                "正在下载更新… {} / {} MB",
                bytes_to_mb(downloaded),
                bytes_to_mb(total)
            )
        }
        _ => format!("正在下载更新… {} MB", bytes_to_mb(downloaded)),
    }
}

fn bytes_to_mb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / (1024.0 * 1024.0))
}

fn push_hud(app: &AppHandle, payload: HudPayload) {
    let Ok(json) = serde_json::to_string(&payload) else {
        return;
    };
    let js = format!(
        "try{{globalThis.__appUpdateHud?.({json});}}catch(e){{console.error('app update hud',e);}}"
    );
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&js);
    }
    // Keep event emit as a secondary channel for debugging/tools.
    let event = format!("update-download-{}", payload.phase);
    let _ = app.emit_to("main", &event, &payload);
}

fn set_taskbar_progress(app: &AppHandle, percent: u32) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.set_progress_bar(ProgressBarState {
        status: Some(ProgressBarStatus::Normal),
        progress: Some(percent.min(100) as u64),
    });
}

fn clear_taskbar_progress(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.set_progress_bar(ProgressBarState {
        status: Some(ProgressBarStatus::None),
        progress: None,
    });
}

fn show_message(app: &AppHandle, title: &str, message: &str, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn ask_yes_no(app: &AppHandle, title: &str, message: &str) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });

    rx.recv().unwrap_or(false)
}
