//! Real end-to-end pipeline tests against the actual yt-dlp + FFmpeg binaries.
//!
//! These are gated with `#[ignore]` because they require network access and the
//! media tools to be installed. Run them explicitly with:
//!
//! ```text
//! cargo test -- --ignored --test-threads=1
//! ```
//!
//! They exercise the exact same code paths the application uses (argument
//! generation, metadata fetching, subprocess execution, path building).

use crate::analyze;
use crate::arggen::{build_fields, build_ytdlp_args};
use crate::config::AppSettings;
use crate::download::Job;
use crate::process::new_command;
use crate::util::build_output_path;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;

/// Locate yt-dlp / ffmpeg / ffprobe. Prefers env var LMS_TOOLS_DIR, then PATH.
fn resolve_tools() -> Option<(PathBuf, PathBuf, PathBuf)> {
    // Tool names and the PATH separator are platform-specific. Hardcoding
    // "ffmpeg.exe" and splitting PATH on ';' meant this returned None on Linux,
    // so every integration test silently skipped instead of running.
    let exe = |stem: &str| format!("{stem}{}", std::env::consts::EXE_SUFFIX);
    let names = [exe("yt-dlp"), exe("ffmpeg"), exe("ffprobe")];

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("LMS_TOOLS_DIR") {
        let d = PathBuf::from(dir);
        candidates.extend(names.iter().map(|n| d.join(n)));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            if dir.as_os_str().is_empty() {
                continue;
            }
            candidates.extend(names.iter().map(|n| dir.join(n)));
        }
    }
    let find = |name: &str| -> Option<PathBuf> {
        candidates
            .iter()
            .find(|p| {
                p.file_name().map(|f| f.to_string_lossy().to_lowercase())
                    == Some(name.to_lowercase())
                    && p.is_file()
            })
            .cloned()
    };
    let ytdlp = find(&names[0])?;
    let ffmpeg = find(&names[1])?;
    let ffprobe = find(&names[2])?;
    Some((ytdlp, ffmpeg, ffprobe))
}

