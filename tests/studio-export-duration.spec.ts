// Export duration contract, proven through the REAL Studio UI and measured on
// the PHYSICAL file with ffprobe.
//
// The guarantee under test: an exported mix ends exactly where the last
// arranged clip ends. Not where the source ends, not where the timeline ruler
// or viewport ends, and with no silent tail after the final clip.
//
// These tests deliberately read the arrangement back out of the DOM (each
// clip's rendered left/width against the container's px-per-second) rather
// than assuming a pointer drop lands at a predictable time — the drop position
// depends on live zoom and scroll, so the composition's real endpoint is
// whatever the UI actually built, and that is what the export must match.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Page } from "@playwright/test";
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

const FFPROBE = path.join(
   process.env.LOCALAPPDATA || "C:\\Users\\user\\AppData\\Local",
   "Amen",
   "tools",
   "ffprobe.exe",
);
const FFMPEG = FFPROBE.replace("ffprobe.exe", "ffmpeg.exe");

function probeDuration(filePath: string): number {
   const out = execFileSync(FFPROBE, [
      "-v", "quiet", "-print_format", "json", "-show_format", filePath,
   ]).toString();
   return parseFloat(JSON.parse(out).format.duration);
}

/**
 * Where audible signal actually stops. A file can be the right LENGTH while
 * still carrying a silent tail if the duration bound is wrong in a
 * compensating way, so the critical test asserts on real signal, not metadata.
 */
function trailingSilenceStart(filePath: string): number | null {
   let log = "";
   try {
      log = execFileSync(
         FFMPEG,
         ["-hide_banner", "-nostdin", "-i", filePath, "-af",
            "silencedetect=noise=-60dB:d=0.4", "-f", "null", "-"],
         { stdio: ["ignore", "ignore", "pipe"] },
      ).toString();
   } catch (e: any) {
      log = (e.stderr || "").toString();
   }
   const starts = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
   const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
   if (starts.length && starts[starts.length - 1] > (ends[ends.length - 1] ?? -1)) {
      return starts[starts.length - 1];
   }
   return null;
}

/** The composition endpoint the UI is currently showing: max(left+width)/pxPerSecond. */
async function compositionEndFromUi(page: Page): Promise<number> {
   const pxPerSecond = parseFloat(
      (await page.locator('[data-testid="timeline-container"]').getAttribute("data-px-per-second")) || "0",
   );
   expect(pxPerSecond, "timeline must expose its scale").toBeGreaterThan(0);
   const styles = await page
      .locator('[data-testid="timeline-clip"]')
      .evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("style") || ""));
   expect(styles.length, "at least one clip must be placed").toBeGreaterThan(0);
   let end = 0;
   for (const s of styles) {
      const left = parseFloat(s.match(/left:\s*(-?[\d.]+)px/)![1]);
      const width = parseFloat(s.match(/width:\s*([\d.]+)px/)![1]);
      end = Math.max(end, (left + width) / pxPerSecond);
   }
   return end;
}

async function exportTo(page: Page, outPath: string, format: "wav" | "mp3") {
   await enableE2EMode(page);
   await page.getByRole("button", { name: "Export", exact: true }).first().click();
   await expect(page.getByText("Export Mix")).toBeVisible();
   await page.locator('[data-testid="export-format-select"]').selectOption(format);
   await queueDialogPath(page, outPath);
   await page.getByRole("button", { name: "Export", exact: true }).last().click();
   // The success dialog offers "Open the file now?" — decline it.
   await cancelAppDialog(page);
}

/** Build a clip from a fractional region of the currently selected source. */
async function makeClip(page: Page, from: number, to: number) {
   await selectWaveformRegion(page, from, to);
   await page.getByRole("button", { name: "Create Clip", exact: true }).click();
   await page.waitForTimeout(200);
}

