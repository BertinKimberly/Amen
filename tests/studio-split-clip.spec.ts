import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

test.describe("Audio Studio — split clip at playhead", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("Split is disabled with nothing selected, and with the playhead outside the selected item", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.6);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const splitBtn = page.locator('[data-testid="timeline-split"]');
      await expect(splitBtn).toBeDisabled();

      const item = page.locator('[data-testid="timeline-clip"]').first();
      await item.click();
      // Playhead defaults to 0, which is the item's own start edge, not strictly inside it.
      await expect(splitBtn).toBeDisabled();
   });

   test("splitting a clip at the playhead produces two independent pieces that together preserve the original duration", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.6); // a wide region of the 8s source
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await dragClipToTrack(page, "Clip 1", 0, 0.02);
      await page.waitForTimeout(150);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();
      await item.click();

      // Seek to roughly the middle of the placed item via the transport seek bar.
      const seekBar = page.locator('input[type="range"]').first();
      const box = await seekBar.boundingBox();
      await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height / 2);
      await page.waitForTimeout(150);

      const splitBtn = page.locator('[data-testid="timeline-split"]');
      // If the playhead didn't land strictly inside, nudge it with arrow keys until it does.
      for (let i = 0; i < 20 && (await splitBtn.isDisabled()); i++) {
         await page.keyboard.press("ArrowRight");
         await page.waitForTimeout(30);
      }
      await expect(splitBtn).toBeEnabled();
      await splitBtn.click();
      await page.waitForTimeout(150);

      const pieces = page.locator('[data-testid="timeline-clip"]');
      await expect(pieces).toHaveCount(2);

      const first = await pieces.nth(0).boundingBox();
      const second = await pieces.nth(1).boundingBox();
      // The two pieces must be adjacent (no gap, no overlap) and together
      // span exactly the original item's width.
      expect(first!.x, "first piece must start where the original clip started").toBeCloseTo(before!.x, 0);
      expect(first!.x + first!.width, "pieces must be adjacent with no gap/overlap").toBeCloseTo(second!.x, 0);
      expect(first!.width + second!.width, "the two pieces together must preserve the original total width").toBeCloseTo(before!.width, 0);

      // Both pieces must reference the same source clip and remain independently manipulable.
      await pieces.nth(1).click();
      const secondBefore = await pieces.nth(1).boundingBox();
      const handle = pieces.nth(1).locator('[data-testid="trim-handle-right"]');
      const handleBox = await handle.boundingBox();
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x - 20, handleBox!.y + handleBox!.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const secondAfter = await pieces.nth(1).boundingBox();
      expect(secondAfter!.width, "trimming the second piece must not affect the first").toBeLessThan(secondBefore!.width);
      const firstUnchanged = await pieces.nth(0).boundingBox();
      expect(firstUnchanged!.width).toBeCloseTo(first!.width, 0);
   });

   test("undo restores the single clip after a split", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.6);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await dragClipToTrack(page, "Clip 1", 0, 0.02);
      await page.waitForTimeout(150);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      await item.click();
      const seekBar = page.locator('input[type="range"]').first();
      const box = await seekBar.boundingBox();
      await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height / 2);
      await page.waitForTimeout(150);

      const splitBtn = page.locator('[data-testid="timeline-split"]');
      for (let i = 0; i < 20 && (await splitBtn.isDisabled()); i++) {
         await page.keyboard.press("ArrowRight");
         await page.waitForTimeout(30);
      }
      await splitBtn.click();
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(2);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });
});
