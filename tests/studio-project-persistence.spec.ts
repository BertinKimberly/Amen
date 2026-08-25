import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect } from "./e2e-fixtures";
import {
   importSource,
   selectSource,
   selectWaveformRegion,
   dragClipToTrack,
   resetToNewProject,
   enableE2EMode,
   queueDialogPath,
   FIXTURES,
} from "./e2e-fixtures";

test.describe("Audio Studio — project save & reopen", () => {
   test.beforeEach(async ({ page }) => {
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);
      await resetToNewProject(page);
   });

   test("a saved project reopens with sources, clips, tracks, and positions intact", async ({ page }) => {
      await importSource(page, FIXTURES.a.path);
      await selectSource(page, FIXTURES.a.name);
      await selectWaveformRegion(page, 0.1, 0.4);
      await page.getByRole("button", { name: "Create Clip", exact: true }).click();
      await page.waitForTimeout(150);

      await page.locator('[data-testid="add-track"]').click();
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
      await dragClipToTrack(page, "Clip 1", 1, 0.05);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      const projectPath = path.join(os.tmpdir(), `amen-e2e-project-${Date.now()}.lms`);
      await enableE2EMode(page);
      await queueDialogPath(page, projectPath);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(500);

      expect(fs.existsSync(projectPath), "project file should be written to disk").toBe(true);
      const savedJson = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
      expect(savedJson.sources).toHaveLength(1);
      expect(savedJson.clips).toHaveLength(1);
      expect(savedJson.timeline.tracks).toHaveLength(2);
      expect(savedJson.timeline.tracks[1].items).toHaveLength(1);

      // Reload the page (simulates closing and reopening the app) then reopen the project.
      await page.reload();
      await page.waitForTimeout(1000);
      await page.getByText("Audio Studio").click();
      await page.waitForTimeout(300);

      await enableE2EMode(page);
      await queueDialogPath(page, projectPath);
      const openBtn = page.getByRole("button", { name: "Open Project" }).or(page.getByRole("button", { name: "Open", exact: true }));
      await openBtn.first().click();
      await page.waitForTimeout(800);

      await expect(page.locator(`text=${FIXTURES.a.name}`).first()).toBeVisible();
      await expect(page.locator('[data-testid="clip-item"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(2);
      await expect(page.locator('[data-testid="timeline-clip"]')).toHaveCount(1);

      // The reopened clip must land on the SAME track it was saved on (track 2).
      const track2Box = await page.locator('[data-testid="timeline-track"]').nth(1).boundingBox();
      const clipBox = await page.locator('[data-testid="timeline-clip"]').first().boundingBox();
      expect(clipBox!.y).toBeGreaterThanOrEqual(track2Box!.y - 2);
      expect(clipBox!.y).toBeLessThanOrEqual(track2Box!.y + track2Box!.height);

      fs.unlinkSync(projectPath);
   });
});
