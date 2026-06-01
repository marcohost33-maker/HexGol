import { test, expect } from "@playwright/test";

// Visual-Regression-Baselines fuer GolHex v29L.2 (2026-06-01). Deterministisch:
// KEINE laufende Sim (kein Start) — nur statische Zustaende, sodass die Snapshots
// reproduzierbar sind. Canvas-AA-Rauschen ist via playwright.config toHaveScreenshot
// (maxDiffPixelRatio 0.03) toleriert. Baselines werden im CI-Docker-Image via
// update-snapshots.yml erzeugt (Linux, deckungsgleich mit visual-regression.yml).
test.describe("GolHex v29L.2 visual baselines", () => {
  test("life: deterministischer Random-Fill (Default-Grid)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(700);
    // fester Default-Seed -> Random ist reproduzierbar (kein Wuerfeln)
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("canvas")).toHaveScreenshot("life-random-default.png");
  });

  test("XXL + Kreis-Rahmen (ImageData-Raster-Pfad, statisch)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    await page.locator("select").nth(1).selectOption("4"); // XXL
    await page.getByRole("button", { name: "Kreis", exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.locator("canvas")).toHaveScreenshot("xxl-circle-frame.png");
  });
});
