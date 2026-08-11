import { test, expect } from "@playwright/test";

// Visual-Baselines fuer die 6 HexForge-2D-Startformen (Issue #128, Gate
// "Golden-Presets + visuelle Baselines fuer alle sechs Startformen").
// Deterministisch: applyLoadedState stoppt die Sim (statischer Zustand), die
// Rasterung ist parameter-deterministisch (Golden-Hash-Anker in
// tests/unit/hexforge-2d.test.js). Canvas-only-Screenshot, Toleranz siehe
// playwright.config (maxDiffPixelRatio 0.03).
const SHAPE_IDS = [
  "rounded-cross", "four-lobe-clover", "spiky-rosette",
  "thin-eight-star", "jagged-starburst", "radial-burst",
];

test.describe("HexForge-2D visual baselines", () => {
  for (const id of SHAPE_IDS) {
    test(`${id}: statische Silhouette (Default-Grid)`, async ({ page }) => {
      await page.goto("/");
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
      await page.waitForTimeout(250);
      await page.getByTestId("gallery-toggle").click();
      await page.waitForTimeout(200);
      await page.getByTestId(`preset-hexforge-${id}`).click();
      await page.waitForTimeout(700); // Reload-Guard: Zellen sind geschrieben
      // Panel schliessen, damit das Overlay die Canvas nicht ueberdeckt.
      await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
      await page.waitForTimeout(400);
      await expect(page.locator("canvas").first()).toHaveScreenshot(`hexforge-${id}.png`);
    });
  }
});
