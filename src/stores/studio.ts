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
}

export interface SelectionState {
   selectedSourceId: string | null;
   selectedSourceWaveform: WaveformData | null;
   selectionStart: number | null;
   selectionEnd: number | null;
   selectedClipId: string | null;
   selectedTrackId: string | null;
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
   moveItem: (trackId: string, index: number, newPosition: number) => void;
   removeItem: (trackId: string, index: number) => void;
   updateItem: (
      trackId: string,
      index: number,
      updates: Partial<StudioTimelineItem>,
   ) => void;

   // Actions: Playback
   play: () => void;
   pause: () => void;
   stop: () => void;
   seek: (time: number) => void;
   setVolume: (v: number) => void;
   setMuted: (m: boolean) => void;
   setPlaybackRate: (r: number) => void;

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
      },
      selection: {
         selectedSourceId: null,
         selectedSourceWaveform: null,
         selectionStart: null,
         selectionEnd: null,
         selectedClipId: null,
         selectedTrackId: null,
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
            };
            state.playback = {
               playing: false,
               playhead: 0,
               previewPath: null,
               previewStale: true,
               volume: 0.8,
               muted: false,
               playbackRate: 1.0,
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
         const state = get();
         if (!state.project || !state.savedPath) {
            throw new Error("No project path set; use saveProjectAs first.");
         }
         set((s: StudioStore) => {
            s.loadingState = "saving";
         });
         try {
            if (state.project) {
               state.project.modifiedAt = Date.now();
               await studioApi.saveProject(state.project, state.savedPath);
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
         const state = get();
         if (!state.project) throw new Error("No project loaded.");
         set((s: StudioStore) => {
            s.loadingState = "saving";
         });
         try {
            state.project.modifiedAt = Date.now();
            await studioApi.saveProject(state.project, path);
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
            state.project.sources = state.project.sources.filter(
               (s) => s.id !== id,
            );
            state.project.clips = state.project.clips.filter(
               (c) => c.sourceId !== id,
            );
            if (state.selection.selectedSourceId === id) {
               state.selection.selectedSourceId = null;
               state.selection.selectedSourceWaveform = null;
            }
            state.modified = true;
         });
      },

      selectSource: async (id: string) => {
         set((state: StudioStore) => {
            state.selection.selectedSourceId = id;
            state.selection.selectionStart = null;
            state.selection.selectionEnd = null;
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
            });
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
         });
      },

      moveItem: (trackId: string, index: number, newPosition: number) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track || !track.items[index]) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            track.items[index].position = newPosition;
            track.items.sort((a, b) => a.position - b.position);
            state.modified = true;
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
            state.modified = true;
         });
      },

      updateItem: (
         trackId: string,
         index: number,
         updates: Partial<StudioTimelineItem>,
      ) => {
         set((state: StudioStore) => {
            if (!state.project) return;
            const track = state.project.timeline.tracks.find(
               (t) => t.id === trackId,
            );
            if (!track || !track.items[index]) return;
            state.past = [
               ...state.past,
               JSON.parse(JSON.stringify(state.project)),
            ];
            state.future = [];
            Object.assign(track.items[index], updates);
            state.modified = true;
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

      renderPreview: async () => {
         const state = get();
         if (!state.project) return;
         try {
            set((s: StudioStore) => {
               s.playback.previewStale = true;
            });
            const result = await studioApi.renderPreview(state.project);
            set((s: StudioStore) => {
               s.playback.previewPath = assetUrl(result.path);
               s.playback.previewStale = false;
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
            const newFuture = [state.project, ...state.past.slice(0, 10)];
            state.future = newFuture.slice(0, 20);
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
