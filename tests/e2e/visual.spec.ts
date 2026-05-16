// Visual regression: render the app at a deterministic state and compare
// the canvas pixels against the committed baseline.
//
// CI determinism guards (NR-G71):
//   - the FPS counter, GEN counter, gps display, transition badge, and the
//     diagnostic overlay all change between machines or runs and must be
//     masked before the screenshot is taken. We use Playwright's mask=
//     option which renders an opaque pink rectangle over the masked
//     locator BEFORE diffing. Failure to mask these is the #1 source of
//     flakes in canvas-app visual regression (per playwright.dev/docs).
//   - Each test forces a deterministic seed via the bridge so the
//     simulation is reproducible cycle-to-cycle.
//   - Snapshot updates land via the manual update-snapshots workflow so
//     noisy auto-updates do not creep into main without review.

import { test, expect } from "@playwright/test";

test.describe("visual baseline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?test=1&seed=42");
    await page.waitForFunction(() => (window as any).__TEST__?.ready === true,
                               undefined, { timeout: 10_000 });
  });

  // Mask the volatile UI chrome. These are time-dependent or env-dependent
  // values (FPS varies with CPU load; GEN depends on whether the rAF tick
  // started before vs after the screenshot; webgpuOk varies by environment).
  // Masking them is mandatory for stable canvas-app screenshots.
  const volatileMasks = (page: import("@playwright/test").Page) => [
    page.locator(".ghx-stats"),
    page.locator(".ghx-badges"),
  ];

  test("Block pattern at default zoom", async ({ page }) => {
    await page.evaluate(() => {
      const t = (window as any).__TEST__;
      t.clear();
      t.setRuleset(0);
      t.advanceTime(0);
    });
    await page.waitForTimeout(50);
    const canvas = page.locator('canvas[aria-label="GolHex hexagonal cellular automaton canvas"]');
    await expect(canvas).toHaveScreenshot("block-default.png", {
      mask: volatileMasks(page),
    });
  });

  test("Random seed=42 after 30 steps under B2/S34", async ({ page }) => {
    await page.evaluate(() => {
      const t = (window as any).__TEST__;
      t.clear();
      t.setRuleset(0);
      t.randomize(42);
      t.step(30);
    });
    await page.waitForTimeout(50);
    const canvas = page.locator('canvas[aria-label="GolHex hexagonal cellular automaton canvas"]');
    await expect(canvas).toHaveScreenshot("random-seed42-30steps.png", {
      mask: volatileMasks(page),
    });
  });
});
