import { Plus, Trash2, Copy, Edit2, GripVertical, Play } from "lucide-react";
import type { StudioClip, StudioSource } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";
import { colorForSource } from "../lib/studioColors";
import { appConfirm, appPrompt } from "../stores/uiDialog";

interface ClipLibraryProps {
   clips: StudioClip[];
   sources: StudioSource[];
   selectedClipId?: string | null;
   previewingClipId?: string | null;
   draggingClipId?: string | null;
   onCreateClipFromSelection?: () => void;
   onSelectClip?: (id: string) => void;
   onPreviewClip?: (id: string) => void;
   onRenameClip?: (id: string, name: string) => void;
   onDeleteClip?: (id: string) => void;
   onDuplicateClip?: (id: string) => void;
   /** Pointer-based drag start (HTML5 drag/drop is unreliable in the Tauri WebView). */
   onBeginDrag?: (clipId: string, clientX: number, clientY: number) => void;
}

export function ClipLibrary({
   clips,
   sources,
   selectedClipId,
   previewingClipId,
   draggingClipId,
   onCreateClipFromSelection,
   onSelectClip,
   onPreviewClip,
   onRenameClip,
   onDeleteClip,
   onDuplicateClip,
   onBeginDrag,
}: ClipLibraryProps) {
   const getSourceName = (sourceId: string) => {
      return sources.find((s) => s.id === sourceId)?.name || "Unknown";
   };

   const handlePointerDown = (e: React.PointerEvent, clipId: string) => {
      // Ignore secondary buttons and clicks that originate on the row's
      // action buttons (rename/duplicate/delete) — those have their own
      // click handlers and must not also start a drag.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      onBeginDrag?.(clipId, e.clientX, e.clientY);
   };

   return (
      <div className="flex flex-col gap-2 h-full min-h-0">
         <div className="flex items-center justify-between shrink-0">
            <h3 className="font-semibold text-[12px] text-studio-text uppercase tracking-wide">Clips</h3>
            <button
               onClick={onCreateClipFromSelection}
               className="rounded-md bg-studio-success/90 p-1 hover:brightness-110 transition disabled:opacity-50 text-black/80"
               title="Create clip from selection"
            >
               <Plus size={14} />
            </button>
         </div>

         <div className="space-y-1 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {clips.length === 0 ? (
               <div className="text-[12px] text-studio-text-faint p-2 leading-relaxed">
                  Select a region on the waveform
                  <br />
                  and create a clip
               </div>
            ) : (
               clips.map((clip) => {
                  const color = colorForSource(clip.sourceId);
                  return (
                     <div
                        key={clip.id}
                        onPointerDown={(e) => handlePointerDown(e, clip.id)}
                        onClick={() => onSelectClip?.(clip.id)}
                        data-testid="clip-item"
                        data-clip-id={clip.id}
                        className={`group p-2 rounded-lg cursor-grab active:cursor-grabbing transition touch-none select-none border ${
                           draggingClipId === clip.id
                              ? "opacity-40 ring-2 ring-studio-accent border-transparent"
                              : previewingClipId === clip.id
                              ? "bg-studio-snap/15 ring-1 ring-studio-snap/60 border-transparent"
                              : selectedClipId === clip.id
                              ? "bg-studio-accent/20 ring-1 ring-studio-accent/50 border-transparent"
                              : "border-transparent hover:bg-studio-raised"
                        }`}
                     >
                        <div className="flex items-start gap-2">
                           <div className={`mt-0.5 h-7 w-1 rounded-full shrink-0 bg-linear-to-b ${color.from} ${color.to}`} />
                           <GripVertical size={13} className="mt-0.5 shrink-0 text-studio-text-faint" />
                           <div className="flex-1 min-w-0">
                              <div className="text-[12px] truncate font-semibold text-studio-text">
                                 {clip.name}
                              </div>
                              <div className={`text-[10px] truncate ${color.text}`}>
                                 {getSourceName(clip.sourceId)}
                              </div>
                              <div className="text-[10px] text-studio-text-muted tabular-nums">
                                 {formatTime(clip.start)} → {formatTime(clip.end)}{" "}
                                 ({formatTime(clip.end - clip.start)})
                              </div>
                           </div>
                           <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                              <button
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    onPreviewClip?.(clip.id);
                                 }}
                                 data-testid="clip-preview-button"
                                 className="p-1 hover:bg-studio-snap/20 rounded text-studio-text-muted hover:text-studio-snap transition"
                                 title="Preview clip (plays only this clip's region)"
                              >
                                 <Play size={11} />
                              </button>
                              <button
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    onDuplicateClip?.(clip.id);
                                 }}
                                 className="p-1 hover:bg-white/10 rounded text-studio-text-muted hover:text-studio-text transition"
                                 title="Duplicate"
                              >
                                 <Copy size={11} />
                              </button>
                              <button
                                 onClick={async (e) => {
                                    e.stopPropagation();
                                    const newName = await appPrompt("Rename clip:", clip.name);
                                    if (newName) onRenameClip?.(clip.id, newName);
                                 }}
                                 className="p-1 hover:bg-white/10 rounded text-studio-text-muted hover:text-studio-text transition"
                                 title="Rename"
                              >
                                 <Edit2 size={11} />
                              </button>
                              <button
                                 onClick={async (e) => {
                                    e.stopPropagation();
                                    if (await appConfirm(`Delete clip "${clip.name}"?`)) {
                                       onDeleteClip?.(clip.id);
                                    }
                                 }}
                                 className="p-1 hover:bg-studio-danger/15 rounded text-studio-text-muted hover:text-studio-danger transition"
                                 title="Delete"
                              >
                                 <Trash2 size={11} />
                              </button>
                           </div>
                        </div>
                     </div>
                  );
               })
            )}
         </div>

         {clips.length > 0 && (
            <div className="text-[11px] text-studio-text-faint pt-1.5 border-t border-studio-border-soft shrink-0">
               Drag clips to the timeline to arrange
            </div>
         )}
      </div>
   );
}
