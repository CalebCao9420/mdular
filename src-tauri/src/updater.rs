use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const PREPARE_RESTART_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_PREPARE_REASONS: usize = 32;
const MAX_PREPARE_MESSAGE_BYTES: usize = 512;

#[derive(Default)]
pub(crate) struct UpdaterState {
    active_install: AtomicBool,
    next_request: AtomicU64,
    pending_prepare: Mutex<Option<PendingPrepareRestart>>,
}

struct PendingPrepareRestart {
    request_id: String,
    sender: mpsc::Sender<PrepareRestartResponse>,
}

struct ActiveInstallGuard<'a> {
    active: &'a AtomicBool,
}

impl Drop for ActiveInstallGuard<'_> {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PrepareRestartReasonKind {
    Conflict,
    SaveInProgress,
    SaveError,
    RecoveryError,
    RecoveryNotCurrent,
    UnsavedChanges,
}

impl PrepareRestartReasonKind {
    fn label(&self) -> &'static str {
        match self {
            Self::Conflict => "unresolved conflict",
            Self::SaveInProgress => "save in progress",
            Self::SaveError => "save error",
            Self::RecoveryError => "recovery error",
            Self::RecoveryNotCurrent => "recovery is not current",
            Self::UnsavedChanges => "unsaved legacy editor changes",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct PrepareRestartReason {
    kind: PrepareRestartReasonKind,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "kebab-case", tag = "kind")]
pub(crate) enum PrepareRestartResponse {
    Ready,
    Blocked { reasons: Vec<PrepareRestartReason> },
    Cancelled,
}

impl PrepareRestartResponse {
    fn validate(&self) -> Result<(), String> {
        if let Self::Blocked { reasons } = self {
            if reasons.is_empty() || MAX_PREPARE_REASONS < reasons.len() {
                return Err("restart preparation returned an invalid reason count".to_string());
            }
            if reasons.iter().any(|reason| {
                reason
                    .message
                    .as_ref()
                    .is_some_and(|message| MAX_PREPARE_MESSAGE_BYTES < message.len())
            }) {
                return Err("restart preparation returned an oversized message".to_string());
            }
        }
        Ok(())
    }

