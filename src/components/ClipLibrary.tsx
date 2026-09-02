import { Plus, Trash2, Copy, Edit2, GripVertical, Play, CornerDownRight } from "lucide-react";
import type { StudioClip, StudioSource } from "../lib/studioTypes";
import { formatTime, formatDuration, formatClock } from "../lib/studioTime";
import { colorForSource } from "../lib/studioColors";
import { appConfirm, appPrompt } from "../stores/uiDialog";

interface ClipLibraryProps {
   clips: StudioClip[];
   sources: StudioSource[];
   selectedClipId?: string | null;
   previewingClipId?: string | null;
   draggingClipId?: string | null;
   /** Whether a region is selected on the waveform — the only state from which a clip can be cut. */
   canCreateClip?: boolean;
   onCreateClipFromSelection?: () => void;
   onSelectClip?: (id: string) => void;
   onPreviewClip?: (id: string) => void;
   onRenameClip?: (id: string, name: string) => void;
   onDeleteClip?: (id: string) => void;
   onDuplicateClip?: (id: string) => void;
   /**
    * Place this clip flush after everything already on the active track. The
    * fast path for "A then B then C": no aiming, no gaps, no overlaps.
    */
   onAppendClip?: (id: string) => void;
   /** Pointer-based drag start (HTML5 drag/drop is unreliable in the Tauri WebView). */
   onBeginDrag?: (clipId: string, clientX: number, clientY: number) => void;
}

export function ClipLibrary({
   clips,
   sources,
   selectedClipId,
   previewingClipId,
   draggingClipId,
   canCreateClip = false,
   onCreateClipFromSelection,
   onSelectClip,
   onPreviewClip,
   onRenameClip,
   onDeleteClip,
   onDuplicateClip,
   onAppendClip,
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
               disabled={!canCreateClip}
               data-testid="clip-library-create"
               className="rounded-md bg-studio-success/90 p-1 hover:brightness-110 transition disabled:opacity-30 text-black/80"
               title={canCreateClip ? "Create clip from selection" : "Select a region on the waveform first"}
            >
               <Plus size={14} />
            </button>
         </div>

         <div className="space-y-1 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {clips.length === 0 ? (
               // Once a region IS selected, the empty state stops describing the
               // next step and becomes it. The small "+" in the header was the
               // only always-visible way in, and an unlabelled icon is not a
               // discoverable one — the reported failure was a user who had a
               // selection ready and still could not find how to make a clip.
               canCreateClip ? (
                  <button
                     onClick={onCreateClipFromSelection}
                     data-testid="clip-library-create-cta"
                     className="w-full flex items-center gap-2 rounded-lg border border-dashed border-studio-accent/50 bg-studio-accent/10 hover:bg-studio-accent/20 px-2.5 py-2.5 text-left text-[12px] font-medium text-studio-text transition"
                  >
                     <Plus size={14} className="shrink-0 text-studio-accent-strong" />
                     Create clip from selection
                  </button>
               ) : (
                  <div className="text-[12px] text-studio-text-faint p-2 leading-relaxed">
                     Select a region on the waveform
                     <br />
                     and create a clip
                  </div>
               )
            ) : (
               clips.map((clip) => {
                  const color = colorForSource(clip.sourceId);
                  return (
                     <div
                        key={clip.id}
                        onPointerDown={(e) => handlePointerDown(e, clip.id)}
                        onClick={() => onSelectClip?.(clip.id)}
                        onDoubleClick={(e) => {
                           e.stopPropagation();
                           onAppendClip?.(clip.id);
                        }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                           if (e.key === "Enter") {
                              e.preventDefault();
                              onAppendClip?.(clip.id);
                           }
                        }}
                        data-testid="clip-item"
                        data-clip-id={clip.id}
                        title={`${clip.name} — drag onto a track, or double-click to append it to the end`}
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
                              {/* One compact line: the length is what you
                                  arrange with, the in-point is context. Full
                                  millisecond bounds live in the tooltip so a
                                  narrow rail doesn't wrap into three lines. */}
                              <div
                                 className="text-[10px] text-studio-text-muted tabular-nums truncate"
                                 title={`${formatTime(clip.start)} → ${formatTime(clip.end)}`}
                              >
                                 <span className="text-studio-text">{formatDuration(clip.end - clip.start)}</span>
                                 {" · from "}
                                 {formatClock(clip.start)}
                              </div>
                           </div>
                           <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                              <button
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    onAppendClip?.(clip.id);
                                 }}
                                 data-testid="clip-append-button"
                                 className="p-1 hover:bg-studio-accent/25 rounded text-studio-text-muted hover:text-studio-accent-strong transition"
                                 title="Append to the end of the active track"
                              >
                                 <CornerDownRight size={11} />
                              </button>
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
            <div className="text-[11px] text-studio-text-faint pt-1.5 border-t border-studio-border-soft shrink-0 leading-relaxed">
               Drag onto a track to place freely, or double-click to append
            </div>
         )}
      </div>
   );
}
