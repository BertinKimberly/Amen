use crate::error::{AppError, AppResult};
use std::path::PathBuf;

fn to_app_error(e: tauri_plugin_opener::Error) -> AppError {
    AppError::with_detail("open_failed", "Could not open the item.", e.to_string())
}

/// Open a file with its default application.
#[tauri::command]
pub fn open_file(app: tauri::AppHandle, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(to_app_error)
}

/// Open a folder in Explorer.
#[tauri::command]
pub fn open_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = PathBuf::from(&path);
    if p.is_dir() {
        app.opener()
            .open_path(path, None::<&str>)
            .map_err(to_app_error)
    } else {
        Err(AppError::new("open_failed", "That folder does not exist."))
    }
}

/// Reveal/select a file in Windows Explorer.
#[tauri::command]
pub fn reveal_in_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(to_app_error)
}
