import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   acceptAppDialog,
   FIXTURES,
} from "./e2e-fixtures";

test.describe("Audio Studio — multi-source, multi-track composition", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("two sources each produce clips that keep correct source references", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await importSource(page, FIXTURES.b.path);
      await selectSource(page, FIXTURES.b.name);
      await selectWaveformRegion(page, 0.2, 0.6);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      const clips = page.locator('[data-testid="clip-item"]');
      await expect(clips).toHaveCount(2);
      await expect(clips.filter({ hasText: FIXTURES.a.name })).toHaveCount(1);
      await expect(clips.filter({ hasText: FIXTURES.b.name })).toHaveCount(1);
   });

   test("clips from two sources land on two tracks and Timeline Mix renders + plays the real composition", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.0, 0.5); // ~0..4s of 8s tone
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await importSource(page, FIXTURES.b.path);
      await selectSource(page, FIXTURES.b.name);
      await selectWaveformRegion(page, 0.0, 0.6); // ~0..3s of 5s tone
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Track 1 gets clip A at t=0
      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.02);
      await page.waitForTimeout(150);

      // Add a second track, put clip B there starting a bit later
      await page.locator('[data-testid="add-track"]').click();
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
      await dragClipToTrack(page, FIXTURES.b.name, 1, 0.15);
      await page.waitForTimeout(150);

      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);
      await page.screenshot({ path: "test-results/04-two-tracks-two-sources.png" });

      // Switch to Timeline Mix playback mode — this triggers a REAL ffmpeg render.
      const mixBtn = page.getByRole("button", { name: /Timeline Mix/i });
      await mixBtn.click();
      await page.waitForTimeout(4000); // real render + ffprobe round trip

      const audioEl = page.locator("audio");
      const src = await audioEl.getAttribute("src");
      expect(src, "Timeline Mix must load a rendered preview file, not the raw source").toBeTruthy();
      expect(src).not.toContain(FIXTURES.a.name);
      expect(src).not.toContain(FIXTURES.b.name);

      const playBtn = page.locator('button[title="Stop (resets to 0)"]').locator("..").locator("button").nth(1);
      await playBtn.click();
      await page.waitForTimeout(800);
      const playing = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);
      expect(playing, "Timeline Mix must actually play the rendered composition").toBe(true);
   });

   test("removing a track clears its clips without corrupting the other track", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.3);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await dragClipToTrack(page, "Clip 1", 0, 0.05);
      await page.locator('[data-testid="add-track"]').click();
      await dragClipToTrack(page, "Clip 1", 1, 0.3);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      // Delete track 2 via its trash icon in the fixed header column (confirm the in-app dialog).
      await page.locator('[data-testid="track-header"]').nth(1).locator('button[title="Delete track"]').click();
      await acceptAppDialog(page);
      await page.waitForTimeout(200);

      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });
});
