use crate::download::{DownloadManager, DownloadRequest, Job};
use crate::error::{AppError, AppResult};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn start_download(
    state: State<'_, Arc<DownloadManager>>,
    request: DownloadRequest,
) -> AppResult<Job> {
    state.submit(request)
}

#[tauri::command]
pub fn cancel_download(state: State<'_, Arc<DownloadManager>>, id: String) -> AppResult<()> {
    state.cancel(&id)
}

#[tauri::command]
pub fn retry_download(state: State<'_, Arc<DownloadManager>>, id: String) -> AppResult<()> {
    state.retry(&id)
}

#[tauri::command]
pub fn remove_job(state: State<'_, Arc<DownloadManager>>, id: String) -> AppResult<()> {
    state.remove_job(&id)
}

#[tauri::command]
pub fn clear_completed_jobs(state: State<'_, Arc<DownloadManager>>) -> AppResult<()> {
    state.clear_completed()
}

#[tauri::command]
pub fn list_jobs(state: State<'_, Arc<DownloadManager>>) -> Vec<Job> {
    state.list_jobs()
}

#[tauri::command]
pub fn validate_output_dir(path: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::new("invalid_config", "The output directory cannot be empty."));
    }
    let expanded = crate::util::expand_env(&path);
    let dir = std::path::PathBuf::from(expanded);
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::with_detail(
            "invalid_config",
            "The output directory cannot be created.",
            e.to_string(),
        )
    })?;
    Ok(())
}
