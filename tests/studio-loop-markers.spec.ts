import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   resetToNewProject,
   enableE2EMode,
   queueDialogPath,
   FIXTURES,
} from "./e2e-fixtures";

test.describe("Audio Studio — loop playback", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("looping a selection replays it instead of stopping at its end", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      // A short selection near the start of the 8s source so the loop wraps quickly.
      await selectWaveformRegion(page, 0.05, 0.15);

      const loopBtn = page.locator('[data-testid="loop-toggle"]');
      await expect(loopBtn).toHaveAttribute("aria-pressed", "false");
      await loopBtn.click();
      await expect(loopBtn).toHaveAttribute("aria-pressed", "true");

      await page.locator('button[title="Preview selection"]').click();
      await page.waitForTimeout(150);

      const audioEl = page.locator("audio");
      const selEnd = await page.evaluate(() => {
         const text = document.body.innerText;
         const m = text.match(/Selection: (\d+):(\d+\.\d+) → (\d+):(\d+\.\d+)/);
         if (!m) return null;
         return parseInt(m[3]) * 60 + parseFloat(m[4]);
      });
      expect(selEnd).not.toBeNull();

      // Wait past where a non-looping preview would have stopped, plus enough
      // for at least one more loop iteration.
      await page.waitForTimeout(((selEnd as number) + 1.5) * 1000);

      const stillPlaying = await audioEl.evaluate((el: HTMLAudioElement) => !el.paused);
      expect(stillPlaying, "looping playback must still be playing well past the selection end").toBe(true);

      const currentTime = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      expect(currentTime, "a real loop-back must have reset playback near the selection start, not kept advancing").toBeLessThan((selEnd as number));

      // Turning the loop off and letting it reach the end again must stop playback normally.
      await loopBtn.click();
      await expect(loopBtn).toHaveAttribute("aria-pressed", "false");
      await page.waitForTimeout(((selEnd as number) + 1.5) * 1000);
      const stoppedAfterLoopOff = await audioEl.evaluate((el: HTMLAudioElement) => el.paused);
      expect(stoppedAfterLoopOff, "disabling loop must let the next end-of-selection stop playback normally").toBe(true);
   });
});

test.describe("Audio Studio — markers (cue points)", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("adding a marker places it, jumping to it seeks exactly, and it persists through save/reopen", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);

      // Seek to a known position, then add a marker there.
      const seekBar = page.locator('input[type="range"]').first();
      const box = await seekBar.boundingBox();
      await page.mouse.click(box!.x + box!.width * 0.4, box!.y + box!.height / 2);
      await page.waitForTimeout(150);
      const playheadAtMark = await page.evaluate(() => {
         const el = document.querySelector("audio") as HTMLAudioElement | null;
         return el?.currentTime ?? null;
      });

      await page.getByRole("button", { name: "Add Marker", exact: true }).click();
      const markers = page.locator('[data-testid="waveform-marker"]');
      await expect(markers).toHaveCount(1);

      // Seek elsewhere, then jump back via the marker — must land exactly on it.
      await page.mouse.click(box!.x + box!.width * 0.9, box!.y + box!.height / 2);
      await page.waitForTimeout(100);
      await markers.first().locator("button").first().click();
      await page.waitForTimeout(150);
      const audioEl = page.locator("audio");
      const afterJump = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
      expect(Math.abs(afterJump - (playheadAtMark as number)), "jumping to a marker must seek exactly to its time").toBeLessThan(0.15);

      // Save, reload, reopen — the marker must survive the round trip.
      const projectPath = path.join(os.tmpdir(), `amen-e2e-marker-${Date.now()}.lms`);
      await enableE2EMode(page);
      await queueDialogPath(page, projectPath);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(400);
      const saved = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
      expect(saved.sources[0].markers).toHaveLength(1);

      await page.reload();
      await page.waitForTimeout(1000);
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await enableE2EMode(page);
      await queueDialogPath(page, projectPath);
      await page.getByRole("button", { name: "Open Project" }).or(page.getByRole("button", { name: "Open", exact: true })).first().click();
      await page.waitForTimeout(800);
      await selectSource(page, FIXTURES.a.name);
      await expect(page.locator('[data-testid="waveform-marker"]')).toHaveCount(1);

      // Remove it.
      await page.locator('[data-testid="waveform-marker"]').hover();
      await page.locator('[data-testid="waveform-marker"] button[title="Remove marker"]').click();
      await expect(page.locator('[data-testid="waveform-marker"]')).toHaveCount(0);

      fs.unlinkSync(projectPath);
   });
});
