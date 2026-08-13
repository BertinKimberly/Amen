use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const APP_NAME: &str = "Local Media Studio";

/// Roaming config dir: %APPDATA%\LocalMediaStudio
pub fn app_data_dir() -> PathBuf {
    dirs::config_dir()
        .map(|d| d.join("LocalMediaStudio"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn logs_dir() -> PathBuf {
    app_data_dir().join("logs")
}

/// Bundled tools: %LOCALAPPDATA%\LocalMediaStudio\tools
pub fn tools_dir() -> PathBuf {
    dirs::data_local_dir()
        .map(|d| d.join("LocalMediaStudio").join("tools"))
        .unwrap_or_else(|| app_data_dir().join("tools"))
}

pub fn default_output_dir() -> PathBuf {
    dirs::audio_dir()
        .map(|d| d.join("Local Media Studio"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn settings_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn history_db_path() -> PathBuf {
    app_data_dir().join("history.db")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub startup_behavior: String,
    pub default_format: String,
    pub default_quality: String,
    pub output_dir: String,
    pub filename_template: String,
    pub overwrite_behavior: String,
    pub duplicate_handling: String,
    pub embed_artwork: bool,
    pub embed_metadata: bool,
    pub ytdlp_path: String,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub max_concurrent: usize,
    pub clipboard_monitor: bool,
    pub notify_on_complete: bool,
    /// Optional, deliberately user-provided cookies file (never harvested automatically).
    pub cookies_file: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            startup_behavior: "restore".to_string(),
            default_format: "mp3".to_string(),
            default_quality: "best".to_string(),
            output_dir: default_output_dir().to_string_lossy().to_string(),
            filename_template: "%(title)s.%(ext)s".to_string(),
            overwrite_behavior: "skip".to_string(),
            duplicate_handling: "skip".to_string(),
            embed_artwork: true,
            embed_metadata: true,
            ytdlp_path: String::new(),
            ffmpeg_path: String::new(),
            ffprobe_path: String::new(),
            max_concurrent: 3,
            clipboard_monitor: false,
            notify_on_complete: true,
            cookies_file: String::new(),
        }
    }
}

impl AppSettings {
    pub fn load() -> Self {
        let path = settings_path();
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(mut s) = serde_json::from_str::<AppSettings>(&text) {
                s.normalize();
                return s;
            }
        }
        Self::default()
    }

    pub fn save(&self) -> crate::error::AppResult<()> {
        let path = settings_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|e| crate::error::AppError::config(e.to_string()))?;
        std::fs::write(&path, text).map_err(|e| crate::error::AppError::io("Saving settings", e))
    }

    pub fn normalize(&mut self) {
        if self.output_dir.trim().is_empty() {
            self.output_dir = default_output_dir().to_string_lossy().to_string();
        }
        if self.filename_template.trim().is_empty() {
            self.filename_template = "%(title)s.%(ext)s".to_string();
        }
        if self.max_concurrent == 0 {
            self.max_concurrent = 1;
        }
        self.max_concurrent = self.max_concurrent.min(8);
    }
}