    fn summary(&self) -> String {
        match self {
            Self::Ready => "ready".to_string(),
            Self::Cancelled => "cancelled by the application".to_string(),
            Self::Blocked { reasons } => reasons
                .iter()
                .map(|reason| reason.kind.label())
                .collect::<Vec<_>>()
                .join(", "),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareRestartRequestPayload {
    request_id: String,
    version: String,
    timeout_ms: u64,
}

impl UpdaterState {
    fn begin_install(&self) -> Result<ActiveInstallGuard<'_>, String> {
        self.active_install
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "another updater install request is already active".to_string())?;
        Ok(ActiveInstallGuard {
            active: &self.active_install,
        })
    }

    fn begin_prepare_restart(
        &self,
    ) -> Result<(String, mpsc::Receiver<PrepareRestartResponse>), String> {
        let sequence = self.next_request.fetch_add(1, Ordering::Relaxed) + 1;
        let request_id = format!("restart-{sequence}");
        let (sender, receiver) = mpsc::channel();
        let mut pending = self
            .pending_prepare
            .lock()
            .map_err(|_| "updater restart state is unavailable".to_string())?;
        if pending.is_some() {
            return Err("another restart preparation request is already active".to_string());
        }
        *pending = Some(PendingPrepareRestart {
            request_id: request_id.clone(),
            sender,
        });
        Ok((request_id, receiver))
    }

    fn clear_prepare_restart(&self, request_id: &str) {
        if let Ok(mut pending) = self.pending_prepare.lock() {
            if pending
                .as_ref()
                .is_some_and(|request| request.request_id == request_id)
            {
                pending.take();
            }
        }
    }

    fn respond_prepare_restart(
        &self,
        request_id: &str,
        response: PrepareRestartResponse,
    ) -> Result<(), String> {
        response.validate()?;
        let pending = {
            let mut slot = self
                .pending_prepare
                .lock()
                .map_err(|_| "updater restart state is unavailable".to_string())?;
            if !slot
                .as_ref()
                .is_some_and(|request| request.request_id == request_id)
            {
                return Err("restart preparation request is stale or unknown".to_string());
            }
            slot.take().expect("pending request checked above")
        };
        pending
            .sender
            .send(response)
            .map_err(|_| "restart preparation request already expired".to_string())
    }
}

#[tauri::command]
pub(crate) fn updater_respond_prepare_restart(
    state: State<'_, UpdaterState>,
    request_id: String,
    result: PrepareRestartResponse,
) -> Result<(), String> {
    if request_id.is_empty() || 128 < request_id.len() {
        return Err("restart preparation request ID is invalid".to_string());
    }
    state.respond_prepare_restart(&request_id, result)
}

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

async fn request_prepare_for_restart(
    app: &AppHandle,
    version: &str,
) -> Result<PrepareRestartResponse, String> {
    let state = app.state::<UpdaterState>();
    let (request_id, receiver) = state.begin_prepare_restart()?;
    let payload = PrepareRestartRequestPayload {
        request_id: request_id.clone(),
        version: version.to_string(),
        timeout_ms: PREPARE_RESTART_TIMEOUT.as_millis() as u64,
    };
    if let Err(error) = app.emit_to("main", "update-prepare-restart", &payload) {
        state.clear_prepare_restart(&request_id);
        return Err(format!(
            "unable to request application restart preparation: {error}"
        ));
    }

    let wait = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(PREPARE_RESTART_TIMEOUT)
    })
    .await
    .map_err(|error| format!("restart preparation wait failed: {error}"))?;
    state.clear_prepare_restart(&request_id);
    match wait {
        Ok(response) => Ok(response),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("restart preparation timed out after 60 seconds".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("restart preparation channel closed before a response".to_string())
        }
    }
}

#[cfg(target_os = "macos")]
fn in_app_install_block_reason() -> Option<&'static str> {
    Some(
        "macOS in-app installation is disabled until restore-on-failure safety is independently verified",
    )
}

#[cfg(not(target_os = "macos"))]
fn in_app_install_block_reason() -> Option<&'static str> {
    None
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
    if let Some(reason) = in_app_install_block_reason() {
        let message = if notes.is_empty() {
            format!(
                "发现新版本 {}。\n\n{reason}。请从项目的 Draft/Release 资产手动安装。",
                update.version
            )
        } else {
            format!(
                "发现新版本 {}。\n\n{}\n\n{reason}。请从项目的 Draft/Release 资产手动安装。",
                update.version, notes
            )
        };
        show_message(&app, "软件更新", &message, MessageDialogKind::Info);
        return Ok(());
    }

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

    let updater_state = app.state::<UpdaterState>();
    let _active_install = match updater_state.begin_install() {
        Ok(guard) => guard,
        Err(error) => {
            show_message(&app, "软件更新", &error, MessageDialogKind::Info);
            return Err(error);
        }
    };
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
    let app_downloaded = app.clone();
    let version_downloaded = version.clone();
    let mut downloaded: u64 = 0;
    let download_result = update
        .download(
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
                    &app_downloaded,
                    HudPayload {
                        phase: "preparing",
                        version: Some(version_downloaded.clone()),
                        percent: None,
                        message: Some("下载与签名验证完成，正在保护未保存内容…".to_string()),
                        downloaded: None,
                        total: None,
                    },
                );
            },
        )
        .await;

    clear_taskbar_progress(&app);

    let downloaded_bytes = match download_result {
        Ok(bytes) => bytes,
        Err(error) => return report_update_error(&app, "下载或验证更新失败", error.to_string()),
    };

    let preparation = match request_prepare_for_restart(&app, &version).await {
        Ok(response) => response,
        Err(error) => {
            drop(downloaded_bytes);
            return report_update_error(&app, "安装前保护应用状态失败", error);
        }
    };
    if !matches!(preparation, PrepareRestartResponse::Ready) {
        let summary = preparation.summary();
        drop(downloaded_bytes);
        push_hud(
            &app,
            HudPayload {
                phase: "blocked",
                version: Some(version),
                percent: None,
                message: Some(summary.clone()),
                downloaded: None,
                total: None,
            },
        );
        show_message(
            &app,
            "更新已取消",
            &format!("应用状态尚未安全保存：{summary}。更新包已从内存丢弃。"),
            MessageDialogKind::Info,
        );
        return Ok(());
    }

    push_hud(
        &app,
        HudPayload {
            phase: "installing",
            version: Some(version.clone()),
            percent: None,
            message: None,
            downloaded: None,
            total: None,
        },
    );
    let install_result = update.install(&downloaded_bytes);
    drop(downloaded_bytes);
    if let Err(error) = install_result {
        return report_update_error(&app, "安装更新失败", error.to_string());
    }

    push_hud(
        &app,
        HudPayload {
            phase: "done",
            version: Some(version),
            percent: None,
            message: Some(if cfg!(target_os = "windows") {
                "安装器已启动。".to_string()
            } else {
                "安装完成，正在受控重启…".to_string()
            }),
            downloaded: None,
            total: None,
        },
    );

    #[cfg(not(target_os = "windows"))]
    {
        app.request_restart();
    }
    Ok(())
}

