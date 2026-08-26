//! FFmpeg render engine for Audio Studio.
//!
//! Non-destructive: source files are never modified. The project (a set of
//! editing instructions) is turned into an FFmpeg filter_complex that trims,
//! fades, volumes, delays and mixes clips, then encodes the result.
//!
//! Rendering model
//! ---------------
//! For every timeline item (clip placement):
//!   -ss <clip.start> -i <source>                      (fast, accurate input seek)
//!   [N:a]atrim=end=<dur>,asetpts=PTS-STARTPTS,        (clip content)
//!        aresample=<sr>:ochl=stereo,volume=<gain>,    (consistent format)
//!        afade in/out,                                (fades & crossfades)
//!        adelay=<pos_ms>:all=1                        (place on timeline)
//! Per track: amix (normalize=0) of that track's clips.
//! All tracks: amix (normalize=0).
//! Optional normalization (peak measured in a separate pass, or loudnorm).
//! Encode to the requested format with metadata/artwork.

use crate::audio::model::StudioProject;
use crate::config::AppSettings;
use crate::error::{AppError, AppResult};
use crate::process::new_command;
use crate::tools::resolve_ffmpeg;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;

pub const SUPPORTED_FORMATS: &[&str] = &["mp3", "wav", "flac", "m4a"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub path: String,
    pub duration: f64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct ExportQuality {
    pub format: String, // mp3 | wav | flac | m4a
    pub bitrate_kbps: u32,
}

impl Default for ExportQuality {
    fn default() -> Self {
        Self {
            format: "mp3".to_string(),
            bitrate_kbps: 320,
        }
    }
}

/// A fully-built FFmpeg command (structured args, no shell).
#[derive(Debug, Clone)]
pub struct MixCommand {
    pub args: Vec<String>,
    pub filter_complex: String,
    pub duration: f64,
    pub clip_count: usize,
}

/// Build the FFmpeg argument list for a mix. Pure and unit-testable.
/// Validates that referenced source files exist.
pub fn build_mix_command(
    project: &StudioProject,
    normalize: NormalizeKind,
    peak_gain_db: Option<f64>,
) -> AppResult<MixCommand> {
    build_mix_command_inner(project, normalize, peak_gain_db, true)
}

/// Same as [`build_mix_command`] but with the source-existence check toggleable
/// (used by pure unit tests with synthetic paths).
fn build_mix_command_inner(
    project: &StudioProject,
    normalize: NormalizeKind,
    peak_gain_db: Option<f64>,
    check_sources: bool,
) -> AppResult<MixCommand> {
    let sr = if project.settings.sample_rate == 0 {
        44100
    } else {
        project.settings.sample_rate.clamp(22050, 96000)
    };

    let mut args: Vec<String> = Vec::new();
    let mut filters: Vec<String> = Vec::new();
    let mut input_idx = 0usize;
    let mut track_labels: Vec<String> = Vec::new();
    let mut clip_count = 0usize;

    // Solo semantics: if any track is soloed, only soloed (and non-muted)
    // tracks are audible. A muted track is always silent, even if soloed.
    let any_solo = project.timeline.tracks.iter().any(|t| t.solo);

    for track in &project.timeline.tracks {
        if track.muted || (any_solo && !track.solo) {
            continue;
        }
        let mut item_labels: Vec<String> = Vec::new();
        for (i, item) in track.items.iter().enumerate() {
            let Some(clip) = project.clip_by_id(&item.clip_id) else {
                return Err(AppError::new(
                    "invalid_project",
                    format!("Timeline references an unknown clip: {}", item.clip_id),
                ));
            };
            let Some(src) = project.source_by_id(&clip.source_id) else {
                return Err(AppError::new(
                    "invalid_project",
                    format!("Clip references an unknown source: {}", clip.source_id),
                ));
            };
            if check_sources && !Path::new(&src.path).exists() {
                return Err(AppError::new(
                    "missing_source",
                    format!("Source audio is missing: {}", src.path),
                ));
            }
            if clip.end - clip.start <= 0.0 {
                return Err(AppError::new(
                    "invalid_project",
                    format!("Clip '{}' has zero or negative length.", clip.name),
                ));
            }

            let raw_dur = clip.end - clip.start;
            let trim_start = item.trim_start.max(0.0).min(raw_dur);
            let clip_dur = item.effective_duration(raw_dur);
            let seek_start = clip.start + trim_start;
            let crossfade_prev = item.crossfade_prev.max(0.0);
            let render_start = (item.position - crossfade_prev).max(0.0);

            // This clip fades in over any crossfade overlap with the previous.
            let fade_in = item.fade_in.max(crossfade_prev).clamp(0.0, clip_dur);
            // The NEXT item's crossfade makes this clip fade out.
            let next_cross = track
                .items
                .get(i + 1)
                .map(|n| n.crossfade_prev.max(0.0))
                .unwrap_or(0.0);
            let fade_out = item.fade_out.max(next_cross).clamp(0.0, clip_dur);

            let volume = if item.muted { 0.0 } else { item.volume.clamp(0.0, 2.0) };

            args.push("-ss".to_string());
            args.push(format!("{}", seek_start));
            args.push("-i".to_string());
            args.push(src.path.clone());

            let mut chain = String::new();
            chain.push_str(&format!(
                "[{input_idx}:a]atrim=end={clip_dur:.6},asetpts=PTS-STARTPTS"
            ));
            chain.push_str(&format!(",aresample={sr}:ochl=stereo"));
            chain.push_str(&format!(",volume={volume}"));
            if fade_in > 0.0 {
                chain.push_str(&format!(",afade=t=in:st=0:d={fade_in:.6}"));
            }
            if fade_out > 0.0 {
                let fo_start = (clip_dur - fade_out).max(0.0);
                chain.push_str(&format!(
                    ",afade=t=out:st={fo_start:.6}:d={fade_out:.6}"
                ));
            }
            let delay_ms = (render_start * 1000.0).round().max(0.0) as u64;
            chain.push_str(&format!(",adelay={delay_ms}:all=1"));
            let label = format!("c{input_idx}");
            chain.push_str(&format!("[{label}]"));
            filters.push(chain);
            item_labels.push(label);
            input_idx += 1;
            clip_count += 1;
        }

        if item_labels.is_empty() {
            continue; // empty track contributes nothing
        }
        let track_label = if item_labels.len() == 1 {
            item_labels[0].clone()
        } else {
            let t = format!("track{}", track_labels.len());
            filters.push(format!(
                "{}amix=inputs={}:normalize=0:duration=longest[{}]",
                item_labels.iter().map(|l| format!("[{l}]")).collect::<String>(),
                item_labels.len(),
                t
            ));
            t
        };
        track_labels.push(track_label);
    }

    if clip_count == 0 {
        return Err(AppError::new(
            "nothing_to_render",
            "Add at least one clip to the timeline before rendering.",
        ));
    }

    // Final mix of all tracks.
    let mix_label = if track_labels.len() == 1 {
        track_labels[0].clone()
    } else {
        let m = "mix".to_string();
        filters.push(format!(
            "{}amix=inputs={}:normalize=0:duration=longest[{}]",
            track_labels.iter().map(|l| format!("[{l}]")).collect::<String>(),
            track_labels.len(),
            m
        ));
        m
    };

    // Normalization + final format. Built as discrete filter steps (not a
    // string with a leading comma) — a chain like `[label],filter` parses as
    // an EMPTY first filter name in ffmpeg ("No such filter: ''"), which
    // silently broke every render whenever this was the final segment.
    let mut tail_steps: Vec<String> = Vec::new();
    match normalize {
        NormalizeKind::None => {}
        NormalizeKind::Loudness => {
            let lufs = if project.settings.normalize_lufs == 0.0 {
                -16.0
            } else {
                project.settings.normalize_lufs
            };
            tail_steps.push(format!("loudnorm=I={lufs}:TP=-1.5:LRA=11"));
        }
        NormalizeKind::Peak => {
            let gain = peak_gain_db.unwrap_or(0.0).clamp(-60.0, 30.0);
            tail_steps.push(format!("volume={gain}dB"));
        }
    }
    tail_steps.push(format!("aresample={sr}"));
    tail_steps.push("aformat=sample_fmts=fltp:channel_layouts=stereo".to_string());

    filters.push(format!("[{mix_label}]{}[out]", tail_steps.join(",")));

    let duration = project.duration();

    Ok(MixCommand {
        args: args,
        filter_complex: filters.join(";"),
        duration,
        clip_count,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NormalizeKind {
    None,
    Peak,
    Loudness,
}

impl NormalizeKind {
    pub fn from_project(project: &StudioProject) -> Self {
        match project.settings.normalize.as_str() {
            "peak" => NormalizeKind::Peak,
            "loudness" => NormalizeKind::Loudness,
            _ => NormalizeKind::None,
        }
    }
}

fn ffmpeg() -> AppResult<PathBuf> {
    let settings = AppSettings::load();
    resolve_ffmpeg(&settings).ok_or_else(|| {
        AppError::dependency("ffmpeg is not installed. Open Diagnostics to install it.")
    })
}

/// Measure the peak (max volume in dB) of the un-normalized mix. Used for peak
/// normalization. Returns e.g. -12.3.
pub fn measure_mix_peak_db(project: &StudioProject) -> AppResult<f64> {
    let mix = build_mix_command(project, NormalizeKind::None, None)?;
    let ffmpeg = ffmpeg()?;

    let mut cmd = new_command(&ffmpeg);
    cmd.args(["-y", "-hide_banner", "-nostdin"]);
    cmd.args(&mix.args);
    cmd.args([
        "-filter_complex",
        &format!("{},[mix]volumedetect[vd]", mix.filter_complex),
    ]);
    cmd.args(["-map", "[vd]", "-f", "null", "-"]);

    let out = run_capture_stderr(&mut cmd)?;
    // volumedetect prints: [Parsed_volumedetect_0] max_volume: -12.3 dB
    let line = out.lines().find(|l| l.contains("max_volume:"));
    let Some(line) = line else {
        return Ok(0.0);
    };
    let value = line
        .split("max_volume:")
        .nth(1)
        .and_then(|s| s.trim().trim_end_matches("dB").trim().parse::<f64>().ok());
    Ok(value.unwrap_or(0.0))
}

fn run_capture_stderr(cmd: &mut std::process::Command) -> AppResult<String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| AppError::io("Starting FFmpeg", e))?;
    let mut stderr = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut stderr);
    }
    let status = child.wait();
    if !status.map(|s| s.success()).unwrap_or(false) {
        return Err(AppError::with_detail(
            "render_failed",
            "FFmpeg could not process this mix.",
            stderr,
        ));
    }
    Ok(stderr)
}

