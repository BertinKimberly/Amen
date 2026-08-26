import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
   StudioProject,
   StudioSource,
   StudioClip,
   StudioTimelineItem,
   WaveformData,
   RenderResult,
} from "../lib/studioTypes";
import { itemEffectiveDuration } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";
import { studioApi, assetUrl } from "../lib/api";
import { nanoid } from "nanoid";

// ---- Types ------------------------------------------------------------------

export interface PlaybackState {
   playing: boolean;
   playhead: number; // seconds
   previewPath: string | null;
   previewStale: boolean;
   volume: number; // 0..1
   muted: boolean;
   playbackRate: number; // 0.25..2.0
   mode: "source" | "timeline"; // source = play individual source, timeline = play rendered mix
   sourcePlaybackPath: string | null; // path to source being played
   /**
    * Disambiguates "playing the whole source" from "previewing a bounded
    * region" while `mode === "source"` — both play the same <audio> element,
    * but the user must never have to guess which one is happening. Null =
    * plain source playback; "__selection__" = an ad-hoc waveform selection
    * (no saved clip yet); any other value = the id of the StudioClip being
    * previewed.
    */
   previewingClipId: string | null;
   /** Loop the current waveform selection during source playback, instead of stopping at its end. Purely a transient playback preference — not saved with the project. */
   looping: boolean;
}

export interface SelectionState {
   selectedSourceId: string | null;
   selectedSourceWaveform: WaveformData | null;
   selectionStart: number | null;
   selectionEnd: number | null;
   selectedClipId: string | null;
   selectedTrackId: string | null;
   /** The timeline item (track + index within that track) currently selected. */
   selectedItemTrackId: string | null;
   selectedItemIndex: number | null;
}

export interface StudioStore {
   // State
   project: StudioProject | null;
   savedPath: string | null;
   modified: boolean;
   past: StudioProject[];
   future: StudioProject[];
   playback: PlaybackState;
   selection: SelectionState;
   waveformCache: Record<string, WaveformData>;
   loadingState: "idle" | "loading" | "saving";

   // Actions: Project lifecycle
   newProject: (name: string) => Promise<void>;
   loadProject: (path: string) => Promise<void>;
   saveProject: () => Promise<void>;
   saveProjectAs: (path: string) => Promise<void>;

   // Actions: Sources
   addSource: (path: string) => Promise<void>;
   removeSource: (id: string) => void;
   selectSource: (id: string) => Promise<void>;
   getSourceWaveform: (id: string) => Promise<WaveformData | null>;

   // Actions: Clips
   createClipFromSelection: (name?: string) => void;
   renameClip: (id: string, name: string) => void;
   deleteClip: (id: string) => void;
   duplicateClip: (id: string) => StudioClip | null;

   // Actions: Markers (per-source navigation bookmarks; persisted with the project)
   addMarker: (sourceId: string, time: number, label?: string) => void;
   removeMarker: (sourceId: string, markerId: string) => void;
   renameMarker: (sourceId: string, markerId: string, label: string) => void;

   // Actions: Timeline
   addTrack: (name?: string) => void;
   removeTrack: (id: string) => void;
   setTrackMute: (id: string, muted: boolean) => void;
   setTrackSolo: (id: string, solo: boolean) => void;

   addItemToTimeline: (
      clipId: string,
      trackId: string,
      position: number,
   ) => void;
   moveItem: (trackId: string, index: number, newPosition: number, recordHistory?: boolean) => void;
   removeItem: (trackId: string, index: number) => void;
   duplicateItem: (trackId: string, index: number) => void;
   /** Split a timeline item into two at `atTime` (an absolute timeline position). No-ops if `atTime` doesn't fall strictly inside the item. Both halves keep playing the same underlying audio with no fade at the cut, since it's the same continuous source content. */
   splitItem: (trackId: string, index: number, atTime: number) => void;
   updateItem: (
      trackId: string,
      index: number,
      updates: Partial<StudioTimelineItem>,
      recordHistory?: boolean,
   ) => void;
   /** Snapshot current state onto the undo stack without mutating anything — call once at the START of a continuous drag/trim gesture, so every subsequent live update during that gesture can skip pushing its own history entry and the whole gesture undoes as one step. */
   checkpointHistory: () => void;