fn report_update_error(app: &AppHandle, title: &str, message: String) -> Result<(), String> {
    push_hud(
        app,
        HudPayload {
            phase: "error",
            version: None,
            percent: None,
            message: Some(message.clone()),
            downloaded: None,
            total: None,
        },
    );
    show_message(
        app,
        "更新失败",
        &format!("{title}：\n\n{message}"),
        MessageDialogKind::Error,
    );
    Err(message)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_guard_rejects_overlap_and_releases_on_drop() {
        let state = UpdaterState::default();
        let guard = state.begin_install().unwrap();
        assert!(state.begin_install().is_err());
        drop(guard);
        assert!(state.begin_install().is_ok());
    }

    #[test]
    fn prepare_restart_accepts_only_the_current_request_once() {
        let state = UpdaterState::default();
        let (request_id, receiver) = state.begin_prepare_restart().unwrap();
        assert!(state.begin_prepare_restart().is_err());

        state
            .respond_prepare_restart(&request_id, PrepareRestartResponse::Ready)
            .unwrap();
        assert_eq!(receiver.recv().unwrap(), PrepareRestartResponse::Ready);
        assert!(state
            .respond_prepare_restart(&request_id, PrepareRestartResponse::Cancelled)
            .is_err());
        assert!(state.begin_prepare_restart().is_ok());
    }

    #[test]
    fn invalid_blocked_responses_fail_without_consuming_the_request() {
        let state = UpdaterState::default();
        let (request_id, receiver) = state.begin_prepare_restart().unwrap();
        assert!(state
            .respond_prepare_restart(
                &request_id,
                PrepareRestartResponse::Blocked { reasons: vec![] },
            )
            .is_err());
        state
            .respond_prepare_restart(&request_id, PrepareRestartResponse::Cancelled)
            .unwrap();
        assert_eq!(receiver.recv().unwrap(), PrepareRestartResponse::Cancelled);
    }

    #[test]
    fn expired_prepare_request_can_be_cleared_and_retried() {
        let state = UpdaterState::default();
        let (request_id, receiver) = state.begin_prepare_restart().unwrap();
        assert_eq!(
            receiver.recv_timeout(Duration::from_millis(0)),
            Err(mpsc::RecvTimeoutError::Timeout)
        );
        state.clear_prepare_restart(&request_id);
        assert!(state.begin_prepare_restart().is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_in_app_install_remains_fail_closed() {
        assert!(in_app_install_block_reason().is_some());
    }
}
