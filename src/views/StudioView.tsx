import { useCallback, useEffect, useRef, useState } from "react";
import { useStudioStore } from "../stores/studio";
import { WaveformView } from "../components/WaveformView";
import { PlayerBar } from "../components/PlayerBar";
import { Timeline, type DropHover } from "../components/Timeline";
import { SourcePanel } from "../components/SourcePanel";
import { ClipLibrary } from "../components/ClipLibrary";
import { ExportDialog } from "../components/ExportDialog";
import { TimeInput } from "../components/TimeInput";
import { Plus, Save, RotateCcw, RotateCw, Download, Play, GripHorizontal, Repeat, Flag, X } from "lucide-react";
import { save, open } from "../lib/dialog";
import { formatTime } from "../lib/studioTime";
import { computeTimelineDuration } from "../lib/studioTypes";
import { appAlert, appConfirm } from "../stores/uiDialog";
import { UiDialogHost } from "../components/UiDialogHost";

const TIMELINE_HEIGHT_KEY = "amen.studio.timelineHeight";
const DEFAULT_TIMELINE_HEIGHT = 400;
const MIN_TIMELINE_HEIGHT = 220;
const MAX_TIMELINE_HEIGHT = 720;
// However tall the user drags it, everything ABOVE the timeline — the
// scrollable waveform/selection area, the mode selector, and the transport
// bar, plus the flex gaps between them — must keep enough room, or a
// maximized-height timeline (or a persisted height from a previous, larger
// window) can starve the rest of the workspace down to a sliver with no way
// to see it. This reserve covers: waveform toolbar+canvas+help (~220) +
// selection-controls row (~80) + mode row (~40) + transport bar (~56) + 3
// flex gaps (~30). Deliberately generous — an oversized reserve just means a
// slightly smaller default timeline, not a collapsed waveform.
const MIN_NON_TIMELINE_HEIGHT = 430;
const RESIZE_HANDLE_HEIGHT = 12;