/// Render the project to `output_path` in the requested format.
pub fn render_mix(
    project: &StudioProject,
    output_path: &Path,
    quality: &ExportQuality,
) -> AppResult<RenderResult> {
    if !SUPPORTED_FORMATS.contains(&quality.format.as_str()) {
        return Err(AppError::new(
            "invalid_format",
            format!("Unsupported export format: {}", quality.format),
        ));
    }

    let normalize = NormalizeKind::from_project(project);
    let peak_gain = if normalize == NormalizeKind::Peak {
        let target = if project.settings.normalize_target_db == 0.0 {
            -1.0
        } else {
            project.settings.normalize_target_db
        };
        let current = measure_mix_peak_db(project)?;
        Some(target - current)
    } else {
        None
    };

    let mix = build_mix_command(project, normalize, peak_gain)?;
    let ffmpeg = ffmpeg()?;

    let mut cmd = new_command(&ffmpeg);
    cmd.args(["-y", "-hide_banner", "-nostdin"]);
    cmd.args(&mix.args);
    cmd.args(["-filter_complex", &mix.filter_complex]);
    cmd.args(["-map", "[out]", "-vn"]);
    cmd.args(["-sn", "-dn"]);

    let br = if quality.bitrate_kbps == 0 { 320 } else { quality.bitrate_kbps };
    match quality.format.as_str() {
        "wav" => {
            cmd.args(["-c:a", "pcm_s16le", "-f", "wav"]);
        }
        "flac" => {
            cmd.args(["-c:a", "flac", "-f", "flac"]);
        }
        "m4a" => {
            cmd.args(["-c:a", "aac", "-b:a", &format!("{br}k"), "-f", "mp4"]);
        }
        _ => {
            cmd.args(["-c:a", "libmp3lame", "-b:a", &format!("{br}k"), "-f", "mp3"]);
        }
    }

    // Metadata
    let meta = &project.export;
    if !meta.title.trim().is_empty() {
        cmd.args(["-metadata", &format!("title={}", meta.title.trim())]);
    }
    if !meta.artist.trim().is_empty() {
        cmd.args(["-metadata", &format!("artist={}", meta.artist.trim())]);
    }
    if !meta.album.trim().is_empty() {
        cmd.args(["-metadata", &format!("album={}", meta.album.trim())]);
    }
    if !meta.year.trim().is_empty() {
        cmd.args(["-metadata", &format!("date={}", meta.year.trim())]);
    }
    if !meta.comment.trim().is_empty() {
        cmd.args(["-metadata", &format!("comment={}", meta.comment.trim())]);
    }

    // Optional artwork (MP3 / FLAC) as an extra input after all clip inputs.
    if let Some(art) = &meta.artwork {
        if !art.trim().is_empty() && Path::new(art).exists() {
            let cover_idx = mix.clip_count;
            cmd.args(["-i", art.trim()]);
            cmd.args(["-map", &format!("{cover_idx}:v")]);
            match quality.format.as_str() {
                "mp3" => {
                    cmd.args(["-c:v", "mjpeg", "-id3v2_version", "3"]);
                    cmd.args(["-metadata:s:v", "title=Album cover"]);
                    cmd.args(["-metadata:s:v", "comment=Cover (front)"]);
                }
                "flac" => {
                    cmd.args(["-c:v", "mjpeg", "-disposition:v", "attached_pic"]);
                }
                _ => {}
            }
        }
    }

    cmd.arg(output_path);

    let out = run_capture_stderr(&mut cmd)?;
    let size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    if size == 0 {
        return Err(AppError::with_detail(
            "render_failed",
            "FFmpeg produced an empty file.",
            out,
        ));
    }

    Ok(RenderResult {
        path: output_path.to_string_lossy().to_string(),
        duration: mix.duration,
        size_bytes: size,
    })
}

