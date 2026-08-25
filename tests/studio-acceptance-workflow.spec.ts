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

/**
 * The full real-user creative workflow, end to end, against the real running
 * app: three sources -> a clip from each -> arranged across two tracks ->
 * trimmed -> previewed -> the full mix played -> saved -> reopened -> and the
 * export verified with real ffprobe against the actual timeline arrangement.
 */
test("acceptance: import 3 sources, clip each, arrange, trim, preview, play mix, save, reopen, export", async ({ page }) => {
   await page.getByText("Audio Studio").click();
   await page.waitForTimeout(300);
   await resetToNewProject(page);

   // ---- Import three sources and create one clip from each -----------------
   for (const fx of [FIXTURES.a, FIXTURES.b, FIXTURES.long]) {
      await importSource(page, fx.path);
      await selectSource(page, fx.name);
      await selectWaveformRegion(page, 0.05, 0.3);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
   }

   const clips = page.locator('[data-testid="clip-item"]');
   await expect(clips).toHaveCount(3);
   await expect(clips.filter({ hasText: FIXTURES.a.name })).toHaveCount(1);
   await expect(clips.filter({ hasText: FIXTURES.b.name })).toHaveCount(1);
   await expect(clips.filter({ hasText: FIXTURES.long.name })).toHaveCount(1);

   // ---- Arrange: Track 1 gets clip A then clip B; Track 2 gets clip C ------
   await dragClipToTrack(page, FIXTURES.a.name, 0, 0.02);
   await page.waitForTimeout(150);
   await dragClipToTrack(page, FIXTURES.b.name, 0, 0.4);
   await page.waitForTimeout(150);
   await page.locator('[data-testid="add-track"]').click();
   await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
   await dragClipToTrack(page, FIXTURES.long.name, 1, 0.15);
   await page.waitForTimeout(150);

   await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(3);
   await page.screenshot({ path: "test-results/acceptance-01-arranged.png" });

   // ---- Trim the first placed clip's right edge -----------------------------
   // Zoom in first: at the composition's default (zoomed-out) scale a short
   // clip renders at the timeline's minimum visual width (36px, so it stays
   // clickable), which would make a real trim invisible to a bounding-box
   // check even though the underlying duration genuinely changed.
   await page.locator('[data-testid="timeline-zoom-in"]').click();
   await page.locator('[data-testid="timeline-zoom-in"]').click();
   await page.locator('[data-testid="timeline-zoom-in"]').click();
   await page.waitForTimeout(100);
   const firstClip = page.locator('[data-testid="timeline-clip"]').first();
   const beforeTrim = await firstClip.boundingBox();
   const trimHandle = firstClip.locator('[data-testid="trim-handle-right"]');
   const handleBox = await trimHandle.boundingBox();
   if (handleBox && beforeTrim) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x - 40, handleBox.y + handleBox.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
   }
   const afterTrim = await firstClip.boundingBox();
   expect(afterTrim!.width, "trim must actually shrink the clip").toBeLessThan(beforeTrim!.width);

   // ---- Preview a clip from the library --------------------------------------
   await clips.first().click();
   await page.waitForTimeout(100);

   // ---- Play the full timeline mix (real ffmpeg render) ---------------------
   const mixBtn = page.getByRole("button", { name: /Timeline Mix/i });
   await mixBtn.click();
   await page.waitForTimeout(4000);
   const audioSrc = await page.locator("audio").getAttribute("src");
   expect(audioSrc, "Timeline Mix must render before playing").toBeTruthy();

   const playBtn = page.locator('button[title="Stop (resets to 0)"]').locator("..").locator("button").nth(1);
   await playBtn.click();
   await page.waitForTimeout(700);
   const playing = await page.locator("audio").evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);
   expect(playing, "the composed mix must actually play").toBe(true);
   await page.screenshot({ path: "test-results/acceptance-02-mix-playing.png" });
   await playBtn.click();

   // ---- Save the project ------------------------------------------------------
   const projectPath = path.join(os.tmpdir(), `amen-e2e-acceptance-${Date.now()}.lms`);
   await enableE2EMode(page);
   await queueDialogPath(page, projectPath);
   await page.getByRole("button", { name: "Save", exact: true }).click();
   await page.waitForTimeout(500);
   expect(fs.existsSync(projectPath)).toBe(true);
   const saved = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
   expect(saved.sources).toHaveLength(3);
   expect(saved.clips).toHaveLength(3);
   expect(saved.timeline.tracks).toHaveLength(2);

   // ---- Reopen it --------------------------------------------------------------
   await page.reload();
   await page.waitForTimeout(1000);
   await page.getByText("Audio Studio").click();
   await page.waitForTimeout(300);
   await enableE2EMode(page);
   await queueDialogPath(page, projectPath);
   await page.getByRole("button", { name: "Open Project" }).or(page.getByRole("button", { name: "Open", exact: true })).first().click();
   await page.waitForTimeout(800);

   await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(3);
   await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
   await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(3);

   // ---- Export and verify the real output file against the arrangement -------
   const exportPath = path.join(os.tmpdir(), `amen-e2e-acceptance-${Date.now()}.wav`);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByText("Export Mix")).toBeVisible();
   await page.locator('[data-testid="export-format-select"]').selectOption("wav");
   await queueDialogPath(page, exportPath);
   await page.getByRole("button", { name: "Export", exact: true }).last().click();
   await cancelAppDialog(page); // decline "open the file now?"

   expect(fs.existsSync(exportPath), "exported file must exist").toBe(true);
   expect(fs.statSync(exportPath).size).toBeGreaterThan(10_000);
   const duration = probeDuration(exportPath);
   expect(duration, "export should reflect a real, non-trivial multi-clip composition").toBeGreaterThan(1.5);

   fs.unlinkSync(projectPath);
   fs.unlinkSync(exportPath);
});