fn run_and_capture(program: &PathBuf, args: &[String], timeout_secs: u64) -> (Option<i32>, String) {
    let mut cmd = new_command(program);
    cmd.args(args);
    let mut child = match cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return (None, format!("spawn error: {e}")),
    };
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut s = String::new();
        let mut buf = Vec::new();
        out.read_to_end(&mut buf).ok();
        s.push_str(&String::from_utf8_lossy(&buf));
        let mut e = String::new();
        err.read_to_string(&mut e).ok();
        let _ = tx.send(format!("{s}\n--- STDERR ---\n{e}"));
    });
    let start = std::time::Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let code = status.code();
            let combined = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or_default();
            return (code, combined);
        }
        if start.elapsed().as_secs() > timeout_secs {
            let _ = child.kill();
            let _ = child.wait();
            return (None, "timed out".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

fn test_url() -> String {
    // Big Buck Bunny — Blender Foundation's open movie (Creative Commons).
    // Publicly available and intended for testing media tooling.
    std::env::var("LMS_TEST_URL")
        .unwrap_or_else(|_| "https://www.youtube.com/watch?v=aqz-KE-bpKQ".to_string())
}

#[test]
#[ignore]
fn tools_versions() {
    let Some((ytdlp, ffmpeg, ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found. Set LMS_TOOLS_DIR or add to PATH.");
        return;
    };
    let (code, out) = run_and_capture(&ytdlp, &["--version".to_string()], 20);
    assert_eq!(code, Some(0), "yt-dlp --version failed: {out}");
    assert!(!out.trim().is_empty());

    let (code, out) = run_and_capture(&ffmpeg, &["-version".to_string()], 20);
    assert_eq!(code, Some(0), "ffmpeg -version failed: {out}");
    assert!(out.contains("ffmpeg version"));

    let (code, out) = run_and_capture(&ffprobe, &["-version".to_string()], 20);
    assert_eq!(code, Some(0), "ffprobe -version failed: {out}");
    assert!(out.contains("ffprobe version"));
}

#[test]
#[ignore]
fn metadata_fetch_returns_title() {
    let Some(_) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };
    let fetched = analyze::fetch_media(&test_url());
    assert!(fetched.is_ok(), "metadata fetch failed: {:?}", fetched.err());
    let fetched = fetched.unwrap();
    assert!(
        fetched.media.title.is_some(),
        "expected a title from the real metadata fetch"
    );
    assert!(fetched.media.id.is_some(), "expected a media id");
}

#[test]
#[ignore]
fn real_mp3_download_and_verify() {
    let Some((ytdlp, ffmpeg, _ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };

    let url = test_url();
    let fetched = analyze::fetch_media(&url)
        .expect("metadata fetch should succeed against a real, test-appropriate URL");
    let title = fetched.media.title.clone().unwrap_or_else(|| "test".to_string());

    let temp_dir = std::env::temp_dir().join(format!("lms_e2e_{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    // Build the job exactly like the app does.
    let settings = AppSettings::default();
    let job = Job {
        id: "e2e-test".to_string(),
        url: fetched.url.clone(),
        title: Some(title.clone()),
        thumbnail: fetched.media.thumbnail.clone(),
        media_id: fetched.media.id.clone(),
        uploader: fetched.media.uploader.clone(),
        channel: fetched.media.channel.clone(),
        artist: None,
        album: None,
        track: None,
        playlist_title: None,
        upload_date: fetched.media.upload_date.clone(),
        release_date: fetched.media.release_date.clone(),
        genre: None,
        track_number: None,
        playlist_index: None,
        format: "mp3".to_string(),
        quality: "128".to_string(),
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
        duration: fetched.media.duration,
        created_at: 0,
        completed_at: None,
        extractor: fetched.media.extractor.clone(),
    };

    let ext = "mp3";
    let fields = build_fields(&job, ext);
    let out_path = build_output_path(
        &temp_dir.to_string_lossy(),
        &settings.filename_template,
        &fields,
        ext,
    )
    .expect("output path should build");

    let ffmpeg_dir = ffmpeg.parent().map(|d| d.to_path_buf());
    let tools = crate::tools::ResolvedTools {
        ytdlp,
        ffmpeg: Some(ffmpeg.clone()),
        ffprobe: None,
        ffmpeg_dir,
    };
    let args = build_ytdlp_args(&job, &settings, &tools, &out_path, false);

    let (code, combined) = run_and_capture(&tools.ytdlp, &args, 180);
    assert_eq!(code, Some(0), "yt-dlp download failed:\n{combined}");

    assert!(out_path.exists(), "expected mp3 at {:?}", out_path);
    let meta = std::fs::metadata(&out_path).expect("stat output file");
    assert!(meta.len() > 10_000, "mp3 suspiciously small: {} bytes", meta.len());

    // Verify with ffprobe that this is a real, playable MP3 with metadata.
    let mut probe = new_command(
        &ffmpeg
            .parent()
            .unwrap()
            .join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)),
    );
    probe.args([
        "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams",
    ]);
    probe.arg(&out_path);
    let out = crate::process::run_capture(&mut probe, 30_000).expect("ffprobe should run");
    let json: serde_json::Value = serde_json::from_str(out.trim()).expect("ffprobe JSON");
    let format = &json["format"];
    assert_eq!(format["format_name"].as_str(), Some("mp3"), "not an mp3 container");
    let duration: f64 = format["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    assert!(duration > 1.0, "duration should be >1s, got {duration}");
    let stream = &json["streams"][0];
    assert_eq!(stream["codec_name"].as_str(), Some("mp3"), "audio codec should be mp3");

    // Tag check (title embedded)
    let tags = &format["tags"];
    let embedded = tags["title"].as_str().unwrap_or("");
    assert!(!embedded.is_empty(), "expected an embedded title tag");

    eprintln!("OK: downloaded {title} -> {}", out_path.display());
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
#[ignore]
fn unsupported_url_fails_gracefully() {
    let Some((ytdlp, _ffmpeg, _ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };
    let (code, _out) = run_and_capture(&ytdlp, &["-J", "https://example.com/not-media"].map(String::from), 60);
    assert!(code.is_some() && code != Some(0), "expected yt-dlp to fail on a non-media URL");
}

#[test]
#[ignore]
fn studio_renders_mix_and_verifies() {
    use crate::audio::model::*;
    use crate::audio::render::{render_mix, ExportQuality};

    let Some((_ytdlp, ffmpeg, ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };

    let dir = std::env::temp_dir().join(format!("lms_studio_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let a = dir.join("song_a.wav");
    let b = dir.join("song_b.wav");

    // Generate two real test sources (different pitches/durations).
    for (out, freq, dur) in [(&a, "440", "3"), (&b, "880", "2")] {
        let (code, out_text) = run_and_capture(
            &ffmpeg,
            &[
                "-y".to_string(),
                "-f".to_string(), "lavfi".to_string(),
                "-i".to_string(), format!("sine=frequency={freq}:duration={dur}"),
                "-ac".to_string(), "2".to_string(),
                "-ar".to_string(), "44100".to_string(),
                out.to_string_lossy().to_string(),
            ],
            30,
        );
        assert_eq!(code, Some(0), "failed to generate test audio: {out_text}");
    }

    let before_a = std::fs::read(&a).unwrap();
    let before_b = std::fs::read(&b).unwrap();

    let mut p = StudioProject::new("Test Mix".to_string());
    p.sources.push(StudioSource {
        id: "s1".to_string(),
        path: a.to_string_lossy().to_string(),
        name: "Song A".to_string(),
        duration: 3.0,
        sample_rate: Some(44100),
        channels: Some(2),
        bpm: None, markers: vec![],
    });
    p.sources.push(StudioSource {
        id: "s2".to_string(),
        path: b.to_string_lossy().to_string(),
        name: "Song B".to_string(),
        duration: 2.0,
        sample_rate: Some(44100),
        channels: Some(2),
        bpm: None, markers: vec![],
    });
    p.clips.push(StudioClip {
        id: "c1".to_string(),
        source_id: "s1".to_string(),
        name: "Clip A".to_string(),
        start: 0.0,
        end: 2.0,
    });
    p.clips.push(StudioClip {
        id: "c2".to_string(),
        source_id: "s2".to_string(),
        name: "Clip B".to_string(),
        start: 0.0,
        end: 2.0,
    });
    p.timeline.tracks[0].items.push(StudioTimelineItem {
        clip_id: "c1".to_string(),
        position: 0.0,
        volume: 1.0,
        muted: false,
        fade_in: 0.2,
        fade_out: 0.0,
        crossfade_prev: 0.0,
        trim_start: 0.0,
        trim_end: 0.0,
    });
    p.timeline.tracks[0].items.push(StudioTimelineItem {
        clip_id: "c2".to_string(),
        position: 2.0,
        volume: 0.7,
        muted: false,
        fade_in: 0.0,
        fade_out: 0.0,
        crossfade_prev: 0.5, // 0.5s crossfade into clip B
        trim_start: 0.0,
        trim_end: 0.0,
    });
    p.export.title = "Test Mix".to_string();
    p.export.artist = "Tester".to_string();

    let out = dir.join("mix.mp3");
    let q = ExportQuality {
        format: "mp3".to_string(),
        bitrate_kbps: 192,
    };
    let res = render_mix(&p, &out, &q).expect("render should succeed");
    assert!(res.size_bytes > 10_000, "mix file too small");
    assert!(res.duration > 3.4 && res.duration <= 3.5001, "mix should be ~3.5s long, got {}", res.duration);

    // Verify with ffprobe that it is a real, playable MP3 with metadata.
    let mut probe = new_command(&ffprobe);
    probe.args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams"]);
    probe.arg(&out);
    let out_text = crate::process::run_capture(&mut probe, 30_000).expect("ffprobe should run");
    let json: serde_json::Value = serde_json::from_str(out_text.trim()).expect("ffprobe JSON");
    let format = &json["format"];
    assert_eq!(format["format_name"].as_str(), Some("mp3"), "not an mp3");
    let dur: f64 = format["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    assert!(dur > 3.0 && dur < 5.0, "unexpected duration {dur}");
    assert_eq!(json["streams"][0]["codec_name"].as_str(), Some("mp3"));
    assert_eq!(format["tags"]["title"].as_str(), Some("Test Mix"));
    assert_eq!(format["tags"]["artist"].as_str(), Some("Tester"));

    // Sources must be byte-for-byte untouched.
    assert_eq!(std::fs::read(&a).unwrap(), before_a, "Song A was modified!");
    assert_eq!(std::fs::read(&b).unwrap(), before_b, "Song B was modified!");

    eprintln!("OK: studio mix rendered and verified -> {}", out.display());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore]
fn studio_export_clip_and_missing_source() {
    use crate::audio::model::*;
    use crate::audio::render::{export_clip, render_mix, ExportQuality};

    let Some((_ytdlp, ffmpeg, _ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };
    let dir = std::env::temp_dir().join(format!("lms_studio_clip_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let a = dir.join("song.wav");
    run_and_capture(
        &ffmpeg,
        &["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-ac", "2", "-ar", "44100", a.to_str().unwrap()]
            .map(String::from),
        30,
    );

    // Export a sub-section (0.5s -> 2.0s) without touching the source.
    let before = std::fs::read(&a).unwrap();
    let clip_out = dir.join("my_clip.wav");
    let q = ExportQuality { format: "wav".to_string(), bitrate_kbps: 0 };
    let res = export_clip(&a.to_string_lossy(), 0.5, 2.0, &clip_out, &q).expect("clip export");
    assert!(res.size_bytes > 0);
    assert!((res.duration - 1.5).abs() < 0.05);
    assert_eq!(std::fs::read(&a).unwrap(), before);

    // Missing source must produce a clean, identifiable error (not a crash).
    let mut p = StudioProject::new("Missing".to_string());
    p.sources.push(StudioSource {
        id: "s1".to_string(), path: dir.join("nope.wav").to_string_lossy().to_string(),
        name: "Gone".to_string(), duration: 3.0, sample_rate: None, channels: None, bpm: None, markers: vec![],
    });
    p.clips.push(StudioClip { id: "c1".to_string(), source_id: "s1".to_string(), name: "X".to_string(), start: 0.0, end: 1.0 });
    p.timeline.tracks[0].items.push(StudioTimelineItem {
        clip_id: "c1".to_string(), position: 0.0, volume: 1.0, muted: false,
        fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
    });
    let err = render_mix(&p, &dir.join("out.mp3"), &q).unwrap_err();
    assert!(err.message.to_lowercase().contains("missing"));
    assert!(p.missing_sources().len() == 1);

    let _ = std::fs::remove_dir_all(&dir);
}

/// A clip must render from EXACTLY the sample it starts at.
///
/// Regression test for silent head-truncation: the renderer used to seek the
/// demuxer straight to `clip.start`, and on a compressed source that lands on a
/// frame boundary rather than a sample. Measured against a VBR MP3 it threw
/// away between 43 ms and 189 ms off the front of every clip, varying with the
/// seek position — enough to lose the attack of a note, and invisible in the
/// preview, which seeks in the decoded stream instead.
///
/// The source here is silence with a short marker tone at a known, deliberately
/// frame-misaligned offset. The clip begins exactly on the tone, so a correct
/// render puts the tone's first sample at the very start of the output. Any
/// leading silence is content that was lost.
#[test]
#[ignore]
fn studio_clip_starts_on_the_exact_sample() {
    use crate::audio::model::*;
    use crate::audio::render::{render_mix, ExportQuality};

    let Some((_ytdlp, ffmpeg, _ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };
    let dir = std::env::temp_dir().join(format!("lms_seek_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    // 90s VBR MP3: silence, with a 250ms tone at an offset that is NOT a
    // multiple of an MP3 frame (1152 samples ≈ 26.12ms).
    const MARK: f64 = 40.017;
    let src = dir.join("marker.mp3");
    let (code, log) = run_and_capture(
        &ffmpeg,
        &[
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=90",
            "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100:duration=0.25",
            "-filter_complex",
            &format!(
                "[1:a]adelay={}:all=1,pan=stereo|c0=c0|c1=c0[t];[0:a][t]amix=inputs=2:normalize=0[o]",
                (MARK * 1000.0).round() as i64
            ),
            "-map", "[o]", "-c:a", "libmp3lame", "-q:a", "4",
            &src.to_string_lossy(),
        ]
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>(),
        90,
    );
    assert_eq!(code, Some(0), "fixture generation failed: {log}");

    let mut p = StudioProject::new("Seek".to_string());
    p.sources.push(StudioSource {
        id: "s1".to_string(), path: src.to_string_lossy().to_string(), name: "marker".to_string(),
        duration: 90.0, sample_rate: Some(44100), channels: Some(2), bpm: None, markers: vec![],
    });
    p.clips.push(StudioClip {
        id: "c1".to_string(), source_id: "s1".to_string(), name: "M".to_string(),
        start: MARK, end: MARK + 2.0,
    });
    p.timeline.tracks[0].items.push(StudioTimelineItem {
        clip_id: "c1".to_string(), position: 0.0, volume: 1.0, muted: false,
        fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
    });

    let out = dir.join("cut.wav");
    let q = ExportQuality { format: "wav".to_string(), bitrate_kbps: 320 };
    render_mix(&p, &out, &q).expect("render");

    // Decode to raw mono f32 and find the first audible sample.
    let raw = dir.join("cut.f32");
    let (code, log) = run_and_capture(
        &ffmpeg,
        ["-y", "-i", &out.to_string_lossy(), "-ac", "1", "-ar", "44100", "-f", "f32le",
         &raw.to_string_lossy()]
            .iter().map(|s| s.to_string()).collect::<Vec<_>>().as_slice(),
        60,
    );
    assert_eq!(code, Some(0), "decode failed: {log}");

    let bytes = std::fs::read(&raw).unwrap();
    let first = (0..bytes.len() / 4)
        .find(|i| {
            f32::from_le_bytes([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]])
                .abs()
                > 0.02
        })
        .map(|i| i as f64 / 44100.0);

    let lead = first.expect("the marker tone must be present in the rendered clip");
    // Allowance covers only the source MP3's own encoder delay (~25ms), which
    // is a property of the fixture, not of the cut. The bug produced 43-189ms.
    assert!(
        lead < 0.030,
        "clip lost {:.1} ms off its head (tone found at {:.4}s, expected ~0)",
        lead * 1000.0,
        lead
    );
    println!("OK: clip head intact — marker at {:.1} ms", lead * 1000.0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// An arrangement that starts with silence must export at its full length.
///
/// Regression test: `adelay` places a clip by shifting timestamps, so when the
/// first clip does not sit at 0:00 the graph's closing `atrim=end=<duration>`
/// saw a stream whose first sample was already at the offset and measured from
/// the wrong origin — cutting the leading silence off and shortening the mix by
/// exactly the offset. The clip itself sounded right, so this showed up only as
/// an export that was seconds shorter than the timeline said.
#[test]
#[ignore]
fn studio_leading_silence_survives_export() {
    use crate::audio::model::*;
    use crate::audio::render::{render_mix, ExportQuality};

    let Some((_ytdlp, ffmpeg, ffprobe)) = resolve_tools() else {
        eprintln!("SKIPPED: media tools not found.");
        return;
    };
    let dir = std::env::temp_dir().join(format!("lms_lead_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("tone.mp3");
    let (code, log) = run_and_capture(
        &ffmpeg,
        ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=120",
         "-ac", "2", "-c:a", "libmp3lame", "-q:a", "4", &src.to_string_lossy()]
            .iter().map(|s| s.to_string()).collect::<Vec<_>>().as_slice(),
        90,
    );
    assert_eq!(code, Some(0), "fixture generation failed: {log}");

    // One 20s clip taken from deep in the source, placed 5s into the timeline:
    // the composition is 25s, of which the first 5s are silence.
    const LEAD: f64 = 5.0;
    const LEN: f64 = 20.0;
    let mut p = StudioProject::new("Lead".to_string());
    p.sources.push(StudioSource {
        id: "s1".to_string(), path: src.to_string_lossy().to_string(), name: "tone".to_string(),
        duration: 120.0, sample_rate: Some(44100), channels: Some(2), bpm: None, markers: vec![],
    });
    p.clips.push(StudioClip {
        id: "c1".to_string(), source_id: "s1".to_string(), name: "C".to_string(),
        start: 40.0, end: 40.0 + LEN,
    });
    p.timeline.tracks[0].items.push(StudioTimelineItem {
        clip_id: "c1".to_string(), position: LEAD, volume: 1.0, muted: false,
        fade_in: 0.0, fade_out: 0.0, crossfade_prev: 0.0, trim_start: 0.0, trim_end: 0.0,
    });
    assert!((p.duration() - (LEAD + LEN)).abs() < 1e-6, "project duration should include the lead");

    let out = dir.join("lead.wav");
    let q = ExportQuality { format: "wav".to_string(), bitrate_kbps: 320 };
    render_mix(&p, &out, &q).expect("render");

    let (code, probed) = run_and_capture(
        &ffprobe,
        ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0",
         &out.to_string_lossy()].iter().map(|s| s.to_string()).collect::<Vec<_>>().as_slice(),
        30,
    );
    assert_eq!(code, Some(0), "ffprobe failed: {probed}");
    let actual: f64 = probed.lines().next().unwrap_or("0").trim().parse().unwrap_or(0.0);
    assert!(
        (actual - (LEAD + LEN)).abs() < 0.3,
        "exported {actual:.3}s but the arrangement is {:.3}s — the {LEAD}s of leading silence was dropped",
        LEAD + LEN
    );
    println!("OK: leading silence intact — exported {actual:.3}s");
    let _ = std::fs::remove_dir_all(&dir);
}
