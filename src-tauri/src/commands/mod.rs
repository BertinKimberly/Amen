pub mod analyze;
pub mod deps;
pub mod fs;
pub mod history;
pub mod jobs;
pub mod settings;
pub mod studio;

use crate::config;
use crate::download::DownloadManager;
use crate::error::AppError;
use crate::logger;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_name: String,
    pub version: String,
    pub data_dir: String,
    pub tools_dir: String,
    pub logs_dir: String,
    pub default_output_dir: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        app_name: config::APP_NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: config::app_data_dir().to_string_lossy().to_string(),
        tools_dir: config::tools_dir().to_string_lossy().to_string(),
        logs_dir: config::logs_dir().to_string_lossy().to_string(),
        default_output_dir: config::default_output_dir().to_string_lossy().to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub fn get_logs_dir() -> String {
    config::logs_dir().to_string_lossy().to_string()
}

#[tauri::command]
pub async fn get_diagnostic_text(
    state: State<'_, Arc<DownloadManager>>,
) -> Result<String, AppError> {
    let jobs = state.list_jobs();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = config::AppSettings::load();
        let report = crate::tools::detect_dependencies(&settings);
        let mut out = String::new();
        out.push_str("Amen — Diagnostic Report\n");
        out.push_str("========================================\n");
        out.push_str(&format!(
            "App version: {}\nPlatform: {} ({})\n",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        out.push_str(&format!("Data dir: {}\n", config::app_data_dir().display()));
        out.push_str(&format!("Tools dir: {}\n", config::tools_dir().display()));
        out.push_str(&format!("Logs dir: {}\n", config::logs_dir().display()));
        out.push_str(&format!(
            "Output dir: {} ({})\n",
            report.output_dir.path,
            if report.output_dir.ok {
                "writable"
            } else {
                "NOT WRITABLE"
            }
        ));
        out.push_str("\n--- Dependencies ---\n");
        for tool in [&report.ytdlp, &report.ffmpeg, &report.ffprobe] {
            out.push_str(&format!(
                "{}: {} (source: {}, version: {})\n",
                tool.name,
                if tool.found { "installed" } else { "MISSING" },
                tool.source,
                tool.version.as_deref().unwrap_or("n/a")
            ));
        }
        out.push_str(&format!(
            "Network: {} ({} ms via {})\n",
            if report.network.ok {
                "reachable"
            } else {
                "UNREACHABLE"
            },
            report
                .network
                .latency_ms
                .map(|m| m.to_string())
                .unwrap_or_else(|| "n/a".to_string()),
            report.network.host.as_deref().unwrap_or("n/a")
        ));
        out.push_str("\n--- Active jobs ---\n");
        for job in &jobs {
            out.push_str(&format!(
                "[{}] {} — {} (progress {:.0}%)\n",
                job.status,
                job.title.as_deref().unwrap_or("untitled"),
                job.format,
                job.progress
            ));
        }
        out.push_str("\n--- Settings (cookies path omitted) ---\n");
        // Never include the cookies file path in diagnostics
        let mut settings_redacted = settings.clone();
        settings_redacted.cookies_file = "[redacted]".to_string();
        let settings_json = serde_json::to_string_pretty(&settings_redacted).unwrap_or_default();
        out.push_str(&settings_json);
        out.push_str("\n\n--- Recent logs ---\n");
        out.push_str(&logger::tail(150));
        out
    })
    .await
    .map_err(|e| AppError::with_detail("diagnostics_failed", "Could not generate diagnostics.", e.to_string()))
}
