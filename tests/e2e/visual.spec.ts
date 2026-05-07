// Visual regression: render the app at a deterministic state and compare
// the canvas pixels against the committed baseline. Snapshot updates land
// via the update-snapshots workflow (manual trigger) so noisy automatic
// updates do not creep into main without review.

import { test, expect } from "@playwright/test";

test.describe("visual baseline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?test=1&seed=42");
    await page.waitForFunction(() => (window as any).__TEST__?.ready === true,
                               undefined, { timeout: 10_000 });
  });

  test("Block pattern at default zoom", async ({ page }) => {
    await page.evaluate(() => {
      const t = (window as any).__TEST__;
      t.clear();
      t.setRuleset(0);
      // Block pattern is the default initial layout. After clear we step once
      // so that any rng-dependent visual state is washed out.
      t.advanceTime(0);
    });
    // Allow rAF render loop one frame to settle.
    await page.waitForTimeout(50);
    const canvas = page.locator('canvas[aria-label="GolHex hexagonal cellular automaton canvas"]');
    await expect(canvas).toHaveScreenshot("block-default.png");
  });

  test("Random seed=42 after 30 steps under B2/S34", async ({ page }) => {
    await page.evaluate(() => {
      const t = (window as any).__TEST__;
      t.clear();
      t.setRuleset(0);
      t.randomize();
      t.step(30);
    });
    await page.waitForTimeout(50);
    const canvas = page.locator('canvas[aria-label="GolHex hexagonal cellular automaton canvas"]');
    await expect(canvas).toHaveScreenshot("random-seed42-30steps.png");
  });
});
