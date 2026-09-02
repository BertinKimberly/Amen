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
      const positionSeconds = () =>
         item.evaluate((e: HTMLElement) => parseFloat(e.dataset.positionSeconds || "0"));
      // Asserted in COMPOSITION seconds: moving a clip can extend the
      // arrangement and scroll the lane, so before/after viewport pixels are
      // measured in two different coordinate systems.
      const beforeBox = await item.boundingBox();
      const beforePosition = await positionSeconds();

      // Grab near the clip's left edge, not its centre — at the composition-
      // fitting zoom a clip can be most of the lane wide, and grabbing the
      // centre then dragging to x+220 would push the pointer off the viewport.
      const grabX = beforeBox!.x + Math.min(beforeBox!.width / 2, 40);
      const grabY = beforeBox!.y + beforeBox!.height / 2;
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX + 220, grabY, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const movedPosition = await positionSeconds();
      expect(movedPosition, "the clip must have moved later in the composition").toBeGreaterThan(
         beforePosition + 0.5,
      );

      await undo(page);
      await page.waitForTimeout(100);
      expect(
         await positionSeconds(),
         "undo must restore the clip's original timeline position",
      ).toBeCloseTo(beforePosition, 3);
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
      const handle = item.locator('[data-testid="trim-handle-right"]');
      // Zooming in twice makes this clip wider than the lane, so its right
      // edge sits outside the scroll viewport. A real user scrolls to reach
      // the handle; without this the drag targets a coordinate off-screen and
      // simply never touches the clip, which read as "trim is broken".
      await handle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const before = await item.boundingBox();
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
