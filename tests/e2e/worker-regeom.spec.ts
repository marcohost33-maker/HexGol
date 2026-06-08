import { test, expect } from "@playwright/test";
import { PNG } from "playwright-core/lib/utilsBundle";

// v33 P2-C (Codex-Review): In-Place-Geometrie-Update des LAUFENDEN OffscreenCanvas-
// Workers (`regeom`). Vorher bekam der Worker die Geometrie NUR beim `init`. Aenderte
// der User bei AKTIVEM Worker die Groesse/Form/Radius, baute der Main-Thread sein Grid
// neu (neighRef + CX/CY + N + fitView), der Worker blieb aber auf der STALEN init-
// Geometrie (altes N, alte CX/CY). Wenn sich dabei R/C/N/CX aendern (Groessenwechsel,
// Kreis-Radius, Kreis<->andere Form), rendert der Worker dann mit zu WENIGEN Welt-
// Zentren: die ueberzaehligen col-Indizes lesen CX[i]=undefined -> NaN-Koordinate ->
// werden STILL nicht geplottet (kein Konsolenfehler). Sichtbare Folge: die feinere
// Geometrie wird nicht reflektiert (zu wenige Zellen).
//
// Dieser Test beweist per gerenderter Zell-DICHTE, dass nach einem Groessenwechsel bei
// aktivem Worker die NEUE, feinere Geometrie sichtbar ist (mehr Zellen), nicht die
// stale grobe. Realer DOM-Kontrakt (keine window-Hooks, AGENTS.md §2): Groessen-Select
// + Buttons + Feld-Canvas. Falsifiziert (ohne regeom-Fix bleibt cells ~ alte Stufe).

// Feld-Canvas im Worker-Modus = SICHTBARE (nicht aria-hidden) Canvas; die zweite ist
// das Rahmen-Umriss-Overlay (v33.0.2, aria-hidden).
const FIELD_CANVAS = 'canvas:not([aria-hidden="true"])';

// Zahl der gerenderten Zell-Pixel (gesaettigte Farben), OHNE die zyan Umrisslinie
// (r<80, g>100, b>100) und OHNE den dunklen Hintergrund mitzuzaehlen.
function cellPixels(buf: Buffer): number {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  let cells = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 70 && (mx - mn) > 50 && !(r < 80 && g > 100 && b > 100)) cells++;
  }
  return cells;
}

test.describe("GolHex v33 P2-C Worker-Geometrie-Update (regeom)", () => {
  test("Worker aktiv: Groessenwechsel 4XL->5XL reflektiert NEUE feinere Geometrie (nicht stale)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    // 4XL (160k Zellen, value 6) -> Auto-Worker AN (>= Cap 90k). Worker bleibt beim
    // Wechsel auf 5XL (250k) AKTIV (beide ueber dem Cap, kein bigGrid-Toggle).
    await page.locator("select").nth(1).selectOption("6");
    await page.waitForTimeout(500);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle, "Auto-Worker bei 4XL aktiv").toHaveText(/Worker AN \(Beta\)/);

    // 4XL fuellen + messen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);
    const field = page.locator(FIELD_CANVAS).first();
    await expect(field).toHaveCount(1);
    const cells4xl = cellPixels(await field.screenshot());
    expect(cells4xl, "4XL-Worker-Canvas gefuellt").toBeGreaterThan(5000);

    // --- Groesse auf 5XL (Worker bleibt aktiv -> regeom, kein Respawn) -----------
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.locator("select").nth(1).selectOption("7"); // 5XL=250k
    await page.waitForTimeout(500);
    await expect(toggle, "Worker bleibt nach Groessenwechsel aktiv").toHaveText(/Worker AN \(Beta\)/);

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);
    const cells5xl = cellPixels(await field.screenshot());

    // KERN-ASSERTION: 5XL (250k Zellen, feineres Raster) rendert deutlich MEHR Zell-
    // Pixel als 4XL (160k). Bliebe der Worker stale (4XL-Geometrie/CX), gingen die
    // ueberzaehligen Zellen still verloren -> cells5xl ~ cells4xl. Mit regeom: ~40%+
    // mehr. Empirisch gemessen: ohne Fix ~30k (= 4XL-Niveau), mit Fix ~43k.
    expect(
      cells5xl,
      `5XL muss die feinere Geometrie zeigen (mehr Zellen als 4XL=${cells4xl}); stale=Bug`,
    ).toBeGreaterThan(cells4xl * 1.25);

    expect(errors, "keine Konsolen-/Page-Fehler im regeom-Pfad").toEqual([]);
  });

  test("Worker aktiv: Box->Ellipse (gleiche Groesse) zeigt die NEUE Ellipse-Form", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    // 5XL (250k) -> Auto-Worker AN. Box->Ellipse bei gleicher Groesse: Worker bleibt
    // aktiv, die Maske/Form aendert sich (Aspect der gefuellten Domaene).
    await page.locator("select").nth(1).selectOption("7");
    await page.waitForTimeout(500);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);

    // Panel ist offen (Tab 3 oben geoeffnet) -> Ellipse direkt waehlbar.
    await page.getByRole("button", { name: "Ellipse", exact: true }).click();
    await page.waitForTimeout(400);
    await expect(toggle, "Worker bleibt nach Form-Wechsel aktiv").toHaveText(/Worker AN \(Beta\)/);

    // Panel schliessen, Feld fuellen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);

    // Die gefuellte Domaene muss eine liegende Ellipse sein (zentrale Sehnen breiter-
    // als-hoch), nicht das vollflaechige Rechteck. (Bei gleicher Grid-Groesse ist
    // dieser Pfad auch ohne regeom robust, weil CX/CY identisch bleiben und der
    // state-Push die Ellipse-col liefert; er sichert das Form-Verhalten ab.)
    const png = PNG.sync.read(await page.locator(FIELD_CANVAS).first().screenshot());
    const { width, height, data } = png;
    const cell = (x: number, y: number) => { const o = (y * width + x) * 4, r = data[o], g = data[o + 1], b = data[o + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 70 && (mx - mn) > 50 && !(r < 80 && g > 100 && b > 100); };
    const my = height / 2 | 0; let lx = -1, rx = -1; for (let x = 0; x < width; x++) if (cell(x, my)) { if (lx < 0) lx = x; rx = x; }
    const mx2 = width / 2 | 0; let ty = -1, by = -1; for (let y = 0; y < height; y++) if (cell(mx2, y)) { if (ty < 0) ty = y; by = y; }
    const aspect = (by - ty) > 0 ? (rx - lx) / (by - ty) : 0;
    expect(aspect, "gefuellte Domaene ist eine liegende Ellipse (breiter als hoch)").toBeGreaterThan(1.3);

    expect(errors, "keine Fehler im Box->Ellipse-Pfad").toEqual([]);
  });

  test("Blind-Spot: Groessenwechsel waehrend RUNNING stoppt die Sim (neues Grid = Reset)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    await page.locator("select").nth(1).selectOption("6"); // 4XL
    await page.waitForTimeout(500);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(800);

    // Mitten im Lauf die Groesse wechseln -> Main-Rebuild setRunning(false) + regeom
    // mit running=false. Erwartung: Sim gestoppt (Start-Button wieder da), 0 Fehler.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.locator("select").nth(1).selectOption("7"); // 5XL
    await page.waitForTimeout(500);

    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    expect(errors, "keine Fehler bei Groessenwechsel waehrend RUNNING").toEqual([]);
  });
});
