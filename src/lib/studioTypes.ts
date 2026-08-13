// Audio Studio types — mirror the Rust backend (serde camelCase).

export interface StudioSource {
   id: string;
   path: string;
   name: string;
   duration: number;
   sampleRate: number | null;
   channels: number | null;
   bpm: number | null;
}

export interface StudioClip {
   id: string;
   sourceId: string;
   name: string;
   start: number;
   end: number;
}

export interface StudioTimelineItem {
   clipId: string;
   position: number;
   volume: number;
   muted: boolean;
   fadeIn: number;
   fadeOut: number;
   crossfadePrev: number;
}

export interface StudioTrack {
   id: string;
   name: string;
   muted: boolean;
   solo: boolean;
   items: StudioTimelineItem[];
}

export interface StudioTimeline {
   tracks: StudioTrack[];
}

export interface StudioExportMeta {
   title: string;
   artist: string;
   album: string;
   year: string;
   comment: string;
   artwork: string | null;
}

export interface StudioSettings {
   sampleRate: number;
   normalize: "none" | "peak" | "loudness";
   normalizeTargetDb: number;
   normalizeLufs: number;
}

export interface StudioProject {
   version: number;
   name: string;
   createdAt: number;
   modifiedAt: number;
   sources: StudioSource[];
   clips: StudioClip[];
   timeline: StudioTimeline;
   export: StudioExportMeta;
   settings: StudioSettings;
}

export interface WaveformData {
   path: string;
   duration: number;
   bucketsPerSecond: number;
   peaks: [number, number][];
   bpm: number | null;
}

export interface AudioInfo {
   path: string;
   duration: number;
   sampleRate: number;
   channels: number;
   codec: string;
   bitrate: number;
   format: string;
   hasAudio: boolean;
}

export interface RenderResult {
   path: string;
   duration: number;
   sizeBytes: number;
}

export type ExportFormat = "mp3" | "wav" | "flac" | "m4a";

export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
   { value: "mp3", label: "MP3" },
   { value: "wav", label: "WAV" },
   { value: "flac", label: "FLAC" },
   { value: "m4a", label: "AAC (M4A)" },
];

export const MP3_BITRATES = [320, 256, 192, 160, 128, 96];
export const M4A_BITRATES = [320, 256, 192, 128, 96];
