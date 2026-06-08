import { test, expect } from "@playwright/test";

// Runtime-Regressionstest fuer die v31-Rekonvergenz (2026-06-04): exerziert die
// zusammengefuehrten Render-Pfade, die statische Visual-Baselines NICHT abdecken
// (sie starten die Sim nie). Geprueft wird, dass die Koexistenz aus
//   - inkrementellem Neuzeichnen  (draw(true), pxR<4, life-Schritt-Updates) und
//   - ImageData-Raster-Fast-Path  (draw(false), hr*s<3.5, Vollredraw)
// bei laufender Sim + Ansichtswechseln OHNE Konsolen-/Page-Fehler laeuft, und die
// neuen Rahmenformen (Hexagon/Dreieck) ohne Fehler umschaltbar sind.
test.describe("GolHex v31 render-path coexistence", () => {
  test("XXL life: run sim (incremental) + frame switch (full redraw) + new shapes, no errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);

    // --- Teil A: inkrementeller Pfad (draw(true)) bei laufender Sim auf dem
    // Default-Grid (M, 8'000 Zellen) — leicht genug, dass der Main-Thread waehrend
    // des Laufs frei bleibt (kein Actionability-Hang). Tab-Panels bleiben zu, das
    // Feld laeuft frei sichtbar.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(900); // mehrere Schritte -> stepDirtyRef -> draw(true)
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForTimeout(150);

    // --- Teil B: Vollredraw-Fast-Path (draw(false), ImageData) + neue Rahmenformen.
    // Bei PAUSIERTER Sim (kein Main-Thread-Stau) das Tab 3 oeffnen: XXL waehlen ->
    // winzige Zellen (hr*s < 3.5) -> Raster-Fast-Path; jeder Form-Wechsel erzwingt
    // einen Vollredraw (dirtyRef), unabhaengig vom Laufzustand.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    await page.locator("select").nth(1).selectOption("4"); // XXL
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Hexagon", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Dreieck", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Rechteck", exact: true }).click();
    await page.waitForTimeout(400);

    // Canvas lebt weiterhin, keine Fehler aus dem zusammengefuehrten Render-Pfad.
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    expect(errors, "keine Konsolen-/Page-Fehler im Render-Pfad").toEqual([]);
  });
});
