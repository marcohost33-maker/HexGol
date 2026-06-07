import { test, expect } from "@playwright/test";

// Smoke-/Funktions-e2e fuer GolHex v33 (Layout-Redesign 2026-06-07, PR-A).
// v33: Tab-Leiste OBEN (1 Farben / 2 Formen / 3 Hex-Regeln / 4 Physik) +
// Aktions-Icons rechts (Snapshot/Speichern disabled = PR-C/D) + Schliessen.
// Steuerung UNTEN (Play/Schritt/Random/Leeren/Undo) + Tempo. Panels oeffnen als
// Overlay UEBER dem Feld. Geprueft (real DOM, KEINE window-Hooks, AGENTS.md §2):
// App mountet, Kern-Controls + Tabs da, Physik->HQST-Wechsel (Migrations-
// Regressionszone) ohne Konsolenfehler, Coworkerz-Schliessen-Button vorhanden.
test.describe("GolHex v33 smoke", () => {
  test("mounts, core controls, tabs, Physik->HQST switch, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(800);

    // App mountet (Canvas-Renderer da)
    await expect(page.locator("canvas")).toHaveCount(1);

    // v33 Top-Leiste: 4 inhaltliche Tabs vorhanden.
    for (const t of ["Tab 1 Farben", "Tab 2 Formen", "Tab 3 Hex-Regeln", "Tab 4 Physik"]) {
      await expect(page.getByRole("button", { name: t })).toBeVisible();
    }

    // v33 Steuerung unten: Kern-Controls vorhanden.
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Schritt", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Leeren", exact: true })).toBeVisible();

    // Tab 3 (Hex-Regeln) oeffnet das Panel -> Rahmen-Wahl + Groessen-Select inkl. XXL.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechteck", exact: true })).toBeVisible();
    await expect(page.locator("select").nth(1)).toContainText("XXL");

    // Migrations-Regressionszone: Physik (Tab 4) -> HQST -> Start ohne Fehler/Hang.
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Physik (reellwertig)", exact: true }).click();
    await page.getByRole("button", { name: "HQST", exact: true }).click();
    // Panel schliessen, dann unten Start.
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(1000);

    // Coworkerz-Standard: Schliessen-Button (Top-Leiste rechts).
    await expect(page.getByRole("button", { name: "App schliessen" })).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });
});
