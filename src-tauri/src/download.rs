use crate::analyze;
use crate::arggen::{build_fields, build_ytdlp_args};
use crate::config::AppSettings;
use crate::error::{AppError, AppResult};
use crate::history::{HistoryDb, HistoryItem, PersistedJob};
use crate::logger;
use crate::process::{kill_tree, new_command};
use crate::progress::{self, ProgressUpdate};
use crate::tools::resolve_all;
use crate::util::{build_output_path, redact_url, unique_path};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_FETCHING: &str = "fetching";
pub const STATUS_DOWNLOADING: &str = "downloading";
pub const STATUS_PROCESSING: &str = "processing";
pub const STATUS_COMPLETED: &str = "completed";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_CANCELLED: &str = "cancelled";
pub const STATUS_SKIPPED: &str = "skipped";
pub const STATUS_INTERRUPTED: &str = "interrupted";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub media_id: Option<String>,
    pub uploader: Option<String>,
    pub channel: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track: Option<String>,
    pub playlist_title: Option<String>,
    pub upload_date: Option<String>,
    pub release_date: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<i64>,
    pub playlist_index: Option<i64>,
    pub format: String,
    pub quality: String,
    pub status: String,
    pub progress: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub stage: Option<String>,
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub file_size: Option<i64>,
    pub duration: Option<f64>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub extractor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub format: String,
    pub quality: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub media_id: Option<String>,
    pub uploader: Option<String>,
    pub channel: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track: Option<String>,
    pub playlist_title: Option<String>,
    pub upload_date: Option<String>,
    pub release_date: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<i64>,
    pub playlist_index: Option<i64>,
    pub duration: Option<f64>,
    pub extractor: Option<String>,
}

struct ManagerInner {
    jobs: HashMap<String, Job>,
    queue: VecDeque<String>,
    running: HashMap<String, u32>,
    cancelled: HashSet<String>,
}

pub struct DownloadManager {
    inner: Mutex<ManagerInner>,
    history: HistoryDb,
    app: Mutex<Option<tauri::AppHandle>>,
    shutdown: AtomicBool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl DownloadManager {
    pub fn new() -> Arc<Self> {
        let history = HistoryDb::open().unwrap_or_else(|_| HistoryDb::open_at_temp());
        Arc::new(Self {
            inner: Mutex::new(ManagerInner {
                jobs: HashMap::new(),
                queue: VecDeque::new(),
                running: HashMap::new(),
                cancelled: HashSet::new(),
            }),
            history,
            app: Mutex::new(None),
            shutdown: AtomicBool::new(false),
        })
    }

    pub fn set_app(self: &Arc<Self>, app: tauri::AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// Access to the SQLite history database.
    pub fn history_db(&self) -> &HistoryDb {
        &self.history
    }

    fn app_handle(&self) -> Option<tauri::AppHandle> {
        self.app.lock().unwrap().clone()
    }

    // ---------- public API ----------

    pub fn submit(self: &Arc<Self>, req: DownloadRequest) -> AppResult<Job> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let job = Job {
            id: id.clone(),
            url: req.url,
            title: req.title,
            thumbnail: req.thumbnail,
            media_id: req.media_id,
            uploader: req.uploader,
            channel: req.channel,
            artist: req.artist,
            album: req.album,
            track: req.track,
            playlist_title: req.playlist_title,
            upload_date: req.upload_date,
            release_date: req.release_date,
            genre: req.genre,
            track_number: req.track_number,
            playlist_index: req.playlist_index,
            format: if req.format.is_empty() { "mp3".to_string() } else { req.format },
            quality: if req.quality.is_empty() { "best".to_string() } else { req.quality },
            status: STATUS_PENDING.to_string(),
            progress: 0.0,
            speed: None,
            eta: None,
            downloaded: None,
            total: None,
            stage: Some("Queued".to_string()),
            error: None,
            output_path: None,
            file_size: None,
            duration: req.duration,
            created_at: now,
            completed_at: None,
            extractor: req.extractor,
        };

        {
            let mut inner = self.inner.lock().unwrap();
            inner.jobs.insert(id.clone(), job.clone());
            inner.queue.push_back(id.clone());
        }
        self.persist_job(&job);
        logger::job_info(&id, "submit", &format!("Queued {} ({})", redact_url(&job.url), job.format));
        self.pump();
        Ok(job)
    }

    pub fn cancel(self: &Arc<Self>, id: &str) -> AppResult<()> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(pid) = inner.running.get(id) {
            if *pid != 0 {
                kill_tree(*pid);
            }
            inner.cancelled.insert(id.to_string());
            return Ok(());
        }
        let is_pending = inner
            .jobs
            .get(id)
            .map(|j| j.status == STATUS_PENDING)
            .unwrap_or(false);
        if is_pending {
            inner.queue.retain(|q| q != id);
            let now = now_ms();
            if let Some(job) = inner.jobs.get_mut(id) {
                job.status = STATUS_CANCELLED.to_string();
                job.completed_at = Some(now);
            }
            drop(inner);
            let job = self.inner.lock().unwrap().jobs.get(id).cloned();
            if let Some(j) = job {
                self.persist_job(&j);
                self.emit_job(id);
            }
            logger::job_info(id, "cancel", "Cancelled before start");
        }
        Ok(())
    }

