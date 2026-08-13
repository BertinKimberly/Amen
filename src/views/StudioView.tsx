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

   // Initialize with a new project if none exists
   useEffect(() => {
      if (!store.project) {
         store.newProject("Untitled Mix");
      }
   }, [store.project]);

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
      <div className="flex flex-col h-full gap-4 p-4 bg-slate-950 text-slate-100 overflow-hidden">
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
               />

               {/* Timeline */}
               <div className="flex-1 min-h-0 overflow-hidden">
                  <Timeline
                     tracks={store.project.timeline.tracks}
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
                     onRemoveItem={(trackId, idx) =>
                        store.removeItem(trackId, idx)
                     }
                     onSelectItem={(trackId) => store.setSelectedTrack(trackId)}
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
