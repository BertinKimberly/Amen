import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Trash2, Plus, Edit2, Copy, Volume2, VolumeX } from "lucide-react";
import type { StudioTrack, StudioTimelineItem, StudioClip } from "../lib/studioTypes";
import { itemEffectiveDuration } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";
import { createTimeAxis, pickNiceInterval } from "../lib/timeAxis";
import { colorForSource } from "../lib/studioColors";
import { ClipEditDialog } from "./ClipEditDialog";
import { appConfirm } from "../stores/uiDialog";

const MIN_ITEM_DURATION = 0.1; // seconds — floor so trim can never invert a clip
const HEADER_WIDTH = 176; // fixed track-header column width (never scrolls away)
const TRACK_HEIGHT = 88;
const SNAP_PX = 10; // pointer-pixel threshold for snapping

export interface ExternalClipDrag {
   clipId: string;
   name: string;
   clientX: number;
   clientY: number;
}

export interface DropHover {
   trackId: string;
   position: number;
   snapped: boolean;
}

interface TimelineProps {
   tracks: StudioTrack[];
   clips: StudioClip[];
   duration: number;
   selectedTrackId?: string | null;
   selectedItemTrackId?: string | null;
   selectedItemIndex?: number | null;
   onMoveItem?: (trackId: string, index: number, newPosition: number, recordHistory?: boolean) => void;
   onRemoveItem?: (trackId: string, index: number) => void;
   onDuplicateItem?: (trackId: string, index: number) => void;
   onSelectItem?: (trackId: string, index: number) => void;
   onSelectTrack?: (trackId: string) => void;
   onAddTrack?: () => void;
   onRemoveTrack?: (trackId: string) => void;
   onUpdateItem?: (trackId: string, index: number, updates: Partial<StudioTimelineItem>, recordHistory?: boolean) => void;
   /** Called once at the start of a move/trim drag gesture, before any live update — lets the store snapshot undo history exactly once per gesture instead of once per pointermove. */
   onBeginItemEdit?: () => void;
   /** Split the selected timeline item into two at the given absolute timeline position. */
   onSplitItem?: (trackId: string, index: number, atTime: number) => void;
   onToggleMute?: (trackId: string, muted: boolean) => void;
   onToggleSolo?: (trackId: string, solo: boolean) => void;
   playhead?: number;
   /** A clip being dragged in from the library via pointer events (not native HTML5 DnD). */
   externalDrag?: ExternalClipDrag | null;
   /** Called whenever the hovered drop target changes while `externalDrag` is active. */
   onExternalHoverChange?: (hover: DropHover | null) => void;
}

/** Snap `time` to the nearest candidate within `thresholdTime`, else return it unchanged. */
function applySnap(time: number, candidates: number[], thresholdTime: number): { value: number; snapped: boolean } {
   let best = time;
   let bestDist = thresholdTime;
   let snapped = false;
   for (const c of candidates) {
      const d = Math.abs(c - time);
      if (d <= bestDist) {
         bestDist = d;
         best = c;
         snapped = true;
      }
   }
   return { value: best, snapped };
}

/**
 * The Studio's professional editing timeline:
 * - A fixed, always-visible track-header column (name, mute/solo, delete) —
 *   never scrolls out of view horizontally, like every real DAW/NLE.
 * - A ruler with adaptive major/minor ticks and a matching background grid.
 * - Pointer-based drag-in from the clip library, move, and trim, all with
 *   intelligent snapping to the grid, the playhead, and neighboring clip
 *   edges — with a live time tooltip while dragging/trimming.
 * - Per-source clip coloring so composition structure reads at a glance.
 */
