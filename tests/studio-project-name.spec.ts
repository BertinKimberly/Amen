// `test`/`expect` come from the project fixture, not @playwright/test: it
// attaches to the running Tauri app over CDP. Importing them from the base
// package hands the spec an empty browser page with no app in it.
import { test, expect } from "./e2e-fixtures";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
   FIXTURES,
   importSource,
   resetToNewProject,
   enableE2EMode,
   queueDialogPath,
} from "./e2e-fixtures";

/**
 * The mix's name is the one piece of identity a user sets by hand, and it was
 * unreachable: the save dialog asked for a filename but the title never changed,
 * and nothing in the UI could edit it.
 */
test.describe("Audio Studio — naming the mix", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   const title = (page: any) => page.locator('[data-testid="studio-title"]');

   test("saving under a chosen filename renames the mix to match", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await expect(title(page)).toHaveText(/Untitled Mix/);

      const out = path.join(os.tmpdir(), `Praise Vol ${Date.now()}.lms`);
      const expectedName = path.basename(out, ".lms");
      await enableE2EMode(page);
      await queueDialogPath(page, out);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(1500);

      expect(fs.existsSync(out), "the project file must be written").toBe(true);
      await expect(
         title(page),
         "the toolbar must show the name chosen in the save dialog, not 'Untitled Mix'",
      ).toHaveText(new RegExp(expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      // The name must be persisted, not just displayed.
      const saved = JSON.parse(fs.readFileSync(out, "utf-8"));
      expect(saved.name).toBe(expectedName);
      fs.unlinkSync(out);
   });

   test("double-clicking the title renames the mix in place", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);

      await title(page).dblclick();
      const input = page.locator('[data-testid="studio-title-input"]');
      await expect(input, "double-click must open an editable field").toBeVisible();

      await input.fill("Sunday Set");
      await input.press("Enter");
      await expect(title(page)).toHaveText(/Sunday Set/);
      await expect(input).toHaveCount(0);
   });

   test("Escape abandons a rename and keeps the previous name", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await title(page).dblclick();
      const input = page.locator('[data-testid="studio-title-input"]');
      await input.fill("Discard me");
      await input.press("Escape");

      await expect(title(page)).toHaveText(/Untitled Mix/);
      await expect(input).toHaveCount(0);
   });

   test("a blank name falls back to the default instead of an empty toolbar", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await title(page).dblclick();
      const input = page.locator('[data-testid="studio-title-input"]');
      await input.fill("   ");
      await input.press("Enter");
      await expect(title(page)).toHaveText(/Untitled Mix/);
   });

   test("renaming is undoable like any other edit", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await title(page).dblclick();
      await page.locator('[data-testid="studio-title-input"]').fill("Take One");
      await page.locator('[data-testid="studio-title-input"]').press("Enter");
      await expect(title(page)).toHaveText(/Take One/);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(300);
      await expect(title(page), "undo must restore the previous name").toHaveText(/Untitled Mix/);
   });
});
