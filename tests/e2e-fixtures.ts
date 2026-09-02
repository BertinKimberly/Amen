// Connects Playwright to the REAL, already-running Tauri desktop app (its
// WebView2 instance) instead of launching a separate browser. This is the
// only reliable way to exercise `invoke()`-backed features (waveform
// extraction, rendering, export, project save/load) end-to-end: a plain
// `vite dev` page in a normal browser has no `window.__TAURI__` bridge at
// all, so any test run that way would necessarily be faking the backend.
//
// Requires the app to already be running with WebView2 remote debugging
// enabled, e.g.:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
//   npm run tauri:dev
import { test as base, chromium, type Page, type BrowserContext } from "@playwright/test";

const CDP_URL = process.env.AMEN_CDP_URL || "http://localhost:9222";

export const test = base.extend<{ page: Page; context: BrowserContext }>({
   context: async ({}, use) => {
      const browser = await chromium.connectOverCDP(CDP_URL);
      const context = browser.contexts()[0];
      if (!context) throw new Error("No browser context found on the running Tauri app.");
      await use(context);
      // Deliberately do not close the browser/context — it's the user's real
      // running app, not a throwaway instance we launched.
   },
   page: async ({ context }, use) => {
      // The Tauri main window is normally the first (and only) page.
      const pages = context.pages();
      const page = pages[0] || (await context.waitForEvent("page"));
      await page.bringToFront();
      await use(page);
   },
});

export { expect } from "@playwright/test";

/** Enable the E2E dialog-bypass bridge (see src/lib/dialog.ts) on this page. */
export async function enableE2EMode(page: Page) {
   await page.evaluate(() => {
      (window as any).__AMEN_E2E__ = true;
      (window as any).__AMEN_E2E_PATHS__ = [];
   });
}

/** Queue up a native-dialog result the next `open()`/`save()` call will return. */
export async function queueDialogPath(page: Page, path: string) {
   await page.evaluate((p) => {
      const w = window as any;
      w.__AMEN_E2E_PATHS__ = w.__AMEN_E2E_PATHS__ || [];
      w.__AMEN_E2E_PATHS__.push(p);
   }, path);
}

/**
 * Native window.confirm/alert/prompt do not reliably surface in this app's
 * Tauri/WebView2 host (confirm() resolves to a truthy stub with no visible
 * UI, prompt() always returns null) — see src/stores/uiDialog.ts. The app
 * uses a real in-app modal (data-testid="ui-dialog-host") instead. These
 * helpers drive THAT modal, which is the genuine UI a real user interacts
 * with in the shipped app.
 */
export async function waitForAppDialog(page: Page, timeout = 5000) {
   await page.locator('[data-testid="ui-dialog-host"]').waitFor({ timeout });
}

export async function acceptAppDialog(page: Page, promptText?: string) {
   await waitForAppDialog(page);
   if (promptText !== undefined) {
      await page.locator('[data-testid="ui-dialog-input"]').fill(promptText);
   }
   await page.locator('[data-testid="ui-dialog-ok"]').click();
}

export async function cancelAppDialog(page: Page) {
   await waitForAppDialog(page);
   await page.locator('[data-testid="ui-dialog-cancel"]').click();
}

export async function getAppDialogMessage(page: Page): Promise<string> {
   await waitForAppDialog(page);
   return (await page.locator('[data-testid="ui-dialog-message"]').textContent()) || "";
}

/** Import an audio file via the (mocked) native file dialog, using a real button click. */
export async function importSource(page: Page, absPath: string) {
   await enableE2EMode(page);
   await queueDialogPath(page, absPath);
   const emptyImportBtn = page.getByRole("button", { name: /Import Audio/i });
   if (await emptyImportBtn.isVisible().catch(() => false)) {
      await emptyImportBtn.click();
   } else {
      await page.locator('button[title="Add audio file"]').click();
   }
   const fileName = absPath.split(/[\\/]/).pop()!;
   await page.locator(`text=${fileName}`).first().waitFor({ timeout: 20000 });
}

/** Click a source row in the Sources panel to select it and load its waveform. */
export async function selectSource(page: Page, fileName: string) {
   await page.locator(`text=${fileName}`).first().click();
   await page.locator("canvas").first().waitFor({ timeout: 20000 });
   // Waveform decoding is a real ffmpeg round-trip; give it a moment to paint.
   await page.waitForTimeout(300);
}