/// Cache directory for preview renders and waveforms.
pub fn cache_dir() -> PathBuf {
    crate::config::app_data_dir().join("cache")
}

fn hash_project(project: &StudioProject) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let json = serde_json::to_string(project).unwrap_or_default();
    let mut h = DefaultHasher::new();
    json.hash(&mut h);
    h.finish()
}

/// Render a cached preview WAV for the current timeline. Re-uses the cached
/// render when the project has not changed (content-hash keyed).
pub fn render_preview(project: &StudioProject) -> AppResult<RenderResult> {
    if project.clips.is_empty() {
        return Err(AppError::new(
            "nothing_to_render",
            "Create a clip and add it to the timeline to preview.",
        ));
    }
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io("Creating cache directory", e))?;
    let hash = hash_project(project);
    let out = dir.join(format!("preview_{:016x}.wav", hash));

    if out.exists() && out.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(RenderResult {
            path: out.to_string_lossy().to_string(),
            duration: project.duration(),
            size_bytes: out.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }

    let quality = ExportQuality {
        format: "wav".to_string(),
        bitrate_kbps: 0,
    };
    let result = render_mix(project, &out, &quality)?;

    // Cleanup: keep only the most recent 20 preview files.
    cleanup_previews(&dir, 20);

    Ok(result)
}

