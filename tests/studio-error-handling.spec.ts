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
   cancelAppDialog,
   FIXTURES,
} from "./e2e-fixtures";

test.describe("Audio Studio — error handling & data integrity", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("removing a source asks for confirmation and cascades to its clips and timeline placements, without corrupting the rest of the project", async ({ page }) => {
      // Source A gets a clip placed on the timeline that we'll delete out
      // from under. Source B stays untouched, so the project remains
      // non-empty and genuinely exportable afterward — proving the cascade
      // cleanup didn't collaterally damage unrelated, still-valid content.
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, FIXTURES.a.name, 0, 0.05);

      await importSource(page, FIXTURES.b.path);
      await selectSource(page, FIXTURES.b.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await page.locator('[data-testid="add-track"]').click();
      await dragClipToTrack(page, FIXTURES.b.name, 1, 0.05);

      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      const sourceRow = page.locator('[data-testid="source-item"]', { hasText: FIXTURES.a.name }).first();
      await sourceRow.hover();
      const removeBtn = sourceRow.locator('button[title="Remove"]');

      // Declining the confirmation must leave everything untouched.
      await removeBtn.click();
      await cancelAppDialog(page);
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(2);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      // Accepting must cleanly remove source A AND cascade to its clip and
      // its timeline placement — no orphaned/invisible timeline item left
      // behind that would silently break a future export — while source B's
      // clip and placement survive untouched.
      await removeBtn.click();
      await acceptAppDialog(page);
      await page.waitForTimeout(200);

      await expect(page.locator("text=" + FIXTURES.a.name)).toHaveCount(0);
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="clip-item"]').first()).toContainText(FIXTURES.b.name);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      // The remaining, still-valid composition must still render and export
      // for real — proving the cascade left no dangling reference behind.
      const outPath = path.join(os.tmpdir(), `amen-e2e-cascade-${Date.now()}.wav`);
      await enableE2EMode(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByText("Export Mix")).toBeVisible();
      await page.locator('[data-testid="export-format-select"]').selectOption("wav");
      await queueDialogPath(page, outPath);
      await page.getByRole("button", { name: "Export", exact: true }).last().click();
      await cancelAppDialog(page); // decline "open the file now?"

      const fs = await import("node:fs");
      expect(fs.existsSync(outPath), "the surviving clip's composition must still export after the cascade cleanup").toBe(true);
      fs.unlinkSync(outPath);
   });

   test("typing a Start time past the current End does not invert the selection", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.2, 0.5); // ~1.5s..~3.8s of 8s

      const startInput = page.locator('input[placeholder="00:00.000"]').first();
      const endInput = page.locator('input[placeholder="00:00.000"]').nth(1);
      const endBefore = await endInput.inputValue();

      // Try to push Start past the current End.
      await startInput.click();
      await startInput.fill("0:07.500");
      await startInput.press("Enter");
      await page.waitForTimeout(150);

      const durationText = await page.locator("text=Duration").locator("..").locator("div").last().textContent();
      // Duration must never go to zero or negative — the input must clamp
      // Start to just under End rather than silently producing an inverted
      // or nonsensical selection.
      expect(durationText).not.toMatch(/^0:00\.000/);
      const endAfter = await endInput.inputValue();
      // End should not have silently jumped to accommodate an out-of-range Start.
      expect(endAfter).toBe(endBefore);
   });
});
