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
 * fractional X position along that track's width. Mirrors exactly what a real
 * user does: press, move in steps (so the app's move-threshold promotes it to
 * an active drag), release.
 */
export async function dragClipToTrack(
   page: Page,
   clipName: string,
   trackIndex: number,
   xFrac: number,
) {
   const clip = page.locator('[data-testid="clip-item"]', { hasText: clipName }).first();
   const track = page.locator('[data-testid="timeline-track"]').nth(trackIndex);
   const clipBox = await clip.boundingBox();
   const trackBox = await track.boundingBox();
   if (!clipBox || !trackBox) throw new Error("Clip or track not visible");

   const startX = clipBox.x + clipBox.width / 2;
   const startY = clipBox.y + clipBox.height / 2;
   const endX = trackBox.x + trackBox.width * xFrac;
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
   await page.mouse.up();
   await page.waitForTimeout(100);
}

export const FIXTURES = {
   a: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-a-440hz-8s.wav", name: "source-a-440hz-8s.wav", duration: 8 },
   b: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-b-660hz-5s.wav", name: "source-b-660hz-5s.wav", duration: 5 },
   long: { path: "C:\\Users\\user\\Desktop\\amen\\tests\\fixtures\\source-long-40s.wav", name: "source-long-40s.wav", duration: 40 },
};

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