    pub fn retry(self: &Arc<Self>, id: &str) -> AppResult<()> {
        {
            let mut inner = self.inner.lock().unwrap();
            let Some(job) = inner.jobs.get_mut(id) else {
                return Ok(());
            };
            job.status = STATUS_PENDING.to_string();
            job.progress = 0.0;
            job.speed = None;
            job.eta = None;
            job.downloaded = None;
            job.total = None;
            job.error = None;
            job.stage = Some("Queued".to_string());
            job.completed_at = None;
        }
        let job = {
            let mut inner = self.inner.lock().unwrap();
            inner.cancelled.remove(id);
            inner.queue.push_back(id.to_string());
            inner.jobs.get(id).cloned()
        };
        if let Some(j) = job {
            self.persist_job(&j);
        }
        logger::job_info(id, "retry", "Re-queued for retry");
        self.pump();
        Ok(())
    }

    pub fn remove_job(self: &Arc<Self>, id: &str) -> AppResult<()> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(pid) = inner.running.get(id) {
            if *pid != 0 {
                kill_tree(*pid);
            }
        }
        inner.queue.retain(|q| q != id);
        inner.cancelled.remove(id);
        inner.jobs.remove(id);
        drop(inner);
        self.history.delete_job(id).ok();
        Ok(())
    }

    pub fn clear_completed(self: &Arc<Self>) -> AppResult<()> {
        let mut inner = self.inner.lock().unwrap();
        let terminal: Vec<String> = inner
            .jobs
            .iter()
            .filter(|(_, j)| {
                matches!(
                    j.status.as_str(),
                    STATUS_COMPLETED
                        | STATUS_FAILED
                        | STATUS_CANCELLED
                        | STATUS_SKIPPED
                        | STATUS_INTERRUPTED
                )
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in terminal {
            inner.jobs.remove(&id);
            self.history.delete_job(&id).ok();
        }
        Ok(())
    }

    pub fn list_jobs(&self) -> Vec<Job> {
        let inner = self.inner.lock().unwrap();
        let mut jobs: Vec<Job> = inner.jobs.values().cloned().collect();
        jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        jobs
    }

    pub fn restore_persisted_jobs(self: &Arc<Self>) {
        let jobs = self.history.load_jobs().unwrap_or_default();
        let mut inner = self.inner.lock().unwrap();
        for pj in jobs {
            if inner.jobs.contains_key(&pj.id) {
                continue;
            }
            let status = if matches!(
                pj.status.as_str(),
                STATUS_DOWNLOADING | STATUS_FETCHING | STATUS_PENDING | STATUS_PROCESSING
            ) {
                STATUS_INTERRUPTED.to_string()
            } else {
                pj.status.clone()
            };
            let job = Job {
                id: pj.id.clone(),
                url: pj.url,
                format: pj.format,
                quality: pj.quality,
                title: pj.title,
                thumbnail: pj.thumbnail,
                media_id: pj.media_id,
                uploader: None,
                channel: None,
                artist: None,
                album: None,
                track: None,
                playlist_title: None,
                upload_date: None,
                release_date: None,
                genre: None,
                track_number: None,
                playlist_index: None,
                status,
                progress: 0.0,
                speed: None,
                eta: None,
                downloaded: None,
                total: None,
                stage: Some("Interrupted — press Retry to resume".to_string()),
                error: None,
                output_path: None,
                file_size: None,
                duration: None,
                created_at: pj.created_at,
                completed_at: None,
                extractor: None,
            };
            inner.jobs.insert(pj.id, job);
        }
    }

    pub fn shutdown(self: &Arc<Self>) {
        self.shutdown.store(true, Ordering::SeqCst);
        let pids: Vec<u32> = self
            .inner
            .lock()
            .unwrap()
            .running
            .values()
            .copied()
            .filter(|p| *p != 0)
            .collect();
        for pid in pids {
            kill_tree(pid);
        }
    }

    // ---------- scheduling ----------

    fn pump(self: &Arc<Self>) {
        loop {
            let id = {
                let mut inner = self.inner.lock().unwrap();
                if self.shutdown.load(Ordering::SeqCst) {
                    return;
                }
                let settings = AppSettings::load();
                let max = settings.max_concurrent.max(1);
                if inner.running.len() >= max {
                    return;
                }
                let Some(id) = inner.queue.pop_front() else {
                    return;
                };
                if inner.jobs.get(&id).map(|j| j.status.as_str()) != Some(STATUS_PENDING) {
                    continue;
                }
                inner.running.insert(id.clone(), 0);
                id
            };
            self.spawn_worker(id);
        }
    }

    fn spawn_worker(self: &Arc<Self>, id: String) {
        let this = self.clone();
        std::thread::spawn(move || this.worker(&id));
    }

    // ---------- worker ----------

    fn worker(self: &Arc<Self>, id: &str) {
        let Some(app) = self.app_handle() else {
            return;
        };
        let job = {
            let inner = self.inner.lock().unwrap();
            inner.jobs.get(id).cloned()
        };
        let Some(mut job) = job else {
            return;
        };

        let settings = AppSettings::load();

        // 1. Fetch metadata if we don't have a title yet (raw URL queue items).
        if job.title.is_none() || job.media_id.is_none() {
            self.set_status(id, STATUS_FETCHING, Some("Fetching media information…"));
            self.emit_job(id);
            match analyze::fetch_media(&job.url) {
                Ok(f) => {
                    job.title = f.media.title.clone();
                    job.thumbnail = f.media.thumbnail.clone();
                    job.media_id = f.media.id.clone();
                    job.uploader = f.media.uploader.clone();
                    job.channel = f.media.channel.clone();
                    job.duration = f.media.duration;
                    job.extractor = f.media.extractor.clone();
                    job.album = f.media.album.clone();
                    job.artist = f.media.artist.clone();
                    job.track = f.media.track.clone();
                    job.upload_date = f.media.upload_date.clone();
                    job.release_date = f.media.release_date.clone();
                    job.genre = f.media.genre.clone();
                    job.track_number = f.media.track_number;
                    job.url = f.url;
                    self.inner
                        .lock()
                        .unwrap()
                        .jobs
                        .insert(id.to_string(), job.clone());
                }
                Err(e) => {
                    self.fail(id, &e, None, &app);
                    return;
                }
            }
        }

        // 2. Duplicate detection by stable media ID (history).
        let mut force_overwrite = false;
        if let Some(mid) = &job.media_id {
            if let Some(existing) = self.history.find_completed_by_media_id(mid) {
                match settings.duplicate_handling.as_str() {
                    "skip" => {
                        logger::job_info(id, "duplicate", "Already downloaded — skipping per settings");
                        self.finish_skipped(id, existing.file_path, &app);
                        return;
                    }
                    "replace" => {
                        force_overwrite = true;
                    }
                    _ => {}
                }
            }
        }

        // 3. Resolve tools.
        let tools = match resolve_all(&settings) {
            Ok(t) => t,
            Err(e) => {
                self.fail(id, &e, None, &app);
                return;
            }
        };

        // 4. Compute a safe output path.
        let ext = if job.format == "mp4" { "mp4" } else { "mp3" };
        let fields = build_fields(&job, ext);
        let mut out_path = match build_output_path(
            &settings.output_dir,
            &settings.filename_template,
            &fields,
            ext,
        ) {
            Ok(p) => p,
            Err(e) => {
                self.fail(id, &e, None, &app);
                return;
            }
        };
        if settings.overwrite_behavior == "new_copy" {
            out_path = unique_path(&out_path);
        } else if settings.overwrite_behavior == "skip" && !force_overwrite && out_path.exists() {
            logger::job_info(id, "existing_file", "Output file already exists — skipping per settings");
            self.finish_skipped(id, out_path.to_string_lossy().to_string(), &app);
            return;
        }

        // 5. Build arguments (structured array, no shell).
        let args = build_ytdlp_args(&job, &settings, &tools, &out_path, force_overwrite);
        logger::job_info(
            id,
            "spawn",
            &format!(
                "yt-dlp {} -o {}",
                args.iter().map(|a| redact_url(a)).collect::<Vec<_>>().join(" "),
                out_path.display()
            ),
        );

        // 6. Spawn the process.
        let mut cmd = new_command(&tools.ytdlp);
        cmd.args(&args);
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.fail(id, &AppError::io("Starting yt-dlp", e), None, &app);
                return;
            }
        };
        {
            let mut inner = self.inner.lock().unwrap();
            inner.running.insert(id.to_string(), child.id());
            inner.cancelled.remove(id);
        }
        self.set_status(id, STATUS_DOWNLOADING, Some("Starting download…"));
        self.emit_job(id);

        // 7. Stream output.
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // stdout carries `--print after_move:filepath` output
        let final_path_stdout = Arc::new(Mutex::new(None::<String>));
        if let Some(out) = stdout {
            let shared = final_path_stdout.clone();
            let this = self.clone();
            let id_owned = id.to_string();
            std::thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let trimmed = line.trim();
                        if looks_like_file_path(trimmed) {
                            *shared.lock().unwrap() = Some(trimmed.to_string());
                            let mut u = ProgressUpdate::default();
                            progress::parse_line(trimmed, &mut u);
                            if let Some(p) = u.output_path {
                                this.record_output_path(&id_owned, &p);
                            }
                        }
                    }
                }
            });
        }

        let mut update = ProgressUpdate::default();
        let mut last_emit = Instant::now();
        let mut last_final_path: Option<String> = None;
        let mut stderr_text = String::new();

        if let Some(err_stream) = stderr {
            let reader = BufReader::new(err_stream);
            for line in reader.lines() {
                let Ok(line) = line else { continue };
                stderr_text.push_str(&line);
                stderr_text.push('\n');
                if stderr_text.len() > 200_000 {
                    stderr_text = stderr_text.split_off(stderr_text.len() - 100_000);
                }
                progress::parse_line(&line, &mut update);
                if let Some(p) = update.output_path.clone() {
                    last_final_path = Some(p.clone());
                }
                if let Some(p) = update.output_path.clone() {
                    self.record_output_path(id, &p);
                }

                {
                    let mut inner = self.inner.lock().unwrap();
                    let Some(j) = inner.jobs.get_mut(id) else {
                        continue;
                    };
                    j.progress = update.percent.unwrap_or(j.progress);
                    j.speed = update.speed.clone();
                    j.eta = update.eta.clone();
                    j.downloaded = update.downloaded_bytes;
                    j.total = update.total_bytes;
                    if let Some(s) = &update.stage {
                        j.stage = Some(s.clone());
                        if s == "Processing" && j.status == STATUS_DOWNLOADING {
                            j.status = STATUS_PROCESSING.to_string();
                        }
                    }
                    if update.skipped {
                        j.status = STATUS_SKIPPED.to_string();
                    }
                }

                if last_emit.elapsed() >= Duration::from_millis(120) {
                    self.emit_job(id);
                    last_emit = Instant::now();
                }
            }
        }

        let status = child.wait();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.running.remove(id);
        }

        let is_cancelled = self.inner.lock().unwrap().cancelled.contains(id);
        let _exit_code = status.as_ref().ok().and_then(|s| s.code());

        // 8. Finalize.
        if update.skipped {
            let p = last_final_path
                .clone()
                .or_else(|| final_path_stdout.lock().unwrap().clone())
                .unwrap_or_else(|| out_path.to_string_lossy().to_string());
            self.finish_skipped(id, p, &app);
            return;
        }
        if is_cancelled {
            self.finish_cancelled(id, &app);
            return;
        }
        if !status.map(|s| s.success()).unwrap_or(false) {
            let msg = friendly_ytdlp_error(&stderr_text);
            self.fail(id, &msg, Some(&stderr_text), &app);
            return;
        }

        let final_path = last_final_path
            .clone()
            .or_else(|| final_path_stdout.lock().unwrap().clone())
            .unwrap_or_else(|| out_path.to_string_lossy().to_string());
        let file_size = std::fs::metadata(&final_path).ok().map(|m| m.len() as i64);
        self.finish_completed(id, &final_path, file_size, &app);
    }

    // ---------- helpers ----------

    fn record_output_path(&self, id: &str, path: &str) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(j) = inner.jobs.get_mut(id) {
            j.output_path = Some(path.to_string());
        }
    }

    fn set_status(&self, id: &str, status: &str, stage: Option<&str>) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(j) = inner.jobs.get_mut(id) {
            j.status = status.to_string();
            if let Some(s) = stage {
                j.stage = Some(s.to_string());
            }
        }
    }

    fn persist_job(&self, job: &Job) {
        let pj = PersistedJob {
            id: job.id.clone(),
            url: job.url.clone(),
            format: job.format.clone(),
            quality: job.quality.clone(),
            title: job.title.clone(),
            thumbnail: job.thumbnail.clone(),
            media_id: job.media_id.clone(),
            created_at: job.created_at,
            status: job.status.clone(),
        };
        self.history.save_job(&pj).ok();
    }

    fn emit_job(&self, id: &str) {
        let job = self.inner.lock().unwrap().jobs.get(id).cloned();
        if let Some(app) = self.app_handle() {
            if let Some(job) = job {
                let _ = app.emit("download-updated", &job);
            }
        }
    }

    fn finish_completed(
        self: &Arc<Self>,
        id: &str,
        path: &str,
        file_size: Option<i64>,
        app: &tauri::AppHandle,
    ) {
        let now = now_ms();
        let job = {
            let mut inner = self.inner.lock().unwrap();
            let Some(j) = inner.jobs.get_mut(id) else {
                return;
            };
            j.status = STATUS_COMPLETED.to_string();
            j.progress = 100.0;
            j.output_path = Some(path.to_string());
            j.file_size = file_size;
            j.completed_at = Some(now);
            j.stage = Some("Completed".to_string());
            j.clone()
        };

        let item = HistoryItem {
            id: job.id.clone(),
            title: job.title.clone(),
            url: job.url.clone(),
            media_id: job.media_id.clone(),
            extractor: job.extractor.clone(),
            thumbnail: job.thumbnail.clone(),
            format: job.format.clone(),
            quality: job.quality.clone(),
            file_path: path.to_string(),
            file_size,
            duration: job.duration,
            status: STATUS_COMPLETED.to_string(),
            created_at: now,
        };
        self.history.insert_history(&item).ok();
        self.persist_job(&job);

        logger::job_info(id, "completed", &format!("Saved to {}", path));
        let _ = app.emit("download-finished", &job);
        self.emit_job(id);
        self.pump();
    }

    fn finish_skipped(self: &Arc<Self>, id: &str, path: String, app: &tauri::AppHandle) {
        let now = now_ms();
        let job = {
            let mut inner = self.inner.lock().unwrap();
            let Some(j) = inner.jobs.get_mut(id) else {
                return;
            };
            j.status = STATUS_SKIPPED.to_string();
            j.output_path = Some(path.clone());
            j.completed_at = Some(now);
            j.stage = Some("Skipped — file already exists".to_string());
            j.clone()
        };
        let item = HistoryItem {
            id: job.id.clone(),
            title: job.title.clone(),
            url: job.url.clone(),
            media_id: job.media_id.clone(),
            extractor: job.extractor.clone(),
            thumbnail: job.thumbnail.clone(),
            format: job.format.clone(),
            quality: job.quality.clone(),
            file_path: path,
            file_size: None,
            duration: job.duration,
            status: STATUS_SKIPPED.to_string(),
            created_at: now,
        };
        self.history.insert_history(&item).ok();
        self.persist_job(&job);
        let _ = app.emit("download-finished", &job);
        self.emit_job(id);
        self.pump();
    }

    fn finish_cancelled(self: &Arc<Self>, id: &str, app: &tauri::AppHandle) {
        let now = now_ms();
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(j) = inner.jobs.get_mut(id) {
                j.status = STATUS_CANCELLED.to_string();
                j.completed_at = Some(now);
                j.stage = Some("Cancelled".to_string());
            }
            inner.cancelled.remove(id);
        }
        let job = self.inner.lock().unwrap().jobs.get(id).cloned();
        if let Some(job) = job {
            self.persist_job(&job);
            let _ = app.emit("download-finished", &job);
            self.emit_job(id);
        }
        self.pump();
    }

    fn fail(
        self: &Arc<Self>,
        id: &str,
        error: &AppError,
        detail: Option<&str>,
        app: &tauri::AppHandle,
    ) {
        let now = now_ms();
        let detail = detail.unwrap_or_else(|| error.detail.as_deref().unwrap_or(""));
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(j) = inner.jobs.get_mut(id) {
                j.status = STATUS_FAILED.to_string();
                j.error = Some(error.message.clone());
                j.completed_at = Some(now);
                j.stage = Some("Failed".to_string());
            }
            inner.running.remove(id);
            inner.cancelled.remove(id);
        }
        let job = self.inner.lock().unwrap().jobs.get(id).cloned();
        if let Some(job) = job {
            self.persist_job(&job);
            logger::job_error(id, "failed", &error.message, Some(detail), None);
            let _ = app.emit(
                "download-failed",
                &serde_json::json!({
                    "job": job,
                    "error": error,
                    "detail": detail,
                }),
            );
            self.emit_job(id);
        }
        self.pump();
    }
}

