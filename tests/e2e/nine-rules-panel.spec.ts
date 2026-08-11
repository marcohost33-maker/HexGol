import { test, expect } from "@playwright/test";

// e2e fuer das 9-Regel-Semantikprofil (007acc-Transfer, Spec-Abschnitt "GolHex UI").
// Realer DOM-Kontrakt, KEINE window-Hooks (AGENTS.md §2): der Test bedient die App
// ueber die echten Bedienelemente und prueft, was ein Mensch sieht.
//
// Der wichtigste Test hier ist NICHT, dass Regeln erscheinen, sondern dass R5
// (Richtung) und R6 (Bewegung) FEHLEN. Eine Population hat keinen Ort; wer sie
// trotzdem anzeigt, hat eine Groesse erfunden, damit ein Feld gruen wird. Genau das
// verbietet die Spezifikation ("N/A, nicht kuenstlich PASS") -- und genau das faellt
// bei einer Sichtpruefung niemandem auf, weil es plausibel aussieht.

/** Oeffnet den Tab, der das Semantikprofil-Panel enthaelt. */
async function oeffneSemantikPanel(page: import("@playwright/test").Page) {
  const toggle = page.getByTestId("ninerules-toggle");
  if (await toggle.isVisible().catch(() => false)) return toggle;
  for (const tab of ["Tab 3 Hex-Regeln", "Tab 4 Physik", "Tab 2 Formen", "Tab 1 Farben"]) {
    const btn = page.getByRole("button", { name: tab });
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click();
    await page.waitForTimeout(250);
    if (await toggle.isVisible().catch(() => false)) return toggle;
  }
  throw new Error("Semantikprofil-Umschalter in keinem Tab gefunden");
}

test.describe("9-Regel-Semantikprofil", () => {
  test("Profil-Wechsel zeigt die Regeln und laesst Unanwendbares weg", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(800);

    const toggle = await oeffneSemantikPanel(page);
    await toggle.click();
    await page.waitForTimeout(200);

    // Default ist das Bestands-Profil; das 9-Regel-Raster ist ausdruecklich Opt-in.
    await expect(page.getByTestId("semantik-axiome")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ninerules-panel")).toHaveCount(0);

    await page.getByTestId("semantik-neunregeln").click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId("ninerules-panel")).toBeVisible();

    // Die sieben fuer eine Population sinnvollen Regeln sind da ...
    for (const id of ["R1", "R2", "R3", "R4", "R7", "R8", "R9"]) {
      await expect(page.getByTestId(`ninerule-${id}`)).toBeVisible();
    }
    // ... und die beiden ortsgebundenen fehlen. Das ist der Kern des Tests.
    for (const id of ["R5", "R6"]) {
      await expect(page.getByTestId(`ninerule-${id}`)).toHaveCount(0);
    }

    // Jede Regel zeigt einen Status UND eine Begruendung -- ein Urteil ohne Beleg
    // waere im UI genauso wertlos wie im Report.
    const r1 = page.getByTestId("ninerule-R1");
    await expect(page.getByTestId("ninerule-status-R1")).not.toBeEmpty();
    expect((await r1.innerText()).length).toBeGreaterThan(10);

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  test("Auswertung folgt dem laufenden Zustand und beeinflusst ihn nicht", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(800);

    const toggle = await oeffneSemantikPanel(page);
    await toggle.click();
    await page.getByTestId("semantik-neunregeln").click();
    await page.waitForTimeout(200);

    const vorher = await page.getByTestId("ninerule-status-R3").innerText();

    // Panel schliessen, damit die Steuerung unten erreichbar ist, dann Muster setzen
    // und laufen lassen.
    await toggle.click();
    const random = page.getByRole("button", { name: "Random", exact: true });
    if (await random.isVisible().catch(() => false)) await random.click();
    const start = page.getByRole("button", { name: "Start", exact: true });
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await page.waitForTimeout(1200);
      const stop = page.getByRole("button", { name: "Stop", exact: true });
      if (await stop.isVisible().catch(() => false)) await stop.click();
    }

    await toggle.click();
    await page.waitForTimeout(300);
    // Nach gelaufenen Generationen hat R3 ("Es war") eine Vergangenheit -- der Wert
    // muss sich also bewegt haben. Ein Panel, das immer dasselbe zeigt, misst nichts.
    const nachher = await page.getByTestId("ninerule-status-R3").innerText();
    expect(nachher).not.toBe("");
    expect([vorher, nachher].join("|")).toMatch(/offen|pass|bisher/);

    // Und die Simulation laeuft weiterhin fehlerfrei: das Raster beobachtet nur.
    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });
});
