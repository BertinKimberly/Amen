use crate::download::DownloadManager;
use crate::error::AppResult;
use crate::history::HistoryItem;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_history(
    state: State<'_, Arc<DownloadManager>>,
    query: Option<String>,
    format_filter: Option<String>,
    status_filter: Option<String>,
    sort: Option<String>,
) -> AppResult<Vec<HistoryItem>> {
    state.history_db().list_history(
        query.as_deref(),
        format_filter.as_deref(),
        status_filter.as_deref(),
        sort.as_deref().unwrap_or("date"),
    )
}

#[tauri::command]
pub fn remove_history_item(state: State<'_, Arc<DownloadManager>>, id: String) -> AppResult<()> {
    state.history_db().remove_history(&id)
}

#[tauri::command]
pub fn clear_history(state: State<'_, Arc<DownloadManager>>) -> AppResult<()> {
    state.history_db().clear_history()
}
