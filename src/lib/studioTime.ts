// Time helpers for Audio Studio. All math uses milliseconds under the hood to
// avoid accumulated floating-point rounding errors where it matters.

/** Convert seconds (float) to milliseconds (rounded). */
export function toMs(sec: number): number {
   return Math.round(sec * 1000);
}

/** Convert milliseconds to seconds (float). */
export function toSec(ms: number): number {
   return ms / 1000;
}

/** Format seconds as `m:ss.mmm` (or `h:mm:ss.mmm` for >= 1h). */
export function formatTime(sec: number | null | undefined): string {
   if (sec == null || !isFinite(sec) || sec < 0) return "0:00.000";
   const ms = toMs(sec);
   const hours = Math.floor(ms / 3_600_000);
   const minutes = Math.floor((ms % 3_600_000) / 60_000);
   const seconds = Math.floor((ms % 60_000) / 1000);
   const millis = ms % 1000;
   const s = `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
   return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
      : s;
}

/** Format seconds more compactly: `1:23` or `1:23.4`. */
export function formatTimeShort(sec: number | null | undefined): string {
   if (sec == null || !isFinite(sec) || sec < 0) return "0:00";
   const ms = toMs(sec);
   const minutes = Math.floor(ms / 60_000);
   const seconds = Math.floor((ms % 60_000) / 1000);
   const tenths = Math.floor((ms % 1000) / 100);
   return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Parse `m:ss.mmm` / `mm:ss.mmm` / `h:mm:ss.mmm` into seconds.
 * Returns null for invalid input. Accepts `.` or `,` as the fractional separator.
 */
export function parseTime(input: string): number | null {
   const text = input.trim().replace(",", ".");
   if (!text) return null;
   const re = /^(?:(\d+):)?(\d+):(\d+)(?:\.(\d{1,3}))?$/;
   const simple = /^(\d+):(\d+)(?:\.(\d{1,3}))?$/;
   let m = text.match(re);
   let h = 0;
   let min = 0;
   let sec = 0;
   let ms = 0;
   if (m) {
      h = Number(m[1] ?? 0);
      min = Number(m[2]);
      sec = Number(m[3]);
      ms = Number((m[4] ?? "0").padEnd(3, "0"));
   } else {
      m = text.match(simple);
      if (!m) return null;
      min = Number(m[1]);
      sec = Number(m[2]);
      ms = Number((m[3] ?? "0").padEnd(3, "0"));
   }
   if (min > 59 && h === 0) return null; // "75:00" style without hours is suspicious, reject
   if (sec >= 60 || ms >= 1000) return null;
   return h * 3600 + min * 60 + sec + ms / 1000;
}

/** Clamp a value into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, v));
}

/** Round a value to `digits` decimal places. */
export function round(v: number, digits = 3): number {
   const f = Math.pow(10, digits);
   return Math.round(v * f) / f;
}
