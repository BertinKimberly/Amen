import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

/**
 * The transport plays three fundamentally different things through the same
 * <audio> element: the whole source, a bounded clip/selection preview, and
 * the rendered timeline mix. A user must never have to guess which one is
 * live — these tests drive the real UI and verify the on-screen label
 * (data-testid="now-playing-indicator") always matches what's actually
 * playing, and that a clip preview genuinely plays only that clip's region.
 */
test.describe("Audio Studio — playback mode disambiguation", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("playing the raw source is labeled SOURCE, never CLIP PREVIEW", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);

      const playBtn = page.locator('button[title="Stop (resets to 0)"]').locator("..").locator("button").nth(1);
      await playBtn.click();
      await page.waitForTimeout(400);

      const indicator = page.locator('[data-testid="now-playing-indicator"]');
      await expect(indicator).toHaveAttribute("data-now-playing-kind", "source");
      await expect(indicator).toContainText(FIXTURES.a.name);
      await playBtn.click(); // stop the loop for the next test
   });

   test("a clip's Preview button plays ONLY that clip's region, labeled CLIP PREVIEW, and stops exactly at its end", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      // Clip covers a known sub-region of the 8s source.
      await selectWaveformRegion(page, 0.1, 0.35);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Deliberately move the ad-hoc waveform selection somewhere else
      // afterward — the clip preview must use the CLIP's saved bounds, not
      // whatever the waveform selection currently happens to be.
      await selectWaveformRegion(page, 0.6, 0.9);
      await page.waitForTimeout(100);

      const clipRow = page.locator('[data-testid="clip-item"]').first();
      const clipRowText = (await clipRow.textContent()) || "";
      const bounds = clipRowText.match(/(\d+):(\d+\.\d+)\s*→\s*(\d+):(\d+\.\d+)/);
      expect(bounds, "clip row must show its start/end").not.toBeNull();
      const clipStart = parseInt(bounds![1]) * 60 + parseFloat(bounds![2]);
      const clipEnd = parseInt(bounds![3]) * 60 + parseFloat(bounds![4]);

      await clipRow.hover();
      await clipRow.locator('[data-testid="clip-preview-button"]').click();
      await page.waitForTimeout(300);

      const indicator = page.locator('[data-testid="now-playing-indicator"]');
      await expect(indicator).toHaveAttribute("data-now-playing-kind", "clip");

      const audioEl = page.locator("audio");
      const playing = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused);
      expect(playing, "clip preview must actually start playback").toBe(true);
      const currentTime = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      // Generous margin above the ~0.3s wait: this only needs to rule out
      // landing near the unrelated selection (2s+ away), not pin an exact
      // elapsed time, which would make the assertion fragile under system load.
      expect(currentTime, "clip preview must start at the CLIP's start, not the unrelated waveform selection").toBeLessThan(clipStart + 1.5);

      // Wait past the clip's end and confirm playback stopped there instead
      // of continuing into the rest of the 8s source.
      await page.waitForTimeout(Math.max(0, (clipEnd - currentTime - 0.5)) * 1000 + 1200);
      const stillPlaying = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused);
      expect(stillPlaying, "clip preview must stop at the clip's end").toBe(false);
   });

   test("Timeline Mix is labeled distinctly from source/clip playback", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.05);
      await page.waitForTimeout(150);

      const mixBtn = page.getByRole("button", { name: /Timeline Mix/i });
      await mixBtn.click();
      await page.waitForTimeout(4000);

      const indicator = page.locator('[data-testid="now-playing-indicator"]');
      await expect(indicator).toHaveAttribute("data-now-playing-kind", "timeline");
      await expect(indicator).toContainText("Timeline Mix");
   });
});

test.describe("Audio Studio — Fit precision", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   async function fitAndReadVisibleEnd(page: import("@playwright/test").Page): Promise<number> {
      await page.locator('[data-testid="waveform-fit"]').click();
      await page.waitForTimeout(150);
      const readout = await page.locator("text=/px\\/s/").textContent();
      // Format: "83px/s · 0:00.000 — 0:08.123"
      const m = readout?.match(/—\s*(\d+):(\d+\.\d+)/);
      expect(m, "zoom readout must be present").not.toBeNull();
      return parseInt(m![1]) * 60 + parseFloat(m![2]);
   }

   test("Fit shows the entire short (8s) source with sensible padding, not a wildly different window", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      const visibleEnd = await fitAndReadVisibleEnd(page);
      // Fit pads to 96% of the canvas, so the visible window is slightly
      // larger than the true 8s duration — but must stay close to it, not
      // drift to some unrelated value.
      expect(visibleEnd).toBeGreaterThan(7.5);
      expect(visibleEnd).toBeLessThan(9.5);
   });

   test("Fit shows the entire long (40s) source with sensible padding", async ({ page }) => {
      await importSource(page, FIXTURES.long.path);
      await selectSource(page, FIXTURES.long.name);
      const visibleEnd = await fitAndReadVisibleEnd(page);
      expect(visibleEnd).toBeGreaterThan(38);
      expect(visibleEnd).toBeLessThan(45);
   });
});
