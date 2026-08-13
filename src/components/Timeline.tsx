import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { StudioTrack, StudioTimelineItem } from "../lib/studioTypes";

interface TimelineProps {
   tracks: StudioTrack[];
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
   const totalWidth = duration * pxPerSecond;

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
   ) => {
      e.preventDefault();
      onSelectItem?.(trackId, index);
      setDragState({
         trackId,
         index,
         type,
         startX: e.clientX,
         startPos: type === "move" ? 0 : Date.now(), // dummy
      });
   };

   const handleMouseMove = (e: React.MouseEvent) => {
      if (!dragState || !containerRef.current) return;
      const track = tracks.find((t) => t.id === dragState.trackId);
      if (!track) return;
      const item = track.items[dragState.index];
      if (!item) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaSeconds = deltaX / pxPerSecond;

      if (dragState.type === "move") {
         const newPos = Math.max(0, dragState.startPos + deltaSeconds);
         onMoveItem?.(dragState.trackId, dragState.index, newPos);
      } else if (dragState.type === "trimLeft") {
         // Adjust clip start by trimming
         // This would require clip updates, skipped for now
      } else if (dragState.type === "trimRight") {
         // Adjust clip end by trimming
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
            {Array.from({ length: Math.ceil(duration) }).map((_, i) => (
               <div
                  key={i}
                  style={{ width: pxPerSecond, minWidth: pxPerSecond }}
                  className="border-r border-slate-700 px-1 text-xs text-slate-500 flex items-center"
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
            style={{ width: Math.max(totalWidth, 800) }}
         >
            {/* Playhead */}
            {playhead >= 0 && (
               <div
                  style={{
                     left: playhead * pxPerSecond,
                     height: tracks.length * trackHeight,
                  }}
                  className="absolute top-10 w-0.5 bg-red-500 pointer-events-none z-20"
               />
            )}

            {/* Tracks */}
            {tracks.map((track, trackIdx) => (
               <div
                  key={track.id}
                  onClick={(e) => handleTrackClick(e, track.id)}
                  style={{
                     top: 40 + trackIdx * trackHeight,
                     height: trackHeight,
                     minWidth: Math.max(totalWidth, 800),
                  }}
                  className={`absolute left-0 right-0 border-b border-slate-700 bg-slate-900 cursor-pointer hover:bg-slate-800 transition ${
                     selectedTrackId === track.id ? "bg-blue-900" : ""
                  }`}
               >
                  {/* Track items */}
                  {track.items.map((item, itemIdx) => {
                     const isSelected =
                        selectedItemTrackId === track.id &&
                        selectedItemIndex === itemIdx;
                     return (
                        <TimelineClipItem
                           key={`${track.id}-${itemIdx}`}
                           item={item}
                           pxPerSecond={pxPerSecond}
                           trackHeight={trackHeight}
                           isSelected={isSelected}
                           onMouseDownMove={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "move",
                              )
                           }
                           onMouseDownTrimLeft={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "trimLeft",
                              )
                           }
                           onMouseDownTrimRight={(e) =>
                              handleMouseDownOnItem(
                                 e,
                                 track.id,
                                 itemIdx,
                                 "trimRight",
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
   const width = Math.max(40, (item.position + 0.1) * pxPerSecond - left); // minimum width for visibility
   const crossfadeWidth = item.crossfadePrev * pxPerSecond;

   return (
      <div
         onClick={onSelect}
         style={{
            left,
            top: 4,
            width,
            height: trackHeight - 8,
         }}
         className={`absolute rounded cursor-move transition ${
            isSelected
               ? "bg-blue-600 border-2 border-blue-400 shadow-lg shadow-blue-500/50"
               : "bg-indigo-700 border border-indigo-600 hover:bg-indigo-600"
         }`}
         onMouseDown={onMouseDownMove}
      >
         {/* Crossfade overlap visualization */}
         {crossfadeWidth > 0 && (
            <div
               style={{ width: Math.min(crossfadeWidth, width) }}
               className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-500/30 to-transparent rounded-l"
            />
         )}

         {/* Content */}
         <div className="px-2 py-1 truncate text-xs text-white font-medium">
            Clip {item.volume.toFixed(2)}x
         </div>

         {/* Trim handles */}
         <div
            style={{ width: 4 }}
            className="absolute inset-y-0 left-0 bg-blue-400 cursor-col-resize hover:bg-yellow-400 rounded-l opacity-0 hover:opacity-100 transition"
            onMouseDown={onMouseDownTrimLeft}
         />
         <div
            style={{ width: 4 }}
            className="absolute inset-y-0 right-0 bg-blue-400 cursor-col-resize hover:bg-yellow-400 rounded-r opacity-0 hover:opacity-100 transition"
            onMouseDown={onMouseDownTrimRight}
         />

         {/* Delete button */}
         <button
            onClick={(e) => {
               e.stopPropagation();
               onRemove();
            }}
            className="absolute top-1 right-1 p-1 bg-red-600 rounded hover:bg-red-700 opacity-0 group-hover:opacity-100 transition"
         >
            <Trash2 size={12} />
         </button>
      </div>
   );
}
