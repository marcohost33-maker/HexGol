import { test, expect } from "@playwright/test";

// REGRESSION (2026-06-08): "Rahmen werden gar nicht gesetzt" (User1).
// Wurzel: der OffscreenCanvas-Worker (Auto ab 90k Zellen, Kreis-Default 250 = 218k)
// rendert nur, was per syncWorkerState gepusht wird — doRandom/doClear/doUndo/rvalSeed
// pushten NICHT -> Feld blieb leer (blank canvas). Diese Tests prüfen die INTEGRATION
// (Maske erreicht den Bildschirm), nicht nur "0 Konsolenfehler". Belegt: ohne Fix
// rendert der Worker blank (7.3 KB PNG), mit Fix gefüllt.

// Zählt HELLE, FARBIGE Zell-Pixel (Palette: Rot/Gelb/Blau usw.) auf der sichtbaren
// Canvas (Main-Thread-Pfad, Gitter < 90k -> nicht an den Worker übergeben). Robust
// gegen die exakte Hintergrundfarbe: eine Zelle ist gesättigt+hell (max-min > 50,
// Summe > 120); der dunkle Hintergrund und der dünne Teal-Umriss dominieren nicht.
async function filledCount(page: import("@playwright/test").Page): Promise<number> {
  return await page.evaluate(() => {
    const cv = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = cv.getContext("2d");
    if (!ctx) return -1;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 50 && r + g + b > 120) n++;
    }
    return n;
  });
}
async function pickShapeRandom(page: import("@playwright/test").Page, lab: string) {
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
  await page.getByRole("button", { name: lab, exact: true }).click(); await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Random", exact: true }).click(); await page.waitForTimeout(300);
}

test.describe("GolHex Rahmen-Render (v33 Regression)", () => {
  test("Maske formt das Feld sichtbar: Box > Hexagon/Dreieck auf gleichem Gitter", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto("/"); await page.waitForTimeout(400);

    await pickShapeRandom(page, "Rechteck"); const box = await filledCount(page);
    await pickShapeRandom(page, "Hexagon"); const hex = await filledCount(page);
    await pickShapeRandom(page, "Dreieck"); const tri = await filledCount(page);

    expect(box, "Rechteck füllt das Feld").toBeGreaterThan(0);
    expect(hex, "Hexagon rendert (nicht leer)").toBeGreaterThan(0);
    expect(tri, "Dreieck rendert (nicht leer)").toBeGreaterThan(0);
    // Die Maske MUSS Zellen entfernen -> deutlich weniger als das volle Rechteck.
    expect(hex, `Hexagon-Maske greift sichtbar (box=${box}, hex=${hex})`).toBeLessThan(box * 0.95);
    expect(tri, `Dreieck-Maske greift sichtbar (box=${box}, tri=${tri})`).toBeLessThan(box * 0.85);
    expect(errors).toEqual([]);
  });

  test("Ellipse + Freiform-Rahmen rendern sichtbar (Main-Thread)", async ({ page }) => {
    await page.goto("/"); await page.waitForTimeout(400);
    await pickShapeRandom(page, "Ellipse");
    expect(await filledCount(page), "Ellipse rendert Zellen").toBeGreaterThan(0);
  });

  test("Worker-Render zeigt Zellen (Kreis-Default = Auto-Worker) + Random/Leeren syncen", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto("/"); await page.waitForTimeout(400);

    // Kreis (Default-Radius 250 = 218k Zellen) -> Canvas wird an den Worker übergeben.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
    await page.getByRole("button", { name: "Kreis", exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);

    const cv = page.locator("canvas").first();
    const empty = (await cv.screenshot()).length;
    await page.getByRole("button", { name: "Random", exact: true }).click(); await page.waitForTimeout(600);
    const full = (await cv.screenshot()).length;
    // Kern: Random MUSS im Worker-Pfad sichtbar Zellen erzeugen (Bug: blieb blank).
    expect(full, `Worker rendert nach Random Zellen (leer ${empty}B, gefüllt ${full}B)`).toBeGreaterThan(empty * 1.8);
    // Leeren MUSS den Worker ebenfalls synchronisieren (wieder ~leer).
    await page.getByRole("button", { name: "Leeren", exact: true }).click(); await page.waitForTimeout(450);
    const cleared = (await cv.screenshot()).length;
    expect(cleared, `Leeren synct Worker zurück (gefüllt ${full}B, geleert ${cleared}B)`).toBeLessThan(full * 0.6);
    expect(errors).toEqual([]);
  });
});
