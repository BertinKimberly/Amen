import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   FIXTURES,
} from "./e2e-fixtures";

async function createOneClip(page: any) {
   await importSource(page, FIXTURES.a.path);
   await selectSource(page, FIXTURES.a.name);
   await selectWaveformRegion(page, 0.1, 0.5);
   await page.getByRole("button", { name: "Create Clip", exact: true }).click();
   await page.waitForTimeout(200);
}

test.describe("Audio Studio — timeline drag & drop (pointer-based)", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("dragging a clip over the timeline shows a live drop indicator with no disabled cursor", async ({ page }) => {
      await createOneClip(page);

      const clip = page.locator('[data-testid="clip-item"]').first();
      const track = page.locator('[data-testid="timeline-track"]').first();
      const clipBox = await clip.boundingBox();
      const trackBox = await track.boundingBox();
      if (!clipBox || !trackBox) throw new Error("missing geometry");

      await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
      await page.mouse.down();
      // Move partway toward the track — this must promote to an active drag.
      await page.mouse.move(trackBox.x + 100, trackBox.y + trackBox.height / 2, { steps: 8 });
      await page.waitForTimeout(150);

      await expect(page.locator('[data-testid="clip-drag-ghost"]')).toBeVisible();
      await expect(page.locator('[data-testid="drop-indicator"]')).toBeVisible();
      await page.screenshot({ path: "test-results/02-clip-dragging-over-timeline.png" });

      await page.mouse.up();
      await page.waitForTimeout(200);
   });

   test("dropping a clip on the timeline commits it at the drop position", async ({ page }) => {
      await createOneClip(page);
      await dragClipToTrack(page, "Clip 1", 0, 0.15);

      const placed = page.locator('[data-testid="timeline-clip"]');
      await expect(placed).toHaveCount(1);
      await page.screenshot({ path: "test-results/03-clip-dropped-on-timeline.png" });

      const style = await placed.first().getAttribute("style");
      const leftMatch = style?.match(/left:\s*([\d.]+)px/);
      expect(leftMatch, "dropped clip must have a concrete left/position").not.toBeNull();
      expect(parseFloat(leftMatch![1])).toBeGreaterThan(0);
   });

   test("moving a placed clip updates its position", async ({ page }) => {
      await createOneClip(page);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();
      expect(before).not.toBeNull();

      // Drag the placed item itself further right. The displacement is
      // measured from the GRAB POINT, not from the clip's left edge — the
      // timeline's zoom now fits the composition, so a single clip can be
      // most of the viewport wide and "move to x+250" would be a move of
      // 250 minus half the clip's width, i.e. barely a move at all.
      const grabX = before!.x + Math.min(before!.width / 2, 40);
      const grabY = before!.y + before!.height / 2;
      const DRAG_PX = 200;
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX + DRAG_PX, grabY, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const after = await item.boundingBox();
      expect(
         after!.x - before!.x,
         `clip should have followed the pointer ~${DRAG_PX}px`,
      ).toBeGreaterThan(DRAG_PX * 0.6);
      expect(after!.width, "a move must not resize the clip").toBeCloseTo(before!.width, 0);
   });

   test("trimming the right handle shortens the clip without changing its start", async ({ page }) => {
      await createOneClip(page);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();
      expect(before).not.toBeNull();

      const TRIM_PX = 60;
      const handle = page.locator('[data-testid="trim-handle-right"]').first();
      const handleBox = await handle.boundingBox();
      expect(handleBox).not.toBeNull();

      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x - TRIM_PX, handleBox!.y + handleBox!.height / 2, { steps: 8 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const after = await item.boundingBox();
      expect(after!.x, "trimming the right edge must not move the clip's start").toBeCloseTo(before!.x, 0);
      // The clip must shrink by the distance the handle was actually dragged.
      // The previous "at least 15% narrower" threshold was unsatisfiable by
      // construction: this drag is 60px, and the clip renders ~540px wide, so
      // even a perfect trim only removes ~11%. Asserting against TRIM_PX is
      // both stricter (it pins the exact amount, not a floor) and honest about
      // what the gesture asks for.
      expect(
         before!.width - after!.width,
         `dragging the handle ${TRIM_PX}px left must narrow the clip by the same amount`,
      ).toBeGreaterThan(TRIM_PX * 0.8);
      expect(before!.width - after!.width).toBeLessThan(TRIM_PX * 1.2);
   });

   test("adding a second track and dragging a clip onto it works independently of track 1", async ({ page }) => {
      await createOneClip(page);
      await page.locator('[data-testid="add-track"]').click();
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);

      await dragClipToTrack(page, "Clip 1", 1, 0.2);
      const items = page.locator('[data-testid="timeline-clip"]');
      await expect(items).toHaveCount(1);

      const track2Box = await page.locator('[data-testid="timeline-track"]').nth(1).boundingBox();
      const itemBox = await items.first().boundingBox();
      expect(itemBox!.y).toBeGreaterThanOrEqual(track2Box!.y - 2);
      expect(itemBox!.y).toBeLessThanOrEqual(track2Box!.y + track2Box!.height);
   });

   test("timeline zoom in/out/Fit all change the rendered scale", async ({ page }) => {
      await createOneClip(page);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const widthAt1x = (await item.boundingBox())!.width;

      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.locator('[data-testid="timeline-zoom-in"]').click();
      await page.waitForTimeout(100);
      const widthZoomedIn = (await item.boundingBox())!.width;
      expect(widthZoomedIn).toBeGreaterThan(widthAt1x);

      await page.locator('[data-testid="timeline-zoom-out"]').click();
      await page.locator('[data-testid="timeline-zoom-out"]').click();
      await page.locator('[data-testid="timeline-zoom-out"]').click();
      await page.waitForTimeout(100);
      const widthZoomedOut = (await item.boundingBox())!.width;
      expect(widthZoomedOut).toBeLessThan(widthZoomedIn);

      await page.locator('[data-testid="timeline-fit"]').click();
      await page.waitForTimeout(100);
      await expect(item).toBeVisible();
   });
});
