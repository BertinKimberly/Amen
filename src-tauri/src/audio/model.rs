//! Shared data model for Audio Studio projects.
//! These structs mirror the frontend's JSON exactly (camelCase), so a project
//! can be edited in the UI, serialized to `.lms`, and rendered by the backend.

use serde::{Deserialize, Serialize};

/// A user-placed bookmark at a specific time in a source — pure navigation
/// metadata, never read by the render pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioMarker {
    pub id: String,
    pub time: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSource {
    pub id: String,
    pub path: String,
    pub name: String,
    pub duration: f64,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    /// Estimated BPM (optional, best-effort). Never fabricated.
    pub bpm: Option<f64>,
    /// `#[serde(default)]` so older .lms project files (saved before markers
    /// existed) still load cleanly with an empty marker list.
    #[serde(default)]
    pub markers: Vec<StudioMarker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioClip {
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioTimelineItem {
    pub clip_id: String,
    /// Nominal start on the timeline (seconds). A crossfade shifts the actual
    /// render start earlier by `crossfade_prev`.
    pub position: f64,
    /// Linear gain (0.0 - 2.0).
    pub volume: f64,
    pub muted: bool,
    pub fade_in: f64,
    pub fade_out: f64,
    /// Overlap duration with the previous clip on this track (seconds).
    pub crossfade_prev: f64,
    /// Non-destructive trim: seconds shaved off the start of the clip's
    /// content, in addition to `clip.start`. Never mutates the source clip.
    #[serde(default)]
    pub trim_start: f64,
    /// Non-destructive trim: seconds shaved off the end of the clip's
    /// content, in addition to `clip.end`.
    #[serde(default)]
    pub trim_end: f64,
}

impl StudioTimelineItem {
    /// Effective content duration after non-destructive trim is applied.
    pub fn effective_duration(&self, clip_duration: f64) -> f64 {
        (clip_duration - self.trim_start.max(0.0) - self.trim_end.max(0.0)).max(0.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioTrack {
    pub id: String,
    pub name: String,
    pub muted: bool,
    pub solo: bool,
    pub items: Vec<StudioTimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StudioTimeline {
    pub tracks: Vec<StudioTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StudioExportMeta {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub comment: String,
    pub artwork: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSettings {
    /// Output sample rate (44100 or 48000).
    pub sample_rate: u32,
    /// none | peak | loudness
    pub normalize: String,
    /// Peak normalization target in dBFS (e.g. -1.0).
    pub normalize_target_db: f64,
    /// Loudness normalization target in LUFS (e.g. -16).
    pub normalize_lufs: f64,
}

impl Default for StudioSettings {
    fn default() -> Self {
        Self {
            sample_rate: 44100,
            normalize: "none".to_string(),
            normalize_target_db: -1.0,
            normalize_lufs: -16.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProject {
    pub version: u32,
    pub name: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub sources: Vec<StudioSource>,
    pub clips: Vec<StudioClip>,
    pub timeline: StudioTimeline,
    pub export: StudioExportMeta,
    pub settings: StudioSettings,
}

impl StudioProject {
    /// Creates a fresh project. Used by tests and potentially tooling; the UI
    /// normally constructs projects as JSON.
    #[allow(dead_code)]
    pub fn new(name: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            version: 1,
            name,
            created_at: now,
            modified_at: now,
            sources: Vec::new(),
            clips: Vec::new(),
            timeline: StudioTimeline {
                tracks: vec![StudioTrack {
                    id: "track-1".to_string(),
                    name: "Track 1".to_string(),
                    muted: false,
                    solo: false,
                    items: Vec::new(),
                }],
            },
            export: StudioExportMeta::default(),
            settings: StudioSettings::default(),
        }
    }

    /// The overall timeline duration = the latest clip end across all tracks.
    pub fn duration(&self) -> f64 {
        let mut end = 0.0f64;
        for track in &self.timeline.tracks {
            for item in &track.items {
                if let Some(clip) = self.clip_by_id(&item.clip_id) {
                    let dur = item.effective_duration((clip.end - clip.start).max(0.0));
                    let render_start = (item.position - item.crossfade_prev).max(0.0);
                    end = end.max(render_start + dur);
                }
            }
        }
        end
    }

    pub fn source_by_id(&self, id: &str) -> Option<&StudioSource> {
        self.sources.iter().find(|s| s.id == id)
    }

    pub fn clip_by_id(&self, id: &str) -> Option<&StudioClip> {
        self.clips.iter().find(|c| c.id == id)
    }

    /// Sources referenced by timeline clips that are missing on disk.
    pub fn missing_sources(&self) -> Vec<StudioSource> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for track in &self.timeline.tracks {
            for item in &track.items {
                if let Some(clip) = self.clip_by_id(&item.clip_id) {
                    if let Some(src) = self.source_by_id(&clip.source_id) {
                        if seen.insert(src.id.clone()) && !std::path::Path::new(&src.path).exists() {
                            out.push(src.clone());
                        }
                    }
                }
            }
        }
        out
    }
}
