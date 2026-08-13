//! Audio probing via ffprobe.

use crate::error::{AppError, AppResult};
use crate::process::{new_command, run_capture};
use crate::tools::resolve_ffprobe;
use crate::config::AppSettings;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub codec: String,
    pub bitrate: u64,
    pub format: String,
    pub has_audio: bool,
}

/// Probe an audio/video file with ffprobe and extract the primary audio stream.
pub fn probe_audio(path: &str) -> AppResult<AudioInfo> {
    if !Path::new(path).exists() {
        return Err(AppError::new("missing_source", format!("The audio file does not exist: {path}")));
    }
    let settings = AppSettings::load();
    let ffprobe = resolve_ffprobe(&settings).ok_or_else(|| {
        AppError::dependency("ffprobe is not installed. Open Diagnostics to install it.")
    })?;

    let mut cmd = new_command(&ffprobe);
    cmd.args([
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
    ]);
    cmd.arg(path);

    let Some(raw) = run_capture(&mut cmd, 60_000) else {
        return Err(AppError::with_detail(
            "probe_failed",
            "Could not read the audio file.",
            "ffprobe failed to start.",
        ));
    };

    let json: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| {
        AppError::with_detail(
            "probe_failed",
            "Could not read the audio file.",
            format!("ffprobe JSON parse error: {e}\n{raw}"),
        )
    })?;

    let format = &json["format"];
    let duration = format["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let bitrate = format["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    // Prefer the first audio stream.
    let mut sample_rate = 0u32;
    let mut channels = 0u32;
    let mut codec = String::new();
    let mut has_audio = false;
    if let Some(streams) = json["streams"].as_array() {
        for s in streams {
            if s["codec_type"].as_str() == Some("audio") {
                has_audio = true;
                codec = s["codec_name"].as_str().unwrap_or("").to_string();
                sample_rate = s["sample_rate"].as_str().and_then(|v| v.parse().ok()).unwrap_or(0);
                channels = s["channels"].as_i64().unwrap_or(0) as u32;
                if sample_rate == 0 {
                    sample_rate = s["sample_rate"].as_i64().unwrap_or(0) as u32;
                }
                break;
            }
        }
    }

    let container = format["format_name"].as_str().unwrap_or("").to_string();

    if !has_audio {
        return Err(AppError::new(
            "no_audio",
            "This file does not contain an audio stream.",
        ));
    }

    Ok(AudioInfo {
        path: path.to_string(),
        duration,
        sample_rate: if sample_rate == 0 { 44100 } else { sample_rate },
        channels: if channels == 0 { 2 } else { channels },
        codec,
        bitrate,
        format: container,
        has_audio: true,
    })
}
