//! Real waveform extraction.
//!
//! We decode the audio with FFmpeg down to a low sample-rate mono float stream
//! and pipe it to our process, computing true per-bucket min/max peaks. This
//! never loads the whole file into memory and produces real data, not a fake
//! static waveform. We also compute a best-effort BPM estimate from the energy
//! envelope (clearly labeled as an estimate — never fabricated).

use crate::error::{AppError, AppResult};
use crate::process::new_command;
use crate::tools::resolve_ffmpeg;
use crate::config::AppSettings;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub path: String,
    pub duration: f64,
    pub buckets_per_second: f64,
    /// Each element is [min, max] for that bucket (normalized -1..1).
    pub peaks: Vec<[f32; 2]>,
    /// Best-effort BPM estimate, or None if it could not be determined.
    pub bpm: Option<f64>,
}

const F32_SAMPLES_PER_BUCKET: usize = 250; // -> 250 samples per bucket

/// Extract waveform peaks. `buckets_per_second` defaults to 50 (20 ms buckets).
pub fn extract_waveform(path: &str, buckets_per_second: Option<f64>) -> AppResult<WaveformData> {
    let bps = buckets_per_second.unwrap_or(50.0).clamp(5.0, 500.0);
    if !Path::new(path).exists() {
        return Err(AppError::new("missing_source", format!("The audio file does not exist: {path}")));
    }

    let settings = AppSettings::load();
    let ffmpeg = resolve_ffmpeg(&settings).ok_or_else(|| {
        AppError::dependency("ffmpeg is not installed. Open Diagnostics to install it.")
    })?;

    // Decode to mono f32 at a reduced rate.
    let sample_rate = (bps * F32_SAMPLES_PER_BUCKET as f64).round() as u32;

    let mut cmd = new_command(&ffmpeg);
    cmd.args(["-v", "error", "-nostdin", "-i"]);
    cmd.arg(path);
    cmd.args([
        "-vn",
        "-ac", "1",
        "-ar", &sample_rate.to_string(),
        "-f", "f32le",
        "-",
    ]);
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Err(AppError::io("Starting ffmpeg for waveform analysis", e));
        }
    };

    let mut stdout = child.stdout.take().ok_or_else(|| {
        AppError::new("waveform_failed", "Could not capture audio output.")
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        AppError::new("waveform_failed", "Could not capture ffmpeg output.")
    })?;

    let mut peaks: Vec<[f32; 2]> = Vec::new();
    let mut env: Vec<f32> = Vec::new(); // RMS per ~20ms window for BPM
    let mut min: f32 = f32::MAX;
    let mut max: f32 = f32::MIN;
    let mut count = 0usize;
    let mut buf = [0u8; 4096];

    // Read f32 samples in chunks.
    loop {
        let n = match stdout.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        // n may not be a multiple of 4; process complete floats
        let floats = n / 4;
        for i in 0..floats {
            let bytes = [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]];
            let s = f32::from_le_bytes(bytes);
            if !s.is_finite() {
                continue;
            }
            min = min.min(s);
            max = max.max(s);
            count += 1;
            if count >= F32_SAMPLES_PER_BUCKET {
                peaks.push([min, max]);
                let rms = (0.5 * (min * min + max * max)).sqrt();
                env.push(rms);
                min = f32::MAX;
                max = f32::MIN;
                count = 0;
            }
        }
    }
    if count > 0 {
        peaks.push([min.min(0.0), max.max(0.0)]);
        let rms = (0.5 * (min.min(0.0).powi(2) + max.max(0.0).powi(2))).sqrt();
        env.push(rms);
    }

    let mut err_text = String::new();
    let _ = stderr.read_to_string(&mut err_text);
    let status = child.wait();
    if !status.map(|s| s.success()).unwrap_or(false) {
        return Err(AppError::with_detail(
            "waveform_failed",
            "Could not decode this audio file for waveform analysis.",
            err_text,
        ));
    }

    let duration = peaks.len() as f64 / bps;
    let bpm = estimate_bpm(&env, sample_rate as f64, F32_SAMPLES_PER_BUCKET as f64);

    Ok(WaveformData {
        path: path.to_string(),
        duration,
        buckets_per_second: bps,
        peaks,
        bpm,
    })
}

/// Very simple, honest tempo estimate via autocorrelation of the RMS envelope.
/// Returns None if the envelope is too quiet or no clear peak is found.
fn estimate_bpm(env: &[f32], sample_rate: f64, samples_per_bucket: f64) -> Option<f64> {
    if env.len() < 40 {
        return None;
    }
    let avg: f32 = env.iter().sum::<f32>() / env.len() as f32;
    if avg < 1e-4 {
        return None;
    }
    let env_rate = sample_rate / samples_per_bucket; // envelopes per second

    // Search lags corresponding to 60..200 BPM (beats per second 1.0..3.33)
    let min_lag = (env_rate / 200.0).round() as usize;
    let max_lag = (env_rate / 60.0).round() as usize;
    if min_lag >= max_lag || max_lag >= env.len() {
        return None;
    }

    let mean = avg;
    let mut best_lag = 0usize;
    let mut best_score = 0.0f64;
    for lag in min_lag..=max_lag {
        let mut score = 0.0f64;
        let n = env.len() - lag;
        for i in 0..n {
            score += ((env[i] - mean) as f64) * ((env[i + lag] - mean) as f64);
        }
        score /= n as f64;
        // Normalize by the lag-0 energy
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    if best_lag == 0 || best_score < 1e-8 {
        return None;
    }
    // Sub-sample refinement via parabolic interpolation around the peak.
    let lag = best_lag as f64;
    let prev = if best_lag > 0 { score_at(env, best_lag - 1, &mean) } else { best_score };
    let next = if best_lag + 1 < env.len() { score_at(env, best_lag + 1, &mean) } else { best_score };
    let refined = if prev + next - 2.0 * best_score != 0.0 {
        lag + 0.5 * (prev - next) / (prev - 2.0 * best_score + next)
    } else {
        lag
    };
    let bpm = 60.0 * env_rate / refined.max(1.0);
    Some((bpm * 10.0).round() / 10.0)
}

fn score_at(env: &[f32], lag: usize, mean: &f32) -> f64 {
    let n = env.len() - lag;
    let mut score = 0.0f64;
    for i in 0..n {
        score += ((env[i] - mean) as f64) * ((env[i + lag] - mean) as f64);
    }
    score / n as f64
}
