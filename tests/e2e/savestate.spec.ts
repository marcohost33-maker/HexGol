import { test, expect } from "@playwright/test";

// v33 PR-C: Spielstand-Speichern (IndexedDB), Datei-Export, Urzustand ("1. Figur").
// Realer DOM-/Verhaltens-Kontrakt (KEINE window-Hooks, AGENTS.md §2):
//   - 💾 oeffnet das Speichern-Panel; Name vorbelegt; Speichern -> Slot in Liste.
//   - Laden eines Slots stellt die Population wieder her (echtes IndexedDB im Chromium).
//   - ⏮ "1. Figur": Figur -> Play -> Steps -> ⏮ -> Population == Urzustand.
//   - Datei-Export loest einen Download aus (download-Event).
//   - Keine Konsolen-/Page-Fehler im ganzen Ablauf.
// Laeuft im "mobile"-Projekt (390x844, playwright.config.ts).

async function popValue(page: import("@playwright/test").Page): Promise<number> {
  const txt = (await page.getByTestId("pop").textContent()) || "0";
  return Number(txt.replace(/[^\d]/g, "")) || 0;
}

function attachErrorGuards(page: import("@playwright/test").Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
}

test.describe("GolHex v33 Spielstand-Speichern + Urzustand (PR-C)", () => {
  test("Speichern -> Slot erscheint -> Leeren -> Laden stellt Population wieder her", async ({ page }) => {
    const errors: string[] = [];
    attachErrorGuards(page, errors);

    await page.goto("/");
    await page.waitForTimeout(400);

    // Reproduzierbare Ausgangslage: Random fuellt deterministisch (fester Seed).
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(250);
    const popSaved = await popValue(page);
    expect(popSaved, "Random erzeugt eine Population > 0").toBeGreaterThan(0);

    // 💾 oeffnet das Panel; Name ist vorbelegt.
    await page.getByRole("button", { name: "Spielstand speichern" }).click();
    await page.waitForTimeout(150);
    await expect(page.getByTestId("save-panel")).toBeVisible();
    const nameInput = page.getByRole("textbox", { name: "Name fuer Spielstand" });
    await nameInput.fill("e2e-slot");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.waitForTimeout(300);

    // Slot taucht in der Liste auf.
    await expect(page.getByRole("button", { name: "Laden e2e-slot" })).toBeVisible();

    // Panel schliessen, Feld leeren -> Pop 0.
    await page.getByRole("button", { name: "Speichern-Panel schliessen" }).click();
    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await popValue(page), "nach Leeren ist Pop 0").toBe(0);

    // 💾 -> Slot laden -> Population zurueck.
    await page.getByRole("button", { name: "Spielstand speichern" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Laden e2e-slot" }).click();
    await page.waitForTimeout(500);
    const popLoaded = await popValue(page);
    expect(popLoaded, `geladene Population == gespeicherte (war ${popSaved}, jetzt ${popLoaded})`).toBe(popSaved);

    expect(errors, "keine Fehler im Speichern/Laden-Ablauf").toEqual([]);
  });

  test('"1. Figur" (⏮): Figur -> Play -> Steps -> Restore == Urzustand', async ({ page }) => {
    const errors: string[] = [];
    attachErrorGuards(page, errors);

    await page.goto("/");
    await page.waitForTimeout(400);

    // Urzustand setzen (Random) -> ⏮ ist anfangs disabled (kein Play bisher).
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(250);
    const popOrigin = await popValue(page);
    expect(popOrigin, "Urzustand-Population > 0").toBeGreaterThan(0);

    const firstFigure = page.getByRole("button", { name: "Zur ersten Figur" });
    await expect(firstFigure).toBeDisabled();

    // Play -> ein paar Schritte (Population veraendert sich) -> Pause.
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(200);
    const popRunning = await popValue(page);

    // ⏮ ist jetzt aktiv und stellt die Urzustand-Population wieder her.
    await expect(firstFigure).toBeEnabled();
    await firstFigure.click();
    await page.waitForTimeout(300);
    const popRestored = await popValue(page);
    expect(popRestored, `Restore == Urzustand (Urzustand ${popOrigin}, nach Lauf ${popRunning}, restauriert ${popRestored})`).toBe(popOrigin);

    expect(errors, "keine Fehler im Urzustand-Ablauf").toEqual([]);
  });

  test("Datei-Export loest einen Download aus (.golhex.json)", async ({ page }) => {
    const errors: string[] = [];
    attachErrorGuards(page, errors);

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByRole("button", { name: "Spielstand speichern" }).click();
    await page.waitForTimeout(150);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Als Datei exportieren" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename(), "Download-Dateiname endet auf .golhex.json").toContain(".golhex.json");

    expect(errors, "keine Fehler im Export-Ablauf").toEqual([]);
  });
});