   // Actions: Playback
   play: () => void;
   pause: () => void;
   stop: () => void;
   seek: (time: number) => void;
   setVolume: (v: number) => void;
   setMuted: (m: boolean) => void;
   setPlaybackRate: (r: number) => void;
   /** Load a clip's source, set the selection to its bounds, and play it — unambiguously labeled as a CLIP PREVIEW, never mistaken for full-source playback. */
   previewClip: (clipId: string) => Promise<void>;
   /** Play the current ad-hoc waveform selection (no saved clip yet), labeled as a preview rather than full-source playback. */
   previewSelection: () => void;
   /** Toggle looping the current waveform selection during source playback. */
   toggleLoop: () => void;

   // Actions: Rendering
   renderPreview: () => Promise<void>;
   exportMix: (
      outputPath: string,
      format: string,
      bitrateKbps: number,
   ) => Promise<RenderResult | null>;
   exportClip: (
      clipId: string,
      outputPath: string,
      format: string,
      bitrateKbps: number,
   ) => Promise<RenderResult | null>;

   // Actions: History
   undo: () => void;
   redo: () => void;
   canUndo: () => boolean;
   canRedo: () => boolean;

   // Actions: Selection & Editing
   setSelectionStart: (time: number | null) => void;
   setSelectionEnd: (time: number | null) => void;
   setSelectedClip: (id: string | null) => void;
   setSelectedTrack: (id: string | null) => void;
   setSelectedItem: (trackId: string | null, index: number | null) => void;

   // Actions: Utilities
   getMissingSources: () => Promise<StudioSource[]>;
}

// ---- Store Implementation ---------------------------------------------------

const createDefaultProject = (name: string): StudioProject => ({
   version: 1,
   name,
   createdAt: Date.now(),
   modifiedAt: Date.now(),
   sources: [],
   clips: [],
   timeline: {
      tracks: [
         {
            id: "track-1",
            name: "Track 1",
            muted: false,
            solo: false,
            items: [],
         },
      ],
   },
   export: {
      title: name,
      artist: "",
      album: "",
      year: new Date().getFullYear().toString(),
      comment: "",
      artwork: null,
   },
   settings: {
      sampleRate: 44100,
      normalize: "none",
      normalizeTargetDb: -3,
      normalizeLufs: -16,
   },
});

