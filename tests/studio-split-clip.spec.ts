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
      // Captured in COMPOSITION seconds, not viewport pixels. Splitting changes
      // the arrangement and can scroll the lane, so a before/after comparison
      // of boundingBox().x compares two different coordinate systems — that is
      // what produced the nonsensical "expected -42.65" (the clip's left edge
      // measured while scrolled off the left of the viewport).
      const before = await item.evaluate((e: HTMLElement) => ({
         position: parseFloat(e.dataset.positionSeconds || "0"),
         duration: parseFloat(e.dataset.durationSeconds || "0"),
      }));
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

      const spans = await pieces.evaluateAll((els: Element[]) =>
         els
            .map((e) => ({
               position: parseFloat((e as HTMLElement).dataset.positionSeconds || "0"),
               duration: parseFloat((e as HTMLElement).dataset.durationSeconds || "0"),
            }))
            .sort((a, b) => a.position - b.position),
      );
      const [first, second] = spans;
      // The two pieces must start where the original did, be adjacent with no
      // gap or overlap, and together preserve the original duration exactly.
      expect(first.position, "first piece must start where the original clip started").toBeCloseTo(before.position, 3);
      expect(first.position + first.duration, "pieces must be adjacent with no gap/overlap").toBeCloseTo(second.position, 3);
      expect(
         first.duration + second.duration,
         "the two pieces together must preserve the original total duration",
      ).toBeCloseTo(before.duration, 3);

      // Both pieces must reference the same source clip and remain independently manipulable.
      await pieces.nth(1).click();
      const durationOf = (i: number) =>
         pieces.nth(i).evaluate((e: HTMLElement) => parseFloat(e.dataset.durationSeconds || "0"));
      const secondBefore = await durationOf(1);
      const handle = pieces.nth(1).locator('[data-testid="trim-handle-right"]');
      // This test zooms in twice, so the second piece's right edge lies outside
      // the scroll viewport; a real user scrolls to it before grabbing.
      await handle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const handleBox = await handle.boundingBox();
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x - 20, handleBox!.y + handleBox!.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      expect(await durationOf(1), "trimming the second piece must shorten it").toBeLessThan(secondBefore);
      expect(
         await durationOf(0),
         "trimming the second piece must not affect the first",
      ).toBeCloseTo(first.duration, 3);
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
