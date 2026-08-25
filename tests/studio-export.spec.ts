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
   acceptAppDialog,
   getAppDialogMessage,
   cancelAppDialog,
   FIXTURES,
} from "./e2e-fixtures";

const FFPROBE = "C:\\Users\\user\\AppData\\Local\\Amen\\tools\\ffprobe.exe";

function probeDuration(filePath: string): number {
   const out = execFileSync(FFPROBE, [
      "-v", "quiet", "-print_format", "json", "-show_format", filePath,
   ]).toString();
   const json = JSON.parse(out);
   return parseFloat(json.format.duration);
}

test.describe("Audio Studio — export produces a correct, real audio file", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("exporting a single-clip composition writes a real WAV matching the timeline duration", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.0, 0.5);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      // Read the ACTUAL clip duration the app recorded, rather than assuming
      // the waveform-selection fraction maps exactly to a time span.
      const clipDurationText = await page.locator('[data-testid="clip-item"]').first().locator("text=/\\(\\d+:\\d+\\.\\d+\\)/").textContent();
      const m = clipDurationText!.match(/\((\d+):(\d+\.\d+)\)/);
      let expectedDuration = parseInt(m![1]) * 60 + parseFloat(m![2]);

      await dragClipToTrack(page, "Clip 1", 0, 0.02);
      await page.waitForTimeout(150);

      // Read back the clip's ACTUAL rendered position (left px / scale) rather
      // than assuming where the pointer drop landed — the track element's
      // width is its full scrollable content width, not the visible viewport,
      // so a fractional xFrac doesn't map to a predictable time offset.
      const placedItem = page.locator('[data-testid="timeline-clip"]').first();
      const style = await placedItem.getAttribute("style");
      const leftPx = parseFloat(style!.match(/left:\s*([\d.]+)px/)![1]);
      const pxPerSecond = parseFloat(
         (await page.locator('[data-testid="timeline-container"]').getAttribute("data-px-per-second")) || "60",
      );
      const actualPosition = leftPx / pxPerSecond;
      expectedDuration += actualPosition;

      const outPath = path.join(os.tmpdir(), `amen-e2e-export-${Date.now()}.wav`);
      await enableE2EMode(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await page.locator('[data-testid="export-format-select"]').selectOption("wav");
      await queueDialogPath(page, outPath);
      await page.getByRole("button", { name: "Export", exact: true }).last().click();

      // The success dialog asks "Open the file now?" — decline it.
      await cancelAppDialog(page);

      expect(fs.existsSync(outPath), `exported file should exist at ${outPath}`).toBe(true);
      const stat = fs.statSync(outPath);
      expect(stat.size).toBeGreaterThan(10_000);

      const duration = probeDuration(outPath);
      expect(
         Math.abs(duration - expectedDuration),
         `exported duration (${duration}s) should match the clip's real duration (${expectedDuration}s)`,
      ).toBeLessThan(0.3);

      fs.unlinkSync(outPath);
   });

   test("export with an empty timeline fails cleanly with a visible error, not a stuck loading state", async ({ page }) => {
      await enableE2EMode(page);
      // Import a source so the toolbar (and Export button) exists, but never
      // place any clip on the timeline.
      await importSource(page, FIXTURES.a.path);

      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await queueDialogPath(page, path.join(os.tmpdir(), `amen-e2e-empty-${Date.now()}.wav`));
      await page.getByRole("button", { name: "Export", exact: true }).last().click();

      const message = await getAppDialogMessage(page);
      expect(message.toLowerCase(), "an empty-timeline export must surface a clear error").toContain("fail");
      await acceptAppDialog(page);

      // The export button must not be stuck in a permanent loading state.
      const exportBtnStillUsable = await page
         .getByRole("button", { name: "Export", exact: true })
         .first()
         .isEnabled();
      expect(exportBtnStillUsable).toBe(true);
   });
});
