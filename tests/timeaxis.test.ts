import { describe, it, expect } from "vitest";
import {
   buildRuler,
   clampZoom,
   createTimeAxis,
   fitZoom,
   formatRulerLabel,
   initialZoom,
   pickNiceInterval,
   MIN_PX_PER_SECOND,
   MAX_PX_PER_SECOND,
   DEFAULT_VIEW_SECONDS,
} from "@/lib/timeAxis";

describe("clampZoom", () => {
   it("keeps every zoom inside the recoverable range", () => {
      expect(clampZoom(1e9)).toBe(MAX_PX_PER_SECOND);
      expect(clampZoom(1e-9)).toBe(MIN_PX_PER_SECOND);
      expect(clampZoom(50)).toBe(50);
   });

   it("never returns a value that would break the time<->pixel mapping", () => {
      for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
         const z = clampZoom(bad);
         expect(Number.isFinite(z)).toBe(true);
         expect(z).toBeGreaterThan(0);
      }
   });
});

describe("initialZoom", () => {
   it("opens an empty timeline on a five-minute window", () => {
      const z = initialZoom(1000, 0);
      expect(1000 / z).toBeCloseTo(DEFAULT_VIEW_SECONDS, 1);
   });

   it("sizes to the content when there is content, capped at five minutes", () => {
      // A 40-second arrangement gets a ~42s window, not a 5-minute one.
      const short = initialZoom(1000, 40);
      expect(1000 / short).toBeGreaterThan(40);
      expect(1000 / short).toBeLessThan(50);

      // A short source fills the view instead of hiding in a corner of it.
      const tiny = initialZoom(1000, 8);
      expect(1000 / tiny).toBeGreaterThan(8);
      expect(1000 / tiny).toBeLessThan(9);

      // A 30-minute arrangement is not crushed to fit; it opens at the cap.
      const long = initialZoom(1000, 1800);
      expect(1000 / long).toBeCloseTo(DEFAULT_VIEW_SECONDS, 1);
   });

   it("never returns an out-of-range zoom for absurd inputs", () => {
      expect(initialZoom(1000, 1e9)).toBeGreaterThanOrEqual(MIN_PX_PER_SECOND);
      expect(initialZoom(1000, 0.0001)).toBeLessThanOrEqual(MAX_PX_PER_SECOND);
   });
});

describe("fitZoom", () => {
   it("makes the whole composition visible", () => {
      for (const duration of [8, 40, 300, 720, 3600]) {
         const width = 900;
         const z = fitZoom(width, duration);
         const visible = width / z;
         expect(visible, `a ${duration}s mix must fit in the viewport`).toBeGreaterThanOrEqual(duration * 0.98);
      }
   });

   it("fits a 12-minute mix in a narrow viewport — the case the old 8px/s floor made impossible", () => {
      const z = fitZoom(570, 720);
      expect(570 / z).toBeGreaterThanOrEqual(720 * 0.98);
      expect(z).toBeGreaterThanOrEqual(MIN_PX_PER_SECOND);
   });
});

describe("formatRulerLabel", () => {
   it("matches its precision to the tick spacing", () => {
      expect(formatRulerLabel(150, 30)).toBe("2:30");
      expect(formatRulerLabel(150, 60)).toBe("2:30");
      expect(formatRulerLabel(0, 5)).toBe("0:00");
      expect(formatRulerLabel(3725, 60)).toBe("1:02:05");
   });

   it("shows a fraction only when ticks are closer than a second apart", () => {
      expect(formatRulerLabel(2.5, 0.5)).toBe("0:02.5");
      expect(formatRulerLabel(2.25, 0.05)).toBe("0:02.25");
      // ...and never at coarse spacing, which is what made the old ruler
      // read as "0:00.000 | 0:02.000 | 0:04.000".
      expect(formatRulerLabel(2, 2)).not.toMatch(/\./);
   });

   it("rolls a rounded 59.6s into the next minute instead of printing :60", () => {
      expect(formatRulerLabel(59.6, 1)).toBe("1:00");
      expect(formatRulerLabel(119.7, 1)).toBe("2:00");
   });
});

describe("pickNiceInterval", () => {
   it("always returns a value that divides cleanly into a clock", () => {
      const allowed = new Set([0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]);
      for (const visible of [0.5, 3, 9, 40, 120, 300, 720, 3600]) {
         const step = pickNiceInterval(visible, 900);
         expect(allowed.has(step) || step % 3600 === 0).toBe(true);
      }
   });
});

describe("buildRuler", () => {
   it("produces evenly spaced, strictly increasing, noise-free labels", () => {
      const pxPerSecond = 900 / 300; // a five-minute window in 900px
      const { ticks } = buildRuler(0, 300, pxPerSecond);
      const labelled = ticks.filter((t) => t.major);
      expect(labelled.length).toBeGreaterThan(2);

      for (let i = 1; i < labelled.length; i++) {
         expect(labelled[i].time).toBeGreaterThan(labelled[i - 1].time);
      }
      const step = labelled[1].time - labelled[0].time;
      for (let i = 1; i < labelled.length; i++) {
         expect(labelled[i].time - labelled[i - 1].time).toBeCloseTo(step, 6);
      }
      for (const t of labelled) {
         expect(t.label).not.toMatch(/\.\d{3}$/);
      }
   });

   it("keeps labels far enough apart to never overlap, at every zoom", () => {
      for (const pxPerSecond of [0.2, 0.5, 1, 3, 12, 60, 200, 400]) {
         const visible = 900 / pxPerSecond;
         const { ticks, majorStep } = buildRuler(0, visible, pxPerSecond);
         expect(majorStep * pxPerSecond, `labels collide at ${pxPerSecond}px/s`).toBeGreaterThanOrEqual(70);
         // And not so sparse that the ruler is useless.
         const majors = ticks.filter((t) => t.major).length;
         expect(majors, `too few labels at ${pxPerSecond}px/s`).toBeGreaterThanOrEqual(2);
      }
   });

   it("only emits ticks for the visible window, however far out the view is scrolled", () => {
      const pxPerSecond = 3;
      const { ticks } = buildRuler(1800, 2100, pxPerSecond);
      expect(ticks.length).toBeLessThan(200);
      expect(ticks[0].time).toBeGreaterThanOrEqual(1800 - 30);
      expect(ticks[ticks.length - 1].time).toBeLessThanOrEqual(2100 + 60);
   });

   it("only emits minor ticks that are far enough apart to read as a grid", () => {
      for (const pxPerSecond of [0.2, 1, 12, 60, 400]) {
         const visible = 900 / pxPerSecond;
         const { ticks, minorStep } = buildRuler(0, visible, pxPerSecond);
         const hasMinors = ticks.some((t) => !t.major);
         if (hasMinors) {
            expect(minorStep * pxPerSecond, `minor ticks smear at ${pxPerSecond}px/s`).toBeGreaterThanOrEqual(7);
         }
      }
      // A normal working zoom does subdivide — the grid is what a user aims at.
      expect(buildRuler(0, 30, 30).ticks.some((t) => !t.major)).toBe(true);
   });
});

describe("createTimeAxis", () => {
   it("round-trips time through pixels exactly", () => {
      const axis = createTimeAxis(37.5, 12.25);
      for (const t of [0, 1, 12.25, 100.125, 3600]) {
         expect(axis.toTime(axis.toPixel(t))).toBeCloseTo(t, 9);
      }
   });

   it("degrades safely rather than producing Infinity on a zero scale", () => {
      const axis = createTimeAxis(0, 0);
      expect(Number.isFinite(axis.toTime(100))).toBe(true);
   });
});
