use serde::Serialize;

/// Application error surfaced to the frontend.
/// The `code` field lets the UI map errors to friendly messages; `detail` holds
/// the raw technical information for the "Copy diagnostic info" action.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub message: String,
    pub code: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: code.to_string(),
            detail: None,
        }
    }

    pub fn with_detail(code: &str, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: code.to_string(),
            detail: Some(detail.into()),
        }
    }

    pub fn dependency(msg: impl Into<String>) -> Self {
        Self::new("dependency_missing", msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new("invalid_config", msg)
    }

    pub fn io(context: &str, err: std::io::Error) -> Self {
        Self::with_detail(
            "io_error",
            format!("{context} failed: {}", friendly_io(&err)),
            err.to_string(),
        )
    }

    pub fn analysis(msg: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::with_detail("analysis_failed", msg, detail)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::with_detail("io_error", format!("I/O error: {}", friendly_io(&e)), e.to_string())
    }
}

fn friendly_io(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::PermissionDenied => "access was denied".to_string(),
        std::io::ErrorKind::NotFound => "the file or folder was not found".to_string(),
        std::io::ErrorKind::AlreadyExists => "the item already exists".to_string(),
        std::io::ErrorKind::TimedOut => "the operation timed out".to_string(),
        std::io::ErrorKind::WouldBlock => "the operation would block".to_string(),
        _ => err.to_string(),
    }
}

pub type AppResult<T> = Result<T, AppError>;
