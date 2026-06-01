import { test, expect } from "@playwright/test";

// Smoke-/Funktions-e2e fuer GolHex v29L.2 (Migration 2026-06-01).
// Ersetzt die alten test-bridge.spec (haengte an der __TEST__-Bridge des v19-Apps,
// die der v29L.2-App fehlt) + visual.spec (Pixel-Baselines des alten Apps, nach
// Komplett-App-Wechsel obsolet). Prueft deterministisch ohne Pixel-Vergleich:
// App mountet, Kern-Controls vorhanden, Physik->HQST-Wechsel (Migrations-Regressions-
// zone) ohne Konsolenfehler, Coworkerz-Schliessen-Button vorhanden.
test.describe("GolHex v29L.2 smoke", () => {
  test("mounts, core controls, Physik->HQST switch, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(800);

    // App mountet (Canvas-Renderer da)
    await expect(page.locator("canvas")).toHaveCount(1);

    // Rahmen-Wahl Kreis/Rechteck vorhanden
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechteck", exact: true })).toBeVisible();

    // Grid-Groessen inkl. XXL
    await expect(page.locator("select").nth(1)).toContainText("XXL");

    // Migrations-Regressionszone: Physik -> HQST -> Start ohne Fehler/Hang
    await page.getByRole("button", { name: "Physik (reellwertig)", exact: true }).click();
    await page.getByRole("button", { name: "HQST", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(1000);

    // Coworkerz-Standard: Schliessen-Button
    await expect(page.getByRole("button", { name: "App schliessen" })).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });
});
