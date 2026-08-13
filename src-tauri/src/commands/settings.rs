use crate::config::AppSettings;
use crate::error::{AppError, AppResult};

#[tauri::command]
pub fn get_settings() -> AppSettings {
    AppSettings::load()
}

#[tauri::command]
pub fn save_settings(mut settings: AppSettings) -> AppResult<AppSettings> {
    settings.normalize();
    settings.save()?;
    Ok(settings)
}

/// Native folder picker (Windows dialog).
#[tauri::command]
pub async fn select_directory(
    app: tauri::AppHandle,
    initial: Option<String>,
) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut builder = app.dialog().file();
        if let Some(dir) = initial {
            if !dir.trim().is_empty() {
                builder = builder.set_directory(std::path::PathBuf::from(crate::util::expand_env(&dir)));
            }
        }
        let picked = builder.blocking_pick_folder();
        let result = match picked {
            Some(p) => {
                let path = p
                    .into_path()
                    .map_err(|e| {
                        AppError::with_detail("dialog_failed", "Could not read the selected folder.", e.to_string())
                    })?;
                Some(path.to_string_lossy().to_string())
            }
            None => None,
        };
        Ok::<_, AppError>(result)
    })
    .await
    .map_err(|e| AppError::with_detail("dialog_failed", "The folder picker failed.", e.to_string()))?
}
