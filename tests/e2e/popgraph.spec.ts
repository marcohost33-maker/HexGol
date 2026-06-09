import { test, expect } from "@playwright/test";

// e2e fuer Feature 1 (2026-06-09): Live-Populations-Graph (Sparkline).
// Real DOM, KEINE window-Hooks (AGENTS.md §2/e2e-Kontrakt). Geprueft:
//  - Lebenswelt-Lauf (Random -> Start) erzeugt die Sparkline ueber den Steuerungen,
//    sie traegt ein eigenes <canvas> (NICHT die Sim-Leinwand) -> Visual-Baseline frei.
//  - Reset bei Leeren: Buffer leert -> Sparkline verschwindet wieder (<2 Punkte).
//  - Keine Konsolen-/Page-Fehler waehrend Lauf + Reset (Redraw-Effekt sauber).
test.describe("Populations-Graph (Sparkline)", () => {
  test("erscheint im Lebenswelt-Lauf, eigenes canvas, reset bei Leeren, 0 Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(600);

    const spark = page.getByTestId("popgraph");
    // Vor jedem Lauf (frisch geladen, leeres Feld) ist der Buffer leer -> keine Sparkline.
    await expect(spark).toHaveCount(0);

    // Lebenswelt-Lauf: Random fuellen, dann laufen lassen -> Pop/Aktiv werden gepuffert.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(1200); // >=2 Generationen + Drossel-Fenster (~6 Hz)
    await page.getByRole("button", { name: "Pause", exact: true }).click();

    // Sparkline ist jetzt sichtbar und traegt ihr EIGENES (aria-hidden) <canvas>,
    // also nicht die Sim-Leinwand (canvas:not([aria-hidden])).
    await expect(spark).toHaveCount(1);
    await expect(spark).toBeVisible();
    await expect(spark.locator('canvas[aria-hidden="true"]')).toHaveCount(1);
    await expect(spark.getByText("POP")).toBeVisible();
    await expect(spark.getByText("AKTIV")).toBeVisible();

    // Reset-Kontrakt: Leeren -> Buffer leert -> Sparkline verschwindet wieder.
    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(300);
    await expect(spark).toHaveCount(0);

    expect(errors, "keine Konsolen-/Page-Fehler in Sparkline-Lauf + Reset").toEqual([]);
  });
});
