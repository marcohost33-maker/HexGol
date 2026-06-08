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

  // v33.0.2: Worker-Outline. Im Worker-Modus (Kreis-Default) zeichnet der Worker
  // den dünnen Rahmen-Umriss NICHT -> Overlay-Canvas (Main-Thread) übernimmt. Auf
  // LEEREM Feld muss der Umriss trotzdem sichtbar sein (vorher: komplett blank).
  test("Worker-Modus: Rahmen-Umriss sichtbar auch auf leerem Feld (Overlay)", async ({ page }) => {
    await page.goto("/"); await page.waitForTimeout(400);
    // Referenz: leeres Box-Default (klein) — wie viel "Chrome" ist ohne Umriss da?
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
    await page.getByRole("button", { name: "Kreis", exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
    await page.getByRole("button", { name: "Leeren", exact: true }).click(); await page.waitForTimeout(400);
    // Feld-Bereich (Wrap = Feld-Canvas + Overlay) screenshotten -> Umriss = Inhalt.
    const shot = (await page.locator(".ghx-canvas").screenshot()).length;
    // Ein leeres Feld OHNE Umriss komprimiert sehr klein (~7-9 KB). Mit teal-Kreis
    // deutlich grösser. Schwelle konservativ.
    expect(shot, `Umriss auf leerem Worker-Feld sichtbar (PNG ${shot}B)`).toBeGreaterThan(11000);
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

  // P1 (Codex-Review): nach einem Worker-LAUF leben die evolvierten Zellen nur im
  // Worker. Bei Pause MUSS der Main-Thread sie zurückpullen (snapshot), sonst
  // speichert/editiert er den stalen Pre-Run-Stand. Test: Kreis(Worker) -> Random
  // -> Play -> Pause -> Save -> Leeren -> Laden ergibt ein nicht-leeres, evolviertes
  // Feld (Gen lief > 0). Ohne den Pull-on-Pause würde Save Pre-Run-Stand sichern.
  async function popValue(page: import("@playwright/test").Page): Promise<number> {
    const t = (await page.getByTestId("pop").textContent()) || "0";
    return Number(t.replace(/[^\d]/g, "")) || 0;
  }
  test("Worker-Lauf + Pause: Main-State wird zurückgepullt (Save/Load nach Lauf, kein Korrupt)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto("/"); await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
    await page.getByRole("button", { name: "Kreis", exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);

    await page.getByRole("button", { name: "Random", exact: true }).click(); await page.waitForTimeout(300);
    // Laufen lassen -> Gen advanciert (Worker steppt), dann Pause -> Pull.
    await page.getByRole("button", { name: "Start", exact: true }).click(); await page.waitForTimeout(1100);
    const genTxt = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => /^Gen\s/.test(s.textContent || ""));
      return el ? (el.textContent || "") : "";
    });
    const gen = Number((genTxt.match(/\d+/) || ["0"])[0]);
    expect(gen, `Worker-Sim lief (Gen=${gen})`).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.waitForTimeout(400);

    // Save -> liest colorRef (jetzt gepullt = evolviert) -> Leeren -> Laden.
    await page.getByRole("button", { name: "Spielstand speichern" }).click(); await page.waitForTimeout(150);
    await page.getByRole("textbox", { name: "Name fuer Spielstand" }).fill("p1run");
    await page.getByRole("button", { name: "Speichern", exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Speichern-Panel schliessen" }).click().catch(() => {});
    await page.getByRole("button", { name: "Leeren", exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Spielstand speichern" }).click(); await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Laden p1run" }).click(); await page.waitForTimeout(500);

    const popLoaded = await popValue(page);
    expect(popLoaded, `Geladener Stand ist nicht leer (pop=${popLoaded})`).toBeGreaterThan(0);
    // Diskriminator: meta.gen = tickRef. Telemetry setzt NUR den React-Gen-State,
    // NICHT tickRef -> ohne Pull-on-Pause bliebe tickRef=0 (vom Random) -> der
    // gespeicherte+geladene Gen wäre 0. Mit Pull ist tickRef = evolvierte Tick > 0.
    const genLoadedTxt = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => /^Gen\s/.test(s.textContent || ""));
      return el ? (el.textContent || "") : "";
    });
    const genLoaded = Number((genLoadedTxt.match(/\d+/) || ["0"])[0]);
    expect(genLoaded, `Save nach Lauf hat die EVOLVIERTE Tick gespeichert (Pull griff) -> geladener Gen ${genLoaded} > 0`).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
