import { test, expect } from "@playwright/test";

// e2e fuer Issue #128 (HexForge-2D-Silhouetten in der Muster-Galerie).
// Real DOM, KEINE window-Hooks (AGENTS.md e2e-Kontrakt). Geprueft:
//  - Galerie zeigt die 6 HexForge-Kacheln (deterministische Silhouetten).
//  - 1 Tap rastert die Form fuer die aktuelle Gittergroesse und laedt sie ueber
//    den Standard-Ladepfad -> Pop-Indikator wechselt von 0 auf > 0.
//  - Keine Konsolen-/Page-Fehler waehrend Oeffnen + Laden.
const SHAPE_IDS = [
  "rounded-cross", "four-lobe-clover", "spiky-rosette",
  "thin-eight-star", "jagged-starburst", "radial-burst",
];

test.describe("HexForge-2D-Galerie (Issue #128)", () => {
  test("6 Kacheln vorhanden, Laden aendert das Feld, 0 Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(600);

    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId("pop")).toHaveText("0");

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(300);
    await page.getByTestId("gallery-toggle").click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId("preset-gallery")).toBeVisible();

    // Alle 6 HexForge-Kacheln sind da (deterministische Registry).
    for (const id of SHAPE_IDS) {
      await expect(page.getByTestId(`preset-hexforge-${id}`), `Kachel ${id}`).toBeVisible();
    }

    // 1-Tap: Rund-Kreuz laden -> Feld nachweislich befuellt (Pop > 0).
    await page.getByTestId("preset-hexforge-rounded-cross").click();
    await page.waitForTimeout(700); // Grid-Reflow + rAF-Reload-Guard

    const popText = await page.getByTestId("pop").innerText();
    const pop = parseInt(popText.replace(/[^\d]/g, ""), 10);
    expect(pop, `Pop nach HexForge-Laden (war "${popText}")`).toBeGreaterThan(0);

    expect(errors, "keine Konsolen-/Page-Fehler im HexForge-Lauf").toEqual([]);
  });
});