export function StudioView() {
   const store = useStudioStore();
   const [showExportDialog, setShowExportDialog] = useState(false);
   const [exporting, setExporting] = useState(false);
   const [dragActive, setDragActive] = useState(false);
   const centerColumnRef = useRef<HTMLDivElement>(null);

   // ---- Resizable timeline panel: the user decides how much of the ---------
   // ---- workspace the timeline gets, like every serious editor does. -------
   const [timelineHeight, setTimelineHeight] = useState<number>(() => {
      const saved = Number(localStorage.getItem(TIMELINE_HEIGHT_KEY));
      return Number.isFinite(saved) && saved >= MIN_TIMELINE_HEIGHT ? saved : DEFAULT_TIMELINE_HEIGHT;
   });
   const timelineHeightRef = useRef(timelineHeight);
   timelineHeightRef.current = timelineHeight;

   const dynamicMaxHeight = useCallback(() => {
      const available = centerColumnRef.current?.clientHeight ?? Infinity;
      return Math.max(
         MIN_TIMELINE_HEIGHT,
         Math.min(MAX_TIMELINE_HEIGHT, available - MIN_NON_TIMELINE_HEIGHT - RESIZE_HANDLE_HEIGHT),
      );
   }, []);

   // A height persisted from a previous, larger window (or dragged to the max
   // on this one) must never be allowed to silently swallow the whole
   // workspace on a smaller one. A plain mount-effect isn't enough here: on
   // first render `store.project` is still null, so this component returns
   // the loading/empty-state tree and `centerColumnRef` is never attached —
   // an effect keyed on `[]` would fire against that, measure nothing, and
   // never re-run once the real layout (and ref) exists. A ResizeObserver
   // re-attaches whenever the ref appears and also re-clamps on live window
   // resizes, which the "must respond intelligently to resize" requirement
   // needs anyway.
   useEffect(() => {
      const el = centerColumnRef.current;
      if (!el) return;
      const clamp = () => setTimelineHeight((h) => Math.min(h, dynamicMaxHeight()));
      clamp();
      const ro = new ResizeObserver(clamp);
      ro.observe(el);
      return () => ro.disconnect();
   }, [store.project?.sources.length, dynamicMaxHeight]);

   // Attaching listeners directly from the pointerdown handler (rather than
   // via a useEffect keyed on a ref) — refs don't trigger effects to re-run,
   // so a `[someRef.current]` dependency array silently never re-attaches.
   const beginTimelineResize = useCallback((startY: number, startHeight: number) => {
      const max = dynamicMaxHeight();
      const handleMove = (e: PointerEvent) => {
         const delta = startY - e.clientY; // dragging up grows the timeline
         const next = Math.max(MIN_TIMELINE_HEIGHT, Math.min(max, startHeight + delta));
         setTimelineHeight(next);
      };
      const handleUp = () => {
         window.removeEventListener("pointermove", handleMove);
         localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeightRef.current));
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
   }, [dynamicMaxHeight]);

   // ---- Pointer-based clip drag: library -> timeline ------------------------
   // HTML5 native drag/drop is unreliable inside the Tauri WebView (repeatedly
   // reported as a disabled-cursor, no-op drop). This tracks the drag with
   // real pointer events instead: a small movement threshold turns a click
   // into a drag, a floating "ghost" follows the cursor, and the Timeline
   // component (which alone knows its own zoom/scroll) resolves the drop
   // target and reports it back via onExternalHoverChange.
   const [dragCandidate, setDragCandidate] = useState<{ clipId: string; name: string; x: number; y: number } | null>(null);
   const [dragClip, setDragClip] = useState<{ clipId: string; name: string; x: number; y: number } | null>(null);
   const dragHoverRef = useRef<DropHover | null>(null);
   const DRAG_THRESHOLD_PX = 5;

   useEffect(() => {
      if (!dragCandidate && !dragClip) return;

      const handleMove = (e: PointerEvent) => {
         if (dragClip) {
            setDragClip((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
            return;
         }
         if (dragCandidate) {
            const dx = e.clientX - dragCandidate.x;
            const dy = e.clientY - dragCandidate.y;
            if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
               setDragClip({ ...dragCandidate, x: e.clientX, y: e.clientY });
               setDragCandidate(null);
            }
         }
      };
      const handleUp = () => {
         const hover = dragHoverRef.current;
         const active = dragClip;
         if (active && hover) {
            store.addItemToTimeline(active.clipId, hover.trackId, hover.position);
         }
         dragHoverRef.current = null;
         setDragCandidate(null);
         setDragClip(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
      return () => {
         window.removeEventListener("pointermove", handleMove);
         window.removeEventListener("pointerup", handleUp);
         window.removeEventListener("pointercancel", handleUp);
      };
      // Re-subscribe only when a drag actually starts/stops (candidate seeded,
      // promoted to an active drag, or ended) — NOT on every pointer move.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [dragCandidate?.clipId, dragClip?.clipId]);

   // Declare handlers first
   const handleNewProject = async () => {
      if (store.modified && !(await appConfirm("Discard unsaved changes?"))) return;
      await store.newProject("Untitled Mix");
   };

   const handleOpenProject = async () => {
      if (store.modified && !(await appConfirm("Discard unsaved changes?"))) return;
      try {
         const path = await open({
            directory: false,
            filters: [{ name: "Studio Project", extensions: ["lms"] }],
         });
         if (path && typeof path === "string") {
            await store.loadProject(path);
         }
      } catch (e) {
         console.error("Failed to open project:", e);
      }
   };

   const handleSaveProject = async () => {
      if (store.savedPath) {
         await store.saveProject();
      } else {
         handleSaveProjectAs();
      }
   };

   const handleSaveProjectAs = async () => {
      try {
         const path = await save({
            defaultPath: "project.lms",
            filters: [{ name: "Studio Project", extensions: ["lms"] }],
         });
         if (path) {
            await store.saveProjectAs(path);
         }
      } catch (e) {
         console.error("Failed to save project:", e);
      }
   };

   const handleExportMix = async (format: string, bitrate: number) => {
      try {
         setExporting(true);
         const defaultExt = format.toLowerCase();
         const path = await save({
            defaultPath: `${store.project?.name || "mix"}.${defaultExt}`,
            filters: [{ name: format.toUpperCase(), extensions: [defaultExt] }],
         });
         if (path) {
            const result = await store.exportMix(path, format, bitrate);
            if (result) {
               setShowExportDialog(false);
               // Show success with options to open
               if (await appConfirm(`Export complete!\n\nFile: ${result.path}\nSize: ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB\nDuration: ${result.duration.toFixed(1)}s\n\nOpen the file now?`)) {
                  try {
                     const { openPath } = await import("@tauri-apps/plugin-opener");
                     await openPath(result.path);
                  } catch (e) {
                     console.error("Failed to open file:", e);
                  }
               }
            } else {
               await appAlert("Export failed. Check the timeline and try again.");
            }
         }
      } catch (e: any) {
         console.error("Export failed:", e);
         await appAlert(`Export failed: ${e?.message || e}`);
      } finally {
         setExporting(false);
      }
   };

   // Drag and drop handlers
   const handleDrag = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "dragenter" || e.type === "dragover") {
         setDragActive(true);
      } else if (e.type === "dragleave") {
         setDragActive(false);
      }
   };

   const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
         const files = Array.from(e.dataTransfer.files);
         for (const file of files) {
            const path = (file as any).path; // Electron/Tauri provides path
            if (path && /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(path)) {
               try {
                  await store.addSource(path);
               } catch (e) {
                  console.error("Failed to import:", e);
               }
            }
         }
      }
   };

   // Initialize with a new project if none exists
   useEffect(() => {
      if (!store.project) {
         store.newProject("Untitled Mix");
      }
   }, [store.project]);

   // Keyboard shortcuts for Studio
   useEffect(() => {
      const handleKeyDown = async (e: KeyboardEvent) => {
         // Skip if user is typing in an input
         if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
         ) {
            return;
         }

         // Space: Play/Pause
         if (e.code === "Space") {
            e.preventDefault();
            if (store.playback.playing) {
               store.pause();
            } else {
               store.play();
            }
         }

         // Delete: remove selected timeline item, else selected library clip
         else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            if (store.selection.selectedItemTrackId !== null && store.selection.selectedItemIndex !== null) {
               store.removeItem(store.selection.selectedItemTrackId, store.selection.selectedItemIndex);
            } else if (store.selection.selectedClipId) {
               if (await appConfirm("Delete this clip?")) {
                  store.deleteClip(store.selection.selectedClipId);
               }
            }
         }

         // S: Split the selected timeline item at the playhead
         else if (e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (
               store.selection.selectedItemTrackId !== null &&
               store.selection.selectedItemIndex !== null
            ) {
               e.preventDefault();
               store.splitItem(
                  store.selection.selectedItemTrackId,
                  store.selection.selectedItemIndex,
                  store.playback.playhead,
               );
            }
         }

         // M: Add a marker at the current playhead
         else if (e.key === "m" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (store.selection.selectedSourceId) {
               e.preventDefault();
               store.addMarker(store.selection.selectedSourceId, store.playback.playhead);
            }
         }

         // Ctrl/Cmd + Z: Undo
         else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
            e.preventDefault();
            if (store.canUndo()) {
               store.undo();
            }
         }

         // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y: Redo
         else if (
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") ||
            ((e.ctrlKey || e.metaKey) && e.key === "y")
         ) {
            e.preventDefault();
            if (store.canRedo()) {
               store.redo();
            }
         }

         // Ctrl/Cmd + S: Save project
         else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            if (store.savedPath) {
               handleSaveProject();
            } else {
               handleSaveProjectAs();
            }
         }

         // Ctrl/Cmd + E: Export
         else if ((e.ctrlKey || e.metaKey) && e.key === "e") {
            e.preventDefault();
            setShowExportDialog(true);
         }

         // Ctrl/Cmd + N: New project
         else if ((e.ctrlKey || e.metaKey) && e.key === "n") {
            e.preventDefault();
            handleNewProject();
         }

         // Ctrl/Cmd + O: Open project
         else if ((e.ctrlKey || e.metaKey) && e.key === "o") {
            e.preventDefault();
            handleOpenProject();
         }

         // Ctrl/Cmd + D: Duplicate selected clip
         else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
            e.preventDefault();
            if (store.selection.selectedClipId) {
               store.duplicateClip(store.selection.selectedClipId);
            }
         }

         // Home: Jump to start
         else if (e.key === "Home") {
            e.preventDefault();
            store.seek(0);
         }

         // End: Jump to end (based on current mode duration)
         else if (e.key === "End") {
            e.preventDefault();
            const duration = store.playback.mode === "source" && store.selection.selectedSourceWaveform
               ? store.selection.selectedSourceWaveform.duration
               : store.project ? computeTimelineDuration(store.project) : 0;
            store.seek(duration);
         }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
   }, [
      store,
      handleSaveProject,
      handleSaveProjectAs,
      handleNewProject,
      handleOpenProject,
   ]);

   if (!store.project) {
      return (
         <div className="studio-shell flex h-full items-center justify-center bg-studio-bg text-studio-text-muted text-sm">
            Loading studio…
         </div>
      );
   }

   if (store.project.sources.length === 0) {
      return (
         <div
            className={`studio-shell relative flex flex-col items-center justify-center h-full gap-5 bg-studio-bg text-studio-text p-8 text-center transition-colors ${
               dragActive ? "bg-studio-accent/10" : ""
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
         >
            <div
               className={`absolute inset-6 rounded-2xl border-2 border-dashed pointer-events-none transition-colors ${
                  dragActive ? "border-studio-accent" : "border-transparent"
               }`}
            />
            <img src="/logo.png" alt="Amen" className="w-16 h-16 mb-2 drop-shadow-xl opacity-95 animate-scale-in" />
            <h2 className="text-2xl font-semibold tracking-tight">Create something new.</h2>
            <p className="text-studio-text-muted text-[15px] max-w-sm leading-relaxed">
               Bring in an audio file and start shaping the moment — import a
               source, select the part that matters, and build it into a mix.
            </p>
            <div className="flex gap-3 mt-2">
               <button
                  onClick={async () => {
                     try {
                        const selected = await open({
                           directory: false,
                           multiple: true,
                           filters: [
                              { name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg"] },
                              { name: "All", extensions: ["*"] }
                           ]
                        });
                        if (selected) {
                           const paths = Array.isArray(selected) ? selected : [selected];
                           for (const path of paths) {
                              if (typeof path === "string") {
                                 await store.addSource(path);
                              }
                           }
                        }
                     } catch (e) {
                        console.error("Import failed:", e);
                     }
                  }}
                  className="bg-studio-accent hover:brightness-110 text-white px-5 py-2.5 rounded-lg font-medium transition shadow-lg shadow-studio-accent/25 flex items-center gap-2"
               >
                  <Plus size={18} />
                  Import Audio
               </button>
               <button
                  onClick={handleOpenProject}
                  className="bg-studio-panel hover:bg-studio-raised border border-studio-border text-studio-text px-5 py-2.5 rounded-lg font-medium transition flex items-center gap-2"
               >
                  <Download size={18} />
                  Open Project
               </button>
            </div>
            <p className="text-studio-text-faint text-xs mt-6">
               {dragActive ? "Drop audio files here" : "or drag audio files here"}
            </p>
            <UiDialogHost />
         </div>
      );
   }

   // Single authoritative timeline-duration calculation (mirrors the Rust
   // backend exactly, so the UI never diverges from what gets exported).
   const projectDuration = computeTimelineDuration(store.project);

   // Calculate duration based on playback mode
   const currentSource = store.selection.selectedSourceId
      ? store.project.sources.find(s => s.id === store.selection.selectedSourceId)
      : undefined;
   const effectiveDuration = store.playback.mode === "source" && store.selection.selectedSourceId
      ? (currentSource?.duration || projectDuration)
      : projectDuration;

   // What is the transport actually about to play? Source playback, a clip
   // preview, and the rendered timeline mix all use the same <audio> element
   // underneath — the user must never have to guess which one is live.
   const nowPlaying: { kind: "source" | "clip" | "timeline"; label: string } =
      store.playback.mode === "timeline"
         ? { kind: "timeline", label: "Timeline Mix" }
         : store.playback.previewingClipId && store.playback.previewingClipId !== "__selection__"
         ? { kind: "clip", label: store.project.clips.find((c) => c.id === store.playback.previewingClipId)?.name ?? "Clip" }
         : store.playback.previewingClipId === "__selection__"
         ? { kind: "clip", label: "selection" }
         : { kind: "source", label: store.project.sources.find((s) => s.id === store.selection.selectedSourceId)?.name ?? "source" };

   return (
      <div
         className="studio-shell relative flex flex-col h-full gap-2.5 p-2.5 bg-studio-bg text-studio-text overflow-hidden"
         onDragEnter={handleDrag}
         onDragLeave={handleDrag}
         onDragOver={handleDrag}
         onDrop={handleDrop}
      >
         {dragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-studio-bg/90 backdrop-blur-sm border-4 border-studio-accent border-dashed pointer-events-none rounded-xl">
               <div className="text-center">
                  <Plus size={56} className="mx-auto mb-3 text-studio-accent" />
                  <p className="text-xl font-semibold text-studio-text">Drop audio files here</p>
                  <p className="text-studio-text-muted mt-1 text-sm">MP3, WAV, FLAC, M4A, AAC, OGG</p>
               </div>
            </div>
         )}

         {/* Toolbar */}
         <div className="flex items-center justify-between gap-4 flex-wrap bg-studio-panel rounded-xl px-3.5 py-2.5 border border-studio-border shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
               <img src="/logo.png" alt="" className="w-6 h-6 rounded-md shrink-0 opacity-95" />
               <div className="min-w-0">
                  <h1 className="text-[14px] font-semibold tracking-tight text-studio-text flex items-center gap-1.5 truncate">
                     {store.project.name}
                     {store.modified && (
                        <span className="text-studio-snap text-[10px]" title="Unsaved changes">●</span>
                     )}
                  </h1>
                  {store.savedPath && (
                     <span className="text-[10px] text-studio-text-faint font-mono truncate block max-w-xs" title={store.savedPath}>
                        {store.savedPath.split(/[\\/]/).pop()}
                     </span>
                  )}
               </div>
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
               <button
                  onClick={handleNewProject}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-studio-raised transition text-[12px] text-studio-text-muted hover:text-studio-text"
                  title="New project (Ctrl+N)"
               >
                  <Plus size={14} />
                  New
               </button>
               <button
                  onClick={handleOpenProject}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-studio-raised transition text-[12px] text-studio-text-muted hover:text-studio-text"
                  title="Open project (Ctrl+O)"
               >
                  <Download size={14} />
                  Open
               </button>
               <button
                  onClick={handleSaveProject}
                  className="flex items-center gap-1.5 rounded-lg bg-studio-accent px-3 py-1.5 hover:brightness-110 transition disabled:opacity-50 text-[12px] font-medium text-white shadow-sm shadow-studio-accent/30"
                  disabled={store.loadingState === "saving"}
                  title="Save project (Ctrl+S)"
               >
                  <Save size={14} />
                  Save
               </button>

               <div className="w-px h-5 bg-studio-border mx-0.5" />

               <button
                  onClick={() => store.undo()}
                  disabled={!store.canUndo()}
                  className="rounded-lg p-1.5 hover:bg-studio-raised disabled:opacity-30 disabled:hover:bg-transparent transition text-studio-text-muted hover:text-studio-text"
                  title="Undo (Ctrl+Z)"
               >
                  <RotateCcw size={14} />
               </button>
               <button
                  onClick={() => store.redo()}
                  disabled={!store.canRedo()}
                  className="rounded-lg p-1.5 hover:bg-studio-raised disabled:opacity-30 disabled:hover:bg-transparent transition text-studio-text-muted hover:text-studio-text"
                  title="Redo (Ctrl+Shift+Z)"
               >
                  <RotateCw size={14} />
               </button>

               <div className="w-px h-5 bg-studio-border mx-0.5" />

               <button
                  onClick={() => setShowExportDialog(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-studio-success/90 px-3 py-1.5 hover:brightness-110 transition disabled:opacity-50 text-[12px] font-semibold text-black/80 shadow-sm shadow-studio-success/20"
                  disabled={exporting}
                  title="Export mix (Ctrl+E)"
               >
                  Export
               </button>
            </div>
         </div>

         {/* Main workspace */}
         <div className="flex gap-2.5 flex-1 min-h-0 overflow-hidden">
            {/* Left panel: sources & clip library */}
            <div className="w-64 shrink-0 flex flex-col gap-2.5 overflow-y-auto">
               <div className="bg-studio-panel rounded-xl p-3 border border-studio-border">
                  <SourcePanel
                     sources={store.project.sources}
                     selectedSourceId={store.selection.selectedSourceId}
                     onAddSource={(path) => store.addSource(path)}
                     onRemoveSource={async (id) => {
                        const affectedClips = store.project?.clips.filter((c) => c.sourceId === id).length ?? 0;
                        const message = affectedClips > 0
                           ? `Remove this source? ${affectedClips} clip${affectedClips === 1 ? "" : "s"} made from it — and any timeline placements of ${affectedClips === 1 ? "it" : "them"} — will be deleted too.`
                           : "Remove this source?";
                        if (await appConfirm(message)) {
                           store.removeSource(id);
                        }
                     }}
                     onSelectSource={(id) => store.selectSource(id)}
                  />
               </div>

               <div className="bg-studio-panel rounded-xl p-3 border border-studio-border flex-1 min-h-0">
                  <ClipLibrary
                     clips={store.project.clips}
                     sources={store.project.sources}
                     selectedClipId={store.selection.selectedClipId}
                     previewingClipId={store.playback.previewingClipId}
                     onCreateClipFromSelection={() =>
                        store.createClipFromSelection()
                     }
                     onSelectClip={(id) => store.setSelectedClip(id)}
                     onPreviewClip={(id) => store.previewClip(id)}
                     onRenameClip={(id, name) => store.renameClip(id, name)}
                     onDeleteClip={(id) => store.deleteClip(id)}
                     onDuplicateClip={(id) => store.duplicateClip(id)}
                     draggingClipId={dragClip?.clipId ?? null}
                     onBeginDrag={(clipId, x, y) => {
                        const clip = store.project?.clips.find((c) => c.id === clipId);
                        setDragCandidate({ clipId, name: clip?.name ?? "Clip", x, y });
                     }}
                  />
               </div>
            </div>

            {/* Center: waveform editor (top) + resizable timeline (bottom) */}
            <div ref={centerColumnRef} className="flex-1 flex flex-col min-w-0 overflow-hidden gap-2.5">
               {/* Only the waveform/selection area scrolls if it doesn't fit —
                   the transport below must always stay reachable without scrolling. */}
               <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto pr-0.5">
                  {/* Waveform + selection (compact) */}
                  {store.selection.selectedSourceWaveform && (
                     <div className="space-y-2.5 shrink-0">
                        <WaveformView
                           key={store.selection.selectedSourceId}
                           waveform={store.selection.selectedSourceWaveform}
                           duration={store.selection.selectedSourceWaveform.duration}
                           selectionStart={store.selection.selectionStart}
                           selectionEnd={store.selection.selectionEnd}
                           onSelectionChange={(start, end) => {
                              store.setSelectionStart(start);
                              store.setSelectionEnd(end);
                           }}
                           onSeek={(time) => store.seek(time)}
                           playhead={store.playback.playhead}
                           markers={currentSource?.markers}
                        />

                        {/* Markers — cue-point style bookmarks for navigating this source */}
                        <div className="flex items-center gap-2 flex-wrap bg-studio-panel px-3 py-2 rounded-xl border border-studio-border">
                           <button
                              onClick={() => currentSource && store.addMarker(currentSource.id, store.playback.playhead)}
                              className="flex items-center gap-1.5 rounded-md bg-studio-raised hover:bg-white/10 border border-studio-border px-2.5 py-1 text-[11px] font-medium text-studio-text transition"
                              title="Add a marker at the current playhead (M)"
                           >
                              <Flag size={12} />
                              Add Marker
                           </button>
                           {currentSource && currentSource.markers.length > 0 ? (
                              currentSource.markers.map((m) => (
                                 <div
                                    key={m.id}
                                    data-testid="waveform-marker"
                                    className="group flex items-center gap-1.5 rounded-md bg-studio-canvas border border-studio-border pl-2 pr-1 py-1 text-[11px] text-studio-text"
                                 >
                                    <button
                                       onClick={() => store.seek(m.time)}
                                       className="flex items-center gap-1.5 hover:text-studio-accent-strong transition"
                                       title={`Jump to ${m.label}`}
                                    >
                                       <span className="h-1.5 w-1.5 rounded-full bg-[#ffb454] shrink-0" />
                                       <span className="font-mono tabular-nums">{formatTime(m.time)}</span>
                                       <span className="text-studio-text-muted">{m.label}</span>
                                    </button>
                                    <button
                                       onClick={() => currentSource && store.removeMarker(currentSource.id, m.id)}
                                       className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-studio-danger/15 hover:text-studio-danger transition"
                                       title="Remove marker"
                                    >
                                       <X size={10} />
                                    </button>
                                 </div>
                              ))
                           ) : (
                              <span className="text-[11px] text-studio-text-faint">No markers yet — bookmark positions as you listen</span>
                           )}
                        </div>

                        {/* Selection controls */}
                        {store.selection.selectionStart !== null && store.selection.selectionEnd !== null && (
                           <div className="flex items-center gap-4 bg-studio-panel p-3.5 rounded-xl border border-studio-border">
                              <div className="flex gap-3 flex-1">
                                 <TimeInput
                                    label="Start"
                                    value={store.selection.selectionStart}
                                    onChange={(val) => {
                                       const end = store.selection.selectionEnd ?? val + 1;
                                       store.setSelectionStart(Math.min(val, end - 0.001));
                                    }}
                                    min={0}
                                    max={store.selection.selectedSourceWaveform.duration}
                                 />
                                 <TimeInput
                                    label="End"
                                    value={store.selection.selectionEnd}
                                    onChange={(val) => {
                                       const start = store.selection.selectionStart ?? 0;
                                       store.setSelectionEnd(Math.max(val, start + 0.001));
                                    }}
                                    min={0}
                                    max={store.selection.selectedSourceWaveform.duration}
                                 />
                                 <div className="flex flex-col gap-1">
                                    <label className="text-[11px] text-studio-text-muted font-medium">Duration</label>
                                    <div className="px-3 py-1.5 bg-studio-canvas border border-studio-border rounded-md text-sm font-mono text-studio-text tabular-nums">
                                       {formatTime(store.selection.selectionEnd - store.selection.selectionStart)}
                                    </div>
                                 </div>
                              </div>
                              <div className="flex gap-2">
                                 <button
                                    onClick={() => store.previewSelection()}
                                    className="flex items-center gap-2 bg-studio-raised hover:bg-white/10 border border-studio-border px-3 py-2 rounded-lg font-medium transition text-[13px] text-studio-text"
                                    title="Preview selection"
                                 >
                                    <Play size={14} />
                                    Preview
                                 </button>
                                 <button
                                    onClick={() => store.toggleLoop()}
                                    data-testid="loop-toggle"
                                    aria-pressed={store.playback.looping}
                                    className={`flex items-center gap-2 border px-3 py-2 rounded-lg font-medium transition text-[13px] ${
                                       store.playback.looping
                                          ? "bg-studio-snap/20 border-studio-snap/50 text-studio-snap"
                                          : "bg-studio-raised hover:bg-white/10 border-studio-border text-studio-text"
                                    }`}
                                    title="Loop the current selection during playback"
                                 >
                                    <Repeat size={14} />
                                    Loop
                                 </button>
                                 <button
                                    onClick={() => store.createClipFromSelection()}
                                    className="flex items-center gap-2 bg-studio-accent hover:brightness-110 px-3.5 py-2 rounded-lg font-medium transition text-[13px] text-white shadow-sm shadow-studio-accent/30"
                                 >
                                    <Plus size={16} />
                                    Create Clip
                                 </button>
                              </div>
                           </div>
                        )}
                     </div>
                  )}
               </div>

               {/* Transport / player bar — always visible, never scrolled away */}
               <div className="space-y-2.5 shrink-0">
                     <div className="flex items-center gap-2 text-[12px] bg-studio-panel px-3.5 py-2 rounded-xl border border-studio-border">
                        <span className="text-studio-text-muted font-medium">Playback:</span>
                        <button
                           onClick={() => {
                              if (store.selection.selectedSourceId) {
                                 store.selectSource(store.selection.selectedSourceId);
                              }
                           }}
                           className={`px-2.5 py-1 rounded-md font-medium transition ${
                              store.playback.mode === "source"
                                 ? "bg-studio-accent text-white shadow-sm"
                                 : "bg-studio-raised text-studio-text-muted hover:text-studio-text"
                           }`}
                           disabled={!store.selection.selectedSourceId}
                           title="Play individual source file"
                        >
                           Source
                        </button>
                        <button
                           onClick={async () => {
                              const hasTimelineContent = store.project?.timeline.tracks.some(t => t.items.length > 0);
                              if (hasTimelineContent) {
                                 await store.renderPreview();
                              }
                           }}
                           className={`px-2.5 py-1 rounded-md font-medium transition ${
                              store.playback.mode === "timeline"
                                 ? "bg-studio-accent text-white shadow-sm"
                                 : "bg-studio-raised text-studio-text-muted hover:text-studio-text"
                           }`}
                           disabled={!store.project?.timeline.tracks.some(t => t.items.length > 0)}
                           title="Play rendered timeline composition"
                        >
                           Timeline Mix
                           {store.playback.previewStale && store.playback.mode === "timeline" && (
                              <span className="ml-1 text-studio-snap animate-pulse">●</span>
                           )}
                        </button>

                        {/* Unambiguous "what am I about to hear" indicator — source
                            playback, a clip preview, and the timeline mix all drive
                            the same <audio> element, so the label (not a guess) is
                            the only thing that tells them apart. */}
                        <div
                           data-testid="now-playing-indicator"
                           data-now-playing-kind={nowPlaying.kind}
                           className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium max-w-55 ${
                              nowPlaying.kind === "timeline"
                                 ? "bg-studio-success/15 text-studio-success"
                                 : nowPlaying.kind === "clip"
                                 ? "bg-studio-snap/15 text-studio-snap"
                                 : "bg-studio-accent/15 text-studio-accent-strong"
                           }`}
                        >
                           {store.playback.playing ? <Play size={11} className="shrink-0" /> : <span className="w-2.75 shrink-0" />}
                           <span className="uppercase tracking-wide shrink-0">
                              {nowPlaying.kind === "timeline" ? "Timeline Mix" : nowPlaying.kind === "clip" ? "Clip Preview" : "Source"}
                           </span>
                           {nowPlaying.kind !== "timeline" && (
                              <span className="truncate opacity-80" title={nowPlaying.label}>
                                 · {nowPlaying.label}
                              </span>
                           )}
                        </div>

                        {store.playback.mode === "timeline" && store.playback.previewStale && (
                           <button
                              onClick={() => store.renderPreview()}
                              className="px-2.5 py-1 rounded-md bg-studio-snap/20 hover:bg-studio-snap/30 text-studio-snap text-[11px] font-medium transition"
                           >
                              Update Preview
                           </button>
                        )}
                     </div>

                     <PlayerBar
                        playing={store.playback.playing}
                        playhead={store.playback.playhead}
                        duration={effectiveDuration || 30}
                        volume={store.playback.volume}
                        muted={store.playback.muted}
                        playbackRate={store.playback.playbackRate}
                        onPlay={() => store.play()}
                        onPause={() => store.pause()}
                        onStop={() => store.stop()}
                        onSeek={(t) => store.seek(t)}
                        onVolumeChange={(v) => store.setVolume(v)}
                        onMuteToggle={() => store.setMuted(!store.playback.muted)}
                        onPlaybackRateChange={(r) => store.setPlaybackRate(r)}
                        previewPath={store.playback.previewPath}
                        mode={store.playback.mode}
                        sourcePlaybackPath={store.playback.sourcePlaybackPath}
                        selectionStart={store.playback.mode === "source" ? store.selection.selectionStart : null}
                        selectionEnd={store.playback.mode === "source" ? store.selection.selectionEnd : null}
                        looping={store.playback.looping}
                     />
                  </div>

               {/* Resize handle */}
               <div
                  onPointerDown={(e) => {
                     e.preventDefault();
                     beginTimelineResize(e.clientY, timelineHeight);
                  }}
                  className="group flex items-center justify-center h-3 shrink-0 cursor-row-resize touch-none"
                  title="Drag to resize the timeline"
                  data-testid="timeline-resize-handle"
               >
                  <div className="w-10 h-1 rounded-full bg-studio-border group-hover:bg-studio-accent transition-colors" />
                  <GripHorizontal size={12} className="absolute text-studio-text-faint opacity-0 group-hover:opacity-60 transition" />
               </div>

               {/* Timeline - THE CREATIVE WORKSPACE */}
               <div className="shrink-0 overflow-hidden bg-studio-panel rounded-xl border border-studio-border p-2.5" style={{ height: timelineHeight }}>
                  <Timeline
                     key={store.project.createdAt}
                     tracks={store.project.timeline.tracks}
                     clips={store.project.clips}
                     duration={projectDuration || 30}
                     selectedTrackId={store.selection.selectedTrackId}
                     selectedItemTrackId={store.selection.selectedItemTrackId}
                     selectedItemIndex={store.selection.selectedItemIndex}
                     onMoveItem={(trackId, idx, newPos, recordHistory) =>
                        store.moveItem(trackId, idx, newPos, recordHistory)
                     }
                     onBeginItemEdit={() => store.checkpointHistory()}
                     onSplitItem={(trackId, idx, atTime) => store.splitItem(trackId, idx, atTime)}
                     onRemoveItem={(trackId, idx) =>
                        store.removeItem(trackId, idx)
                     }
                     onDuplicateItem={(trackId, idx) => store.duplicateItem(trackId, idx)}
                     onSelectItem={(trackId, idx) => {
                        store.setSelectedTrack(trackId);
                        store.setSelectedItem(trackId, idx);
                     }}
                     onSelectTrack={(trackId) => {
                        store.setSelectedTrack(trackId);
                        store.setSelectedItem(null, null);
                     }}
                     onAddTrack={() => store.addTrack()}
                     onRemoveTrack={(id) => store.removeTrack(id)}
                     onUpdateItem={(trackId, idx, updates, recordHistory) =>
                        store.updateItem(trackId, idx, updates, recordHistory)
                     }
                     onToggleMute={(trackId, muted) => store.setTrackMute(trackId, muted)}
                     onToggleSolo={(trackId, solo) => store.setTrackSolo(trackId, solo)}
                     playhead={store.playback.playhead}
                     externalDrag={
                        dragClip
                           ? { clipId: dragClip.clipId, name: dragClip.name, clientX: dragClip.x, clientY: dragClip.y }
                           : null
                     }
                     onExternalHoverChange={(hover) => {
                        dragHoverRef.current = hover;
                     }}
                  />
               </div>
            </div>
         </div>

         {/* Export dialog */}
         <ExportDialog
            open={showExportDialog}
            onClose={() => setShowExportDialog(false)}
            onExport={handleExportMix}
            isLoading={exporting}
         />

         {/* Floating ghost for the pointer-based clip drag (library -> timeline) */}
         {dragClip && (
            <div
               data-testid="clip-drag-ghost"
               style={{ left: dragClip.x + 12, top: dragClip.y + 12 }}
               className="fixed z-100 pointer-events-none px-3 py-1.5 rounded-md bg-studio-accent text-white text-xs font-medium shadow-xl shadow-black/40 border border-white/20"
            >
               {dragClip.name}
            </div>
         )}

         <UiDialogHost />
      </div>
   );
}
