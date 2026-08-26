import { useEffect, useRef, useState, useCallback } from "react";
import type { WaveformData, StudioMarker } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";
import { createTimeAxis, pickNiceInterval } from "../lib/timeAxis";
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";

interface WaveformViewProps {
   waveform: WaveformData | null;
   duration: number;
   selectionStart?: number | null;
   selectionEnd?: number | null;
   onSelectionChange?: (start: number, end: number) => void;
   onSeek?: (time: number) => void;
   playhead?: number;
   markers?: StudioMarker[];
}

// Studio canvas palette — mirrors the `.studio-shell` CSS tokens (see
// styles.css). Canvas 2D fillStyle can't resolve `var(--...)` at draw time,
// so the values are kept here in lockstep with the token definitions.
const PALETTE = {
   bg: "#0d0d14",
   grid: "#24242f",
   gridMinor: "rgba(255,255,255,0.035)",
   center: "#2a2a38",
   label: "#8b8b9e",
   waveTop: "#6ea1ff",
   waveMid: "#8fc0ff",
   waveBottom: "#4f7ed6",
   selectionFill: "rgba(79, 140, 255, 0.16)",
   selectionEdge: "#6ea1ff",
   playhead: "#ff5470",
   marker: "#ffb454",
};

/**
 * Professional canvas-based waveform editor:
 * - Amplitude-based peak rendering with a signature gradient
 * - Zoom in/out/fit/reset, mouse-wheel zoom centered on the cursor
 * - Horizontal pan (shift+drag), click-to-seek, drag-to-select
 * - Shares its time<->pixel model with the Timeline (src/lib/timeAxis.ts)
 * - Selection start/end/duration surfaced both on-canvas and as text
 */
