use crate::config;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub title: Option<String>,
    pub url: String,
    pub media_id: Option<String>,
    pub extractor: Option<String>,
    pub thumbnail: Option<String>,
    pub format: String,
    pub quality: String,
    pub file_path: String,
    pub file_size: Option<i64>,
    pub duration: Option<f64>,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedJob {
    pub id: String,
    pub url: String,
    pub format: String,
    pub quality: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub created_at: i64,
    pub media_id: Option<String>,
    pub status: String,
}

/// Lightweight SQLite persistence for download history and the queue (so the
/// queue survives restarts). Files are stored on disk, never in the database.
pub struct HistoryDb {
    conn: Mutex<Connection>,
}

impl HistoryDb {
    pub fn open() -> AppResult<Self> {
        let path = config::history_db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io("Creating data directory", e))?;
        }
        Self::open_at(&path)
    }

    /// Emergency fallback DB location used only if the configured data dir is unusable.
    pub fn open_at_temp() -> Self {
        let path = std::env::temp_dir().join("local-media-studio-history.db");
        Self::open_at(&path).unwrap_or_else(|_| {
            // Last resort: in-memory database.
            Self {
                conn: Mutex::new(Connection::open_in_memory().expect("in-memory sqlite")),
            }
        })
    }

    /// A private, empty database for one test.
    ///
    /// `open_at_temp` is NOT usable here: it hands every caller the same fixed
    /// file, and cargo runs a suite's tests in parallel threads, so tests read
    /// each other's rows — and a file left behind by an earlier run poisoned
    /// the next one. Row-count assertions therefore failed intermittently
    /// depending on scheduling. (It stays as it is for the production fallback
    /// in `download.rs`, which does want a real file that survives a restart.)
    #[cfg(test)]
    fn open_isolated() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        Self::init_schema(&conn).expect("test schema");
        Self {
            conn: Mutex::new(conn),
        }
    }

    fn open_at(path: &std::path::Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io("Creating data directory", e))?;
        }
        let conn = Connection::open(path)
            .map_err(|e| AppError::with_detail("db_error", "Could not open the local database.", e.to_string()))?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Create the tables and indexes. Shared so a test database is built by the
    /// same statements as a real one and cannot drift from it.
    fn init_schema(conn: &Connection) -> AppResult<()> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                title TEXT,
                url TEXT NOT NULL,
                media_id TEXT,
                extractor TEXT,
                thumbnail TEXT,
                format TEXT,
                quality TEXT,
                file_path TEXT,
                file_size INTEGER,
                duration REAL,
                status TEXT,
                created_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_history_media_id ON history(media_id);
             CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);
             CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                format TEXT,
                quality TEXT,
                title TEXT,
                thumbnail TEXT,
                media_id TEXT,
                created_at INTEGER,
                status TEXT
             );",
        )
        .map_err(|e| AppError::with_detail("db_error", "Could not initialize the local database.", e.to_string()))?;
        Ok(())
    }

    pub fn insert_history(&self, item: &HistoryItem) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO history
             (id, title, url, media_id, extractor, thumbnail, format, quality, file_path, file_size, duration, status, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                item.id,
                item.title,
                item.url,
                item.media_id,
                item.extractor,
                item.thumbnail,
                item.format,
                item.quality,
                item.file_path,
                item.file_size,
                item.duration,
                item.status,
                item.created_at
            ],
        )
        .map_err(|e| AppError::with_detail("db_error", "Could not save history.", e.to_string()))?;
        Ok(())
    }

    pub fn list_history(
        &self,
        query: Option<&str>,
        format_filter: Option<&str>,
        status_filter: Option<&str>,
        sort: &str,
    ) -> AppResult<Vec<HistoryItem>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT id, title, url, media_id, extractor, thumbnail, format, quality, file_path, file_size, duration, status, created_at
             FROM history WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(q) = query {
            if !q.is_empty() {
                sql.push_str(" AND (title LIKE ? OR url LIKE ?)");
                let like = format!("%{q}%");
                args.push(Box::new(like.clone()));
                args.push(Box::new(like));
            }
        }
        if let Some(f) = format_filter {
            if !f.is_empty() && f != "all" {
                sql.push_str(" AND format = ?");
                args.push(Box::new(f.to_string()));
            }
        }
        if let Some(s) = status_filter {
            if !s.is_empty() && s != "all" {
                sql.push_str(" AND status = ?");
                args.push(Box::new(s.to_string()));
            }
        }
        sql.push_str(match sort {
            "title" => " ORDER BY title COLLATE NOCASE ASC",
            "format" => " ORDER BY format ASC",
            _ => " ORDER BY created_at DESC",
        });

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| AppError::with_detail("db_error", "Could not query history.", e.to_string()))?;
        let mapped = stmt
            .query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    url: row.get(2)?,
                    media_id: row.get(3)?,
                    extractor: row.get(4)?,
                    thumbnail: row.get(5)?,
                    format: row.get(6)?,
                    quality: row.get(7)?,
                    file_path: row.get(8)?,
                    file_size: row.get(9)?,
                    duration: row.get(10)?,
                    status: row.get(11)?,
                    created_at: row.get(12)?,
                })
            })
            .map_err(|e| AppError::with_detail("db_error", "Could not query history.", e.to_string()))?;

        let mut out = Vec::new();
        for item in mapped {
            out.push(item.map_err(|e| {
                AppError::with_detail("db_error", "Could not read a history row.", e.to_string())
            })?);
        }
        Ok(out)
    }

    pub fn find_completed_by_media_id(&self, media_id: &str) -> Option<HistoryItem> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, url, media_id, extractor, thumbnail, format, quality, file_path, file_size, duration, status, created_at
                 FROM history WHERE media_id = ?1 AND status = 'completed' LIMIT 1",
            )
            .ok()?;
        let mut rows = stmt
            .query_map(params![media_id], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    url: row.get(2)?,
                    media_id: row.get(3)?,
                    extractor: row.get(4)?,
                    thumbnail: row.get(5)?,
                    format: row.get(6)?,
                    quality: row.get(7)?,
                    file_path: row.get(8)?,
                    file_size: row.get(9)?,
                    duration: row.get(10)?,
                    status: row.get(11)?,
                    created_at: row.get(12)?,
                })
            })
            .ok()?;
        rows.next().and_then(|r| r.ok())
    }

    pub fn remove_history(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])
            .map_err(|e| AppError::with_detail("db_error", "Could not remove history item.", e.to_string()))?;
        Ok(())
    }

    pub fn clear_history(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history", [])
            .map_err(|e| AppError::with_detail("db_error", "Could not clear history.", e.to_string()))?;
        Ok(())
    }

    pub fn save_job(&self, job: &PersistedJob) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, url, format, quality, title, thumbnail, media_id, created_at, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                job.id,
                job.url,
                job.format,
                job.quality,
                job.title,
                job.thumbnail,
                job.media_id,
                job.created_at,
                job.status
            ],
        )
        .map_err(|e| AppError::with_detail("db_error", "Could not save job.", e.to_string()))?;
        Ok(())
    }

    pub fn load_jobs(&self) -> AppResult<Vec<PersistedJob>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, url, format, quality, title, thumbnail, media_id, created_at, status FROM jobs")
            .map_err(|e| AppError::with_detail("db_error", "Could not load jobs.", e.to_string()))?;
        let mapped = stmt
            .query_map([], |row| {
                Ok(PersistedJob {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    format: row.get(2)?,
                    quality: row.get(3)?,
                    title: row.get(4)?,
                    thumbnail: row.get(5)?,
                    media_id: row.get(6)?,
                    created_at: row.get(7)?,
                    status: row.get(8)?,
                })
            })
            .map_err(|e| AppError::with_detail("db_error", "Could not load jobs.", e.to_string()))?;
        let mut out = Vec::new();
        for item in mapped {
            out.push(item.map_err(|e| {
                AppError::with_detail("db_error", "Could not read a job row.", e.to_string())
            })?);
        }
        Ok(out)
    }

    pub fn delete_job(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])
            .map_err(|e| AppError::with_detail("db_error", "Could not delete job.", e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> HistoryItem {
        HistoryItem {
            id: "h1".to_string(),
            title: Some("Test Song".to_string()),
            url: "https://example.com/v".to_string(),
            media_id: Some("vid123".to_string()),
            extractor: Some("youtube".to_string()),
            thumbnail: None,
            format: "mp3".to_string(),
            quality: "320".to_string(),
            file_path: "C:\\Music\\Test Song.mp3".to_string(),
            file_size: Some(12345),
            duration: Some(180.0),
            status: "completed".to_string(),
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn history_insert_list_remove() {
        let db = HistoryDb::open_isolated();
        let item = sample();
        db.insert_history(&item).unwrap();

        let list = db.list_history(None, None, None, "date").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title.as_deref(), Some("Test Song"));

        // filter by format
        let list = db.list_history(None, Some("mp4"), None, "date").unwrap();
        assert_eq!(list.len(), 0);
        let list = db.list_history(None, Some("mp3"), None, "date").unwrap();
        assert_eq!(list.len(), 1);

        // search by title
        let list = db.list_history(Some("Test"), None, None, "date").unwrap();
        assert_eq!(list.len(), 1);

        // duplicate detection by media id
        let found = db.find_completed_by_media_id("vid123");
        assert!(found.is_some());
        assert_eq!(db.find_completed_by_media_id("nope"), None);

        db.remove_history("h1").unwrap();
        assert_eq!(db.list_history(None, None, None, "date").unwrap().len(), 0);
    }

    #[test]
    fn jobs_persist_roundtrip() {
        let db = HistoryDb::open_isolated();
        let job = PersistedJob {
            id: "j1".to_string(),
            url: "https://example.com/v".to_string(),
            format: "mp3".to_string(),
            quality: "best".to_string(),
            title: Some("X".to_string()),
            thumbnail: None,
            media_id: None,
            created_at: 1,
            status: "pending".to_string(),
        };
        db.save_job(&job).unwrap();
        let loaded = db.load_jobs().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "j1");
        db.delete_job("j1").unwrap();
        assert_eq!(db.load_jobs().unwrap().len(), 0);
    }
}