fn looks_like_file_path(line: &str) -> bool {
    let lower = line.to_lowercase();
    (line.len() >= 3
        && line.as_bytes().get(1) == Some(&b':')
        && line.as_bytes().get(2) == Some(&b'\\'))
        || lower.ends_with(".mp3")
        || lower.ends_with(".mp4")
        || lower.ends_with(".m4a")
        || lower.ends_with(".webm")
        || lower.ends_with(".mkv")
        || lower.ends_with(".part")
}

/// Translate raw yt-dlp stderr into a friendly, actionable error message.
pub fn friendly_ytdlp_error(stderr: &str) -> AppError {
    let lower = stderr.to_lowercase();
    let detail = truncate(stderr, 3000);
    let message = if lower.contains("unsupported url") {
        "This URL is not supported by yt-dlp.".to_string()
    } else if lower.contains("video unavailable") {
        "The video is unavailable — it may be private, removed, or restricted in your region.".to_string()
    } else if lower.contains("sign in to confirm") || lower.contains("confirm you're not a bot") {
        "The service is asking to verify you are not a bot. If you are authorized to access this content, provide a cookies file in Settings → yt-dlp.".to_string()
    } else if lower.contains("ffmpeg") && (lower.contains("not found") || lower.contains("not installed")) {
        "FFmpeg is missing. Install it from the Diagnostics screen.".to_string()
    } else if lower.contains("requested format is not available") || lower.contains("has no formats") {
        "No matching media formats are available for this item.".to_string()
    } else if lower.contains("private video") {
        "This is a private video. Sign in and provide a cookies file if you are authorized.".to_string()
    } else if lower.contains("login required") || lower.contains("authentication required") {
        "This content requires authentication. Provide a cookies file in Settings if you are authorized.".to_string()
    } else if lower.contains("age-restricted") || lower.contains("age restricted") {
        "This content is age-restricted.".to_string()
    } else if lower.contains("no entries") {
        "This playlist is empty or its entries could not be fetched.".to_string()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "The request timed out — check your network connection and try again.".to_string()
    } else if lower.contains("getaddrinfo")
        || lower.contains("name or service not known")
        || lower.contains("couldn't connect")
        || lower.contains("connection refused")
    {
        "Network error while contacting the media service.".to_string()
    } else if lower.contains("http error 403") {
        "The service rejected the request (HTTP 403). This usually means yt-dlp is out of date and YouTube is blocking its current extraction method — open Diagnostics and check for a yt-dlp update first. It can also require cookies or be region-blocked.".to_string()
    } else {
        format!(
            "yt-dlp failed to process this media (exit {})",
            detail.lines().next().unwrap_or("unknown error")
        )
    };
    AppError::with_detail("download_failed", message, detail)
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() > max {
        let mut out: String = t.chars().take(max).collect();
        out.push_str("\n… (truncated)");
        out
    } else {
        t.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_error_maps_unsupported_url() {
        let e = friendly_ytdlp_error("ERROR: Unsupported URL: https://foo.bar");
        assert!(e.message.contains("not supported"));
        assert_eq!(e.code, "download_failed");
    }

    #[test]
    fn friendly_error_maps_bot_check() {
        let e = friendly_ytdlp_error("Sign in to confirm you're not a bot");
        assert!(e.message.contains("bot"));
    }

    #[test]
    fn friendly_error_maps_ffmpeg_missing() {
        let e = friendly_ytdlp_error("ffmpeg not found. Please install or provide the path");
        assert!(e.message.contains("FFmpeg is missing"));
    }

    #[test]
    fn friendly_error_maps_403_to_ytdlp_update_hint() {
        let e = friendly_ytdlp_error("ERROR: unable to download video data: HTTP Error 403: Forbidden");
        assert!(e.message.contains("yt-dlp is out of date"));
        assert!(e.message.contains("Diagnostics"));
    }

    #[test]
    fn friendly_error_falls_back_with_exit() {
        let e = friendly_ytdlp_error("ERROR: something weird happened");
        assert!(e.message.contains("failed"));
        assert!(e.detail.is_some());
    }

    #[test]
    fn looks_like_path_win() {
        assert!(looks_like_file_path("C:\\Music\\song.mp3"));
        assert!(!looks_like_file_path("[download] 42% of 5MiB"));
        assert!(!looks_like_file_path("ERROR: Unsupported URL"));
    }
}
