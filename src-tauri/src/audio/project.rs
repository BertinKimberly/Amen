//! Project file save/load and source validation. `.lms` files are plain JSON
//! containing editing instructions (references, not copies) — the actual audio
//! is never duplicated into the project.

use crate::audio::model::{StudioProject, StudioSource};
use crate::error::{AppError, AppResult};
use std::path::Path;

pub const PROJECT_VERSION: u32 = 1;

pub fn save_project(project: &StudioProject, path: &str) -> AppResult<()> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io("Creating project folder", e))?;
        }
    }
    let json = serde_json::to_string_pretty(project)
        .map_err(|e| AppError::with_detail("save_failed", "Could not serialize the project.", e.to_string()))?;
    std::fs::write(path, json).map_err(|e| AppError::io("Saving project", e))
}

pub fn load_project(path: &str) -> AppResult<StudioProject> {
    if !Path::new(path).exists() {
        return Err(AppError::new("not_found", format!("Project file not found: {path}")));
    }
    let text = std::fs::read_to_string(path).map_err(|e| AppError::io("Reading project", e))?;
    let project: StudioProject = serde_json::from_str(&text).map_err(|e| {
        AppError::with_detail(
            "invalid_project",
            "This project file could not be read (it may be corrupted or from a newer version).",
            e.to_string(),
        )
    })?;
    if project.version > PROJECT_VERSION {
        return Err(AppError::new(
            "newer_version",
            format!("This project was saved by a newer version (v{}).", project.version),
        ));
    }
    Ok(project)
}

/// Returns the list of sources referenced by timeline clips that are missing on disk.
pub fn missing_sources(project: &StudioProject) -> Vec<StudioSource> {
    project.missing_sources()
}
