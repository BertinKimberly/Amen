use crate::config;
use chrono::Local;
use serde::Serialize;
use std::sync::Mutex;

static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts: String,
    pub level: String,
    pub job_id: Option<String>,
    pub op: String,
    pub message: String,
    pub exit_code: Option<i32>,
    pub detail: Option<String>,
}

/// Append one structured log line to %APPDATA%\LocalMediaStudio\logs\app.log.
/// Never log secrets: callers must pass already-redacted content.
pub fn log(entry: LogEntry) {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = config::logs_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("app.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let json = serde_json::to_string(&entry).unwrap_or_else(|_| "{}".to_string());
        let line = format!("{json}\n");
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn info(op: &str, message: &str) {
    log(LogEntry {
        ts: Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string(),
        level: "INFO".to_string(),
        job_id: None,
        op: op.to_string(),
        message: message.to_string(),
        exit_code: None,
        detail: None,
    });
}

pub fn job_error(job_id: &str, op: &str, message: &str, detail: Option<&str>, exit_code: Option<i32>) {
    log(LogEntry {
        ts: Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string(),
        level: "ERROR".to_string(),
        job_id: Some(job_id.to_string()),
        op: op.to_string(),
        message: message.to_string(),
        exit_code,
        detail: detail.map(|s| s.to_string()),
    });
}

pub fn job_info(job_id: &str, op: &str, message: &str) {
    log(LogEntry {
        ts: Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string(),
        level: "INFO".to_string(),
        job_id: Some(job_id.to_string()),
        op: op.to_string(),
        message: message.to_string(),
        exit_code: None,
        detail: None,
    });
}

/// Read the most recent log lines for the "copy diagnostic info" feature.
pub fn tail(max_lines: usize) -> String {
    let path = config::logs_dir().join("app.log");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}