export function Timeline({
   tracks,
   clips,
   duration,
   selectedTrackId,
   selectedItemTrackId,
   selectedItemIndex,
   onMoveItem,
   onRemoveItem,
   onDuplicateItem,
   onSelectItem,
   onSelectTrack,
   onAddTrack,
   onRemoveTrack,
   onUpdateItem,
   onToggleMute,
   onToggleSolo,
   onBeginItemEdit,
   onSplitItem,
   playhead = 0,
   externalDrag = null,
   onExternalHoverChange,
}: TimelineProps) {
   const containerRef = useRef<HTMLDivElement>(null);
   const headerColRef = useRef<HTMLDivElement>(null);
   const [pxPerSecond, setPxPerSecond] = useState(60);
   const [scrollLeft, setScrollLeft] = useState(0);
   const didAutoFit = useRef(false);

   // Drag state for moving/trimming existing items (pointer-based).
   const [dragState, setDragState] = useState<{
      trackId: string;
      index: number;
      type: "move" | "trimLeft" | "trimRight";
      startClientX: number;
      startPosition: number;
      rawClipDuration: number;
      origTrimStart: number;
      origTrimEnd: number;
      liveTime: number; // current position/duration feedback, for the tooltip
   } | null>(null);

   // Drop target for clips dragged in from the library.
   const [dropTarget, setDropTarget] = useState<DropHover | null>(null);

   // Edit dialog state
   const [editDialogOpen, setEditDialogOpen] = useState(false);
   const [editingItem, setEditingItem] = useState<{ trackId: string; index: number; item: StudioTimelineItem; clip: StudioClip } | null>(null);

   const minDuration = Math.max(duration, 60); // at least 60s visible
   const totalWidth = minDuration * pxPerSecond;

   // The timeline works in raw content-pixel space (native browser scrolling
   // moves the viewport, not our own pan offset), so the axis offset is
   // always 0 — the single authoritative model still lives in timeAxis.ts,
   // shared with the waveform view, which DOES use a non-zero offset (manual
   // pan) for its own coordinate space.
   const axis = createTimeAxis(pxPerSecond, 0);
   const pixelToTime = useCallback((px: number) => axis.toTime(px), [axis]);
   const timeToPixel = useCallback((time: number) => axis.toPixel(time), [axis]);

   // Default zoom: most audio is a few minutes long, so show ~5 minutes of
   // useful context by default instead of opening on a nearly-empty 60s view
   // (or, for short clips, the whole thing). Runs once, on first real content.
   useEffect(() => {
      if (didAutoFit.current || !containerRef.current) return;
      const viewWidth = containerRef.current.clientWidth;
      if (viewWidth <= 0) return;
      const targetSeconds = Math.min(Math.max(duration, 30), 300);
      const target = (viewWidth * 0.92) / targetSeconds;
      setPxPerSecond(Math.max(8, Math.min(200, target)));
      didAutoFit.current = true;
   }, [duration]);

   // Track horizontal scroll; mirror it onto the fixed header column's own
   // (hidden) vertical scroll so headers stay aligned with their track rows.
   useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const handleScroll = () => {
         setScrollLeft(container.scrollLeft);
         if (headerColRef.current) headerColRef.current.scrollTop = container.scrollTop;
      };
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
   }, []);

   // Auto-scroll to keep playhead visible during playback
   useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const playheadX = timeToPixel(playhead);
      const viewportWidth = container.clientWidth;
      const currentScroll = container.scrollLeft;
      const playheadRelativeToView = playheadX - currentScroll;
      const leftBoundary = viewportWidth * 0.2;
      const rightBoundary = viewportWidth * 0.8;
      if (playheadRelativeToView < leftBoundary) {
         container.scrollLeft = Math.max(0, playheadX - viewportWidth * 0.3);
      } else if (playheadRelativeToView > rightBoundary) {
         container.scrollLeft = playheadX - viewportWidth * 0.7;
      }
   }, [playhead, pxPerSecond, timeToPixel]);

   // Every item's start/end time, tagged with its origin so a dragged clip
   // never snaps to its own (stale) edges.
   const allItemEdges = useMemo(() => {
      const edges: { trackId: string; index: number; start: number; end: number }[] = [];
      for (const track of tracks) {
         track.items.forEach((item, index) => {
            const clip = clips.find((c) => c.id === item.clipId);
            if (!clip) return;
            const dur = itemEffectiveDuration(item, clip);
            edges.push({ trackId: track.id, index, start: item.position, end: item.position + dur });
         });
      }
      return edges;
   }, [tracks, clips]);

   const snapThresholdTime = SNAP_PX / pxPerSecond;
   const rulerInterval = pickNiceInterval(
      containerRef.current ? containerRef.current.clientWidth / pxPerSecond : minDuration,
      containerRef.current?.clientWidth || 800,
   );

   const snapCandidatesFor = useCallback(
      (excludeTrackId: string, excludeIndex: number) => {
         const edges: number[] = [0, playhead];
         for (const e of allItemEdges) {
            if (e.trackId === excludeTrackId && e.index === excludeIndex) continue;
            edges.push(e.start, e.end);
         }
         return edges;
      },
      [allItemEdges, playhead],
   );

   // ---- External drag (clip library -> timeline), pointer-based ------------
   useEffect(() => {
      if (!externalDrag || !containerRef.current) {
         if (dropTarget !== null) setDropTarget(null);
         onExternalHoverChange?.(null);
         return;
      }
      const trackEls = containerRef.current.querySelectorAll<HTMLElement>('[data-testid="timeline-track"]');
      let hover: DropHover | null = null;
      for (const el of Array.from(trackEls)) {
         const r = el.getBoundingClientRect();
         if (externalDrag.clientY >= r.top && externalDrag.clientY <= r.bottom) {
            const trackId = el.dataset.trackId || "";
            const raw = Math.max(0, pixelToTime(externalDrag.clientX - r.left));
            const { value, snapped } = applySnap(raw, snapCandidatesFor(trackId, -1), snapThresholdTime);
            hover = { trackId, position: value, snapped };
            break;
         }
      }
      setDropTarget(hover);
      onExternalHoverChange?.(hover);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [externalDrag?.clientX, externalDrag?.clientY, pxPerSecond, scrollLeft]);

   // ---- Move / trim existing items, pointer-based with window listeners ----
   useEffect(() => {
      if (!dragState) return;

      const handleMove = (e: PointerEvent) => {
         const deltaX = e.clientX - dragState.startClientX;
         const deltaTime = pixelToTime(deltaX);

         if (dragState.type === "move" && onMoveItem) {
            const raw = Math.max(0, dragState.startPosition + deltaTime);
            const { value, snapped } = applySnap(raw, snapCandidatesFor(dragState.trackId, dragState.index), snapThresholdTime);
            onMoveItem(dragState.trackId, dragState.index, value, false);
            setDragState((s) => (s ? { ...s, liveTime: value } : s));
            void snapped;
         } else if (dragState.type === "trimLeft" && onUpdateItem) {
            const maxTrimStart = Math.max(
               0,
               dragState.rawClipDuration - dragState.origTrimEnd - MIN_ITEM_DURATION,
            );
            const newTrimStart = Math.max(0, Math.min(maxTrimStart, dragState.origTrimStart + deltaTime));
            const actualDelta = newTrimStart - dragState.origTrimStart;
            const newPosition = Math.max(0, dragState.startPosition + actualDelta);
            onUpdateItem(dragState.trackId, dragState.index, {
               trimStart: newTrimStart,
               position: newPosition,
            }, false);
            setDragState((s) => (s ? { ...s, liveTime: dragState.rawClipDuration - newTrimStart - dragState.origTrimEnd } : s));
         } else if (dragState.type === "trimRight" && onUpdateItem) {
            const maxTrimEnd = Math.max(
               0,
               dragState.rawClipDuration - dragState.origTrimStart - MIN_ITEM_DURATION,
            );
            const newTrimEnd = Math.max(0, Math.min(maxTrimEnd, dragState.origTrimEnd - deltaTime));
            onUpdateItem(dragState.trackId, dragState.index, { trimEnd: newTrimEnd }, false);
            setDragState((s) => (s ? { ...s, liveTime: dragState.rawClipDuration - dragState.origTrimStart - newTrimEnd } : s));
         }
      };
      const handleUp = () => setDragState(null);

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
      return () => {
         window.removeEventListener("pointermove", handleMove);
         window.removeEventListener("pointerup", handleUp);
         window.removeEventListener("pointercancel", handleUp);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [dragState?.trackId, dragState?.index, dragState?.type, pixelToTime, onMoveItem, onUpdateItem, snapCandidatesFor, snapThresholdTime]);

   // Select track on click (but not on items)
   const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>, trackId: string) => {
      if (e.target === e.currentTarget) {
         onSelectTrack?.(trackId);
      }
   };

   // Start dragging/trimming an existing item
   const beginItemDrag = (
      e: React.PointerEvent,
      trackId: string,
      index: number,
      type: "move" | "trimLeft" | "trimRight",
      item: StudioTimelineItem,
      rawClipDuration: number,
   ) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectItem?.(trackId, index);
      onBeginItemEdit?.();
      const initialLive =
         type === "move"
            ? item.position
            : rawClipDuration - (item.trimStart ?? 0) - (item.trimEnd ?? 0);
      setDragState({
         trackId,
         index,
         type,
         startClientX: e.clientX,
         startPosition: item.position,
         rawClipDuration,
         origTrimStart: item.trimStart ?? 0,
         origTrimEnd: item.trimEnd ?? 0,
         liveTime: initialLive,
      });
   };

   // Zoom controls
   const zoomIn = () => setPxPerSecond((prev) => Math.min(200, prev * 1.4));
   const zoomOut = () => setPxPerSecond((prev) => Math.max(8, prev / 1.4));
   const fitToView = () => {
      if (containerRef.current) {
         const viewWidth = containerRef.current.clientWidth;
         const targetPx = (viewWidth * 0.94) / minDuration;
         setPxPerSecond(Math.max(8, Math.min(200, targetPx)));
         containerRef.current.scrollLeft = 0;
      }
   };

   // Open edit dialog for a clip
   const openEditDialog = (trackId: string, index: number) => {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) return;
      const item = track.items[index];
      if (!item) return;
      const clip = clips.find((c) => c.id === item.clipId);
      if (!clip) return;
      setEditingItem({ trackId, index, item, clip });
      setEditDialogOpen(true);
   };

   // Ruler + grid tick list, shared between the ruler row and the background grid.
   const ticks = useMemo(() => {
      const majors: number[] = [];
      const minors: number[] = [];
      const minorStep = rulerInterval / 5;
      for (let t = 0; t <= minDuration + rulerInterval; t += rulerInterval) majors.push(t);
      if (minorStep * pxPerSecond >= 6) {
         for (let t = 0; t <= minDuration + rulerInterval; t += minorStep) {
            if (majors.some((m) => Math.abs(m - t) < 1e-6)) continue;
            minors.push(t);
         }
      }
      return { majors, minors };
   }, [rulerInterval, minDuration, pxPerSecond]);

   const anySolo = tracks.some((t) => t.solo);

   // Split is only meaningful when the selected item actually spans the
   // current playhead, with enough room on both sides for two real pieces.
   const selectedItemEdge =
      selectedItemTrackId !== null && selectedItemIndex !== null
         ? allItemEdges.find((e) => e.trackId === selectedItemTrackId && e.index === selectedItemIndex)
         : undefined;
   const canSplit =
      !!selectedItemEdge &&
      playhead > selectedItemEdge.start + 0.05 &&
      playhead < selectedItemEdge.end - 0.05;

   return (
      <div className="flex flex-col gap-2.5 h-full min-h-0">
         {/* Timeline toolbar */}
         <div className="flex items-center justify-between shrink-0">
            <h3 className="font-semibold text-[13px] flex items-center gap-2 text-studio-text">
               Timeline
               <span className="text-[11px] text-studio-text-muted font-normal">
                  {tracks.length} track{tracks.length !== 1 ? "s" : ""}
               </span>
            </h3>
            <div className="flex items-center gap-1.5">
               <div className="flex items-center rounded-md border border-studio-border bg-studio-panel overflow-hidden">
                  <button
                     onClick={zoomOut}
                     className="px-2.5 py-1 hover:bg-studio-raised transition text-[13px] text-studio-text-muted hover:text-studio-text"
                     title="Zoom out"
                     data-testid="timeline-zoom-out"
                  >
                     −
                  </button>
                  <div className="w-px h-4 bg-studio-border" />
                  <button
                     onClick={zoomIn}
                     className="px-2.5 py-1 hover:bg-studio-raised transition text-[13px] text-studio-text-muted hover:text-studio-text"
                     title="Zoom in"
                     data-testid="timeline-zoom-in"
                  >
                     +
                  </button>
               </div>
               <button
                  onClick={fitToView}
                  className="px-2.5 py-1 rounded-md border border-studio-border bg-studio-panel hover:bg-studio-raised transition text-[11px] font-medium text-studio-text-muted hover:text-studio-text"
                  title="Fit to view"
                  data-testid="timeline-fit"
               >
                  Fit
               </button>
               <div className="w-px h-4 bg-studio-border mx-0.5" />
               <button
                  onClick={() => {
                     if (canSplit && selectedItemTrackId != null && selectedItemIndex != null) {
                        onSplitItem?.(selectedItemTrackId, selectedItemIndex, playhead);
                     }
                  }}
                  disabled={!canSplit}
                  className="px-2.5 py-1 rounded-md border border-studio-border bg-studio-panel hover:bg-studio-raised transition text-[11px] font-medium text-studio-text-muted hover:text-studio-text disabled:opacity-30 disabled:hover:bg-studio-panel"
                  title="Split the selected clip at the playhead (S)"
                  data-testid="timeline-split"
               >
                  Split
               </button>
               <div className="w-px h-4 bg-studio-border mx-0.5" />
               <button
                  onClick={onAddTrack}
                  className="rounded-md bg-studio-accent hover:brightness-110 transition text-[11px] font-medium flex items-center gap-1 px-2.5 py-1 text-white shadow-sm shadow-studio-accent/30"
                  title="Add track"
                  data-testid="add-track"
               >
                  <Plus size={13} />
                  Track
               </button>
            </div>
         </div>

         {/* Timeline body: fixed header column + scrollable content */}
         <div className="flex flex-1 min-h-0 rounded-xl border border-studio-border overflow-hidden bg-studio-canvas">
            {/* Fixed track-header column — never scrolls horizontally */}
            <div
               ref={headerColRef}
               className="shrink-0 overflow-hidden bg-studio-panel border-r border-studio-border"
               style={{ width: HEADER_WIDTH }}
            >
               <div className="h-8 border-b border-studio-border flex items-center px-3 text-[10px] uppercase tracking-wide text-studio-text-faint font-medium">
                  Tracks
               </div>
               <div style={{ height: Math.max(tracks.length * TRACK_HEIGHT, 1) }}>
                  {tracks.map((track) => (
                     <div
                        key={track.id}
                        data-testid="track-header"
                        data-track-id={track.id}
                        style={{ height: TRACK_HEIGHT }}
                        className={`flex flex-col justify-center gap-1.5 px-3 border-b border-studio-border-soft transition ${
                           selectedTrackId === track.id ? "bg-studio-raised" : ""
                        }`}
                     >
                        <div className="flex items-center justify-between gap-1">
                           <span className="text-[12px] font-medium text-studio-text truncate">{track.name}</span>
                           {tracks.length > 1 && (
                              <button
                                 onClick={async (e) => {
                                    e.stopPropagation();
                                    if (await appConfirm(`Delete ${track.name}?`)) {
                                       onRemoveTrack?.(track.id);
                                    }
                                 }}
                                 className="p-1 -m-1 rounded text-studio-text-faint hover:text-studio-danger hover:bg-studio-danger/10 transition"
                                 title="Delete track"
                              >
                                 <Trash2 size={11} />
                              </button>
                           )}
                        </div>
                        <div className="flex items-center gap-1">
                           <button
                              onClick={() => onToggleMute?.(track.id, !track.muted)}
                              title={track.muted ? "Unmute track" : "Mute track"}
                              data-testid="track-mute"
                              className={`flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold transition ${
                                 track.muted
                                    ? "bg-studio-danger/20 text-studio-danger"
                                    : "bg-studio-raised text-studio-text-faint hover:text-studio-text"
                              }`}
                           >
                              {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                           </button>
                           <button
                              onClick={() => onToggleSolo?.(track.id, !track.solo)}
                              title={track.solo ? "Unsolo track" : "Solo track"}
                              data-testid="track-solo"
                              className={`flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold transition ${
                                 track.solo
                                    ? "bg-studio-snap/20 text-studio-snap"
                                    : "bg-studio-raised text-studio-text-faint hover:text-studio-text"
                              }`}
                           >
                              S
                           </button>
                           {track.items.length === 0 && (
                              <span className="text-[10px] text-studio-text-faint italic ml-0.5">empty</span>
                           )}
                        </div>
                     </div>
                  ))}
                  {tracks.length === 0 && (
                     <div className="flex items-center justify-center h-full text-[11px] text-studio-text-faint px-3 text-center">
                        No tracks
                     </div>
                  )}
               </div>
            </div>

            {/* Scrollable ruler + track lanes */}
            <div
               ref={containerRef}
               data-testid="timeline-container"
               data-px-per-second={pxPerSecond}
               className="relative flex-1 overflow-auto"
            >
               {/* Ruler */}
               <div
                  className="sticky top-0 z-20 h-8 bg-studio-panel border-b border-studio-border"
                  style={{ minWidth: totalWidth }}
                  data-testid="timeline-ruler"
               >
                  {ticks.minors.map((t) => (
                     <div
                        key={`mn-${t}`}
                        style={{ position: "absolute", left: timeToPixel(t), top: 20, height: 8 }}
                        className="w-px bg-studio-border"
                     />
                  ))}
                  {ticks.majors.map((t) => (
                     <div
                        key={`mj-${t}`}
                        style={{ position: "absolute", left: timeToPixel(t) }}
                        className="h-full flex flex-col justify-end pb-1"
                     >
                        <div className="w-px h-2.5 bg-studio-text-faint" />
                        <span className="absolute bottom-1 left-1.5 text-[10px] tabular-nums text-studio-text-muted whitespace-nowrap">
                           {formatTime(t)}
                        </span>
                     </div>
                  ))}
               </div>

               {/* Tracks container */}
               <div className="relative" style={{ minWidth: totalWidth, minHeight: Math.max(tracks.length * TRACK_HEIGHT, 120) }}>
                  {/* Background grid, aligned to the ruler */}
                  <div className="absolute inset-0 pointer-events-none">
                     {ticks.minors.map((t) => (
                        <div key={`gmn-${t}`} style={{ left: timeToPixel(t) }} className="absolute top-0 bottom-0 w-px bg-studio-grid-minor" />
                     ))}
                     {ticks.majors.map((t) => (
                        <div key={`gmj-${t}`} style={{ left: timeToPixel(t) }} className="absolute top-0 bottom-0 w-px bg-studio-grid-major" />
                     ))}
                  </div>

                  {/* Playhead */}
                  {playhead >= 0 && (
                     <div
                        data-testid="timeline-playhead"
                        style={{ left: timeToPixel(playhead), height: Math.max(tracks.length * TRACK_HEIGHT, 120) }}
                        className="absolute top-0 w-px bg-studio-playhead pointer-events-none z-10 shadow-[0_0_8px_rgba(255,84,112,0.6)]"
                     >
                        <div className="absolute -top-0 -left-[5px] w-[11px] h-[9px] bg-studio-playhead" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
                     </div>
                  )}

                  {/* Tracks */}
                  {tracks.length === 0 ? (
                     <div className="absolute inset-0 flex items-center justify-center text-studio-text-muted text-sm">
                        <div className="text-center">
                           <div className="mb-2">No tracks yet</div>
                           <button onClick={onAddTrack} className="text-studio-accent hover:brightness-125 underline underline-offset-2">
                              Add your first track
                           </button>
                        </div>
                     </div>
                  ) : (
                     tracks.map((track, trackIdx) => {
                        const inactive = track.muted || (anySolo && !track.solo);
                        return (
                           <div
                              key={track.id}
                              onClick={(e) => handleTrackClick(e, track.id)}
                              data-testid="timeline-track"
                              data-track-id={track.id}
                              style={{ top: trackIdx * TRACK_HEIGHT, height: TRACK_HEIGHT, minWidth: totalWidth }}
                              className={`absolute left-0 right-0 border-b border-studio-border-soft cursor-pointer transition ${
                                 dropTarget?.trackId === track.id
                                    ? "bg-studio-accent/10"
                                    : selectedTrackId === track.id
                                    ? "bg-white/[0.03]"
                                    : "hover:bg-white/[0.015]"
                              } ${inactive ? "opacity-40" : ""}`}
                           >
                              {track.items.length === 0 && dropTarget?.trackId !== track.id && (
                                 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-studio-text-faint italic pointer-events-none select-none">
                                    Drop a clip here
                                 </span>
                              )}

                              {/* Drop position indicator */}
                              {dropTarget?.trackId === track.id && (
                                 <div
                                    data-testid="drop-indicator"
                                    style={{ left: timeToPixel(dropTarget.position) }}
                                    className={`absolute top-0 bottom-0 w-0.5 pointer-events-none z-30 ${
                                       dropTarget.snapped ? "bg-studio-snap shadow-[0_0_10px_rgba(255,209,102,0.7)]" : "bg-studio-accent-strong shadow-[0_0_10px_rgba(110,161,255,0.6)]"
                                    }`}
                                 >
                                    <div
                                       className={`absolute top-1/2 -translate-y-1/2 -left-[5px] w-[11px] h-[11px] rotate-45 ${
                                          dropTarget.snapped ? "bg-studio-snap" : "bg-studio-accent-strong"
                                       }`}
                                    />
                                    <div className="absolute -top-6 left-1.5 whitespace-nowrap text-[10px] font-mono bg-studio-raised border border-studio-border rounded px-1.5 py-0.5 text-studio-text">
                                       {formatTime(dropTarget.position)}
                                    </div>
                                 </div>
                              )}

                              {/* Track items */}
                              {track.items.map((item, itemIdx) => {
                                 const clip = clips.find((c) => c.id === item.clipId);
                                 if (!clip) return null;
                                 const rawClipDuration = clip.end - clip.start;
                                 const clipDuration = itemEffectiveDuration(item, clip);
                                 const isDraggingThis = dragState?.trackId === track.id && dragState?.index === itemIdx;

                                 return (
                                    <TimelineClipItem
                                       key={`${track.id}-${itemIdx}`}
                                       item={item}
                                       clip={clip}
                                       clipDuration={clipDuration}
                                       pxPerSecond={pxPerSecond}
                                       trackHeight={TRACK_HEIGHT}
                                       isSelected={selectedItemTrackId === track.id && selectedItemIndex === itemIdx}
                                       isDragging={isDraggingThis}
                                       dragType={isDraggingThis ? dragState!.type : null}
                                       dragLiveTime={isDraggingThis ? dragState!.liveTime : 0}
                                       onPointerDownMove={(e) => beginItemDrag(e, track.id, itemIdx, "move", item, rawClipDuration)}
                                       onPointerDownTrimLeft={(e) => beginItemDrag(e, track.id, itemIdx, "trimLeft", item, rawClipDuration)}
                                       onPointerDownTrimRight={(e) => beginItemDrag(e, track.id, itemIdx, "trimRight", item, rawClipDuration)}
                                       onRemove={async () => {
                                          if (await appConfirm(`Remove "${clip.name}" from timeline?`)) {
                                             onRemoveItem?.(track.id, itemIdx);
                                          }
                                       }}
                                       onDuplicate={() => onDuplicateItem?.(track.id, itemIdx)}
                                       onSelect={() => onSelectItem?.(track.id, itemIdx)}
                                       onEdit={() => openEditDialog(track.id, itemIdx)}
                                    />
                                 );
                              })}
                           </div>
                        );
                     })
                  )}
               </div>
            </div>
         </div>

         {/* Edit dialog */}
         <ClipEditDialog
            open={editDialogOpen}
            onClose={() => {
               setEditDialogOpen(false);
               setEditingItem(null);
            }}
            item={editingItem?.item ?? null}
            clip={editingItem?.clip ?? null}
            onUpdate={(updates) => {
               if (editingItem) {
                  onUpdateItem?.(editingItem.trackId, editingItem.index, updates);
               }
            }}
         />
      </div>
   );
}

