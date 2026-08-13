use crate::config::AppSettings;
use crate::error::{AppError, AppResult};
use crate::tools::{self, DependencyReport, YtdlpUpdateInfo};
use tauri::Emitter;

#[tauri::command]
pub async fn detect_dependencies() -> AppResult<DependencyReport> {
    tauri::async_runtime::spawn_blocking(|| {
        let settings = AppSettings::load();
        Ok::<_, AppError>(tools::detect_dependencies(&settings))
    })
    .await
    .map_err(|e| AppError::with_detail("detect_failed", "Dependency detection failed.", e.to_string()))?
}

#[tauri::command]
pub async fn install_dependencies(
    app: tauri::AppHandle,
    what: String,
) -> AppResult<DependencyReport> {
    let what = what.trim().to_string();
    if !matches!(what.as_str(), "all" | "yt-dlp" | "ffmpeg") {
        return Err(AppError::new("invalid_request", "Unknown component to install."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        tools::install_dependencies(&what, |stage, percent, message| {
            let _ = app.emit(
                "install-progress",
                &serde_json::json!({
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                }),
            );
        })
    })
    .await
    .map_err(|e| AppError::with_detail("install_failed", "Dependency install failed.", e.to_string()))?
}

#[tauri::command]
pub async fn check_ytdlp_update() -> AppResult<YtdlpUpdateInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let settings = AppSettings::load();
        tools::check_ytdlp_update(&settings)
    })
    .await
    .map_err(|e| AppError::with_detail("update_check_failed", "Update check failed.", e.to_string()))?
}

#[tauri::command]
pub async fn update_ytdlp() -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let settings = AppSettings::load();
        tools::update_ytdlp(&settings)
    })
    .await
    .map_err(|e| AppError::with_detail("update_failed", "Update failed.", e.to_string()))?
}
