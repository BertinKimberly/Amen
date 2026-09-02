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

// ---- Zoom model -------------------------------------------------------------
//
// Deliberately NOT hardcoded per-view magic numbers. Both the waveform and the
// timeline derive their zoom limits from the same two facts: how precise an
// edit can usefully be (the maximum), and how much time a user could ever want
// on screen at once (the minimum). Because every zoom action is clamped
// through `clampZoom`, no gesture — wheel, button, Fit, or a resize — can ever
// strand the view at an unrecoverable scale.

/** Finest useful zoom: 2.5 ms per pixel. Beyond this the waveform is just noise. */
export const MAX_PX_PER_SECOND = 400;
/** Coarsest useful zoom: 5 s per pixel — ~1 hour fits in 720px of viewport. */
export const MIN_PX_PER_SECOND = 0.2;
/**
 * How much time a freshly-opened view shows before the user has zoomed. Long
 * enough to see the shape of a whole song at a glance, short enough that a
 * second still reads as a distance you can aim at.
 */
export const DEFAULT_VIEW_SECONDS = 300;

export function clampZoom(pxPerSecond: number): number {
   if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return 1;
   return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/**
 * The zoom a view should open at: show up to `DEFAULT_VIEW_SECONDS` of
 * context, but never stretch a short piece of content across the whole
 * viewport at an unusable scale, and never crush a long one below
 * readability. `contentSeconds <= 0` (an empty timeline) means "no content to
 * size to" and gets the full default window.
 */
export function initialZoom(viewportWidth: number, contentSeconds: number): number {
   if (viewportWidth <= 0) return 0;
   // Content shorter than the default window fills the view (with a hair of
   // padding) rather than sitting in a corner of it — an 8-second file should
   // occupy the whole waveform, not 40% of it. `clampZoom` handles the
   // degenerate short-content case, so no artificial floor is needed here.
   const target =
      contentSeconds > 0 ? Math.min(DEFAULT_VIEW_SECONDS, contentSeconds * 1.04) : DEFAULT_VIEW_SECONDS;
   return clampZoom(viewportWidth / target);
}

/** The zoom that fits exactly `contentSeconds` into `viewportWidth`, with a small margin. */
export function fitZoom(viewportWidth: number, contentSeconds: number): number {
   if (viewportWidth <= 0) return 0;
   if (contentSeconds <= 0) return initialZoom(viewportWidth, 0);
   return clampZoom((viewportWidth * 0.97) / contentSeconds);
}

// ---- Ruler model ------------------------------------------------------------

/** "Nice" tick intervals in seconds — every one divides cleanly into a clock. */
const NICE_STEPS = [
   0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/**
 * Pick a "nice" grid/label interval (in seconds) so that labels never
 * overlap, given how many pixels are available per label.
 */
export function pickNiceInterval(secondsVisible: number, pxAvailable: number, minLabelSpacingPx = 80): number {
   const maxLabels = Math.max(1, pxAvailable / minLabelSpacingPx);
   const rawInterval = secondsVisible / maxLabels;
   for (const step of NICE_STEPS) {
      if (rawInterval <= step) return step;
   }
   return Math.ceil(rawInterval / 3600) * 3600;
}

export interface RulerTick {
   time: number;
   major: boolean;
   label: string | null;
}

export interface RulerModel {
   majorStep: number;
   minorStep: number;
   ticks: RulerTick[];
}

/**
 * Format a ruler label at a precision matched to the tick spacing. A ruler
 * whose ticks are 30s apart must never print `0:30.000` — the extra digits are
 * pure noise that make the axis look scattered and unreadable. Conversely, at
 * sub-second spacing the fraction is the only thing distinguishing two labels,
 * so it has to be there.
 */
export function formatRulerLabel(time: number, step: number): string {
   const t = Math.max(0, time);
   const hours = Math.floor(t / 3600);
   const minutes = Math.floor((t % 3600) / 60);
   const seconds = t % 60;
   const pad = (n: number) => String(n).padStart(2, "0");

   if (step < 0.1) {
      const s = seconds.toFixed(2).padStart(5, "0");
      return hours > 0 ? `${hours}:${pad(minutes)}:${s}` : `${minutes}:${s}`;
   }
   if (step < 1) {
      const s = seconds.toFixed(1).padStart(4, "0");
      return hours > 0 ? `${hours}:${pad(minutes)}:${s}` : `${minutes}:${s}`;
   }
   const whole = Math.round(seconds);
   // Rounding 59.6 -> 60 must roll over into the minute, not print "1:60".
   const carry = whole === 60 ? 1 : 0;
   const secText = pad(carry ? 0 : whole);
   const mins = minutes + carry;
   if (hours > 0 || mins >= 60) {
      const h = hours + Math.floor(mins / 60);
      return `${h}:${pad(mins % 60)}:${secText}`;
   }
   return `${mins}:${secText}`;
}

/**
 * Build the visible tick list for a ruler. Only ticks inside (a small margin
 * around) the visible window are produced, so zooming out over a long mix
 * never generates tens of thousands of DOM nodes.
 *
 * @param viewStart  first visible time, seconds
 * @param viewEnd    last visible time, seconds
 * @param pxPerSecond current zoom
 * @param labelWidthPx how much horizontal room one label needs
 */
export function buildRuler(
   viewStart: number,
   viewEnd: number,
   pxPerSecond: number,
   labelWidthPx = 78,
): RulerModel {
   const span = Math.max(0.001, viewEnd - viewStart);
   const majorStep = pickNiceInterval(span, span * pxPerSecond, labelWidthPx);
   // Sub-divide a major interval into 4 or 5 minor ticks, whichever lands on
   // rounder numbers for that step, and only while they stay far enough apart
   // to read as a grid rather than a smear.
   const divisor = majorStep === 15 || majorStep === 30 || majorStep === 0.25 ? 3 : majorStep % 5 === 0 ? 5 : 4;
   const minorStep = majorStep / divisor;
   const showMinor = minorStep * pxPerSecond >= 7;

   const step = showMinor ? minorStep : majorStep;
   const first = Math.max(0, Math.floor(viewStart / step) * step);
   const ticks: RulerTick[] = [];
   const guard = 4000; // hard cap; the window math should never approach this
   for (let i = 0; i < guard; i++) {
      const t = first + i * step;
      if (t > viewEnd + step) break;
      // Floating-point accumulation would make `t % majorStep` unreliable, so
      // decide major-ness on the integer tick index instead.
      const isMajor = showMinor ? Math.round(t / minorStep) % divisor === 0 : true;
      ticks.push({
         time: t,
         major: isMajor,
         label: isMajor ? formatRulerLabel(t, majorStep) : null,
      });
   }
   return { majorStep, minorStep, ticks };
}
