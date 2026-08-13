use crate::config::AppSettings;
use crate::download::Job;
use crate::tools::ResolvedTools;
use std::collections::HashMap;
use std::path::Path;

/// Build the metadata fields map used for filename templates.
pub fn build_fields(job: &Job, ext: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let title = job.title.clone().unwrap_or_else(|| "media".to_string());
    fields.insert("title".to_string(), title);
    fields.insert("ext".to_string(), ext.to_string());
    insert(&mut fields, "uploader", job.uploader.as_deref());
    insert(&mut fields, "channel", job.channel.as_deref());
    insert(&mut fields, "artist", job.artist.as_deref());
    insert(&mut fields, "album", job.album.as_deref());
    insert(&mut fields, "track", job.track.as_deref());
    insert(&mut fields, "playlist_title", job.playlist_title.as_deref());
    insert(&mut fields, "upload_date", job.upload_date.as_deref());
    insert(&mut fields, "release_date", job.release_date.as_deref());
    insert(&mut fields, "genre", job.genre.as_deref());
    insert(&mut fields, "id", job.media_id.as_deref());
    if let Some(n) = job.track_number {
        fields.insert("track_number".to_string(), n.to_string());
    }
    if let Some(n) = job.playlist_index {
        fields.insert("playlist_index".to_string(), n.to_string());
    }
    fields.insert("format".to_string(), job.format.clone());
    fields.insert("quality".to_string(), job.quality.clone());
    fields
}

fn insert(fields: &mut HashMap<String, String>, key: &str, value: Option<&str>) {
    if let Some(v) = value {
        if !v.is_empty() {
            fields.insert(key.to_string(), v.to_string());
        }
    }
}