/** Drag-select a region on the waveform canvas (fractional 0..1 of its width). */
export async function selectWaveformRegion(page: Page, fromFrac: number, toFrac: number) {
   const canvas = page.locator("canvas").first();
   const box = await canvas.boundingBox();
   if (!box) throw new Error("Waveform canvas not visible");
   const y = box.y + box.height / 2;
   const x1 = box.x + box.width * fromFrac;
   const x2 = box.x + box.width * toFrac;
   await page.mouse.move(x1, y);
   await page.mouse.down();
   for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x1 + ((x2 - x1) * i) / 8, y, { steps: 1 });
   }
   await page.mouse.up();
}

/**
 * Pointer-based drag of a clip-library card onto a timeline track, at a given
 * fractional X position across the VISIBLE timeline viewport. Mirrors exactly
 * what a real user does: press, move in steps (so the app's move-threshold
 * promotes it to an active drag), release.
 *
 * The fraction is deliberately relative to the scroll container, not to the
 * track element — a track spans the whole scrollable content width, so a
 * fraction of THAT can land at a coordinate outside the window entirely,
 * where no pointer event can be delivered.
 */
export async function dragClipToTrack(
   page: Page,
   clipName: string,
   trackIndex: number,
   xFrac: number,
) {
   const clip = page.locator('[data-testid="clip-item"]', { hasText: clipName }).first();
   const track = page.locator('[data-testid="timeline-track"]').nth(trackIndex);
   const container = page.locator('[data-testid="timeline-container"]');
   const clipBox = await clip.boundingBox();
   const trackBox = await track.boundingBox();
   const containerBox = await container.boundingBox();
   if (!clipBox || !trackBox || !containerBox) throw new Error("Clip or track not visible");

   const startX = clipBox.x + clipBox.width / 2;
   const startY = clipBox.y + clipBox.height / 2;
   const endX = containerBox.x + containerBox.width * xFrac;
   const endY = trackBox.y + trackBox.height / 2;

   await page.mouse.move(startX, startY);
   await page.mouse.down();
   const steps = 12;
   for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
         startX + ((endX - startX) * i) / steps,
         startY + ((endY - startY) * i) / steps,
         { steps: 1 },
      );
      await page.waitForTimeout(15);
   }
   await page.waitForTimeout(50);
   // The composition time the pointer is over AT THE MOMENT OF RELEASE, read
   // from the lane's own origin and scale. This must be captured before the
   // drop: placing a clip can extend the composition, which scrolls the
   // viewport to reveal it, so any expectation re-derived from the timeline's
   // POST-drop scrollLeft describes a coordinate system that did not exist
   // when the user let go — that mismatch, not a placement bug, is what made
   // this look like clips landing in the wrong place.
   const dropTime = await page.evaluate((clientX) => {
      const c = document.querySelector('[data-testid="timeline-container"]') as HTMLElement | null;
      const lane = document.querySelector('[data-testid="timeline-track"]') as HTMLElement | null;
      if (!c || !lane) return null;
      const pps = parseFloat(c.dataset.pxPerSecond || "0");
      if (!pps) return null;
      return Math.max(0, (clientX - lane.getBoundingClientRect().left) / pps);
   }, endX);
   await page.mouse.up();
   await page.waitForTimeout(100);
   return { dropTime };
}

/**
 * Read the timeline's live geometry straight from the DOM contract the
 * component publishes (`data-px-per-second`, per-clip `data-position-seconds`).
 * Tests assert on real seconds this way instead of re-deriving them from
 * pixels, which would just re-implement the maths under test.
 */
