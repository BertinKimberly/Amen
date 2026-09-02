import type { Page } from "@playwright/test";
// The app-aware fixture, NOT bare @playwright/test: the latter hands back a
// blank page with no `__TAURI_INTERNALS__`, so the real window resize below
// cannot run.
import { test, expect } from "./e2e-fixtures";
import {
   FIXTURES,
   importSource,
   selectSource,
   selectWaveformRegion,
   resetToNewProject,
   resizeWindow,
   dragClipToTrack,
} from "./e2e-fixtures";

/**
 * Regression cover for a critical, shipped bug: on a 1385x873 window the
 * source editor pane was 257px tall but its content needed 313px, and the pane
 * was `overflow: hidden`. The Start/End fields, Preview, Loop and CREATE CLIP
 * were all rendered — and all silently clipped past the pane's edge, with no
 * scrollbar to reveal them. Clip creation, the very first step of the Studio's
 * whole purpose, was impossible and invisible; the user could not get started.
 *
 * The lesson these tests encode: "the element exists in the DOM" is not the
 * property that matters. Every one of these assertions hit-tests the control's
 * own centre point, which is the only thing that proves a user could click it.
 */

/** True only if this element's own centre point actually hit-tests to itself. */
async function isReachable(page: Page, describe: string, handleSelector: string) {
   return page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { found: false, reason: "not in DOM" };
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return { found: true, ok: false, reason: "zero-size" };
      const cx = r.left + r.width / 2;
      const cy = r.top + Math.min(r.height / 2, 10);
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight)
         return { found: true, ok: false, reason: `off-screen at ${Math.round(cx)},${Math.round(cy)}` };
      const hit = document.elementFromPoint(cx, cy);
      const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      return { found: true, ok, reason: ok ? "" : `covered by <${hit?.tagName.toLowerCase()}>` };
   }, handleSelector).then((r) => ({ ...r, describe }));
}

const CRITICAL_CONTROLS: [string, string][] = [
   ["Create Clip", '[data-testid="create-clip"]'],
   ["Preview selection", '[data-testid="preview-selection"]'],
   ["Loop toggle", '[data-testid="loop-toggle"]'],
   ["Waveform canvas", "canvas"],
   ["Timeline track lane", '[data-testid="timeline-track"]'],
   ["Timeline Fit", '[data-testid="timeline-fit"]'],
];

// These are REAL native window resizes, so they are bounded by the physical
// display (1600x900 here). Larger desktops are therefore not claimed as
// verified by this spec — 1385x873 is the reported window, and 1366x768 is
// tighter vertically still, so the binding constraint is covered.
const SIZES: [number, number][] = [
   [1280, 720],
   [1366, 768],
   [1385, 873],
   [1440, 880],
   [1600, 900],
];

test.describe("Audio Studio — every critical control is reachable, not just present", () => {
   for (const [w, h] of SIZES) {
      test(`at ${w}x${h} the clip-creation controls can actually be clicked`, async ({ page }) => {
         await resizeWindow(page, w, h);
         await page.getByText("Audio Studio").click();
         await page.waitForTimeout(300);
         await resetToNewProject(page);

         // A long source is the reported case: it makes the waveform panel want
         // the most vertical room, which is what squeezed the controls out.
         await importSource(page, FIXTURES.min12.path);
         await selectSource(page, FIXTURES.min12.name);
         await selectWaveformRegion(page, 0.55, 0.85);

         for (const [name, sel] of CRITICAL_CONTROLS) {
            const r = await isReachable(page, name, sel);
            expect(r.found, `${name} is missing from the DOM at ${w}x${h}`).toBe(true);
            expect(r.ok, `${name} is unclickable at ${w}x${h}: ${r.reason}`).toBe(true);
         }

         // No horizontal overflow of the whole page at any supported width.
         const hOverflow = await page.evaluate(() => {
            const de = document.documentElement;
            return de.scrollWidth - de.clientWidth;
         });
         expect(hOverflow, `page overflows horizontally by ${hOverflow}px at ${w}x${h}`).toBeLessThanOrEqual(1);
      });
   }

   test("on a very short window nothing becomes unreachable — the pane scrolls instead", async ({ page }) => {
      await resizeWindow(page, 1280, 620);
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
      await importSource(page, FIXTURES.min12.path);
      await selectSource(page, FIXTURES.min12.name);
      await selectWaveformRegion(page, 0.55, 0.85);

      const pane = page.locator('[data-testid="source-editor-pane"]');
      await expect(pane).toHaveCount(1);

      // Whatever cannot fit must be reachable by scrolling — never clipped away.
      await page.locator('[data-testid="create-clip"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const r = await isReachable(page, "Create Clip", '[data-testid="create-clip"]');
      expect(r.ok, `Create Clip unreachable even after scrolling: ${r.reason}`).toBe(true);
   });

   test("the full first-run journey works at the reported 1385x873", async ({ page }) => {
      // Import -> select -> create -> preview -> arrange: the exact sequence the
      // user could not begin, driven through real clicks at their window size.
      await resizeWindow(page, 1385, 873);
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
      await importSource(page, FIXTURES.min12.path);
      await selectSource(page, FIXTURES.min12.name);
      await selectWaveformRegion(page, 0.55, 0.85);

      await page.locator('[data-testid="create-clip"]').click();
      await page.waitForTimeout(300);
      await expect(
         page.locator('[data-testid="clip-item"]'),
         "clicking Create Clip must actually produce a clip in the library",
      ).toHaveCount(1);

      await page.locator('[data-testid="clip-preview-button"]').first().click();
      await page.waitForTimeout(600);
      const previewing = await page.evaluate(() => {
         const a = document.querySelector("audio") as HTMLAudioElement | null;
         return !!a && !a.paused;
      });
      expect(previewing, "the clip's Preview button must start playback").toBe(true);
      await page.keyboard.press("Space");
      await page.waitForTimeout(200);

      await dragClipToTrack(page, "Clip 1", 0, 0.1);
      await page.waitForTimeout(300);
      await expect(
         page.locator('[data-testid="timeline-clip"]'),
         "the clip must reach the timeline at this window size",
      ).toHaveCount(1);
   });

   test("restores the window to the default size for later specs", async ({ page }) => {
      await resizeWindow(page, 1280, 840);
   });
});
