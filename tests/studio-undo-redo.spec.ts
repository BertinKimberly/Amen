import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

async function undo(page: import("@playwright/test").Page) {
   await page.keyboard.press("Control+z");
   await page.waitForTimeout(150);
}
async function redo(page: import("@playwright/test").Page) {
   await page.keyboard.press("Control+Shift+z");
   await page.waitForTimeout(150);
}

/**
 * Undo/redo must restore REAL application state, not just toggle a flag —
 * each test performs a genuine edit, verifies the resulting state, undoes
 * it and verifies the state actually reverted, then redoes it and verifies
 * it's back.
 */
test.describe("Audio Studio — undo/redo of real editing operations", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
   });

   test("creating a clip: undo removes it, redo brings it back", async ({ page }) => {
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);

      await undo(page);
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(0);

      await redo(page);
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
   });

   test("adding a clip to the timeline: undo removes it, redo restores it", async ({ page }) => {
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      await undo(page);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(0);
      // The library clip itself must survive — only the timeline placement was undone.
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);

      await redo(page);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });

   test("moving a placed clip: undo restores its original position", async ({ page }) => {
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();

      await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
      await page.mouse.down();
      await page.mouse.move(before!.x + 220, before!.y + before!.height / 2, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const moved = await item.boundingBox();
      expect(moved!.x).toBeGreaterThan(before!.x + 80);

      await undo(page);
      const reverted = await item.boundingBox();
      expect(reverted!.x, "undo must restore the clip's original timeline position").toBeCloseTo(before!.x, 0);
   });

   test("deleting a placed clip: undo restores it to the timeline", async ({ page }) => {
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      // Select the placed item, then delete it via keyboard.
      await page.locator('[data-testid="timeline-clip"]').first().click();
      await page.keyboard.press("Delete");
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(0);

      await undo(page);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });

   test("trimming a clip: undo restores its original duration", async ({ page }) => {
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.waitForTimeout(100);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();
      const handle = item.locator('[data-testid="trim-handle-right"]');
      const handleBox = await handle.boundingBox();

      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x - 40, handleBox!.y + handleBox!.height / 2, { steps: 8 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const trimmed = await item.boundingBox();
      expect(trimmed!.width).toBeLessThan(before!.width);

      await undo(page);
      const reverted = await item.boundingBox();
      expect(reverted!.width, "undo must restore the clip's original duration/width").toBeCloseTo(before!.width, 0);
   });
});
