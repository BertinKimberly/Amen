import { useCallback } from "react";
import { Plus, Trash2, Play } from "lucide-react";
import type { StudioSource } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";
import { open } from "@tauri-apps/plugin-dialog";

interface SourcePanelProps {
   sources: StudioSource[];
   selectedSourceId?: string | null;
   onAddSource?: (path: string) => Promise<void>;
   onRemoveSource?: (id: string) => void;
   onSelectSource?: (id: string) => Promise<void>;
   onPlayPreview?: (path: string) => void;
}

export function SourcePanel({
   sources,
   selectedSourceId,
   onAddSource,
   onRemoveSource,
   onSelectSource,
   onPlayPreview,
}: SourcePanelProps) {
   const handleAddSource = useCallback(async () => {
      try {
         const selected = await open({
            directory: false,
            multiple: false,
            filters: [
               {
                  name: "Audio",
                  extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg"],
               },
               { name: "All", extensions: ["*"] },
            ],
         });
         if (selected && typeof selected === "string") {
            await onAddSource?.(selected);
         }
      } catch (e) {
         console.error("Failed to open file dialog:", e);
      }
   }, [onAddSource]);

   return (
      <div className="flex flex-col gap-2">
         <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Sources</h3>
            <button
               onClick={handleAddSource}
               className="rounded bg-blue-600 p-1 hover:bg-blue-700 transition"
               title="Add audio file"
            >
               <Plus size={16} />
            </button>
         </div>

         <div className="space-y-1 max-h-48 overflow-y-auto">
            {sources.length === 0 ? (
               <div className="text-xs text-slate-400 p-2">No sources yet</div>
            ) : (
               sources.map((src) => (
                  <div
                     key={src.id}
                     onClick={() => onSelectSource?.(src.id)}
                     className={`p-2 rounded cursor-pointer transition ${
                        selectedSourceId === src.id
                           ? "bg-blue-600 text-white"
                           : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                     }`}
                  >
                     <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                           <div className="font-mono text-xs truncate">
                              {src.name}
                           </div>
                           <div className="text-xs text-slate-400">
                              {formatTime(src.duration)}
                              {src.sampleRate
                                 ? ` @ ${src.sampleRate / 1000}kHz`
                                 : ""}
                           </div>
                           {src.bpm && (
                              <div className="text-xs text-yellow-400">
                                 {src.bpm.toFixed(1)} BPM
                              </div>
                           )}
                        </div>
                        <div className="flex gap-1">
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 onPlayPreview?.(src.path);
                              }}
                              className="p-1 hover:bg-blue-700 rounded transition"
                              title="Preview"
                           >
                              <Play size={12} />
                           </button>
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 onRemoveSource?.(src.id);
                              }}
                              className="p-1 hover:bg-red-700 rounded transition"
                              title="Remove"
                           >
                              <Trash2 size={12} />
                           </button>
                        </div>
                     </div>
                  </div>
               ))
            )}
         </div>
      </div>
   );
}
