import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { StudioTrack, StudioTimelineItem, StudioClip } from "../lib/studioTypes";

interface TimelineProps {
   tracks: StudioTrack[];
   clips: StudioClip[];
   duration: number;
   selectedTrackId?: string | null;
   selectedItemTrackId?: string | null;
   selectedItemIndex?: number | null;
   onAddClipToTrack?: (trackId: string, position: number) => void;
   onMoveItem?: (trackId: string, index: number, newPosition: number) => void;
   onRemoveItem?: (trackId: string, index: number) => void;
   onSelectItem?: (trackId: string, index: number) => void;
   onSelectTrack?: (trackId: string) => void;
   playhead?: number;
}

/**
 * DOM-based timeline with:
 * - Multiple tracks
 * - Absolute-positioned clips
 * - Drag-to-move clips
 * - Trim handles
 * - Crossfade visualization
 * - Playhead
 * - Click on track to add clip at position
 */
export function Timeline({
   tracks,
   duration,
   selectedTrackId,
   selectedItemTrackId,
   selectedItemIndex,
   onAddClipToTrack,
   onMoveItem,
   onRemoveItem,
   onSelectItem,
   onSelectTrack,
   clips,
   playhead = 0,
}: TimelineProps) {
   const containerRef = useRef<HTMLDivElement>(null);
   const [dragState, setDragState] = useState<{
      trackId: string;
      index: number;
      type: "move" | "trimLeft" | "trimRight";
      startX: number;
      startPos: number;
   } | null>(null);

   const pxPerSecond = 100; // pixels per second
   const trackHeight = 80;
   const totalWidth = Math.max(duration * pxPerSecond, 800);

   const handleTrackClick = (
      e: React.MouseEvent<HTMLDivElement>,
      trackId: string,
   ) => {
      if (e.target !== e.currentTarget) return; // only on empty track area
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const position = relX / pxPerSecond;
      onSelectTrack?.(trackId);
      onAddClipToTrack?.(trackId, position);
   };

   const handleMouseDownOnItem = (
      e: React.MouseEvent,
      trackId: string,
      index: number,
      type: "move" | "trimLeft" | "trimRight",
      itemPosition: number,
   ) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectItem?.(trackId, index);
      setDragState({
         trackId,
         index,
         type,
         startX: e.clientX,
         startPos: itemPosition,
      });
   };

   const handleMouseMove = (e: React.MouseEvent) => {
      if (!dragState || !containerRef.current) return;
      const deltaX = e.clientX - dragState.startX;
      const deltaSeconds = deltaX / pxPerSecond;

      if (dragState.type === "move") {
         const newPos = Math.max(0, dragState.startPos + deltaSeconds);
         onMoveItem?.(dragState.trackId, dragState.index, newPos);
      }
   };

   const handleMouseUp = () => {
      setDragState(null);
   };

   return (
      <div
         className="relative overflow-x-auto overflow-y-hidden rounded-lg bg-slate-950 border border-slate-700"
         style={{ height: tracks.length * trackHeight + 40 }}
      >
         {/* Ruler at top */}
         <div className="sticky top-0 z-10 h-10 bg-slate-900 border-b border-slate-700 flex">
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
               <div
                  key={i}
                  style={{ width: pxPerSecond, minWidth: pxPerSecond }}
                  className="border-r border-slate-700 px-1 text-xs text-slate-500 flex items-center shrink-0"
               >
                  {i}s
               </div>
            ))}
         </div>

         {/* Tracks container */}
         <div
            ref={containerRef}
            className="relative"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ width: totalWidth }}
         >
            {/* Playhead */}
            {playhead >= 0 && (
               <div
                  style={{
                     left: playhead * pxPerSecond,
                     height: tracks.length * trackHeight,
                  }}
                  className="absolute top-0 w-0.5 bg-red-500 pointer-events-none z-20"
               />
            )}

            {/* Tracks */}
            {tracks.map((track, trackIdx) => (
               <div
                  key={track.id}
                  onClick={(e) => handleTrackClick(e, track.id)}
                  style={{
                     top: trackIdx * trackHeight,
                     height: trackHeight,
                     minWidth: totalWidth,
                  }}
                  className={`absolute left-0 right-0 border-b border-slate-700 cursor-pointer transition ${
                     selectedTrackId === track.id
                        ? "bg-blue-950"
                        : "bg-slate-900 hover:bg-slate-800"
                  }`}
               >
                  {/* Track label */}
                  <div className="absolute left-2 top-1 text-xs text-slate-500 select-none pointer-events-none">
                     Track {trackIdx + 1}
                  </div>

                  {/* Track items */}
                  {track.items.map((item, itemIdx) => {
                     const isSelected =
                        selectedItemTrackId === track.id &&
                        selectedItemIndex === itemIdx;
                     const clip = clips.find((c) => c.id === item.clipId);
                     const clipDuration = clip ? clip.end - clip.start : 0.1;
                     const clipName = clip ? clip.name : "Unknown";
                     return (
                        <TimelineClipItem
                           key={`${track.id}-${itemIdx}`}
                           item={item}
                           clipName={clipName}
                           clipDuration={clipDuration}
                           pxPerSecond={pxPerSecond}
                           trackHeight={trackHeight}
                           isSelected={isSelected}
                           onMouseDownMove={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "move",
                                 item.position,
                              )
                           }
                           onMouseDownTrimLeft={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "trimLeft",
                                 item.position,
                              )
                           }
                           onMouseDownTrimRight={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "trimRight",
                                 item.position,
                              )
                           }
                           onRemove={() => onRemoveItem?.(track.id, itemIdx)}
                           onSelect={() => onSelectItem?.(track.id, itemIdx)}
                        />
                     );
                  })}
               </div>
            ))}
         </div>
      </div>
   );
}

