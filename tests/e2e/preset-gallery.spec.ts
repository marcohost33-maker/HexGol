import { test, expect } from "@playwright/test";

// e2e fuer Feature 3 (2026-06-09): Muster-Galerie & Presets (1-Tap laden).
// Real DOM, KEINE window-Hooks (AGENTS.md §2/e2e-Kontrakt). Geprueft:
//  - Tab 3 (Hex-Regeln) -> Galerie-Toggle oeffnet das Galerie-Sheet.
//  - Built-in-Kacheln vorhanden (Thumbnails), 1 Tap laedt -> Feld aendert sich
//    (Pop-Indikator wechselt von 0 auf >0), beobachtbar ueber data-testid="pop".
//  - "+ Eigener"-Kachel (aktuellen Zustand speichern) vorhanden.
//  - Keine Konsolen-/Page-Fehler waehrend Oeffnen + Laden.
test.describe("Muster-Galerie & Presets", () => {
  test("Galerie oeffnet, Built-in laden aendert das Feld, 0 Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(600);

    // Frisch geladen: Feld leer -> Pop = 0 (Ausgangs-Orakel).
    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId("pop")).toHaveText("0");

    // Tab 3 (Hex-Regeln) oeffnen -> Galerie-Toggle ist da.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(300);
    const toggle = page.getByTestId("gallery-toggle");
    await expect(toggle).toBeVisible();

    // Galerie oeffnen -> Sheet + Built-in-Kacheln erscheinen.
    await toggle.click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId("preset-gallery")).toBeVisible();
    // mindestens eine Built-in-Kachel + die "+ Eigener"-Kachel vorhanden.
    const builtins = page.locator('[data-testid^="preset-builtin-"]');
    await expect(builtins.first()).toBeVisible();
    const count = await builtins.count();
    expect(count).toBeGreaterThanOrEqual(4);
    await expect(page.getByTestId("preset-save-current")).toBeVisible();

    // 1-Tap: ersten Built-in laden. applyLoadedState schliesst die Galerie + setzt
    // das Feld -> Pop wechselt auf > 0 (Feld hat sich nachweislich geaendert).
    await page.getByTestId("preset-builtin-block").click();
    await page.waitForTimeout(700); // Grid-Reflow + rAF-Reload-Guard

    // Pop ist jetzt > 0 (Feld-Aenderung beobachtbar, kein window-Hook).
    const popText = await page.getByTestId("pop").innerText();
    const pop = parseInt(popText.replace(/[^\d]/g, ""), 10);
    expect(pop, `Pop nach Preset-Laden (war "${popText}")`).toBeGreaterThan(0);

    expect(errors, "keine Konsolen-/Page-Fehler in Galerie-Lauf").toEqual([]);
  });
});
