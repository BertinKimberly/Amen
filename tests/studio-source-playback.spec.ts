import { test, expect } from "./e2e-fixtures";
import { importSource, selectSource, selectWaveformRegion, resetToNewProject, FIXTURES } from "./e2e-fixtures";

test.describe("Audio Studio — source import & playback", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("imports a real audio source and it appears in the Sources panel", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await expect(page.locator(`text=${FIXTURES.a.name}`).first()).toBeVisible();
      // Real ffprobe-derived duration must be shown (0:08.000), not a placeholder.
      await expect(page.locator("text=0:08.000")).toBeVisible();
   });

   test("selecting a source loads and renders its real waveform", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box?.width).toBeGreaterThan(100);

      // The canvas must actually contain drawn waveform pixels, not be blank.
      const hasContent = await canvas.evaluate((el: HTMLCanvasElement) => {
         const ctx = el.getContext("2d")!;
         const data = ctx.getImageData(0, 0, el.width, el.height).data;
         let nonBackground = 0;
         for (let i = 0; i < data.length; i += 4) {
            // background is #0f172a; count pixels that differ noticeably
            if (Math.abs(data[i] - 0x0f) > 10 || Math.abs(data[i + 1] - 0x17) > 10) nonBackground++;
         }
         return nonBackground;
      });
      expect(hasContent).toBeGreaterThan(50);
      await page.screenshot({ path: "test-results/01-waveform-rendered.png" });
   });

   test("play, pause, and seek control real audio playback", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);

      const playBtn = page.locator('button[title="Stop (resets to 0)"]').locator("..").locator("button").nth(1);
      await playBtn.click();
      await page.waitForTimeout(800);

      const audioEl = page.locator("audio");
      const isPlaying = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);
      expect(isPlaying, "audio element should actually be playing with advancing currentTime").toBe(true);

      await playBtn.click(); // pause
      await page.waitForTimeout(200);
      const t1 = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      await page.waitForTimeout(400);
      const t2 = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      expect(Math.abs(t2 - t1), "currentTime must not advance while paused").toBeLessThan(0.05);

      // Seek via keyboard (ArrowRight = +5s)
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      const t3 = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      expect(t3).toBeGreaterThan(t1 + 3);
   });

   test("waveform drag-selection stays in sync with manual Start/End time inputs", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);

      await selectWaveformRegion(page, 0.2, 0.6);
      await expect(page.locator("text=/Selection:/")).toBeVisible();

      const startInput = page.locator('input[placeholder="00:00.000"]').first();
      const endInput = page.locator('input[placeholder="00:00.000"]').nth(1);
      await expect(startInput).toBeVisible();
      await expect(endInput).toBeVisible();

      // Edit Start manually and confirm Duration recalculates.
      await startInput.click();
      await startInput.fill("0:01.000");
      await startInput.press("Enter");
      await page.waitForTimeout(150);

      const durationText = await page.locator("text=Duration").locator("..").locator("div").last().textContent();
      // End is somewhere around 0:04.8 (60% of 8s); Start now 1.000 -> duration ~3.8s
      expect(durationText).toMatch(/0:0[2-4]\./);
   });

   test("Create Clip then Preview plays ONLY the selected region, not the whole source", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.35); // ~0.8s -> 2.8s of an 8s clip

      const createBtn = page.getByRole("button", { name: "Create Clip", exact: true });
      await createBtn.click();
      await page.waitForTimeout(200);
      await expect(page.locator('[data-testid="clip-item"]').first()).toBeVisible();

      // Re-select the same region (creating the clip doesn't clear it) and preview.
      const previewBtn = page.locator('button[title="Preview selection"]');
      await previewBtn.click();
      await page.waitForTimeout(300);

      const audioEl = page.locator("audio");
      const playing = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused);
      expect(playing).toBe(true);

      // Wait past the selection end and verify playback actually stopped there,
      // instead of continuing to play the rest of the 8s source.
      const selEnd = await page.evaluate(() => {
         const text = document.body.innerText;
         const m = text.match(/Selection: (\d+):(\d+\.\d+) → (\d+):(\d+\.\d+)/);
         if (!m) return null;
         return parseInt(m[3]) * 60 + parseFloat(m[4]);
      });
      expect(selEnd).not.toBeNull();
      await page.waitForTimeout(((selEnd as number) - 0.6) * 1000 + 1200);
      const stillPlaying = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused);
      expect(stillPlaying, "preview must stop at the selection end, not keep playing the full source").toBe(false);
   });
});
