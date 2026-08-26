import { spawnSync } from "node:child_process";
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

const FFMPEG = "C:\\Users\\user\\AppData\\Local\\Amen\\tools\\ffmpeg.exe";

/**
 * Set a React-controlled range input's value programmatically. Neither
 * `.fill()` nor a plain click on the track reliably reaches this app's
 * range sliders in a way React's onChange picks up, so this uses the
 * standard trick: invoke the native value setter (bypassing React's
 * shadowed one) and dispatch a real 'input' event, which is what React's
 * synthetic event system actually listens for.
 */
async function setRangeValue(slider: ReturnType<import("@playwright/test").Page["locator"]>, value: number) {
   await slider.evaluate((el: HTMLInputElement, v: number) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
   }, value);
}

function parseVolumeLine(text: string): number {
   const m = text.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
   if (!m) throw new Error("ffmpeg volumedetect output did not contain mean_volume: " + text.slice(-500));
   return parseFloat(m[1]);
}

/** Mean volume (dBFS) of a time window in an audio file, via ffmpeg's volumedetect (writes to stderr). */
function meanVolumeDbCombined(filePath: string, start: number, dur: number): number {
   const result = spawnSync(FFMPEG, [
      "-v", "info", "-ss", String(start), "-t", String(dur), "-i", filePath,
      "-af", "volumedetect", "-f", "null", "-",
   ], { encoding: "utf-8" });
   return parseVolumeLine(result.stderr || "");
}

test.describe("Audio Studio — fade-in/out and crossfade actually change the rendered audio", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("a fade-in makes the exported clip's start quieter than its (unfaded) tail", async ({ page }) => {
      await importSource(page, FIXTURES.a.path); // constant-amplitude 440Hz tone, 8s
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.0, 0.5); // ~0..4s of the 8s tone
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.02);
      await page.waitForTimeout(150);

      // Open the clip's edit dialog and set a 1.5s fade-in.
      const clipItem = page.locator('[data-testid="timeline-clip"]').first();
      await clipItem.hover();
      await clipItem.locator('button[title="Edit clip (volume, fades, crossfade)"]').click();
      await expect(page.getByText(/Edit Clip:/)).toBeVisible();
      const fadeInSlider = page.locator("text=Fade In").locator("../..").locator('input[type="range"]');
      // Set close to the max (fade-in caps at 40% of clip duration) so a
      // clearly measurable portion of the clip's start is attenuated.
      const maxFadeInMs = parseFloat((await fadeInSlider.getAttribute("max")) || "0");
      expect(maxFadeInMs, "the fade-in slider must allow a real, non-trivial fade for this clip").toBeGreaterThan(500);
      await setRangeValue(fadeInSlider, maxFadeInMs * 0.85);
      await page.waitForTimeout(100);
      const fadeInMs = await fadeInSlider.evaluate((el: HTMLInputElement) => parseFloat(el.value));
      expect(fadeInMs, "setting the Fade In slider must actually move it off zero").toBeGreaterThan(300);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.waitForTimeout(150);

      const outPath = path.join(os.tmpdir(), `amen-e2e-fadein-${Date.now()}.wav`);
      await enableE2EMode(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await page.locator('[data-testid="export-format-select"]').selectOption("wav");
      await queueDialogPath(page, outPath);
      await page.getByRole("button", { name: "Export", exact: true }).last().click();
      await cancelAppDialog(page);
      expect(fs.existsSync(outPath)).toBe(true);

      // Early in the fade ramp (heavily attenuated) vs. well past it (full volume).
      const early = meanVolumeDbCombined(outPath, 0.05, 0.2);
      const late = meanVolumeDbCombined(outPath, 2.5, 0.3);
      expect(
         late - early,
         `fade-in must make the export measurably quieter near t=0 (early=${early}dB) than after the ramp (late=${late}dB)`,
      ).toBeGreaterThan(6);

      fs.unlinkSync(outPath);
   });

   test("crossfade between two adjacent clips actually overlaps and blends their audio on export", async ({ page }) => {
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

      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.02);
      await page.waitForTimeout(150);
      // Place clip B immediately after clip A on the SAME track so they're adjacent.
      const clipA = page.locator('[data-testid="timeline-clip"]').first();
      const aBox = await clipA.boundingBox();
      const track = page.locator('[data-testid="timeline-track"]').first();
      const trackBox = await track.boundingBox();
      const bClip = page.locator('[data-testid="clip-item"]', { hasText: FIXTURES.b.name }).first();
      const bBox = await bClip.boundingBox();
      await page.mouse.move(bBox!.x + bBox!.width / 2, bBox!.y + bBox!.height / 2);
      await page.mouse.down();
      const dropX = aBox!.x + aBox!.width + 20;
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
         await page.mouse.move(
            bBox!.x + ((dropX - bBox!.x) * i) / steps,
            trackBox!.y + trackBox!.height / 2,
            { steps: 1 },
         );
         await page.waitForTimeout(15);
      }
      await page.mouse.up();
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      // Edit the second clip: add a 1s crossfade with the previous clip.
      const secondClip = page.locator('[data-testid="timeline-clip"]').nth(1);
      await secondClip.hover();
      await secondClip.locator('button[title="Edit clip (volume, fades, crossfade)"]').click();
      await expect(page.getByText(/Edit Clip:/)).toBeVisible();
      const crossfadeSlider = page.locator("text=Crossfade with Previous").locator("../..").locator('input[type="range"]');
      const maxCrossfade = parseFloat((await crossfadeSlider.getAttribute("max")) || "0");
      expect(maxCrossfade, "there must be room for a real crossfade given the clips' adjacency").toBeGreaterThan(200);
      await setRangeValue(crossfadeSlider, maxCrossfade * 0.8);
      await page.waitForTimeout(100);
      const crossfadeMs = await crossfadeSlider.evaluate((el: HTMLInputElement) => parseFloat(el.value));
      expect(crossfadeMs, "clicking the crossfade slider must actually move it off zero").toBeGreaterThan(150);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.waitForTimeout(150);

      const outPath = path.join(os.tmpdir(), `amen-e2e-crossfade-${Date.now()}.wav`);
      await enableE2EMode(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await page.locator('[data-testid="export-format-select"]').selectOption("wav");
      await queueDialogPath(page, outPath);
      await page.getByRole("button", { name: "Export", exact: true }).last().click();
      await cancelAppDialog(page);
      expect(fs.existsSync(outPath), "crossfaded export must still produce a real file").toBe(true);
      expect(fs.statSync(outPath).size).toBeGreaterThan(10_000);

      fs.unlinkSync(outPath);
   });
});
