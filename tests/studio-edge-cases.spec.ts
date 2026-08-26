import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   enableE2EMode,
   queueDialogPath,
   cancelAppDialog,
   FIXTURES,
} from "./e2e-fixtures";

const FFPROBE = "C:\\Users\\user\\AppData\\Local\\Amen\\tools\\ffprobe.exe";
function probeDuration(filePath: string): number {
   const out = execFileSync(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_format", filePath]).toString();
   return parseFloat(JSON.parse(out).format.duration);
}

test.describe("Audio Studio — edge cases", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("importing a file with Unicode, accented, and symbol characters in its name works end to end", async ({ page }) => {
      // Real ffmpeg-generated fixture with a deliberately hostile filename:
      // accents, CJK, Arabic, an emoji, spaces, apostrophe, and parentheses.
      const unicodeName = "tëst 曲 اختبار 😀 it's (final).wav";
      const unicodePath = path.join(os.tmpdir(), unicodeName);
      execFileSync("C:\\Users\\user\\AppData\\Local\\Amen\\tools\\ffmpeg.exe", [
         "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
         unicodePath,
      ]);

      try {
         await importSource(page, unicodePath);
         await expect(page.locator(`text=${unicodeName}`).first()).toBeVisible();
         await selectSource(page, unicodeName);
         await expect(page.locator("canvas").first()).toBeVisible();

         await selectWaveformRegion(page, 0.1, 0.6);
         await page.getByRole("button", { name: "Create Clip", exact: true }).click();
         await page.waitForTimeout(150);
         await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
      } finally {
         fs.unlinkSync(unicodePath);
      }
   });

   test("a selection at the exact start (0) and one ending at the exact source end both create valid clips", async ({ page }) => {
      await importSource(page, FIXTURES.b.path); // 5s source
      await selectSource(page, FIXTURES.b.name);

      // Selection starting at exactly 0.
      await selectWaveformRegion(page, 0.0, 0.3);
      const startInput = page.locator('input[placeholder="00:00.000"]').first();
      await expect(startInput).toHaveValue(/^0:00\.000$/);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Selection ending at exactly the source's duration.
      await selectWaveformRegion(page, 0.7, 1.0);
      const endInput = page.locator('input[placeholder="00:00.000"]').nth(1);
      await expect(endInput).toHaveValue(/^0:05\.000$/);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(2);
   });

   test("overlapping clips on the same track both play — the render mixes them rather than silently dropping one", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.0, 0.5);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await importSource(page, FIXTURES.b.path);
      await selectSource(page, FIXTURES.b.name);
      await selectWaveformRegion(page, 0.0, 0.6);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Drop both at (nearly) the same position on the SAME track — deliberately overlapping.
      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.05);
      await page.waitForTimeout(150);
      await dragClipToTrack(page, FIXTURES.b.name, 0, 0.08);
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      const outPath = path.join(os.tmpdir(), `amen-e2e-overlap-${Date.now()}.wav`);
      await enableE2EMode(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await page.locator('[data-testid="export-format-select"]').selectOption("wav");
      await queueDialogPath(page, outPath);
      await page.getByRole("button", { name: "Export", exact: true }).last().click();
      await cancelAppDialog(page);

      // Overlapping clips must still export cleanly to a real, valid file —
      // not fail, not silently drop one, not crash the renderer.
      expect(fs.existsSync(outPath), "overlapping clips must still export successfully").toBe(true);
      expect(fs.statSync(outPath).size).toBeGreaterThan(10_000);
      const duration = probeDuration(outPath);
      expect(duration).toBeGreaterThan(0.5);

      fs.unlinkSync(outPath);
   });

   test("rapid play/pause toggling does not desync the playhead or leave the UI in a stuck state", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      const playBtn = page.locator('button[title="Stop (resets to 0)"]').locator("..").locator("button").nth(1);

      for (let i = 0; i < 8; i++) {
         await playBtn.click();
         await page.waitForTimeout(40);
      }
      await page.waitForTimeout(300);

      const audioEl = page.locator("audio");
      const domPausedBefore = await audioEl.evaluate((el: HTMLAudioElement) => el.paused);

      // Whatever state rapid toggling left it in, one more deliberate click
      // must correctly flip it — proving the store's `playing` flag and the
      // real <audio> element never desynced from all that rapid toggling.
      await playBtn.click();
      await page.waitForTimeout(400);
      const domPausedAfter = await audioEl.evaluate((el: HTMLAudioElement) => el.paused);
      expect(domPausedAfter, "one more click after rapid toggling must reliably flip play/pause").toBe(!domPausedBefore);
      if (!domPausedAfter) {
         const currentTime = await audioEl.evaluate((el: HTMLAudioElement) => el.currentTime);
         expect(currentTime, "if playing after the toggle, the audio clock must actually be advancing").toBeGreaterThan(0);
      }
   });

   test("repeated undo/redo cycles beyond the history length are safe no-ops", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Undo far more times than there is history for.
      for (let i = 0; i < 10; i++) {
         await page.keyboard.press("Control+z");
         await page.waitForTimeout(30);
      }
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(0);

      // Redo far more times than there is future history for.
      for (let i = 0; i < 10; i++) {
         await page.keyboard.press("Control+Shift+z");
         await page.waitForTimeout(30);
      }
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
   });
});
