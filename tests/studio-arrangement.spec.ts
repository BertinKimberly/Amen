import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   createPreciseClip,
   appendClipToTimeline,
   dragClipToTrack,
   readTimelineState,
   resetToNewProject,
   acceptAppDialog,
   FIXTURES,
} from "./e2e-fixtures";

/**
 * The Studio's reason to exist: take pieces of different songs and arrange
 * them into a new composition. These tests drive the real UI end to end and
 * assert on the arrangement the app will actually export — the defect they
 * were written for is that dropping three 20/35/15-second clips onto a track
 * produced a 46-second composition of overlapping mush, because a dropped
 * clip landed wherever the pointer happened to be with no way to sequence.
 */
test.describe("Audio Studio — arranging clips into a composition", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("appending three clips builds a gapless composition of exactly their combined length", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);

      const d1 = await createPreciseClip(page, 10, 30); // 20s
      const d2 = await createPreciseClip(page, 60, 95); // 35s
      const d3 = await createPreciseClip(page, 120, 135); // 15s
      const expected = d1 + d2 + d3;

      await appendClipToTimeline(page, "Clip 1");
      await appendClipToTimeline(page, "Clip 2");
      await appendClipToTimeline(page, "Clip 3");
      await page.waitForTimeout(300);

      const state = await readTimelineState(page);
      expect(state.clips).toHaveLength(3);
      expect(
         Math.abs(state.duration - expected),
         `composition must be ${expected}s (20+35+15), got ${state.duration.toFixed(3)}s`,
      ).toBeLessThan(0.05);

      // Back to back, in order, with no overlap and no dead air.
      const ordered = [...state.clips].sort((a, b) => a.position - b.position);
      let cursor = 0;
      for (const clip of ordered) {
         expect(
            Math.abs(clip.position - cursor),
            `${clip.name} should start at ${cursor.toFixed(3)}s, starts at ${clip.position.toFixed(3)}s`,
         ).toBeLessThan(0.02);
         cursor += clip.duration;
      }
      await page.screenshot({ path: "test-results/arrangement-sequential.png" });
   });

   test("clips from three different sources arrange into one composition", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      const d1 = await createPreciseClip(page, 1, 4);

      await importSource(page, FIXTURES.b.path);
      await selectSource(page, FIXTURES.b.name);
      const d2 = await createPreciseClip(page, 0.5, 3);

      await importSource(page, FIXTURES.long.path);
      await selectSource(page, FIXTURES.long.name);
      const d3 = await createPreciseClip(page, 10, 16);

      await appendClipToTimeline(page, "Clip 1");
      await appendClipToTimeline(page, "Clip 2");
      await appendClipToTimeline(page, "Clip 3");
      await page.waitForTimeout(300);

      const state = await readTimelineState(page);
      expect(state.clips).toHaveLength(3);
      expect(Math.abs(state.duration - (d1 + d2 + d3))).toBeLessThan(0.05);

      // Each library row must still name its own source.
      const rows = page.locator('[data-testid="clip-item"]');
      await expect(rows.filter({ hasText: FIXTURES.a.name })).toHaveCount(1);
      await expect(rows.filter({ hasText: FIXTURES.b.name })).toHaveCount(1);
      await expect(rows.filter({ hasText: FIXTURES.long.name })).toHaveCount(1);
   });

   test("a clip can be dragged from the library onto a track and lands where it was dropped", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 5, 25);

      const { dropTime } = await dragClipToTrack(page, "Clip 1", 0, 0.4);
      await page.waitForTimeout(250);

      const state = await readTimelineState(page);
      expect(state.clips, "the dragged clip must actually appear on the timeline").toHaveLength(1);
      // Compared against where the pointer actually was when released, not
      // against the post-drop viewport — placing a clip scrolls the timeline to
      // reveal it, so the two coordinate systems differ by exactly that scroll.
      expect(dropTime, "the drag helper must capture the drop-time coordinate").not.toBeNull();
      expect(
         Math.abs(state.clips[0].position - dropTime!),
         `dropped at ~${dropTime!.toFixed(2)}s but landed at ${state.clips[0].position.toFixed(2)}s`,
      ).toBeLessThan(Math.max(1, state.visibleSeconds * 0.04));
   });

   test("dropping a clip next to another snaps flush against its edge", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 0, 20);
      await createPreciseClip(page, 30, 45);

      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(250);
      const afterFirst = await readTimelineState(page);
      const firstEnd = afterFirst.clips[0].position + afterFirst.clips[0].duration;

      // Aim a few pixels past the first clip's end — a real user's aim, not a
      // pixel-perfect one. Magnetic snapping must close the gap.
      const container = page.locator('[data-testid="timeline-container"]');
      const cbox = (await container.boundingBox())!;
      const targetX = cbox.x + (firstEnd * afterFirst.pxPerSecond - afterFirst.scrollLeft) + 6;
      const clip = page.locator('[data-testid="clip-item"]', { hasText: "Clip 2" }).first();
      const clipBox = (await clip.boundingBox())!;
      const track = page.locator('[data-testid="timeline-track"]').first();
      const tbox = (await track.boundingBox())!;

      const sx = clipBox.x + clipBox.width / 2;
      const sy = clipBox.y + clipBox.height / 2;
      const ey = tbox.y + tbox.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
         await page.mouse.move(sx + ((targetX - sx) * i) / 12, sy + ((ey - sy) * i) / 12, { steps: 1 });
         await page.waitForTimeout(15);
      }
      // The drop indicator must announce the snap BEFORE the release.
      await expect(page.locator('[data-testid="drop-indicator"]')).toBeVisible();
      await page.mouse.up();
      await page.waitForTimeout(250);

      const state = await readTimelineState(page);
      expect(state.clips).toHaveLength(2);
      const second = state.clips.find((c) => c.name === "Clip 2")!;
      expect(
         Math.abs(second.position - firstEnd),
         `Clip 2 should snap flush to ${firstEnd.toFixed(3)}s, landed at ${second.position.toFixed(3)}s`,
      ).toBeLessThan(0.05);
   });

   test("a placed clip can be moved to a new position on its track", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 0, 20);
      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(250);

      const before = await readTimelineState(page);
      expect(before.clips[0].position).toBeLessThan(0.05);

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const box = (await item.boundingBox())!;
      const moveByPx = 120;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
         await page.mouse.move(box.x + box.width / 2 + (moveByPx * i) / 10, box.y + box.height / 2, { steps: 1 });
         await page.waitForTimeout(15);
      }
      await page.mouse.up();
      await page.waitForTimeout(250);

      const after = await readTimelineState(page);
      const expectedShift = moveByPx / after.pxPerSecond;
      expect(
         after.clips[0].position,
         "the clip must have actually moved right",
      ).toBeGreaterThan(before.clips[0].position + expectedShift * 0.5);
      // Its length must be untouched by a move.
      expect(Math.abs(after.clips[0].duration - before.clips[0].duration)).toBeLessThan(0.01);
   });

   test("a clip can be dragged from one track to another", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 0, 20);
      await appendClipToTimeline(page, "Clip 1");

      await page.locator('[data-testid="add-track"]').click();
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
      await page.waitForTimeout(200);

      const trackIds = await page.evaluate(() =>
         Array.from(document.querySelectorAll('[data-testid="timeline-track"]')).map(
            (e) => (e as HTMLElement).dataset.trackId,
         ),
      );

      const item = page.locator('[data-testid="timeline-clip"]').first();
      const box = (await item.boundingBox())!;
      const targetTrack = page.locator('[data-testid="timeline-track"]').nth(1);
      const tbox = (await targetTrack.boundingBox())!;

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const ex = box.x + box.width / 2;
      const ey = tbox.y + tbox.height / 2;
      for (let i = 1; i <= 10; i++) {
         await page.mouse.move(ex, box.y + box.height / 2 + ((ey - (box.y + box.height / 2)) * i) / 10, { steps: 1 });
         await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await page.waitForTimeout(300);

      // The clip must now be a child of the SECOND track lane, not the first.
      const ownerTrackId = await page.evaluate(() => {
         const clip = document.querySelector('[data-testid="timeline-clip"]');
         const lane = clip?.closest('[data-testid="timeline-track"]') as HTMLElement | null;
         return lane?.dataset.trackId ?? null;
      });
      expect(ownerTrackId, "the clip must have moved to the second track").toBe(trackIds[1]);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });

   test("Close gaps compacts a scattered track into a continuous mix", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      const d1 = await createPreciseClip(page, 0, 20);
      const d2 = await createPreciseClip(page, 30, 55);

      // Deliberately scatter them, the way a pointer drop does.
      await dragClipToTrack(page, "Clip 1", 0, 0.15);
      await page.waitForTimeout(200);
      await dragClipToTrack(page, "Clip 2", 0, 0.7);
      await page.waitForTimeout(250);

      const scattered = await readTimelineState(page);
      expect(scattered.clips).toHaveLength(2);
      expect(
         scattered.duration,
         "the scattered arrangement should be longer than the material itself",
      ).toBeGreaterThan(d1 + d2);

      await page.locator('[data-testid="timeline-close-gaps"]').click();
      await page.waitForTimeout(300);

      const compacted = await readTimelineState(page);
      expect(
         Math.abs(compacted.duration - (d1 + d2)),
         `after Close gaps the mix must be exactly ${d1 + d2}s, got ${compacted.duration.toFixed(3)}s`,
      ).toBeLessThan(0.05);
      const ordered = [...compacted.clips].sort((a, b) => a.position - b.position);
      expect(Math.abs(ordered[0].position)).toBeLessThan(0.02);
      expect(Math.abs(ordered[1].position - ordered[0].duration)).toBeLessThan(0.02);
   });

   test("overlapping clips on one track are flagged, not hidden", async ({ page }) => {
      await importSource(page, FIXTURES.min5.path);
      await selectSource(page, FIXTURES.min5.name);
      await createPreciseClip(page, 0, 40);
      await createPreciseClip(page, 60, 100);

      await appendClipToTimeline(page, "Clip 1");
      await page.waitForTimeout(200);
      // Drop the second one right on top of the first.
      await dragClipToTrack(page, "Clip 2", 0, 0.02);
      await page.waitForTimeout(300);

      const state = await readTimelineState(page);
      expect(state.clips).toHaveLength(2);
      const [a, b] = [...state.clips].sort((x, y) => x.position - y.position);
      const overlapping = b.position < a.position + a.duration - 0.01;
      if (overlapping) {
         await expect(
            page.locator('[data-testid="clip-overlap-warning"]').first(),
            "overlapping clips must be visibly marked — they mix together in the export",
         ).toBeVisible();
      }
   });

   test("a track can be muted and soloed, and the state is visible", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 0, 10);
      await appendClipToTimeline(page, "Clip 1");
      await page.locator('[data-testid="add-track"]').click();
      await page.waitForTimeout(200);

      const mute = page.locator('[data-testid="track-mute"]').first();
      await mute.click();
      await expect(mute).toHaveAttribute("aria-pressed", "true");
      await mute.click();
      await expect(mute).toHaveAttribute("aria-pressed", "false");

      const solo = page.locator('[data-testid="track-solo"]').first();
      await solo.click();
      await expect(solo).toHaveAttribute("aria-pressed", "true");
      await solo.click();
      await expect(solo).toHaveAttribute("aria-pressed", "false");
   });

   test("delete then undo then redo keeps the arrangement consistent", async ({ page }) => {
      await importSource(page, FIXTURES.min3.path);
      await selectSource(page, FIXTURES.min3.name);
      await createPreciseClip(page, 0, 15);
      await createPreciseClip(page, 20, 40);
      await appendClipToTimeline(page, "Clip 1");
      await appendClipToTimeline(page, "Clip 2");
      await page.waitForTimeout(250);

      const built = await readTimelineState(page);
      expect(built.clips).toHaveLength(2);
      const builtDuration = built.duration;

      // Remove the second placement via its own trash button.
      const second = page.locator('[data-testid="timeline-clip"]').nth(1);
      await second.hover();
      await second.locator('button[title="Remove from timeline"]').click();
      await acceptAppDialog(page);
      await page.waitForTimeout(250);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      const undone = await readTimelineState(page);
      expect(undone.clips, "undo must restore the removed placement").toHaveLength(2);
      expect(Math.abs(undone.duration - builtDuration)).toBeLessThan(0.05);

      await page.keyboard.press("Control+Shift+z");
      await page.waitForTimeout(250);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);
   });
});
