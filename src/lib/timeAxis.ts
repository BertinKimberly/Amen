// Single authoritative time <-> pixel conversion, used identically by every
// view that renders a time axis (waveform, timeline ruler, clips, playhead,
// drag/drop). Each view owns its own scale/offset state (they represent
// different time domains — source time vs. composition time — so they are
// NOT shared state), but the arithmetic itself must never be reimplemented
// ad hoc, or zoom/scroll/resize will silently drift out of sync between
// the ruler, the content, and the playhead.

export interface TimeAxis {
   /** Time (seconds) -> local pixel X, relative to the axis origin. */
   toPixel(time: number): number;
   /** Local pixel X (relative to the axis origin) -> time (seconds). */
   toTime(px: number): number;
   pxPerSecond: number;
   offsetSeconds: number;
}

/**
 * @param pxPerSecond Zoom level: pixels per second of audio/timeline time.
 * @param offsetSeconds Time (seconds) shown at local pixel 0 (pan/scroll offset).
 */
export function createTimeAxis(pxPerSecond: number, offsetSeconds: number): TimeAxis {
   const safePxPerSecond = pxPerSecond > 0 ? pxPerSecond : 1;
   return {
      pxPerSecond: safePxPerSecond,
      offsetSeconds,
      toPixel(time: number): number {
         return (time - offsetSeconds) * safePxPerSecond;
      },
      toTime(px: number): number {
         return offsetSeconds + px / safePxPerSecond;
      },
   };
}

/**
 * Pick a "nice" grid/label interval (in seconds) so that labels never
 * overlap, given how many pixels are available per label.
 */
export function pickNiceInterval(secondsVisible: number, pxAvailable: number, minLabelSpacingPx = 80): number {
   const maxLabels = Math.max(1, pxAvailable / minLabelSpacingPx);
   const rawInterval = secondsVisible / maxLabels;
   const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
   for (const step of steps) {
      if (rawInterval <= step) return step;
   }
   return Math.ceil(rawInterval / 3600) * 3600;
}