export async function readTimelineState(page: Page): Promise<{
   pxPerSecond: number;
   visibleSeconds: number;
   scrollLeft: number;
   scrollWidth: number;
   clientWidth: number;
   rulerLabels: string[];
   clips: { name: string; position: number; duration: number }[];
   duration: number;
}> {
   return page.evaluate(() => {
      const c = document.querySelector('[data-testid="timeline-container"]') as HTMLElement | null;
      if (!c) throw new Error("Timeline container not present");
      const durEl = document.querySelector('[data-testid="composition-summary"]') as HTMLElement | null;
      return {
         pxPerSecond: parseFloat(c.dataset.pxPerSecond || "0"),
         visibleSeconds: parseFloat(c.dataset.visibleSeconds || "0"),
         scrollLeft: c.scrollLeft,
         scrollWidth: c.scrollWidth,
         clientWidth: c.clientWidth,
         rulerLabels: Array.from(
            document.querySelectorAll('[data-testid="timeline-ruler"] span'),
         ).map((e) => (e.textContent || "").trim()),
         clips: Array.from(document.querySelectorAll('[data-testid="timeline-clip"]')).map((e) => {
            const el = e as HTMLElement;
            return {
               name: el.dataset.clipName || "",
               position: parseFloat(el.dataset.positionSeconds || "0"),
               duration: parseFloat(el.dataset.durationSeconds || "0"),
            };
         }),
         duration: parseFloat(durEl?.dataset.compositionDuration || "0"),
      };
   });
}

/** Append a library clip to the end of the active track, via its real button. */
export async function appendClipToTimeline(page: Page, clipName: string) {
   const row = page.locator('[data-testid="clip-item"]', { hasText: clipName }).first();
   await row.hover();
   await row.locator('[data-testid="clip-append-button"]').click();
   await page.waitForTimeout(120);
}

/**
 * Create a clip with EXACT bounds: drag a rough region so the selection
 * controls appear, then type precise Start/End values. Returns the requested
 * duration so callers can assert against it.
 */
export async function createPreciseClip(page: Page, startSec: number, endSec: number): Promise<number> {
   const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${m}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
   };
   await selectWaveformRegion(page, 0.2, 0.3);
   const startInput = page.locator('input[placeholder="00:00.000"]').nth(0);
   const endInput = page.locator('input[placeholder="00:00.000"]').nth(1);
   // End first, then start, then end again: each field clamps against the
   // other, so a single pass can be silently rejected when the new range
   // doesn't overlap the old one.
   await endInput.fill(fmt(endSec));
   await endInput.press("Enter");
   await startInput.fill(fmt(startSec));
   await startInput.press("Enter");
   await endInput.fill(fmt(endSec));
   await endInput.press("Enter");
   await page.waitForTimeout(120);
   await page.getByRole("button", { name: "Create Clip", exact: true }).click();
   await page.waitForTimeout(150);
   return endSec - startSec;
}

export const FIXTURES = {
   a: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-a-440hz-8s.wav", name: "source-a-440hz-8s.wav", duration: 8 },
   b: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-b-660hz-5s.wav", name: "source-b-660hz-5s.wav", duration: 5 },
   long: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-long-40s.wav", name: "source-long-40s.wav", duration: 40 },
   min3: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-3min.wav", name: "source-3min.wav", duration: 180 },
   min5: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-5min.wav", name: "source-5min.wav", duration: 300 },
   min12: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-12min.wav", name: "source-12min.wav", duration: 720 },
};

/**
 * Resize the REAL native Tauri window (not a CDP viewport emulation, which
 * doesn't remap real mouse-input coordinates for this app) via the
 * `core:window:allow-set-size` capability, and wait for the resize to land.
 */
export async function resizeWindow(page: Page, width: number, height: number) {
   const result = await page.evaluate(
      async ({ width, height }) => {
         const internals = (window as any).__TAURI_INTERNALS__;
         try {
            await internals.invoke("plugin:window|set_size", {
               label: "main",
               value: { Logical: { width, height } },
            });
            return { ok: true };
         } catch (e: any) {
            return { ok: false, error: String(e?.message || e) };
         }
      },
      { width, height },
   );
   if (!(result as any).ok) throw new Error("resizeWindow failed: " + (result as any).error);
   await page.waitForTimeout(300);
}

/** Start a brand-new, empty project (accepting the discard-changes prompt if shown). */
export async function resetToNewProject(page: Page) {
   const newBtn = page.getByRole("button", { name: /^New$/ });
   if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      const dialog = page.locator('[data-testid="ui-dialog-host"]');
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
         await acceptAppDialog(page);
      }
      await page.waitForTimeout(200);
   }
}
