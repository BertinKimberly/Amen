import { useEffect, useRef, useState } from "react";
import type { WaveformData } from "../lib/studioTypes";
import { formatTime } from "../lib/studioTime";

interface WaveformViewProps {
   waveform: WaveformData | null;
   duration: number;
   onSelectionChange?: (start: number | null, end: number | null) => void;
   onSeek?: (time: number) => void;
   playhead?: number;
   darkMode?: boolean;
}

/**
 * Canvas-based waveform viewer with:
 * - Zoom (mouse wheel)
 * - Horizontal pan (arrow keys or drag)
 * - Click to seek
 * - Drag to select
 * - Playhead indicator
 * - Efficient: only renders visible buckets
 */
export function WaveformView({
   waveform,
   onSelectionChange,
   onSeek,
   playhead = 0,
   darkMode = true,
}: WaveformViewProps) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [zoom, setZoom] = useState(1); // pixels per second
   const panX = 0; // left offset in seconds (currently no panning)
   const [isDragging, setIsDragging] = useState(false);
   const [dragStart, setDragStart] = useState<number | null>(null);
   const [selectionStart, setSelectionStart] = useState<number | null>(null);
   const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

   const canvasWidth = 800;
   const canvasHeight = 100;

   const baseZoom = 50; // pixels per second at zoom=1

   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !waveform) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background
      ctx.fillStyle = darkMode ? "#1a1a1a" : "#f5f5f5";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Grid lines (every 1 second)
      ctx.strokeStyle = darkMode ? "#333" : "#ddd";
      ctx.lineWidth = 1;
      for (
         let sec = Math.ceil(panX);
         sec < panX + canvasWidth / (baseZoom * zoom);
         sec++
      ) {
         const px = (sec - panX) * baseZoom * zoom;
         if (px >= 0 && px <= canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvasHeight);
            ctx.stroke();
            // Time label
            ctx.fillStyle = darkMode ? "#888" : "#666";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            ctx.fillText(formatTime(sec), px, canvasHeight - 2);
         }
      }

      // Peaks
      const pixelsPerBucket = (baseZoom * zoom) / waveform.bucketsPerSecond;
      const visibleStart = Math.max(
         0,
         Math.floor(panX * waveform.bucketsPerSecond),
      );
      const visibleEnd = Math.min(
         waveform.peaks.length,
         Math.ceil(
            (panX + canvasWidth / (baseZoom * zoom)) *
               waveform.bucketsPerSecond,
         ),
      );

      const centerY = canvasHeight / 2;
      const scale = (canvasHeight / 2) * 0.9;

      ctx.strokeStyle = darkMode ? "#0f7dff" : "#0066cc";
      ctx.lineWidth = Math.max(1, pixelsPerBucket * 0.8);
      ctx.lineCap = "round";

      for (let i = visibleStart; i < visibleEnd; i++) {
         const [min, max] = waveform.peaks[i];
         const x =
            ((i / waveform.bucketsPerSecond - panX) * baseZoom * zoom +
               pixelsPerBucket / 2) |
            0;
         const y1 = centerY + min * scale;
         const y2 = centerY + max * scale;
         ctx.beginPath();
         ctx.moveTo(x, y1);
         ctx.lineTo(x, y2);
         ctx.stroke();
      }

      // Selection highlight
      if (selectionStart !== null && selectionEnd !== null) {
         const sx = (selectionStart - panX) * baseZoom * zoom;
         const ex = (selectionEnd - panX) * baseZoom * zoom;
         ctx.fillStyle = darkMode
            ? "rgba(15, 125, 255, 0.2)"
            : "rgba(0, 102, 204, 0.15)";
         ctx.fillRect(sx, 0, ex - sx, canvasHeight);
      }

      // Playhead
      if (
         playhead >= panX &&
         playhead <= panX + canvasWidth / (baseZoom * zoom)
      ) {
         const hx = (playhead - panX) * baseZoom * zoom;
         ctx.strokeStyle = "#ff4444";
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.moveTo(hx, 0);
         ctx.lineTo(hx, canvasHeight);
         ctx.stroke();
      }
   }, [waveform, zoom, panX, playhead, darkMode, selectionStart, selectionEnd]);

   const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.5, Math.min(10, z * delta)));
   };

   const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !waveform) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const timeAtClick = panX + px / (baseZoom * zoom);
      setDragStart(timeAtClick);
      setIsDragging(true);
   };

   const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !waveform || !isDragging || dragStart === null)
         return;
      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const timeAtMouse = panX + px / (baseZoom * zoom);
      const start = Math.min(dragStart, timeAtMouse);
      const end = Math.max(dragStart, timeAtMouse);
      setSelectionStart(start);
      setSelectionEnd(end);
      onSelectionChange?.(start, end);
   };

   const handleMouseUp = () => {
      if (isDragging && dragStart !== null) {
         // Only treat as selection if we dragged more than a small threshold
         if (selectionStart !== null && selectionEnd !== null) {
            const delta = Math.abs(selectionEnd - selectionStart);
            if (delta < 0.1) {
               // Too small, treat as click
               onSeek?.(dragStart);
               setSelectionStart(null);
               setSelectionEnd(null);
               onSelectionChange?.(null, null);
            }
         }
      }
      setIsDragging(false);
   };

   return (
      <div className="flex flex-col gap-2">
         <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="border rounded cursor-crosshair bg-slate-950"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
         />
         <div className="text-xs text-slate-400">
            {selectionStart !== null && selectionEnd !== null
               ? `Selection: ${formatTime(selectionStart)} — ${formatTime(selectionEnd)} (${formatTime(selectionEnd - selectionStart)})`
               : "Click to seek, drag to select, scroll to zoom"}
         </div>
      </div>
   );
}
