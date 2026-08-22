import { Plus, Trash2, Copy, Edit2, GripVertical } from "lucide-react";
import type { StudioClip, StudioSource } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";

interface ClipLibraryProps {
   clips: StudioClip[];
   sources: StudioSource[];
   selectedClipId?: string | null;
   onCreateClipFromSelection?: () => void;
   onSelectClip?: (id: string) => void;
   onRenameClip?: (id: string, name: string) => void;
   onDeleteClip?: (id: string) => void;
   onDuplicateClip?: (id: string) => void;
   onStartDrag?: (clipId: string) => void;
}

export function ClipLibrary({
   clips,
   sources,
   selectedClipId,
   onCreateClipFromSelection,
   onSelectClip,
   onRenameClip,
   onDeleteClip,
   onDuplicateClip,
   onStartDrag,
}: ClipLibraryProps) {
   const getSourceName = (sourceId: string) => {
      return sources.find((s) => s.id === sourceId)?.name || "Unknown";
   };

   const handleDragStart = (e: React.DragEvent, clipId: string) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/amen-clip", clipId);
      onStartDrag?.(clipId);
   };

   return (
      <div className="flex flex-col gap-2">
         <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Clips</h3>
            <button
               onClick={onCreateClipFromSelection}
               className="rounded bg-green-600 p-1 hover:bg-green-700 transition disabled:opacity-50"
               title="Create clip from selection"
            >
               <Plus size={16} />
            </button>
         </div>

         <div className="space-y-1 max-h-64 overflow-y-auto">
            {clips.length === 0 ? (
               <div className="text-xs text-slate-400 p-2">
                  Select a region on the waveform<br/>and create a clip
               </div>
            ) : (
               clips.map((clip) => (
                  <div
                     key={clip.id}
                     draggable
                     onDragStart={(e) => handleDragStart(e, clip.id)}
                     onClick={() => onSelectClip?.(clip.id)}
                     className={`p-2 rounded cursor-move transition group ${
                        selectedClipId === clip.id
                           ? "bg-green-600 text-white"
                           : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                     }`}
                  >
                     <div className="flex items-start gap-2">
                        <GripVertical size={14} className="mt-0.5 flex-shrink-0 text-slate-500" />
                        <div className="flex-1 min-w-0">
                           <div className="font-mono text-xs truncate font-semibold">
                              {clip.name}
                           </div>
                           <div className="text-xs text-slate-400">
                              {getSourceName(clip.sourceId)}
                           </div>
                           <div className="text-xs text-slate-400">
                              {formatTime(clip.start)} → {formatTime(clip.end)}{" "}
                              ({formatTime(clip.end - clip.start)})
                           </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 onDuplicateClip?.(clip.id);
                              }}
                              className="p-1 hover:bg-blue-700 rounded transition"
                              title="Duplicate"
                           >
                              <Copy size={12} />
                           </button>
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 const newName = prompt(
                                    "Rename clip:",
                                    clip.name,
                                 );
                                 if (newName) onRenameClip?.(clip.id, newName);
                              }}
                              className="p-1 hover:bg-yellow-700 rounded transition"
                              title="Rename"
                           >
                              <Edit2 size={12} />
                           </button>
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 if (confirm(`Delete clip "${clip.name}"?`)) {
                                    onDeleteClip?.(clip.id);
                                 }
                              }}
                              className="p-1 hover:bg-red-700 rounded transition"
                              title="Delete"
                           >
                              <Trash2 size={12} />
                           </button>
                        </div>
                     </div>
                  </div>
               ))
            )}
         </div>
         
         {clips.length > 0 && (
            <div className="text-xs text-slate-500 pt-1 border-t border-slate-700">
               Drag clips to timeline to arrange
            </div>
         )}
      </div>
   );
}
