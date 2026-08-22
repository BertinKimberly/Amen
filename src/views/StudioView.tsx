import { useEffect, useState } from "react";
import { useStudioStore } from "../stores/studio";
import { WaveformView } from "../components/WaveformView";
import { PlayerBar } from "../components/PlayerBar";
import { Timeline } from "../components/Timeline";
import { SourcePanel } from "../components/SourcePanel";
import { ClipLibrary } from "../components/ClipLibrary";
import { ExportDialog } from "../components/ExportDialog";
import { Plus, Save, RotateCcw, RotateCw, Download } from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";

export function StudioView() {
   const store = useStudioStore();
   const [showExportDialog, setShowExportDialog] = useState(false);
   const [exporting, setExporting] = useState(false);
   const [dragActive, setDragActive] = useState(false);

   // Initialize with a new project if none exists
   useEffect(() => {
      if (!store.project) {
         store.newProject("Untitled Mix");
      }
   }, [store.project]);

   // Auto-render preview when modified
   useEffect(() => {
      if (store.modified && store.project?.timeline.tracks.some(t => t.items.length > 0)) {
         const t = setTimeout(() => {
            store.renderPreview();
         }, 1000);
         return () => clearTimeout(t);
      }
   }, [store.modified, store.project]);

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

   const handleNewProject = async () => {
      if (store.modified && !confirm("Discard unsaved changes?")) return;
      await store.newProject("Untitled Mix");
   };

   const handleOpenProject = async () => {
      if (store.modified && !confirm("Discard unsaved changes?")) return;
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
         const path = await save({
            defaultPath: `mix.${format}`,
            filters: [{ name: format.toUpperCase(), extensions: [format] }],
         });
         if (path) {
            const result = await store.exportMix(path, format, bitrate);
            if (result) {
               alert(`Exported to ${result.path}`);
            }
         }
      } catch (e) {
         console.error("Export failed:", e);
         alert("Export failed");
      } finally {
         setExporting(false);
      }
   };

   if (!store.project) {
      return <div className="p-8 text-center">Loading studio...</div>;
   }

   if (store.project.sources.length === 0) {
      return (
         <div 
            className={`flex flex-col items-center justify-center h-full gap-6 bg-slate-950 text-slate-100 p-8 text-center animate-in fade-in zoom-in duration-500 ${
               dragActive ? "bg-blue-950/50 border-4 border-blue-500 border-dashed" : ""
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
         >
            <img src="/logo.png" alt="Amen Logo" className="w-24 h-24 mb-4 drop-shadow-xl opacity-90" />
            <h2 className="text-3xl font-bold tracking-tight">Create something new.</h2>
            <p className="text-slate-400 text-lg max-w-sm">
               Bring in an audio file and start shaping the moment.
            </p>
            <div className="flex gap-4 mt-4">
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
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition shadow-lg flex items-center gap-2"
               >
                  <Plus size={20} />
                  Import Audio
               </button>
               <button 
                  onClick={handleOpenProject}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg font-medium transition shadow-lg flex items-center gap-2"
               >
                  <Download size={20} />
                  Open Project
               </button>
            </div>
            <p className="text-slate-500 text-sm mt-8">
               {dragActive ? "Drop audio files here" : "or drag audio here"}
            </p>
         </div>
      );
   }

   // Calculate project duration from timeline
   const projectDuration = store.project.timeline.tracks.reduce(
      (max, track) => {
         const trackEnd = track.items.reduce((trackMax, item) => {
            const clipIdx = store.project!.clips.findIndex(
               (c) => c.id === item.clipId,
            );
            if (clipIdx === -1) return trackMax;
            const clip = store.project!.clips[clipIdx];
            const itemEnd = item.position + (clip.end - clip.start);
            return Math.max(trackMax, itemEnd);
         }, 0);
         return Math.max(max, trackEnd);
      },
      0,
   );

   return (
      <div 
         className="flex flex-col h-full gap-4 p-4 bg-slate-950 text-slate-100 overflow-hidden"
         onDragEnter={handleDrag}
         onDragLeave={handleDrag}
         onDragOver={handleDrag}
         onDrop={handleDrop}
      >
         {dragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-950/90 backdrop-blur-sm border-4 border-blue-500 border-dashed pointer-events-none">
               <div className="text-center">
                  <Plus size={64} className="mx-auto mb-4 text-blue-400" />
                  <p className="text-2xl font-bold text-white">Drop audio files here</p>
                  <p className="text-blue-300 mt-2">MP3, WAV, FLAC, M4A, AAC, OGG</p>
               </div>
            </div>
         )}
         {/* Toolbar */}
         <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-bold">
               {store.project.name}
               {store.modified && (
                  <span className="text-yellow-400 text-sm">*</span>
               )}
            </h1>

            <div className="flex items-center gap-2 ml-auto">
               <button
                  onClick={handleNewProject}
                  className="flex items-center gap-2 rounded bg-slate-700 px-3 py-2 hover:bg-slate-600 transition"
                  title="New project"
               >
                  <Plus size={16} />
                  New
               </button>
               <button
                  onClick={handleOpenProject}
                  className="flex items-center gap-2 rounded bg-slate-700 px-3 py-2 hover:bg-slate-600 transition"
                  title="Open project"
               >
                  <Download size={16} />
                  Open
               </button>
               <button
                  onClick={handleSaveProject}
                  className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 hover:bg-blue-700 transition disabled:opacity-50"
                  disabled={store.loadingState === "saving"}
                  title="Save project"
               >
                  <Save size={16} />
                  Save
               </button>
               <button
                  onClick={handleSaveProjectAs}
                  className="flex items-center gap-2 rounded bg-slate-700 px-3 py-2 hover:bg-slate-600 transition"
                  title="Save project as..."
               >
                  Save As...
               </button>

               <div className="w-px h-6 bg-slate-600" />

               <button
                  onClick={() => store.undo()}
                  disabled={!store.canUndo()}
                  className="rounded bg-slate-700 px-3 py-2 hover:bg-slate-600 disabled:opacity-50 transition"
                  title="Undo"
               >
                  <RotateCcw size={16} />
               </button>
               <button
                  onClick={() => store.redo()}
                  disabled={!store.canRedo()}
                  className="rounded bg-slate-700 px-3 py-2 hover:bg-slate-600 disabled:opacity-50 transition"
                  title="Redo"
               >
                  <RotateCw size={16} />
               </button>

               <div className="w-px h-6 bg-slate-600" />

               <button
                  onClick={() => setShowExportDialog(true)}
                  className="flex items-center gap-2 rounded bg-green-600 px-3 py-2 hover:bg-green-700 transition disabled:opacity-50"
                  disabled={exporting}
                  title="Export mix"
               >
                  Export
               </button>
            </div>
         </div>

         {/* Main content area */}
         <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Left panel: sources & clips */}
            <div className="w-48 flex flex-col gap-4 overflow-y-auto border-r border-slate-700 pr-4">
               <SourcePanel
                  sources={store.project.sources}
                  selectedSourceId={store.selection.selectedSourceId}
                  onAddSource={(path) => store.addSource(path)}
                  onRemoveSource={(id) => store.removeSource(id)}
                  onSelectSource={(id) => store.selectSource(id)}
               />

               <ClipLibrary
                  clips={store.project.clips}
                  sources={store.project.sources}
                  selectedClipId={store.selection.selectedClipId}
                  onCreateClipFromSelection={() =>
                     store.createClipFromSelection()
                  }
                  onSelectClip={(id) => store.setSelectedClip(id)}
                  onRenameClip={(id, name) => store.renameClip(id, name)}
                  onDeleteClip={(id) => store.deleteClip(id)}
                  onDuplicateClip={(id) => store.duplicateClip(id)}
               />
            </div>

            {/* Center panel: editor */}
            <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">
               {/* Waveform */}
               {store.selection.selectedSourceWaveform && (
                  <WaveformView
                     waveform={store.selection.selectedSourceWaveform}
                     duration={store.selection.selectedSourceWaveform.duration}
                     onSelectionChange={(start, end) => {
                        store.setSelectionStart(start);
                        store.setSelectionEnd(end);
                     }}
                     onSeek={(time) => store.seek(time)}
                     playhead={store.playback.playhead}
                     darkMode
                  />
               )}

               {/* Player bar */}
               <PlayerBar
                  playing={store.playback.playing}
                  playhead={store.playback.playhead}
                  duration={projectDuration || 30}
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
               />

               {/* Timeline */}
               <div className="flex-1 min-h-0 overflow-hidden">
                  <Timeline
                     tracks={store.project.timeline.tracks}
                     clips={store.project.clips}
                     duration={projectDuration || 30}
                     selectedTrackId={store.selection.selectedTrackId}
                     onAddClipToTrack={(trackId, pos) => {
                        if (store.selection.selectedClipId) {
                           store.addItemToTimeline(
                              store.selection.selectedClipId,
                              trackId,
                              pos,
                           );
                        }
                     }}
                     onMoveItem={(trackId, idx, newPos) =>
                        store.moveItem(trackId, idx, newPos)
                     }
                     onRemoveItem={(trackId, idx) =>
                        store.removeItem(trackId, idx)
                     }
                     onSelectItem={(trackId, _idx) => store.setSelectedTrack(trackId)}
                     onSelectTrack={(trackId) =>
                        store.setSelectedTrack(trackId)
                     }
                     playhead={store.playback.playhead}
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
      </div>
   );
}