export const useStudioStore = create<StudioStore>()(
   immer((set, get) => ({
      project: null,
      savedPath: null,
      modified: false,
      past: [],
      future: [],
      playback: {
         playing: false,
         playhead: 0,
         previewPath: null,
         previewStale: true,
         volume: 0.8,
         muted: false,
         playbackRate: 1.0,
         mode: "source",
         sourcePlaybackPath: null,
         previewingClipId: null,
         looping: false,
      },
      selection: {
         selectedSourceId: null,
         selectedSourceWaveform: null,
         selectionStart: null,
         selectionEnd: null,
         selectedClipId: null,
         selectedTrackId: null,
         selectedItemTrackId: null,
         selectedItemIndex: null,
      },
      waveformCache: {},
      loadingState: "idle",

      // ---- Project Lifecycle --------------------------------------------------

      newProject: async (name: string) => {
         set((state: StudioStore) => {
            state.project = createDefaultProject(name);
            state.savedPath = null;
            state.modified = false;
            state.past = [];
            state.future = [];
            state.selection = {
               selectedSourceId: null,
               selectedSourceWaveform: null,
               selectionStart: null,
               selectionEnd: null,
               selectedClipId: null,
               selectedTrackId: null,
               selectedItemTrackId: null,
               selectedItemIndex: null,
            };
            state.playback = {
               playing: false,
               playhead: 0,
               previewPath: null,
               previewStale: true,
               volume: 0.8,
               muted: false,
               playbackRate: 1.0,
               mode: "source",
               sourcePlaybackPath: null,
               previewingClipId: null,
               looping: false,
            };
            state.waveformCache = {};
            state.loadingState = "idle";
         });
      },

      loadProject: async (path: string) => {
         set((state: StudioStore) => {
            state.loadingState = "loading";
         });
         try {
            const loaded = await studioApi.loadProject(path);
            set((state: StudioStore) => {
               state.project = loaded;
               state.savedPath = path;
               state.modified = false;
               state.past = [];
               state.future = [];
               state.selection = {
                  selectedSourceId: null,
                  selectedSourceWaveform: null,
                  selectionStart: null,
                  selectionEnd: null,
                  selectedClipId: null,
                  selectedTrackId: null,
                  selectedItemTrackId: null,
                  selectedItemIndex: null,
               };
               state.loadingState = "idle";
            });
         } catch (e) {
            set((state: StudioStore) => {
               state.loadingState = "idle";
            });
            throw e;
         }
      },

      saveProject: async () => {
         const savedPath = get().savedPath;
         if (!get().project || !savedPath) {
            throw new Error("No project path set; use saveProjectAs first.");
         }
         // Immer freezes committed state in development; mutate `modifiedAt`
         // through a producer (not directly on the object from get()), then
         // re-read the up-to-date project for the actual save call.
         set((s: StudioStore) => {
            if (s.project) s.project.modifiedAt = Date.now();
            s.loadingState = "saving";
         });
         try {
            const project = get().project;
            if (project) {
               await studioApi.saveProject(project, savedPath);
            }
            set((s: StudioStore) => {
               s.modified = false;
               s.loadingState = "idle";
            });
         } catch (e) {
            set((s: StudioStore) => {
               s.loadingState = "idle";
            });
            throw e;
         }
      },

      saveProjectAs: async (path: string) => {
         if (!get().project) throw new Error("No project loaded.");
         set((s: StudioStore) => {
            if (s.project) s.project.modifiedAt = Date.now();
            s.loadingState = "saving";
         });
         try {
            const project = get().project;
            if (project) {
               await studioApi.saveProject(project, path);
            }
            set((s: StudioStore) => {
               s.savedPath = path;
               s.modified = false;
               s.loadingState = "idle";
            });
         } catch (e) {
            set((s: StudioStore) => {
               s.loadingState = "idle";
            });
            throw e;
         }
      },

      // ---- Sources, Clips, Timeline omitted for brevity (same implementation) ----
      // All state mutations following the same pattern as above.

      addSource: async (path: string) => {
         try {
            const info = await studioApi.probeAudio(path);
            const id = nanoid();
            set((state: StudioStore) => {
               if (!state.project) return;
               state.past = [
                  ...state.past,
                  JSON.parse(JSON.stringify(state.project)),
               ];
               state.future = [];
               state.project.sources.push({
                  id,
                  path,
                  name: path.split(/[\\/]/).pop() || "Audio",
                  duration: info.duration,
                  sampleRate: info.sampleRate,
                  channels: info.channels,
                  bpm: null,
                  markers: [],
               });
               state.modified = true;
            });
         } catch (e) {
            throw new Error(`Failed to add source: ${e}`);
         }
      },

      removeSource: (id: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            const removedClipIds = new Set(
               state.project.clips.filter((c) => c.sourceId === id).map((c) => c.id),
            );
            state.project.sources = state.project.sources.filter(
               (s) => s.id !== id,
            );
            state.project.clips = state.project.clips.filter(
               (c) => c.sourceId !== id,
            );
            // A clip that no longer exists can't stay referenced on the
            // timeline — the Timeline UI silently hides such items (renders
            // nothing for them) rather than crash, which would otherwise
            // leave an invisible, permanently un-exportable dangling
            // reference the user has no way to discover or remove.
            state.project.timeline.tracks.forEach((track) => {
               track.items = track.items.filter((item) => !removedClipIds.has(item.clipId));
            });
            if (state.selection.selectedSourceId === id) {
               state.selection.selectedSourceId = null;
               state.selection.selectedSourceWaveform = null;
            }
            if (state.selection.selectedClipId && removedClipIds.has(state.selection.selectedClipId)) {
               state.selection.selectedClipId = null;
            }
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      selectSource: async (id: string) => {
         const state = get();
         const src = state.project?.sources.find((s) => s.id === id);
         set((state: StudioStore) => {
            state.selection.selectedSourceId = id;
            state.selection.selectionStart = null;
            state.selection.selectionEnd = null;
            // Switch to source playback mode and set source path
            if (src) {
               state.playback.mode = "source";
               state.playback.sourcePlaybackPath = src.path;
               state.playback.playhead = 0;
               state.playback.playing = false;
               state.playback.previewingClipId = null;
               state.playback.looping = false;
            }
         });
         await get().getSourceWaveform(id);
      },

      getSourceWaveform: async (id: string) => {
         const state = get();
         if (!state.project) return null;
         const src = state.project.sources.find((s) => s.id === id);
         if (!src) return null;
         if (state.waveformCache[id]) {
            set((s: StudioStore) => {
               s.selection.selectedSourceWaveform = state.waveformCache[id];
            });
            return state.waveformCache[id];
         }
         try {
            const wf = await studioApi.waveform(src.path, 10);
            set((s: StudioStore) => {
               s.waveformCache[id] = wf;
               if (s.selection.selectedSourceId === id) {
                  s.selection.selectedSourceWaveform = wf;
               }
            });
            return wf;
         } catch (e) {
            console.error("Waveform extract failed:", e);
            return null;
         }
      },

      createClipFromSelection: (name?: string) => {
         set((state: StudioStore) => {
            if (!state.project || !state.selection.selectedSourceId) return;
            const start = state.selection.selectionStart ?? 0;
            const end = state.selection.selectionEnd ?? 1;
            const id = nanoid();
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            state.project.clips.push({
               id,
               sourceId: state.selection.selectedSourceId,
               name: name || `Clip ${state.project.clips.length + 1}`,
               start,
               end,
            });
            state.modified = true;
         });
      },

      renameClip: (id: string, name: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const clip = state.project.clips.find((c) => c.id === id);
            if (clip) {
               state.past = [
                  ...state.past,
                  JSON.parse(JSON.stringify(state.project)),
               ];
               state.future = [];
               clip.name = name;
               state.modified = true;
            }
         });
      },

      deleteClip: (id: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            state.project.clips = state.project.clips.filter(
               (c) => c.id !== id,
            );
            state.project.timeline.tracks.forEach((track) => {
               track.items = track.items.filter((item) => item.clipId !== id);
            });
            if (state.selection.selectedClipId === id) {
               state.selection.selectedClipId = null;
            }
            state.modified = true;
         });
      },

      duplicateClip: (id: string) => {
         let dup: StudioClip | null = null;
         set((state: StudioStore) => {
            if (!state.project) return;
            const orig = state.project.clips.find((c) => c.id === id);
            if (!orig) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            dup = {
               id: nanoid(),
               sourceId: orig.sourceId,
               name: `${orig.name} (copy)`,
               start: orig.start,
               end: orig.end,
            };
            state.project.clips.push(dup);
            state.modified = true;
         });
         return dup;
      },

      addMarker: (sourceId: string, time: number, label?: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const src = state.project.sources.find((s) => s.id === sourceId);
            if (!src) return;
            state.past = [...state.past, JSON.parse(JSON.stringify(state.project))];
            state.future = [];
            const clamped = Math.max(0, Math.min(src.duration, time));
            src.markers.push({
               id: nanoid(),
               time: clamped,
               label: label || formatTime(clamped),
            });
            src.markers.sort((a, b) => a.time - b.time);
            state.modified = true;
         });
      },

      removeMarker: (sourceId: string, markerId: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const src = state.project.sources.find((s) => s.id === sourceId);
            if (!src) return;
            state.past = [...state.past, JSON.parse(JSON.stringify(state.project))];
            state.future = [];
            src.markers = src.markers.filter((m) => m.id !== markerId);
            state.modified = true;
         });
      },

      renameMarker: (sourceId: string, markerId: string, label: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const src = state.project.sources.find((s) => s.id === sourceId);
            const marker = src?.markers.find((m) => m.id === markerId);
            if (!marker) return;
            state.past = [...state.past, JSON.parse(JSON.stringify(state.project))];
            state.future = [];
            marker.label = label;
            state.modified = true;
         });
      },

      addTrack: (name?: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            const idx = state.project.timeline.tracks.length;
            state.project.timeline.tracks.push({
               id: nanoid(),
               name: name || `Track ${idx + 1}`,
               muted: false,
               solo: false,
               items: [],
            });
            state.modified = true;
         });
      },

      removeTrack: (id: string) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            state.project.timeline.tracks =
               state.project.timeline.tracks.filter((t) => t.id !== id);
            if (state.selection.selectedTrackId === id)
               state.selection.selectedTrackId = null;
            if (state.selection.selectedItemTrackId === id) {
               state.selection.selectedItemTrackId = null;
               state.selection.selectedItemIndex = null;
            }
            state.modified = true;
         });
      },

      setTrackMute: (id: string, muted: boolean) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === id,
            );
            if (track) track.muted = muted;
         });
      },

      setTrackSolo: (id: string, solo: boolean) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === id,
            );
            if (track) track.solo = solo;
         });
      },

      addItemToTimeline: (
         clipId: string,
         trackId: string,
         position: number,
      ) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track) return;
            track.items.push({
               clipId,
               position,
               volume: 1.0,
               muted: false,
               fadeIn: 0,
               fadeOut: 0,
               crossfadePrev: 0,
               trimStart: 0,
               trimEnd: 0,
            });
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      moveItem: (trackId: string, index: number, newPosition: number, recordHistory = true) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track || !track.items[index]) return;
            if (recordHistory) {
               state.past = [
                  ...state.past,
                  JSON.parse(JSON.stringify(state.project)),
               ];
               state.future = [];
            }
            track.items[index].position = newPosition;
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      checkpointHistory: () => {
         set((state: StudioStore) => {
            if (!state.project) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
         });
      },

      removeItem: (trackId: string, index: number) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            track.items.splice(index, 1);
            if (state.selection.selectedItemTrackId === trackId) {
               if (state.selection.selectedItemIndex === index) {
                  state.selection.selectedItemTrackId = null;
                  state.selection.selectedItemIndex = null;
               } else if (
                  state.selection.selectedItemIndex !== null &&
                  state.selection.selectedItemIndex > index
               ) {
                  state.selection.selectedItemIndex -= 1;
               }
            }
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      duplicateItem: (trackId: string, index: number) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find((t) => t.id === trackId);
            const item = track?.items[index];
            if (!track || !item) return;
            const clip = state.project.clips.find((c) => c.id === item.clipId);
            const clipDuration = clip ? clip.end - clip.start - (item.trimStart ?? 0) - (item.trimEnd ?? 0) : 0;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            track.items.push({
               ...item,
               position: item.position + Math.max(0.01, clipDuration),
               crossfadePrev: 0,
            });
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      updateItem: (
         trackId: string,
         index: number,
         updates: Partial<StudioTimelineItem>,
         recordHistory = true,
      ) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track || !track.items[index]) return;
            if (recordHistory) {
               state.past = [
                  ...state.past,
                  JSON.parse(JSON.stringify(state.project)),
               ];
               state.future = [];
            }
            Object.assign(track.items[index], updates);
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      splitItem: (trackId: string, index: number, atTime: number) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find((t) => t.id === trackId);
            const item = track?.items[index];
            if (!track || !item) return;
            const clip = state.project.clips.find((c) => c.id === item.clipId);
            if (!clip) return;

            const MIN_PIECE_DURATION = 0.05;
            const duration = itemEffectiveDuration(item, clip);
            const splitOffset = atTime - item.position;
            // Refuse a split that doesn't fall strictly inside the item, or
            // would leave a sliver too small to be a meaningful clip.
            if (splitOffset < MIN_PIECE_DURATION || splitOffset > duration - MIN_PIECE_DURATION) return;

            state.past = [...state.past, JSON.parse(JSON.stringify(state.project))];
            state.future = [];

            const originalTrimEnd = item.trimEnd ?? 0;
            const originalFadeOut = item.fadeOut;
            // Both halves keep playing the exact same continuous underlying
            // audio at the cut, so neither gets a fade there — only the
            // outer edges (the original fadeIn/fadeOut) are preserved, and
            // each stays on whichever half now owns that edge.
            item.trimEnd = originalTrimEnd + (duration - splitOffset);
            item.fadeOut = 0;

            track.items.push({
               ...item,
               position: atTime,
               trimStart: (item.trimStart ?? 0) + splitOffset,
               trimEnd: originalTrimEnd,
               fadeIn: 0,
               fadeOut: originalFadeOut,
               crossfadePrev: 0,
            });
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
            state.playback.previewStale = true;
         });
      },

      play: () => {
         set((s: StudioStore) => {
            s.playback.playing = true;
         });
      },
      pause: () => {
         set((s: StudioStore) => {
            s.playback.playing = false;
         });
      },
      stop: () => {
         set((s: StudioStore) => {
            s.playback.playing = false;
            s.playback.playhead = 0;
            s.playback.previewingClipId = null;
         });
      },
      seek: (time: number) => {
         set((s: StudioStore) => {
            s.playback.playhead = time;
         });
      },
      setVolume: (v: number) => {
         set((s: StudioStore) => {
            s.playback.volume = Math.max(0, Math.min(1, v));
         });
      },
      setMuted: (m: boolean) => {
         set((s: StudioStore) => {
            s.playback.muted = m;
         });
      },
      setPlaybackRate: (r: number) => {
         set((s: StudioStore) => {
            s.playback.playbackRate = Math.max(0.25, Math.min(2.0, r));
         });
      },

      previewClip: async (clipId: string) => {
         const state = get();
         const clip = state.project?.clips.find((c) => c.id === clipId);
         if (!clip) return;
         const src = state.project?.sources.find((s) => s.id === clip.sourceId);
         if (!src) return;

         // Load the clip's source waveform if it isn't already cached — mirrors
         // selectSource's loading path but does NOT go through the public
         // selectSource action, which unconditionally clears previewingClipId
         // (that clearing is exactly right when a user manually picks a
         // source, but would immediately erase the label we're about to set).
         set((s: StudioStore) => {
            s.selection.selectedSourceId = clip.sourceId;
            s.playback.mode = "source";
            s.playback.sourcePlaybackPath = src.path;
         });
         await get().getSourceWaveform(clip.sourceId);

         set((s: StudioStore) => {
            s.selection.selectionStart = clip.start;
            s.selection.selectionEnd = clip.end;
            s.selection.selectedClipId = clipId;
            s.playback.previewingClipId = clipId;
            s.playback.playhead = clip.start;
            s.playback.playing = true;
         });
      },

      previewSelection: () => {
         set((s: StudioStore) => {
            if (s.selection.selectionStart === null || s.selection.selectionEnd === null) return;
            s.playback.previewingClipId = "__selection__";
            s.playback.playhead = s.selection.selectionStart;
            s.playback.playing = true;
         });
      },

      toggleLoop: () => {
         set((s: StudioStore) => {
            s.playback.looping = !s.playback.looping;
         });
      },

      renderPreview: async () => {
         const state = get();
         if (!state.project) return;
         try {
            set((s: StudioStore) => {
               s.playback.previewStale = true;
               s.playback.mode = "timeline"; // Switch to timeline mode for preview
            });
            const result = await studioApi.renderPreview(state.project);
            set((s: StudioStore) => {
               s.playback.previewPath = assetUrl(result.path);
               s.playback.previewStale = false;
               s.playback.playhead = 0; // Reset playhead
            });
         } catch (e) {
            console.error("Preview render failed:", e);
            set((s: StudioStore) => {
               s.playback.previewStale = false;
            });
         }
      },

      exportMix: async (
         outputPath: string,
         format: string,
         bitrateKbps: number,
      ) => {
         const state = get();
         if (!state.project) return null;
         try {
            return await studioApi.exportMix(
               state.project,
               outputPath,
               format,
               bitrateKbps,
            );
         } catch (e) {
            console.error("Export failed:", e);
            return null;
         }
      },

      exportClip: async (
         clipId: string,
         outputPath: string,
         format: string,
         bitrateKbps: number,
      ) => {
         const state = get();
         if (!state.project) return null;
         const clip = state.project.clips.find((c) => c.id === clipId);
         if (!clip) return null;
         const src = state.project.sources.find((s) => s.id === clip.sourceId);
         if (!src) return null;
         try {
            return await studioApi.exportClip(
               src.path,
               clip.start,
               clip.end,
               outputPath,
               format,
               bitrateKbps,
            );
         } catch (e) {
            console.error("Clip export failed:", e);
            return null;
         }
      },

      undo: () => {
         set((state: StudioStore) => {
            if (state.past.length === 0 || !state.project) return;
            // The redo stack is the current project prepended onto whatever
            // was ALREADY there — not a slice of `past` (unrelated, older
            // states). Getting this wrong means a second consecutive redo
            // (with no new undo in between) silently reverts to the wrong
            // state instead of being the no-op `canRedo()` implies.
            state.future = [state.project, ...state.future].slice(0, 50);
            state.project = JSON.parse(
               JSON.stringify(state.past[state.past.length - 1]),
            );
            state.past = state.past.slice(0, -1);
            state.modified = true;
         });
      },

      redo: () => {
         set((state: StudioStore) => {
            if (state.future.length === 0 || !state.project) return;
            state.past = [...state.past, state.project];
            state.project = JSON.parse(JSON.stringify(state.future[0]));
            state.future = state.future.slice(1);
            state.modified = true;
         });
      },

      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,

      setSelectionStart: (time: number | null) => {
         set((s: StudioStore) => {
            s.selection.selectionStart = time;
         });
      },
      setSelectionEnd: (time: number | null) => {
         set((s: StudioStore) => {
            s.selection.selectionEnd = time;
         });
      },
      setSelectedClip: (id: string | null) => {
         set((s: StudioStore) => {
            s.selection.selectedClipId = id;
         });
      },
      setSelectedTrack: (id: string | null) => {
         set((s: StudioStore) => {
            s.selection.selectedTrackId = id;
         });
      },
      setSelectedItem: (trackId: string | null, index: number | null) => {
         set((s: StudioStore) => {
            s.selection.selectedItemTrackId = trackId;
            s.selection.selectedItemIndex = index;
         });
      },

      getMissingSources: async () => {
         const state = get();
         if (!state.project) return [];
         try {
            return await studioApi.missingSources(state.project);
         } catch (e) {
            console.error("Missing sources check failed:", e);
            return [];
         }
      },
   })),
);
