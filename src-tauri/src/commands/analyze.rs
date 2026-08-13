use crate::analyze::AnalyzeResult;
use crate::error::{AppError, AppResult};

/// Trim and lightly normalize a user-provided URL before analysis.
/// This is a safety/UX step only — yt-dlp decides whether a URL is supported.
pub fn normalize_url(input: &str) -> String {
    input.trim().to_string()
}

#[tauri::command]
pub async fn analyze_url(url: String) -> AppResult<AnalyzeResult> {
    let url = normalize_url(&url);
    if url.is_empty() {
        return Err(AppError::new(
            "invalid_url",
            "Please paste a media URL first.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || crate::analyze::analyze_url(&url, true))
        .await
        .map_err(|e| {
            AppError::with_detail("analysis_failed", "Media analysis was interrupted.", e.to_string())
        })?
}