fn cleanup_previews(dir: &Path, keep: usize) {
    let Ok(files) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = files
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("preview_"))
        .filter_map(|e| {
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| (t, e.path()))
        })
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in entries.iter().skip(keep) {
        let _ = std::fs::remove_file(p);
    }
}

/// Export a single clip region from a source file (non-destructive).
pub fn export_clip(
    source_path: &str,
    start: f64,
    end: f64,
    output_path: &Path,
    quality: &ExportQuality,
) -> AppResult<RenderResult> {
    if !Path::new(source_path).exists() {
        return Err(AppError::new("missing_source", "The source file does not exist."));
    }
    if end - start <= 0.0 {
        return Err(AppError::new(
            "invalid_selection",
            "Clip selection must have a positive duration.",
        ));
    }
    let ffmpeg = ffmpeg()?;
    let mut cmd = new_command(&ffmpeg);
    cmd.args(["-y", "-hide_banner", "-nostdin", "-ss", &format!("{start}")]);
    cmd.arg("-i").arg(source_path);
    cmd.args(["-t", &format!("{}", end - start), "-vn", "-sn", "-dn"]);

    let br = if quality.bitrate_kbps == 0 { 320 } else { quality.bitrate_kbps };
    match quality.format.as_str() {
        "wav" => {
            cmd.args(["-c:a", "pcm_s16le", "-f", "wav"]);
        }
        "flac" => {
            cmd.args(["-c:a", "flac", "-f", "flac"]);
        }
        "m4a" => {
            cmd.args(["-c:a", "aac", "-b:a", &format!("{br}k"), "-f", "mp4"]);
        }
        _ => {
            cmd.args(["-c:a", "libmp3lame", "-b:a", &format!("{br}k"), "-f", "mp3"]);
        }
    }
    cmd.arg(output_path);

    run_capture_stderr(&mut cmd)?;
    let size = std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err(AppError::with_detail(
            "render_failed",
            "FFmpeg produced an empty file.",
            "Empty output.",
        ));
    }
    Ok(RenderResult {
        path: output_path.to_string_lossy().to_string(),
        duration: end - start,
        size_bytes: size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::model::*;

    fn sample_project() -> StudioProject {
        let mut p = StudioProject::new("Test".to_string());
        p.sources.push(StudioSource {
            id: "s1".to_string(),
            path: "C:\\Music\\A.mp3".to_string(),
            name: "A".to_string(),
            duration: 100.0,
            sample_rate: Some(44100),
            channels: Some(2),
            bpm: None, markers: vec![],
        });
        p.sources.push(StudioSource {
            id: "s2".to_string(),
            path: "C:\\Music\\B.mp3".to_string(),
            name: "B".to_string(),
            duration: 100.0,
            sample_rate: Some(44100),
            channels: Some(2),
            bpm: None, markers: vec![],
        });
        p.clips.push(StudioClip {
            id: "c1".to_string(),
            source_id: "s1".to_string(),
            name: "Clip A".to_string(),
            start: 42.3,
            end: 78.7,
        });
        p.clips.push(StudioClip {
            id: "c2".to_string(),
            source_id: "s2".to_string(),
            name: "Clip B".to_string(),
            start: 10.0,
            end: 40.0,
        });
        p.timeline.tracks[0].items.push(StudioTimelineItem {
            clip_id: "c1".to_string(),
            position: 0.0,
            volume: 1.0,
            muted: false,
            fade_in: 0.5,
            fade_out: 0.5,
            crossfade_prev: 0.0,
            trim_start: 0.0,
            trim_end: 0.0,
        });
        p.timeline.tracks[0].items.push(StudioTimelineItem {
            clip_id: "c2".to_string(),
            position: 36.4,
            volume: 0.8,
            muted: false,
            fade_in: 0.0,
            fade_out: 0.0,
            crossfade_prev: 0.5,
            trim_start: 0.0,
            trim_end: 0.0,
        });
        p
    }

    #[test]
    fn graph_includes_all_inputs() {
        let p = sample_project();
        let mix = build_mix_command_inner(&p, NormalizeKind::None, None, false).unwrap();
        assert_eq!(mix.clip_count, 2);
        let joined = mix.args.join(" ");
        assert!(joined.contains("-ss 42.3 -i C:\\Music\\A.mp3"));
        assert!(joined.contains("-ss 10 -i C:\\Music\\B.mp3"));
    }

    #[test]
    fn graph_has_fades_crossfade_and_amix() {
        let p = sample_project();
        let mix = build_mix_command_inner(&p, NormalizeKind::None, None, false).unwrap();
        assert!(mix.filter_complex.contains("afade=t=in:st=0:d=0.5"));
        // crossfade of 0.5 → clip B fades in 0.5 and clip A fades out 0.5
        assert!(mix.filter_complex.contains("afade=t=in:st=0:d=0.5"));
        assert!(mix.filter_complex.contains("amix=inputs=2:normalize=0"));
        assert!(mix.filter_complex.contains("adelay=0:all=1"));
        // clip B render start = 36.4 - 0.5 = 35.9s
        assert!(mix.filter_complex.contains("adelay=35900:all=1"));
    }

    #[test]
    fn empty_timeline_errors() {
        let p = StudioProject::new("Empty".to_string());
        let err = build_mix_command(&p, NormalizeKind::None, None);
        assert!(err.is_err());
    }

    fn two_track_project() -> StudioProject {
        let mut p = StudioProject::new("TwoTracks".to_string());
        p.sources.push(StudioSource {
            id: "s1".to_string(), path: r"C:\Music\A.mp3".to_string(), name: "A".to_string(),
            duration: 10.0, sample_rate: Some(44100), channels: Some(2), bpm: None, markers: vec![],
        });
        p.sources.push(StudioSource {
            id: "s2".to_string(), path: r"C:\Music\B.mp3".to_string(), name: "B".to_string(),
            duration: 10.0, sample_rate: Some(44100), channels: Some(2), bpm: None, markers: vec![],
        });
        p.clips.push(StudioClip { id: "c1".to_string(), source_id: "s1".to_string(), name: "A".to_string(), start: 0.0, end: 2.0 });
        p.clips.push(StudioClip { id: "c2".to_string(), source_id: "s2".to_string(), name: "B".to_string(), start: 0.0, end: 2.0 });
        p.timeline.tracks[0].items.push(StudioTimelineItem {
            clip_id: "c1".to_string(), position: 0.0, volume: 1.0, muted: false,
            fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
        });
        p.timeline.tracks.push(StudioTrack {
            id: "track-2".to_string(), name: "Track 2".to_string(), muted: false, solo: false,
            items: vec![StudioTimelineItem {
                clip_id: "c2".to_string(), position: 0.0, volume: 1.0, muted: false,
                fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
            }],
        });
        p
    }

    #[test]
    fn muted_track_is_excluded_from_render() {
        let mut p = two_track_project();
        p.timeline.tracks[0].muted = true;
        let mix = build_mix_command_inner(&p, NormalizeKind::None, None, false).unwrap();
        assert_eq!(mix.clip_count, 1, "only track 2's clip should render");
        assert!(mix.args.join(" ").contains(r"C:\Music\B.mp3"));
        assert!(!mix.args.join(" ").contains(r"C:\Music\A.mp3"));
    }

    #[test]
    fn soloed_track_excludes_all_others() {
        let mut p = two_track_project();
        p.timeline.tracks[1].solo = true;
        let mix = build_mix_command_inner(&p, NormalizeKind::None, None, false).unwrap();
        assert_eq!(mix.clip_count, 1, "only the soloed track should render");
        assert!(mix.args.join(" ").contains(r"C:\Music\B.mp3"));
        assert!(!mix.args.join(" ").contains(r"C:\Music\A.mp3"));
    }

    #[test]
    fn mute_wins_over_solo_on_the_same_track() {
        let mut p = two_track_project();
        p.timeline.tracks[1].solo = true;
        p.timeline.tracks[1].muted = true;
        let err = build_mix_command_inner(&p, NormalizeKind::None, None, false);
        assert!(err.is_err(), "soloed-but-muted track should render nothing");
    }

    #[test]
    fn missing_source_errors() {
        let mut p = sample_project();
        p.sources[0].path = "C:\\nonexistent\\A.mp3".to_string();
        let err = build_mix_command_inner(&p, NormalizeKind::None, None, true);
        assert!(err.is_err());
        let msg = err.unwrap_err().message;
        assert!(msg.contains("missing"));
    }

    #[test]
    fn duration_is_latest_end() {
        let p = sample_project();
        // clip1: 0 + 36.4 = 36.4 ; clip2 render start 35.9 + 30 = 65.9
        let d = p.duration();
        assert!((d - 65.9).abs() < 0.01, "got {d}");
    }

    #[test]
    fn peak_normalize_inserts_gain() {
        let p = sample_project();
        let mix = build_mix_command_inner(&p, NormalizeKind::Peak, Some(-3.5), false).unwrap();
        assert!(mix.filter_complex.contains("volume=-3.5dB"));
    }

    #[test]
    fn loudness_normalize_inserts_loudnorm() {
        let p = sample_project();
        let mix = build_mix_command_inner(&p, NormalizeKind::Loudness, None, false).unwrap();
        assert!(mix.filter_complex.contains("loudnorm"));
    }

    /// Regression test: a filterchain segment like `[label],filtername` parses
    /// in ffmpeg as an EMPTY first filter name ("No such filter: ''"), which
    /// silently broke every mix render (single-clip and multi-clip alike).
    /// No `]` may ever be immediately followed by a `,` in a valid graph here.
    #[test]
    fn filter_graph_never_has_empty_filter_name_after_a_pad() {
        // Single clip on a single track (the most common real case).
        let mut single = StudioProject::new("Single".to_string());
        single.sources.push(StudioSource {
            id: "s1".to_string(), path: r"C:\Music\A.mp3".to_string(), name: "A".to_string(),
            duration: 100.0, sample_rate: Some(44100), channels: Some(2), bpm: None, markers: vec![],
        });
        single.clips.push(StudioClip { id: "c1".to_string(), source_id: "s1".to_string(), name: "A".to_string(), start: 0.0, end: 4.2 });
        single.timeline.tracks[0].items.push(StudioTimelineItem {
            clip_id: "c1".to_string(), position: 0.0, volume: 1.0, muted: false,
            fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
        });
        for normalize in [NormalizeKind::None, NormalizeKind::Peak, NormalizeKind::Loudness] {
            let mix = build_mix_command_inner(&single, normalize, Some(-3.0), false).unwrap();
            assert!(!mix.filter_complex.contains("],"), "empty filter name bug (single clip, {normalize:?}): {}", mix.filter_complex);
        }

        // Two clips crossfading on one track (exercises the amix path too).
        let two = sample_project();
        for normalize in [NormalizeKind::None, NormalizeKind::Peak, NormalizeKind::Loudness] {
            let mix = build_mix_command_inner(&two, normalize, Some(-3.0), false).unwrap();
            assert!(!mix.filter_complex.contains("],"), "empty filter name bug (two clips, {normalize:?}): {}", mix.filter_complex);
        }
    }
}