interface TimelineClipItemProps {
   item: StudioTimelineItem;
   clip: StudioClip;
   clipDuration: number;
   pxPerSecond: number;
   trackHeight: number;
   isSelected: boolean;
   isDragging: boolean;
   dragType: "move" | "trimLeft" | "trimRight" | null;
   dragLiveTime: number;
   onPointerDownMove: (e: React.PointerEvent) => void;
   onPointerDownTrimLeft: (e: React.PointerEvent) => void;
   onPointerDownTrimRight: (e: React.PointerEvent) => void;
   onRemove: () => void;
   onDuplicate: () => void;
   onSelect: () => void;
   onEdit: () => void;
}

function TimelineClipItem({
   item,
   clip,
   clipDuration,
   pxPerSecond,
   trackHeight,
   isSelected,
   isDragging,
   dragType,
   dragLiveTime,
   onPointerDownMove,
   onPointerDownTrimLeft,
   onPointerDownTrimRight,
   onRemove,
   onDuplicate,
   onSelect,
   onEdit,
}: TimelineClipItemProps) {
   const left = item.position * pxPerSecond;
   const width = Math.max(36, clipDuration * pxPerSecond);
   const crossfadeWidth = (item.crossfadePrev ?? 0) * pxPerSecond;
   const color = colorForSource(clip.sourceId);

   return (
      <div
         onClick={(e) => {
            e.stopPropagation();
            onSelect();
         }}
         onPointerDown={onPointerDownMove}
         data-testid="timeline-clip"
         data-clip-name={clip.name}
         style={{ left, top: 10, width, height: trackHeight - 20 }}
         className={`absolute rounded-lg cursor-grab active:cursor-grabbing transition-shadow group touch-none bg-linear-to-b ${color.from} ${color.to} border ${
            isDragging
               ? `${color.ring} shadow-2xl scale-[1.02] z-50 ring-2 ring-white/30`
               : isSelected
               ? "border-2 border-white/70 shadow-lg z-20"
               : `${color.ring}/70 shadow-md hover:shadow-lg hover:brightness-110 z-10`
         }`}
      >
         {/* Decorative content texture — hints at audio without a full waveform fetch */}
         <div
            className="absolute inset-0 rounded-lg opacity-25 pointer-events-none mix-blend-overlay"
            style={{
               backgroundImage:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 5px)",
            }}
         />

         {/* Crossfade overlap visualization */}
         {crossfadeWidth > 0 && (
            <div
               style={{ width: Math.min(crossfadeWidth, width) }}
               className="absolute inset-y-0 left-0 bg-linear-to-r from-amber-300/50 to-transparent rounded-l-lg pointer-events-none"
            />
         )}
         {item.fadeIn > 0 && (
            <div
               style={{ width: Math.min(item.fadeIn * pxPerSecond, width * 0.4) }}
               className="absolute inset-y-0 left-0 bg-linear-to-r from-black/35 to-transparent pointer-events-none"
            />
         )}
         {item.fadeOut > 0 && (
            <div
               style={{ width: Math.min(item.fadeOut * pxPerSecond, width * 0.4) }}
               className="absolute inset-y-0 right-0 bg-linear-to-l from-black/35 to-transparent pointer-events-none"
            />
         )}

         {/* Content */}
         <div className="px-2 py-1 truncate text-[11px] text-white font-medium pointer-events-none flex items-center justify-between relative">
            <span className="truncate drop-shadow-sm">{clip.name}</span>
            <div className="flex items-center gap-1 text-[9px] opacity-90 ml-2 shrink-0">
               {item.volume !== 1 && <span>{Math.round(item.volume * 100)}%</span>}
               {item.muted && <span>[M]</span>}
            </div>
         </div>
         <div className="px-2 text-[9px] text-white/70 pointer-events-none tabular-nums">{formatTime(clipDuration)}</div>

         {/* Live drag/trim tooltip */}
         {isDragging && dragType && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono bg-studio-raised border border-studio-border rounded px-2 py-0.5 text-studio-text shadow-lg z-50">
               {dragType === "move" ? `${formatTime(item.position)}` : `${formatTime(dragLiveTime)}`}
            </div>
         )}

         {/* Duplicate button */}
         <button
            onClick={(e) => {
               e.stopPropagation();
               onDuplicate();
            }}
            className="absolute top-1 right-11 p-1 bg-black/40 rounded opacity-0 group-hover:opacity-100 hover:bg-black/60 transition z-20"
            title="Duplicate on timeline"
         >
            <Copy size={10} className="text-white" />
         </button>
         <button
            onClick={(e) => {
               e.stopPropagation();
               onEdit();
            }}
            className="absolute top-1 right-6 p-1 bg-black/40 rounded opacity-0 group-hover:opacity-100 hover:bg-black/60 transition z-20"
            title="Edit clip (volume, fades, crossfade)"
         >
            <Edit2 size={10} className="text-white" />
         </button>
         <button
            onClick={(e) => {
               e.stopPropagation();
               onRemove();
            }}
            className="absolute top-1 right-1 p-1 bg-red-600/90 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500 transition z-20"
            title="Remove from timeline"
         >
            <Trash2 size={10} className="text-white" />
         </button>

         {/* Trim handles — real, functional drag targets */}
         <div
            onPointerDown={(e) => {
               e.stopPropagation();
               onPointerDownTrimLeft(e);
            }}
            data-testid="trim-handle-left"
            className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize rounded-l-lg opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/40 transition touch-none z-10"
            title="Trim start"
         />
         <div
            onPointerDown={(e) => {
               e.stopPropagation();
               onPointerDownTrimRight(e);
            }}
            data-testid="trim-handle-right"
            className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize rounded-r-lg opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/40 transition touch-none z-10"
            title="Trim end"
         />
      </div>
   );
}
