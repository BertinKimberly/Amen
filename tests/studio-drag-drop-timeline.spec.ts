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

      // Drag the placed item itself further right.
      await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
      await page.mouse.down();
      await page.mouse.move(before!.x + 250, before!.y + before!.height / 2, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const after = await item.boundingBox();
      expect(after!.x, "clip should have moved to a new position").toBeGreaterThan(before!.x + 100);
   });

   test("trimming the right handle shortens the clip without changing its start", async ({ page }) => {
      await createOneClip(page);
      await dragClipToTrack(page, "Clip 1", 0, 0.1);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const before = await item.boundingBox();
      expect(before).not.toBeNull();

      const handle = page.locator('[data-testid="trim-handle-right"]').first();
      const handleBox = await handle.boundingBox();
      expect(handleBox).not.toBeNull();

      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x - 60, handleBox!.y + handleBox!.height / 2, { steps: 8 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(150);

      const after = await item.boundingBox();
      expect(after!.x, "trimming the right edge must not move the clip's start").toBeCloseTo(before!.x, 0);
      // A relative threshold, not an absolute pixel count: the timeline's
      // default zoom now adapts to the composition length (~5 min target for
      // longer content), so a fixed 60px drag maps to a different pixel
      // delta at different zoom levels even though the same real trim occurs.
      expect(after!.width, "trimming the right edge must shrink the clip").toBeLessThan(before!.width * 0.85);
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
