import { test, expect } from "@playwright/test";

// AP-2 e2e (realer DOM-Kontrakt, KEINE window-Hooks): die neuen Groessen sind im
// echten App-DOM verdrahtet + instanziierbar, ohne Konsolen-/Page-Fehler.
//
// OOM-Ehrlichkeit (8-GB-PC, Headless-Chromium, parallele Worker): ein VOLLER
// Random-Fill + Lauf bei 250'000 / 680'000 Zellen sprengt hier den Tab. Darum:
//  - 5XL/Kreis r=500: nur die UI-Verdrahtung + Speicher-Guard pruefen (Auswahl
//    baut das Grid; Canvas lebt; 0 Fehler) — KEIN schwerer Fill im Browser.
//  - das eigentliche Stepping-/Zellzahl-Verhalten der Maximal-Groessen ist
//    headless in tests/manual/ap2-instantiation.mjs tool-belegt (250k box ~6.7ms/
//    Step, Kreis r=500 = 680'071 Zellen ~17ms/Step).
//  - der laufende-Sim-DOM-Beleg passiert bei 3XL (90'000), das hier stabil laeuft.
test.describe("GolHex AP-2 max sizes", () => {
  test("5XL (500x500) wired into size select + memory guard, no errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    // v33: Groesse/Rahmen + Speicher-Hinweis leben im Tab 3 (Hex-Regeln) — oeffnen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    const sizeSel = page.locator("select").nth(1);
    await expect(sizeSel).toContainText("5XL");
    await sizeSel.selectOption("7"); // index 7 = 5XL (500x500 = 250'000)
    await page.waitForTimeout(500);

    // Grid baut (Canvas lebt) + ehrlicher Speicher-Hinweis sichtbar (fail-closed).
    // Der Hinweis nennt die Zellzahl; auf de-CH ist der Tausender-Trenner U+2019.
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    await expect(page.getByText(/Sehr grosses Gitter/)).toBeVisible();
    await expect(page.getByText(/Auf aelteren Handys/)).toBeVisible();
    expect(errors, "keine Fehler beim 5XL-Aufbau").toEqual([]);
  });

  test("new stages 3XL/4XL/5XL all build (size select) without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    // v33: Groesse/Rahmen + Speicher-Hinweis leben im Tab 3 (Hex-Regeln) — oeffnen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    const sizeSel = page.locator("select").nth(1);
    // index 5=3XL(90k), 6=4XL(160k), 7=5XL(250k) — jede Stufe baut das Grid.
    for (const v of ["5", "6", "7"]) {
      await sizeSel.selectOption(v);
      await page.waitForTimeout(350);
      await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    }
    expect(errors, "keine Fehler beim Aufbau der neuen Stufen").toEqual([]);
  });

  test("circle radius control: slider + number, clamps to 500, no errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    // v33: Rahmen + Kreis-Radius leben im Tab 3 (Hex-Regeln) — oeffnen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    await page.getByRole("button", { name: "Kreis", exact: true }).click();
    await page.waitForTimeout(300);

    // Radius-Zahlenfeld vorhanden, Default 250 (Marco-Vorgabe).
    const num = page.getByLabel("Kreis-Radius (Zahl)");
    await expect(num).toBeVisible();
    await expect(num).toHaveValue("250");

    // kleiner Radius -> Grid baut, Canvas lebt, kein Fehler (DOM-Verdrahtung).
    await num.fill("60");
    await num.blur();
    await page.waitForTimeout(300);
    await expect(num).toHaveValue("60");
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);

    // mittlerer Radius -> groesseres Grid, weiter stabil.
    await num.fill("120");
    await num.blur();
    await page.waitForTimeout(400);
    await expect(num).toHaveValue("120");
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);

    // Hinweis: Klemmen >500 -> 500 ist im Unit-Test belegt (ap2-sizes.test.js);
    // das schwere r=500-Grid wird headless in ap2-instantiation.mjs tool-belegt
    // (OOM-Augenmass: kein r=500-Build im parallelen Headless-Chromium).
    expect(errors, "keine Fehler bei Kreis-Radius-UI").toEqual([]);
  });
});
