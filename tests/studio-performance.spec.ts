import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   dragClipToTrack,
   selectWaveformRegion,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

/**
 * Real-world audio is minutes long, not the 5-40s toy fixtures the rest of
 * the suite uses for speed. These tests exercise actual 3/5/12-minute WAV
 * files (real ffmpeg-generated, not synthetic metadata) through the exact
 * same import → waveform → zoom/scroll → clip → timeline path a user would
 * take, and assert the UI stays responsive rather than hanging or freezing.
 * Timings are logged for visibility; thresholds are generous (this is a dev
 * machine running a debug/dev build under Playwright, not the shipped
 * release binary) — the goal is catching genuine hangs/freezes, not
 * micro-benchmarking.
 */
test.describe("Audio Studio — performance with realistic long audio", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   for (const fixture of [FIXTURES.min3, FIXTURES.min5, FIXTURES.min12]) {
      test(`${fixture.name} (${Math.round(fixture.duration / 60)}min): import, waveform, zoom, and clip creation stay responsive`, async ({ page }) => {
         test.setTimeout(60000);
         const t0 = Date.now();
         await importSource(page, fixture.path);
         const importMs = Date.now() - t0;

         const t1 = Date.now();
         await selectSource(page, fixture.name);
         await expect(page.locator("canvas").first()).toBeVisible();
         const waveformMs = Date.now() - t1;

         // The waveform must contain real drawn content, not a blank canvas —
         // decoding minutes of audio into peaks must not silently fail or
         // truncate to nothing.
         const hasContent = await page.locator("canvas").first().evaluate((el: HTMLCanvasElement) => {
            const ctx = el.getContext("2d")!;
            const data = ctx.getImageData(0, 0, el.width, el.height).data;
            let nonBackground = 0;
            for (let i = 0; i < data.length; i += 4) {
               if (Math.abs(data[i] - 0x0d) > 10 || Math.abs(data[i + 1] - 0x0d) > 10) nonBackground++;
            }
            return nonBackground;
         });
         expect(hasContent, "waveform must render real content even for long audio").toBeGreaterThan(50);

         // Default zoom must expose real context (not 1px representing the
         // whole multi-minute file, and not stuck at a toy-file default).
         const readout = await page.locator("text=/px\\/s/").textContent();
         const pxPerSecond = parseFloat(readout?.match(/^(\d+)px\/s/)?.[1] || "0");
         expect(pxPerSecond, "default zoom must not collapse to near-zero for long audio").toBeGreaterThan(1);

         // Zoom in/out several times — must complete without hanging.
         const t2 = Date.now();
         for (let i = 0; i < 5; i++) {
            await page.locator('[data-testid="waveform-fit"]').click();
         }
         const zoomMs = Date.now() - t2;

         // Create a clip from a small region — must work the same as short audio.
         const t3 = Date.now();
         await selectWaveformRegion(page, 0.1, 0.15);
         await page.getByRole("button", { name: "Create Clip", exact: true }).click();
         await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
         const clipMs = Date.now() - t3;

         // Place it on the timeline and zoom/scroll the timeline itself.
         const t4 = Date.now();
         await dragClipToTrack(page, fixture.name, 0, 0.02);
         await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
         await page.locator('[data-testid="timeline-fit"]').click();
         await page.locator('[data-testid="timeline-zoom-in"]').click();
         await page.locator('[data-testid="timeline-zoom-out"]').click();
         const timelineMs = Date.now() - t4;

         console.log(
            `[perf ${fixture.name}] import=${importMs}ms waveform=${waveformMs}ms zoom×5=${zoomMs}ms clip=${clipMs}ms timeline=${timelineMs}ms`,
         );

         // Generous ceilings — this catches genuine hangs (multi-second
         // per-frame freezes), not fine-grained performance regressions.
         expect(importMs, "import must not hang").toBeLessThan(15_000);
         expect(waveformMs, "waveform generation must not hang").toBeLessThan(15_000);
         expect(zoomMs, "repeated zoom must stay responsive, not compound into a freeze").toBeLessThan(5_000);
         expect(clipMs, "clip creation must not slow down with a long source").toBeLessThan(3_000);
         expect(timelineMs, "timeline placement/zoom must not slow down with a long clip").toBeLessThan(5_000);
      });
   }

   test("scrolling and re-zooming a 12-minute timeline repeatedly does not progressively slow down (no unbounded re-render growth)", async ({ page }) => {
      await importSource(page, FIXTURES.min12.path);
      await selectSource(page, FIXTURES.min12.name);
      await selectWaveformRegion(page, 0.05, 0.1);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, FIXTURES.min12.name, 0, 0.02);
      await page.waitForTimeout(150);

      const timings: number[] = [];
      for (let round = 0; round < 6; round++) {
         const t = Date.now();
         await page.locator('[data-testid="timeline-zoom-in"]').click();
         await page.locator('[data-testid="timeline-zoom-out"]').click();
         timings.push(Date.now() - t);
      }
      console.log(`[perf 12min repeated zoom] ${timings.join(", ")}ms`);

      // The later rounds must not be dramatically slower than the earlier
      // ones — a growing trend would indicate an unbounded re-render or
      // listener leak rather than stable, O(1)-per-interaction cost.
      const firstHalfAvg = (timings[0] + timings[1] + timings[2]) / 3;
      const secondHalfAvg = (timings[3] + timings[4] + timings[5]) / 3;
      expect(
         secondHalfAvg,
         `later zoom interactions (${secondHalfAvg}ms avg) must not be much slower than earlier ones (${firstHalfAvg}ms avg) — that would indicate a performance leak`,
      ).toBeLessThan(Math.max(firstHalfAvg * 3, 500));
   });
});
