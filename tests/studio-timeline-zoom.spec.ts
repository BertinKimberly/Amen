import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   createPreciseClip,
   appendClipToTimeline,
   readTimelineState,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

/**
 * The timeline's zoom model and its ruler. These exist because the shipped
 * Studio opened every timeline at a hardcoded 60 px/s — about nine seconds
 * across the viewport, ticked every two seconds — no matter how long the
 * material was, and clamped zoom-out at 8 px/s so a five-minute mix could
 * never be fitted on screen at all.
 */

/** Parse a ruler label (`m:ss`, `m:ss.t`, `h:mm:ss`) back into seconds. */
function parseLabel(label: string): number | null {
   const parts = label.split(":");
   if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
   }
   if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      return Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s) ? h * 3600 + m * 60 + s : null;
   }
   return null;
}

test.describe("Audio Studio — timeline zoom model", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("a fresh timeline opens showing minutes of context, not a nine-second window", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await page.waitForTimeout(400);

      const state = await readTimelineState(page);
      expect(
         state.visibleSeconds,
         `an empty timeline must open on a broad window, got ${state.visibleSeconds.toFixed(1)}s`,
      ).toBeGreaterThan(200);
      expect(state.visibleSeconds).toBeLessThan(400);
   });

   test("ruler labels are evenly spaced, ordered, and free of millisecond noise", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await page.waitForTimeout(400);

      const state = await readTimelineState(page);
      const labels = state.rulerLabels.filter((l) => l.length > 0);
      expect(labels.length, "the ruler must actually be labelled").toBeGreaterThan(2);

      // No ".000"-style noise: at multi-second spacing the fraction is pure clutter.
      for (const label of labels) {
         expect(label, `ruler label "${label}" carries millisecond noise`).not.toMatch(/\.\d{3}$/);
      }

      const times = labels.map(parseLabel);
      expect(times.every((t) => t !== null), `unparseable ruler labels: ${labels.join(" | ")}`).toBe(true);

      // Strictly increasing, and a single consistent interval — never scattered.
      const values = times as number[];
      for (let i = 1; i < values.length; i++) {
         expect(values[i], `ruler labels out of order: ${labels.join(" | ")}`).toBeGreaterThan(values[i - 1]);
      }
      const steps = values.slice(1).map((v, i) => v - values[i]);
      const first = steps[0];
      for (const s of steps) {
         expect(Math.abs(s - first), `inconsistent ruler interval: ${labels.join(" | ")}`).toBeLessThan(0.01);
      }

      // And the interval must be a sane fraction of the visible window, not
      // 40 labels crammed together nor two labels for five minutes.
      const labelCount = state.visibleSeconds / first;
      expect(labelCount).toBeGreaterThan(2);
      expect(labelCount).toBeLessThan(24);
   });

   test("zoom in, zoom out and Fit all change the view and stay recoverable", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await createPreciseClip(page, 10, 40);
      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(300);

      const base = await readTimelineState(page);

      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.waitForTimeout(150);
      const zoomedIn = await readTimelineState(page);
      expect(zoomedIn.pxPerSecond, "zoom in must increase the scale").toBeGreaterThan(base.pxPerSecond);
      expect(zoomedIn.visibleSeconds).toBeLessThan(base.visibleSeconds);

      await page.locator('[data-testid="timeline-zoom-out"]').click();
      await page.locator('[data-testid="timeline-zoom-out"]').click();
      await page.waitForTimeout(150);
      const zoomedOut = await readTimelineState(page);
      expect(zoomedOut.pxPerSecond, "zoom out must decrease the scale").toBeLessThan(zoomedIn.pxPerSecond);

      await page.locator('[data-testid="timeline-fit"]').click();
      await page.waitForTimeout(200);
      const fitted = await readTimelineState(page);
      // Fit must genuinely fit the composition: everything visible, and not
      // wildly more than the composition itself.
      expect(fitted.duration).toBeGreaterThan(0);
      expect(
         fitted.visibleSeconds,
         `Fit must show the whole ${fitted.duration.toFixed(1)}s composition, showed ${fitted.visibleSeconds.toFixed(1)}s`,
      ).toBeGreaterThanOrEqual(fitted.duration * 0.98);
      expect(fitted.visibleSeconds).toBeLessThan(fitted.duration * 1.6);
   });

   test("Fit works for a long (12 minute) composition — the old 8px/s floor made this impossible", async ({ page }) => {
      await importSource(page, FIXTURES.min12.path);
      await selectSource(page, FIXTURES.min12.name);
      // Two long clips appended back to back: an ~11 minute arrangement.
      await createPreciseClip(page, 0, 350);
      await createPreciseClip(page, 350, 660);
      await appendClipToTimeline(page, "Clip 1");
      await appendClipToTimeline(page, "Clip 2");
      await page.waitForTimeout(400);

      await page.locator('[data-testid="timeline-fit"]').click();
      await page.waitForTimeout(300);

      const state = await readTimelineState(page);
      expect(state.duration).toBeGreaterThan(600);
      expect(
         state.visibleSeconds,
         `Fit must show all ${state.duration.toFixed(0)}s; it showed ${state.visibleSeconds.toFixed(0)}s`,
      ).toBeGreaterThanOrEqual(state.duration * 0.98);
   });

   test("repeated zooming to the extremes always recovers via Fit", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await createPreciseClip(page, 5, 65);
      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(300);

      // Slam zoom all the way in, then all the way out. The buttons disable
      // at the limits — that is the app telling you where the edge is, so the
      // test stops there rather than hammering a dead control.
      const zoomIn = page.locator('[data-testid="timeline-zoom-in"]');
      const zoomOut = page.locator('[data-testid="timeline-zoom-out"]');

      for (let i = 0; i < 30 && (await zoomIn.isEnabled()); i++) {
         await zoomIn.click();
      }
      await page.waitForTimeout(200);
      const maxed = await readTimelineState(page);
      expect(maxed.pxPerSecond, "zoom must stop at the documented maximum").toBeLessThanOrEqual(400.001);
      expect(Number.isFinite(maxed.pxPerSecond)).toBe(true);
      expect(await zoomIn.isDisabled(), "hitting the zoom-in limit must be visible, not silent").toBe(true);

      for (let i = 0; i < 60 && (await zoomOut.isEnabled()); i++) {
         await zoomOut.click();
      }
      await page.waitForTimeout(200);
      const minned = await readTimelineState(page);
      expect(minned.pxPerSecond, "zoom-out must stop at the documented minimum").toBeGreaterThanOrEqual(0.19);
      expect(minned.pxPerSecond).toBeLessThan(maxed.pxPerSecond);

      await page.locator('[data-testid="timeline-fit"]').click();
      await page.waitForTimeout(250);
      const recovered = await readTimelineState(page);
      expect(recovered.visibleSeconds).toBeGreaterThanOrEqual(recovered.duration * 0.98);
      expect(recovered.visibleSeconds).toBeLessThan(recovered.duration * 1.6);
      // And the clip is on screen again, not lost off the right edge.
      await expect(page.locator('[data-testid="timeline-clip"]').first()).toBeVisible();
   });

   test("the timeline scrolls horizontally when the arrangement is wider than the view", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await createPreciseClip(page, 0, 60);
      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(300);

      // Zoom in so the content is definitively wider than the viewport.
      for (let i = 0; i < 5; i++) await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.waitForTimeout(250);

      const before = await readTimelineState(page);
      expect(before.scrollWidth, "content must exceed the viewport for scrolling to mean anything").toBeGreaterThan(
         before.clientWidth + 50,
      );

      await page.evaluate(() => {
         const c = document.querySelector('[data-testid="timeline-container"]') as HTMLElement;
         c.scrollLeft = 400;
      });
      await page.waitForTimeout(200);

      const after = await readTimelineState(page);
      expect(after.scrollLeft, "the timeline must scroll horizontally").toBeGreaterThan(300);

      // The ruler must still be labelled correctly at the scrolled position —
      // labels are generated for the VISIBLE window, so they must start near it.
      const firstLabel = after.rulerLabels.filter(Boolean)[0];
      const firstTime = parseLabel(firstLabel);
      expect(firstTime).not.toBeNull();
      const viewStart = after.scrollLeft / after.pxPerSecond;
      expect(
         Math.abs((firstTime as number) - viewStart),
         `first visible ruler label (${firstLabel}) must be near the scrolled view start (${viewStart.toFixed(1)}s)`,
      ).toBeLessThan(after.visibleSeconds * 0.5);
   });

   test("the timeline ruler scrubs the playhead", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await createPreciseClip(page, 0, 60);
      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(300);

      const ruler = page.locator('[data-testid="timeline-ruler"]');
      const box = await ruler.boundingBox();
      expect(box).not.toBeNull();
      const targetX = box!.x + box!.width * 0.4;
      await page.mouse.move(targetX, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);

      const state = await readTimelineState(page);
      const playheadSeconds = await page.evaluate(() => {
         const el = document.querySelector('[data-testid="timeline-playhead"]') as HTMLElement;
         return parseFloat(el.dataset.playheadSeconds || "0");
      });
      const expected = (state.scrollLeft + box!.width * 0.4) / state.pxPerSecond;
      expect(
         Math.abs(playheadSeconds - expected),
         `ruler click put the playhead at ${playheadSeconds.toFixed(2)}s, expected ~${expected.toFixed(2)}s`,
      ).toBeLessThan(1.0);
   });
});