/// Build the full yt-dlp argument list for a job. All values are passed as
/// structured arguments — never interpolated into a shell string.
pub fn build_ytdlp_args(
    job: &Job,
    settings: &AppSettings,
    tools: &ResolvedTools,
    out_template: &Path,
    force_overwrite: bool,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // The URL is placed first (matching yt-dlp convention) — it is passed as a
    // single argument, never through a shell.
    args.push(job.url.clone());
    args.push("--no-playlist".to_string());
    args.push("--newline".to_string());
    args.push("--progress".to_string());
    args.push("--no-warnings".to_string());
    args.push("--print".to_string());
    args.push("after_move:filepath".to_string());

    if let Some(ffmpeg_dir) = &tools.ffmpeg_dir {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_dir.to_string_lossy().to_string());
    }

    if force_overwrite || settings.overwrite_behavior == "replace" {
        args.push("--force-overwrites".to_string());
    }

    // Explicitly user-provided cookies file (never harvested automatically).
    let cookies = settings.cookies_file.trim();
    if !cookies.is_empty() && Path::new(cookies).is_file() {
        args.push("--cookies".to_string());
        args.push(cookies.to_string());
    }

    if job.format == "mp4" {
        args.push("-f".to_string());
        args.push("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b".to_string());
        args.push("--merge-output-format".to_string());
        args.push("mp4".to_string());
        if settings.embed_metadata {
            args.push("--embed-metadata".to_string());
        }
    } else {
        // MP3 (default): extract best audio, convert with FFmpeg
        args.push("-f".to_string());
        args.push("bestaudio/best".to_string());
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push("mp3".to_string());

        match job.quality.as_str() {
            "320" => {
                args.push("--postprocessor-args".to_string());
                args.push("ffmpeg:-b:a 320k".to_string());
            }
            "256" => {
                args.push("--postprocessor-args".to_string());
                args.push("ffmpeg:-b:a 256k".to_string());
            }
            "192" => {
                args.push("--postprocessor-args".to_string());
                args.push("ffmpeg:-b:a 192k".to_string());
            }
            "128" => {
                args.push("--postprocessor-args".to_string());
                args.push("ffmpeg:-b:a 128k".to_string());
            }
            _ => {
                // "best" — highest VBR the encoder supports
                args.push("--audio-quality".to_string());
                args.push("0".to_string());
            }
        }

        if settings.embed_artwork {
            args.push("--embed-thumbnail".to_string());
        }
        if settings.embed_metadata {
            args.push("--embed-metadata".to_string());
            args.push("--parse-metadata".to_string());
            args.push("description:%(meta_description)s".to_string());
            args.push("--parse-metadata".to_string());
            args.push("comment:%(meta_comment)s".to_string());
            args.push("--parse-metadata".to_string());
            args.push("upload_date:%(meta_date)s".to_string());
            args.push("--parse-metadata".to_string());
            args.push("track_number:%(meta_track)s".to_string());
        }
    }

    args.push("-o".to_string());
    args.push(out_template.to_string_lossy().to_string());

    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::download::Job;
    use crate::util::sanitize_filename_component;

    fn sample_job() -> Job {
        Job {
            id: "j1".to_string(),
            url: "https://example.com/watch?v=abc".to_string(),
            title: Some("Test Title".to_string()),
            thumbnail: None,
            media_id: Some("abc".to_string()),
            uploader: Some("Some Artist".to_string()),
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
            format: "mp3".to_string(),
            quality: "best".to_string(),
            status: "pending".to_string(),
            progress: 0.0,
            speed: None,
            eta: None,
            downloaded: None,
            total: None,
            stage: None,
            error: None,
            output_path: None,
            file_size: None,
            duration: None,
            created_at: 0,
            completed_at: None,
            extractor: None,
        }
    }

    fn tools() -> ResolvedTools {
        ResolvedTools {
            ytdlp: Path::new("C:\\tools\\yt-dlp.exe").to_path_buf(),
            ffmpeg: Some(Path::new("C:\\tools\\ffmpeg.exe").to_path_buf()),
            ffprobe: Some(Path::new("C:\\tools\\ffprobe.exe").to_path_buf()),
            ffmpeg_dir: Some(Path::new("C:\\tools").to_path_buf()),
        }
    }

    #[test]
    fn mp3_best_args() {
        let job = sample_job();
        let settings = AppSettings::default();
        let args = build_ytdlp_args(&job, &settings, &tools(), Path::new("C:\\Music\\out.mp3"), false);
        let joined = args.join(" ");
        assert!(joined.contains("-x"));
        assert!(joined.contains("--audio-format mp3"));
        assert!(joined.contains("--audio-quality 0"));
        assert!(joined.contains("--embed-thumbnail"));
        assert!(joined.contains("--embed-metadata"));
        assert!(joined.contains("--ffmpeg-location C:\\tools"));
        assert!(joined.contains("-o C:\\Music\\out.mp3"));
        assert!(!joined.contains("--force-overwrites"));
        // URL must be a single argument (no shell)
        assert!(args.contains(&"https://example.com/watch?v=abc".to_string()));
    }

    #[test]
    fn mp3_320_uses_cbr() {
        let mut job = sample_job();
        job.quality = "320".to_string();
        let settings = AppSettings::default();
        let args = build_ytdlp_args(&job, &settings, &tools(), Path::new("C:\\Music\\out.mp3"), false);
        let joined = args.join(" ");
        assert!(joined.contains("-b:a 320k"));
        assert!(!joined.contains("--audio-quality 0"));
    }

    #[test]
    fn replace_forces_overwrite() {
        let job = sample_job();
        let settings = AppSettings::default();
        let args = build_ytdlp_args(&job, &settings, &tools(), Path::new("C:\\Music\\out.mp3"), true);
        assert!(args.contains(&"--force-overwrites".to_string()));
    }

    #[test]
    fn mp4_args() {
        let mut job = sample_job();
        job.format = "mp4".to_string();
        let settings = AppSettings::default();
        let args = build_ytdlp_args(&job, &settings, &tools(), Path::new("C:\\Music\\out.mp4"), false);
        let joined = args.join(" ");
        assert!(joined.contains("--merge-output-format mp4"));
        assert!(!joined.contains("-x"));
    }

    #[test]
    fn cookies_file_only_when_present() {
        let job = sample_job();
        let mut settings = AppSettings::default();
        settings.cookies_file = "C:\\nonexistent\\cookies.txt".to_string();
        let args = build_ytdlp_args(&job, &settings, &tools(), Path::new("C:\\Music\\out.mp3"), false);
        assert!(!args.contains(&"--cookies".to_string()));
    }

    #[test]
    fn fields_include_uploader() {
        let job = sample_job();
        let fields = build_fields(&job, "mp3");
        assert_eq!(fields.get("uploader").map(|s| s.as_str()), Some("Some Artist"));
        assert_eq!(fields.get("ext").map(|s| s.as_str()), Some("mp3"));
    }

    #[test]
    fn sanitize_is_applied_by_template_consumer() {
        // `/` and `:` are both invalid in Windows filenames → replaced with spaces
        assert_eq!(sanitize_filename_component("A:B / C"), "A B C");
    }
}