export function WaveformView({
   waveform,
   duration,
   selectionStart = null,
   selectionEnd = null,
   onSelectionChange,
   onSeek,
   playhead = 0,
   markers = [],
}: WaveformViewProps) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const containerRef = useRef<HTMLDivElement>(null);

   // Zoom state: pixels per second
   const [pxPerSecond, setPxPerSecond] = useState(0); // Will be set on mount
   const minZoom = 2; // 2px per second (very zoomed out - allows viewing hours)
   const maxZoom = 500; // 500px per second (very zoomed in)

   // Pan state: left edge time offset in seconds
   const [panX, setPanX] = useState(0);

   // Interaction state
   const [isDragging, setIsDragging] = useState(false);
   const [isPanning, setIsPanning] = useState(false);
   const [dragStart, setDragStart] = useState<number | null>(null);
   const [panStartX, setPanStartX] = useState(0);
   const [panStartOffset, setPanStartOffset] = useState(0);

   const canvasHeight = 132;

   // Calculate canvas width based on container
   const [canvasWidth, setCanvasWidth] = useState(800);

   // Tracks the container's real size continuously (not just on `window`
   // resize) — a flex-layout reflow (e.g. sibling panels changing size)
   // resizes this container without ever firing a window resize event, and
   // the default-zoom calc below must stay based on the CURRENT width or its
   // pixel<->time mapping silently drifts from what the drawn canvas has.
   useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
         const w = entries[0]?.contentRect.width;
         if (w) setCanvasWidth(w);
      });
      ro.observe(el);
      return () => ro.disconnect();
   }, []);

   // Set intelligent default zoom: most audio is a few minutes long, so show
   // ~5 minutes of useful context rather than the whole hour-long source
   // crushed into one screen, or a few seconds of a short clip. Keeps
   // recalculating as the container settles into its final layout size,
   // until the user takes an explicit zoom action (see autoZoomRef below) —
   // a one-shot calc against an intermediate width would silently disagree
   // with the width the canvas actually ends up rendered at.
   const autoZoomRef = useRef(true);
   useEffect(() => {
      if (!autoZoomRef.current || !waveform || canvasWidth <= 0) return;
      const audioDuration = waveform.duration;
      const targetViewSeconds = Math.min(audioDuration, 300);
      const initialZoom = (canvasWidth * 0.94) / targetViewSeconds;
      setPxPerSecond(Math.max(minZoom, Math.min(maxZoom, initialZoom)));
   }, [waveform, canvasWidth, minZoom, maxZoom]);

   // Fit entire audio to view
   const fitToView = useCallback(() => {
      if (!waveform) return;
      const audioDuration = waveform.duration;
      if (!audioDuration || audioDuration <= 0) return;
      autoZoomRef.current = false;
      const targetPxPerSecond = (canvasWidth * 0.96) / audioDuration;
      setPxPerSecond(Math.max(minZoom, Math.min(maxZoom, targetPxPerSecond)));
      setPanX(0);
   }, [waveform, canvasWidth, minZoom, maxZoom]);

   // Reset zoom to 1:1 (100px per second is a nice default)
   const resetZoom = useCallback(() => {
      autoZoomRef.current = false;
      setPxPerSecond(100);
      setPanX(0);
   }, []);

   const zoomIn = useCallback(() => {
      autoZoomRef.current = false;
      setPxPerSecond((prev) => Math.min(maxZoom, prev * 1.5));
   }, [maxZoom]);

   const zoomOut = useCallback(() => {
      autoZoomRef.current = false;
      setPxPerSecond((prev) => Math.max(minZoom, prev / 1.5));
   }, [minZoom]);

   // Single authoritative time<->pixel model (shared with the Timeline;
   // see src/lib/timeAxis.ts). The waveform's offset is its manual pan (panX)
   // rather than native scrolling.
   const axis = createTimeAxis(pxPerSecond, panX);
   const pixelToTime = useCallback((px: number) => axis.toTime(px), [axis]);
   const timeToPixel = useCallback((time: number) => axis.toPixel(time), [axis]);

   // Render waveform
   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !waveform) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Adaptive grid interval so labels never overlap (shared with the
      // Timeline's ruler — see src/lib/timeAxis.ts), with a minor sub-grid.
      const secondsVisible = canvasWidth / pxPerSecond;
      const gridInterval = pickNiceInterval(secondsVisible, canvasWidth);
      const minorInterval = gridInterval / 5;

      if (minorInterval * pxPerSecond >= 6) {
         ctx.strokeStyle = PALETTE.gridMinor;
         ctx.lineWidth = 1;
         for (let t = Math.floor(panX / minorInterval) * minorInterval; t <= panX + secondsVisible + minorInterval; t += minorInterval) {
            if (t < 0) continue;
            const px = Math.round(timeToPixel(t)) + 0.5;
            if (px < -10 || px > canvasWidth + 10) continue;
            ctx.beginPath();
            ctx.moveTo(px, 18);
            ctx.lineTo(px, canvasHeight);
            ctx.stroke();
         }
      }

      ctx.strokeStyle = PALETTE.grid;
      ctx.fillStyle = PALETTE.label;
      ctx.font = "10.5px system-ui, -apple-system, sans-serif";
      ctx.lineWidth = 1;
      for (let t = Math.floor(panX / gridInterval) * gridInterval; t <= panX + secondsVisible + gridInterval; t += gridInterval) {
         if (t < 0) continue;
         const px = Math.round(timeToPixel(t)) + 0.5;
         if (px >= -10 && px <= canvasWidth + 10) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvasHeight);
            ctx.stroke();
            ctx.textAlign = "left";
            ctx.fillText(formatTime(t), px + 4, 11);
         }
      }

      // Center line
      const centerY = canvasHeight / 2 + 8;
      ctx.strokeStyle = PALETTE.center;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvasWidth, centerY);
      ctx.stroke();

      // Visible peak range
      const visibleStartTime = panX;
      const visibleEndTime = panX + secondsVisible;
      const visibleStartBucket = Math.max(0, Math.floor(visibleStartTime * waveform.bucketsPerSecond));
      const visibleEndBucket = Math.min(
         waveform.peaks.length,
         Math.ceil(visibleEndTime * waveform.bucketsPerSecond)
      );

      const bucketDuration = 1 / waveform.bucketsPerSecond;
      const bucketWidth = pxPerSecond * bucketDuration;
      const scale = ((canvasHeight - 16) / 2) * 0.88;

      const gradient = ctx.createLinearGradient(0, centerY - scale, 0, centerY + scale);
      gradient.addColorStop(0, PALETTE.waveTop);
      gradient.addColorStop(0.5, PALETTE.waveMid);
      gradient.addColorStop(1, PALETTE.waveBottom);
      ctx.fillStyle = gradient;

      for (let i = visibleStartBucket; i < visibleEndBucket; i++) {
         const [min, max] = waveform.peaks[i];
         const bucketTime = i / waveform.bucketsPerSecond;
         const x = timeToPixel(bucketTime);
         if (x + bucketWidth < 0 || x > canvasWidth) continue;
         const y1 = centerY + min * scale;
         const y2 = centerY + max * scale;
         const height = Math.max(1, y2 - y1);
         ctx.fillRect(x, y1, Math.max(1, bucketWidth * 0.9), height);
      }

      // Selection highlight
      if (selectionStart !== null && selectionEnd !== null) {
         const sx = timeToPixel(selectionStart);
         const ex = timeToPixel(selectionEnd);

         if (ex > 0 && sx < canvasWidth) {
            ctx.fillStyle = PALETTE.selectionFill;
            ctx.fillRect(Math.max(0, sx), 18, Math.min(canvasWidth, ex) - Math.max(0, sx), canvasHeight - 18);

            ctx.strokeStyle = PALETTE.selectionEdge;
            ctx.lineWidth = 2;
            if (sx >= 0 && sx <= canvasWidth) {
               ctx.beginPath();
               ctx.moveTo(sx, 18);
               ctx.lineTo(sx, canvasHeight);
               ctx.stroke();
            }
            if (ex >= 0 && ex <= canvasWidth) {
               ctx.beginPath();
               ctx.moveTo(ex, 18);
               ctx.lineTo(ex, canvasHeight);
               ctx.stroke();
            }

            // On-canvas duration badge, centered in the selection.
            const dur = selectionEnd - selectionStart;
            const label = formatTime(dur);
            ctx.font = "600 11px system-ui, -apple-system, sans-serif";
            const labelWidth = ctx.measureText(label).width + 14;
            const midX = Math.max(labelWidth / 2, Math.min(canvasWidth - labelWidth / 2, (Math.max(0, sx) + Math.min(canvasWidth, ex)) / 2));
            ctx.fillStyle = "rgba(10,10,16,0.85)";
            const badgeY = 22;
            ctx.beginPath();
            const rectX = midX - labelWidth / 2;
            const radius = 5;
            ctx.moveTo(rectX + radius, badgeY);
            ctx.arcTo(rectX + labelWidth, badgeY, rectX + labelWidth, badgeY + 18, radius);
            ctx.arcTo(rectX + labelWidth, badgeY + 18, rectX, badgeY + 18, radius);
            ctx.arcTo(rectX, badgeY + 18, rectX, badgeY, radius);
            ctx.arcTo(rectX, badgeY, rectX + labelWidth, badgeY, radius);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = PALETTE.selectionEdge;
            ctx.textAlign = "center";
            ctx.fillText(label, midX, badgeY + 13);
         }
      }

      // Markers — user bookmarks, drawn as a flag at the top edge so they
      // never visually compete with the selection/playhead which span the
      // full height.
      for (const marker of markers) {
         const mx = timeToPixel(marker.time);
         if (mx < -10 || mx > canvasWidth + 10) continue;
         ctx.strokeStyle = PALETTE.marker;
         ctx.lineWidth = 1.5;
         ctx.beginPath();
         ctx.moveTo(mx, 0);
         ctx.lineTo(mx, canvasHeight);
         ctx.stroke();
         ctx.fillStyle = PALETTE.marker;
         ctx.beginPath();
         ctx.moveTo(mx, 0);
         ctx.lineTo(mx + 7, 0);
         ctx.lineTo(mx, 9);
         ctx.closePath();
         ctx.fill();
      }

      // Playhead
      const playheadX = timeToPixel(playhead);
      if (playheadX >= 0 && playheadX <= canvasWidth) {
         ctx.strokeStyle = PALETTE.playhead;
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.moveTo(playheadX, 0);
         ctx.lineTo(playheadX, canvasHeight);
         ctx.stroke();

         ctx.fillStyle = PALETTE.playhead;
         ctx.beginPath();
         ctx.moveTo(playheadX, 0);
         ctx.lineTo(playheadX - 5, 8);
         ctx.lineTo(playheadX + 5, 8);
         ctx.closePath();
         ctx.fill();
      }
   }, [
      waveform,
      canvasWidth,
      canvasHeight,
      pxPerSecond,
      panX,
      selectionStart,
      selectionEnd,
      playhead,
      markers,
      timeToPixel,
   ]);

   // Mouse wheel: zoom
   const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      autoZoomRef.current = false;
      const delta = e.deltaY > 0 ? 1 / 1.3 : 1.3;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, pxPerSecond * delta));

      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
         const mouseX = e.clientX - rect.left;
         const timeAtMouse = pixelToTime(mouseX);
         const newPanX = timeAtMouse - mouseX / newZoom;
         setPanX(Math.max(0, newPanX));
      }

      setPxPerSecond(newZoom);
   };

   const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !waveform) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const timeAtClick = pixelToTime(px);

      if (e.button === 1 || e.shiftKey) {
         e.preventDefault();
         setIsPanning(true);
         setPanStartX(e.clientX);
         setPanStartOffset(panX);
      } else {
         setDragStart(timeAtClick);
         setIsDragging(true);
      }
   };

   const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !waveform) return;

      if (isPanning) {
         const deltaX = e.clientX - panStartX;
         const deltaTime = -deltaX / pxPerSecond;
         setPanX(Math.max(0, panStartOffset + deltaTime));
      } else if (isDragging && dragStart !== null) {
         const rect = canvasRef.current.getBoundingClientRect();
         const px = e.clientX - rect.left;
         const timeAtMouse = pixelToTime(px);

         const start = Math.max(0, Math.min(duration, Math.min(dragStart, timeAtMouse)));
         const end = Math.max(0, Math.min(duration, Math.max(dragStart, timeAtMouse)));

         if (Math.abs(end - start) > 0.01) {
            onSelectionChange?.(start, end);
         }
      }
   };

   const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanning) {
         setIsPanning(false);
      } else if (isDragging && dragStart !== null) {
         const rect = canvasRef.current?.getBoundingClientRect();
         if (rect) {
            const px = e.clientX - rect.left;
            const timeAtMouse = pixelToTime(px);
            const delta = Math.abs(timeAtMouse - dragStart);
            if (delta < 0.05) {
               onSeek?.(dragStart);
            }
         }
         setIsDragging(false);
         setDragStart(null);
      }
   };

   // Keyboard shortcuts for zoom
   useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
         if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
         }
         if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            zoomIn();
         } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            zoomOut();
         } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            fitToView();
         }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
   }, [zoomIn, zoomOut, fitToView]);

   // Auto-scroll to keep playhead visible during playback
   const lastPlayheadRef = useRef(playhead);
   useEffect(() => {
      const playheadMoving = Math.abs(playhead - lastPlayheadRef.current) > 0.01;
      lastPlayheadRef.current = playhead;
      if (!playheadMoving) return;

      const playheadX = timeToPixel(playhead);
      const leftBoundary = canvasWidth * 0.15;
      const rightBoundary = canvasWidth * 0.85;

      if (playheadX < leftBoundary) {
         const targetPanX = Math.max(0, playhead - (canvasWidth * 0.3) / pxPerSecond);
         setPanX(targetPanX);
      } else if (playheadX > rightBoundary) {
         const targetPanX = playhead - (canvasWidth * 0.7) / pxPerSecond;
         setPanX(Math.max(0, targetPanX));
      }
   }, [playhead, canvasWidth, pxPerSecond, timeToPixel]);

   return (
      <div ref={containerRef} className="flex flex-col gap-2.5 bg-studio-panel rounded-xl p-3 border border-studio-border">
         {/* Zoom controls */}
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
               <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-studio-raised transition text-studio-text-muted hover:text-studio-text" title="Zoom out (-)">
                  <ZoomOut size={14} />
               </button>
               <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-studio-raised transition text-studio-text-muted hover:text-studio-text" title="Zoom in (+)">
                  <ZoomIn size={14} />
               </button>
               <button
                  onClick={fitToView}
                  data-testid="waveform-fit"
                  className="px-2 py-1.5 rounded-md hover:bg-studio-raised transition text-[11px] font-medium flex items-center gap-1 text-studio-text-muted hover:text-studio-text"
                  title="Fit entire audio (Ctrl+0)"
               >
                  <Maximize2 size={13} />
                  Fit
               </button>
               <button onClick={resetZoom} className="p-1.5 rounded-md hover:bg-studio-raised transition text-studio-text-muted hover:text-studio-text" title="Reset zoom (1:1)">
                  <RotateCcw size={14} />
               </button>
            </div>

            <div className="text-[11px] text-studio-text-faint tabular-nums">
               {Math.round(pxPerSecond)}px/s · {formatTime(panX)} — {formatTime(panX + canvasWidth / pxPerSecond)}
            </div>
         </div>

         {/* Waveform canvas */}
         <canvas
            ref={canvasRef}
            className="rounded-lg cursor-crosshair block w-full"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
         />

         {/* Help text */}
         <div className="text-[11px] text-studio-text-faint">
            {selectionStart !== null && selectionEnd !== null ? (
               <>
                  <span className="text-studio-accent-strong font-medium">
                     Selection: {formatTime(selectionStart)} → {formatTime(selectionEnd)}
                  </span>
                  {" "}({formatTime(selectionEnd - selectionStart)})
               </>
            ) : (
               <>Click to seek · Drag to select · Scroll to zoom · Shift+drag to pan</>
            )}
         </div>
      </div>
   );
}