interface TimelineClipItemProps {
   item: StudioTimelineItem;
   clipName: string;
   clipDuration: number;
   pxPerSecond: number;
   trackHeight: number;
   isSelected: boolean;
   onMouseDownMove: (e: React.MouseEvent) => void;
   onMouseDownTrimLeft: (e: React.MouseEvent) => void;
   onMouseDownTrimRight: (e: React.MouseEvent) => void;
   onRemove: () => void;
   onSelect: () => void;
}

function TimelineClipItem({
   item,
   clipName,
   clipDuration,
   pxPerSecond,
   trackHeight,
   isSelected,
   onMouseDownMove,
   onMouseDownTrimLeft,
   onMouseDownTrimRight,
   onRemove,
   onSelect,
}: TimelineClipItemProps) {
   const left = item.position * pxPerSecond;
   const width = Math.max(8, clipDuration * pxPerSecond);
   const crossfadeWidth = (item.crossfadePrev ?? 0) * pxPerSecond;

   return (
      <div
         onClick={(e) => { e.stopPropagation(); onSelect(); }}
         style={{
            left,
            top: 16,
            width,
            height: trackHeight - 24,
         }}
         className={`absolute rounded cursor-move transition group ${
            isSelected
               ? "bg-blue-600 border-2 border-blue-400 shadow-lg shadow-blue-500/30"
               : "bg-blue-800 border border-blue-700 hover:bg-blue-700"
         }`}
         onMouseDown={onMouseDownMove}
      >
         {/* Crossfade overlap visualization */}
         {crossfadeWidth > 0 && (
            <div
               style={{ width: Math.min(crossfadeWidth, width) }}
               className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500/40 to-transparent rounded-l pointer-events-none"
            />
         )}

         {/* Content */}
         <div className="px-2 py-1 truncate text-xs text-white font-medium pointer-events-none">
            {clipName}
            {item.muted && <span className="ml-1 opacity-60">[M]</span>}
            {item.volume !== 1 && (
               <span className="ml-1 opacity-60">{Math.round(item.volume * 100)}%</span>
            )}
         </div>

         {/* Trim handle — left */}
         <div
            style={{ width: 6 }}
            className="absolute inset-y-0 left-0 bg-blue-300 cursor-col-resize hover:bg-yellow-400 rounded-l opacity-0 group-hover:opacity-80 transition"
            onMouseDown={(e) => { e.stopPropagation(); onMouseDownTrimLeft(e); }}
         />
         {/* Trim handle — right */}
         <div
            style={{ width: 6 }}
            className="absolute inset-y-0 right-0 bg-blue-300 cursor-col-resize hover:bg-yellow-400 rounded-r opacity-0 group-hover:opacity-80 transition"
            onMouseDown={(e) => { e.stopPropagation(); onMouseDownTrimRight(e); }}
         />

         {/* Delete button */}
         <button
            onClick={(e) => {
               e.stopPropagation();
               onRemove();
            }}
            className="absolute top-1 right-1 p-0.5 bg-red-600 rounded hover:bg-red-500 opacity-0 group-hover:opacity-100 transition z-10"
         >
            <Trash2 size={10} />
         </button>
      </div>
   );
}