test.describe("Studio export — the file ends where the arrangement ends", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("a single clip dragged onto the timeline exports at the arrangement's length, not the source's", async ({ page }) => {
      // A 5-minute source with one short clip taken from it: the classic
      // "exported the whole song" failure would show up as ~300s here.
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await makeClip(page, 0.1, 0.25);
      await dragClipToTrack(page, "Clip 1", 0, 0.02);

      const expected = await compositionEndFromUi(page);
      expect(expected, "sanity: the arrangement is far shorter than the 300s source").toBeLessThan(200);

      const out = path.join(os.tmpdir(), `amen-e2e-single-${Date.now()}.wav`);
      await exportTo(page, out, "wav");

      expect(fs.existsSync(out), `exported file should exist at ${out}`).toBe(true);
      const actual = probeDuration(out);
      expect(
         Math.abs(actual - expected),
         `exported ${actual}s vs arrangement ${expected}s (source is ${FIXTURES.min5.duration}s)`,
      ).toBeLessThan(0.3);
      expect(actual, "must not be anywhere near the source length").toBeLessThan(FIXTURES.min5.duration * 0.9);
      fs.unlinkSync(out);
   });

   test("CRITICAL: no silent tail after the final clip, with a 12-minute source behind the arrangement", async ({ page }) => {
      // The reported bug: the exported file carries a null/empty section after
      // the last clip. Asserted on real signal, not just on the duration field.
      await importSource(page, FIXTURES.min12.path);
      await selectSource(page, FIXTURES.min12.name);
      await makeClip(page, 0.05, 0.09);
      await makeClip(page, 0.5, 0.55);
      await dragClipToTrack(page, "Clip 1", 0, 0.01);
      await dragClipToTrack(page, "Clip 2", 0, 0.1);

      const expected = await compositionEndFromUi(page);
      const out = path.join(os.tmpdir(), `amen-e2e-tail-${Date.now()}.wav`);
      await exportTo(page, out, "wav");

      expect(fs.existsSync(out)).toBe(true);
      const actual = probeDuration(out);
      expect(
         Math.abs(actual - expected),
         `exported ${actual}s vs arrangement ${expected}s (source is ${FIXTURES.min12.duration}s)`,
      ).toBeLessThan(0.3);
      expect(actual, "must be nothing like the 720s source").toBeLessThan(300);

      const silenceFrom = trailingSilenceStart(out);
      expect(
         silenceFrom === null || silenceFrom >= expected - 0.5,
         `trailing silence began at ${silenceFrom}s in a ${actual}s file whose arrangement ends at ${expected}s`,
      ).toBe(true);
      fs.unlinkSync(out);
   });

   test("clips from two different sources export as only their arranged regions", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await importSource(page, FIXTURES.min3.path);

      await selectSource(page, FIXTURES.min5.name);
      await makeClip(page, 0.1, 0.16);
      await selectSource(page, FIXTURES.min3.name);
      await makeClip(page, 0.4, 0.48);

      await dragClipToTrack(page, "Clip 1", 0, 0.01);
      await dragClipToTrack(page, "Clip 2", 0, 0.08);

      const expected = await compositionEndFromUi(page);
      const out = path.join(os.tmpdir(), `amen-e2e-two-src-${Date.now()}.wav`);
      await exportTo(page, out, "wav");

      expect(fs.existsSync(out)).toBe(true);
      const actual = probeDuration(out);
      expect(Math.abs(actual - expected), `exported ${actual}s vs arrangement ${expected}s`).toBeLessThan(0.3);
      fs.unlinkSync(out);
   });

   test("deleting the final clip shortens the exported file", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await makeClip(page, 0.1, 0.15);
      await makeClip(page, 0.5, 0.56);
      await dragClipToTrack(page, "Clip 1", 0, 0.01);
      await dragClipToTrack(page, "Clip 2", 0, 0.12);

      const longEnd = await compositionEndFromUi(page);
      const outLong = path.join(os.tmpdir(), `amen-e2e-del-a-${Date.now()}.wav`);
      await exportTo(page, outLong, "wav");
      const durLong = probeDuration(outLong);
      expect(Math.abs(durLong - longEnd)).toBeLessThan(0.3);

      // Remove the last clip on the timeline, then export again.
      const clipEls = page.locator('[data-testid="timeline-clip"]');
      const count = await clipEls.count();
      expect(count).toBeGreaterThan(1);
      await clipEls.nth(count - 1).click();
      await page.keyboard.press("Delete");
      await page.waitForTimeout(250);
      expect(await clipEls.count(), "one clip should have been removed").toBe(count - 1);

      const shortEnd = await compositionEndFromUi(page);
      expect(shortEnd, "removing the last clip must shorten the composition").toBeLessThan(longEnd - 0.5);

      const outShort = path.join(os.tmpdir(), `amen-e2e-del-b-${Date.now()}.wav`);
      await exportTo(page, outShort, "wav");
      const durShort = probeDuration(outShort);
      expect(
         Math.abs(durShort - shortEnd),
         `after delete: exported ${durShort}s vs arrangement ${shortEnd}s`,
      ).toBeLessThan(0.3);
      expect(durShort, "the exported file must actually get shorter").toBeLessThan(durLong - 0.5);

      fs.unlinkSync(outLong);
      fs.unlinkSync(outShort);
   });

   test("a muted track cannot inflate either the on-screen figure or the exported file", async ({ page }) => {
      // The architectural guarantee: the number the toolbar shows and the
      // number ffprobe reads off the file are the SAME composition. This once
      // diverged 14x — a 20s file announced as 300s — because the UI counted
      // every item while the renderer only rendered audible tracks.
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await makeClip(page, 0.02, 0.06);
      await makeClip(page, 0.5, 0.54);

      await page.locator('[data-testid="add-track"]').click();
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);

      // Clip 1 on the audible track; Clip 2 parked far to the right on track 2.
      await dragClipToTrack(page, "Clip 1", 0, 0.02);
      await dragClipToTrack(page, "Clip 2", 1, 0.85);

      const withBoth = await compositionEndFromUi(page);

      // Mute track 2 — the one holding the furthest-right clip.
      await page.locator('[data-testid="track-mute"]').nth(1).click();
      await page.waitForTimeout(200);

      const shown = parseFloat(
         (await page
            .locator('[data-testid="composition-summary"]')
            .getAttribute("data-composition-duration")) || "0",
      );
      expect(shown, "muting the furthest track must shorten the figure on screen").toBeLessThan(
         withBoth - 1,
      );

      const out = path.join(os.tmpdir(), `amen-e2e-muted-${Date.now()}.wav`);
      await exportTo(page, out, "wav");
      expect(fs.existsSync(out)).toBe(true);

      const actual = probeDuration(out);
      expect(
         Math.abs(actual - shown),
         `the toolbar says ${shown}s but the exported file is ${actual}s`,
      ).toBeLessThan(0.3);

      const silenceFrom = trailingSilenceStart(out);
      expect(
         silenceFrom === null || silenceFrom >= shown - 0.5,
         `muted clip left a silent tail from ${silenceFrom}s in a ${actual}s file`,
      ).toBe(true);
      fs.unlinkSync(out);
   });

   test("the shipping default (MP3) obeys the same duration contract at a sane file size", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await makeClip(page, 0.1, 0.3);
      await dragClipToTrack(page, "Clip 1", 0, 0.02);

      const expected = await compositionEndFromUi(page);
      const out = path.join(os.tmpdir(), `amen-e2e-mp3-${Date.now()}.mp3`);
      await exportTo(page, out, "mp3");

      expect(fs.existsSync(out)).toBe(true);
      const actual = probeDuration(out);
      // MP3 carries encoder delay/padding, so the tolerance is a frame or two
      // wider than for PCM — but still far tighter than any real defect.
      expect(
         Math.abs(actual - expected),
         `exported ${actual}s vs arrangement ${expected}s`,
      ).toBeLessThan(0.35);

      // ~192kbps => ~24KB/s. Guards against a silently-WAV-sized "MP3".
      const kbPerSecond = fs.statSync(out).size / 1024 / actual;
      expect(kbPerSecond, "file size should match a compressed bitrate").toBeLessThan(60);
      expect(kbPerSecond, "file should not be suspiciously tiny").toBeGreaterThan(5);
      fs.unlinkSync(out);
   });
});
