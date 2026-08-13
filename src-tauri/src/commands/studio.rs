use crate::audio::model::StudioProject;
use crate::audio::model::StudioSource;
use crate::audio::probe::{probe_audio, AudioInfo};
use crate::audio::render::{export_clip, render_mix, render_preview, ExportQuality, RenderResult};
use crate::audio::waveform::{extract_waveform, WaveformData};
use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn studio_probe_audio(path: String) -> AppResult<AudioInfo> {
    tauri::async_runtime::spawn_blocking(move || probe_audio(&path))
        .await
        .map_err(|e| AppError::with_detail("probe_failed", "Probing was interrupted.", e.to_string()))?
}

#[tauri::command]
pub async fn studio_waveform(
    path: String,
    buckets_per_second: Option<f64>,
) -> AppResult<WaveformData> {
    tauri::async_runtime::spawn_blocking(move || extract_waveform(&path, buckets_per_second))
        .await
        .map_err(|e| AppError::with_detail("waveform_failed", "Waveform analysis was interrupted.", e.to_string()))?
}

#[tauri::command]
pub async fn studio_render_preview(project: StudioProject) -> AppResult<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || render_preview(&project))
        .await
        .map_err(|e| AppError::with_detail("render_failed", "Preview rendering was interrupted.", e.to_string()))?
}

#[tauri::command]
pub async fn studio_export_mix(
    project: StudioProject,
    format: String,
    bitrate_kbps: u32,
    output_path: String,
) -> AppResult<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let quality = ExportQuality {
            format: format.to_lowercase(),
            bitrate_kbps,
        };
        render_mix(&project, std::path::Path::new(&output_path), &quality)
    })
    .await
    .map_err(|e| AppError::with_detail("export_failed", "Export was interrupted.", e.to_string()))?
}

#[tauri::command]
pub async fn studio_export_clip(
    source_path: String,
    start: f64,
    end: f64,
    format: String,
    bitrate_kbps: u32,
    output_path: String,
) -> AppResult<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let quality = ExportQuality {
            format: format.to_lowercase(),
            bitrate_kbps,
        };
        export_clip(
            &source_path,
            start,
            end,
            std::path::Path::new(&output_path),
            &quality,
        )
    })
    .await
    .map_err(|e| AppError::with_detail("export_failed", "Clip export was interrupted.", e.to_string()))?
}

#[tauri::command]
pub fn studio_save_project(project: StudioProject, path: String) -> AppResult<()> {
    crate::audio::project::save_project(&project, &path)
}

#[tauri::command]
pub async fn studio_load_project(path: String) -> AppResult<StudioProject> {
    tauri::async_runtime::spawn_blocking(move || crate::audio::project::load_project(&path))
        .await
        .map_err(|e| AppError::with_detail("load_failed", "Loading was interrupted.", e.to_string()))?
}

#[tauri::command]
pub fn studio_missing_sources(project: StudioProject) -> Vec<StudioSource> {
    crate::audio::project::missing_sources(&project)
}

#[tauri::command]
pub fn studio_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}
