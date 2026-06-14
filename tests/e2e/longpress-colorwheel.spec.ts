import { test, expect } from "@playwright/test";

// AP-3 (2026-06-07): Long-Press-Farbrad (Marco-Entscheid M-3 "Beides").
// Realer DOM-/Verhaltens-Kontrakt (KEINE window-Hooks, AGENTS.md):
//   - Long-Press (~500 ms Hold, Bewegung < Touch-Slop) oeffnet das radiale
//     12-Farb-Rad zentriert auf dem Druckpunkt.
//   - Auswahl faerbt die gedrueckte Zelle SOFORT *und* wechselt die aktive
//     Pinselfarbe (das Swatch wird aria-pressed) -> direkt weitermalen.
//   - Abbruch: Tipp ausserhalb (auf den Overlay-Hintergrund) schliesst ohne Auswahl.
//   - Pan-Geste (schnelles Wischen > Slop) oeffnet KEIN Rad.
//   - funktioniert mit Maus (Desktop, langer Klick) UND emuliertem Touch.
//
// Touch-/Long-Press-Emulation: das App nutzt Pointer Events. Wir feuern native
// PointerEvents (pointerdown/move/up) per dispatchEvent auf dem <canvas>; der
// Long-Press ist ein pointerdown + warten > 500 ms (Playwright kann keinen
// gehaltenen Touch-Down ueber touchscreen.tap, daher dispatchEvent — vom
// Handoff so vorgesehen). pointerType laesst sich frei setzen (mouse|touch).

type Pt = "mouse" | "touch";

async function pointerDownOnCanvas(page: import("@playwright/test").Page, dx: number, dy: number, pointerType: Pt) {
  await page.evaluate(({ dx, dy, pointerType }) => {
    const c = document.querySelector("canvas")!;
    const r = c.getBoundingClientRect();
    const x = r.left + dx, y = r.top + dy;
    (window as unknown as { __lpX: number; __lpY: number }).__lpX = x;
    (window as unknown as { __lpX: number; __lpY: number }).__lpY = y;
    c.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      pointerType, clientX: x, clientY: y, button: pointerType === "mouse" ? 0 : -1,
    }));
  }, { dx, dy, pointerType });
}

async function pointerMoveAndUp(page: import("@playwright/test").Page, ddx: number, ddy: number, pointerType: Pt) {
  await page.evaluate(({ ddx, ddy, pointerType }) => {
    const c = document.querySelector("canvas")!;
    const w = window as unknown as { __lpX: number; __lpY: number };
    const x = w.__lpX + ddx, y = w.__lpY + ddy;
    c.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y,
    }));
    c.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y,
    }));
  }, { ddx, ddy, pointerType });
}

async function releaseAtOrigin(page: import("@playwright/test").Page, pointerType: Pt) {
  await page.evaluate(({ pointerType }) => {
    const c = document.querySelector("canvas")!;
    const w = window as unknown as { __lpX: number; __lpY: number };
    c.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: w.__lpX, clientY: w.__lpY,
    }));
  }, { pointerType });
}

// PR#44-Auflage (2): nur Bewegung > Slop, OHNE pointerup (Finger bleibt unten).
// Schaerft den Pan-Slop-Test: Hold > 500 ms + Move > 8 px (kein frueher Up) darf
// KEIN Rad oeffnen (der Bewegungs-Abbruch des Long-Press-Timers ist der Pruefstein,
// nicht das Loslassen).
async function pointerMoveOnly(page: import("@playwright/test").Page, ddx: number, ddy: number, pointerType: Pt) {
  await page.evaluate(({ ddx, ddy, pointerType }) => {
    const c = document.querySelector("canvas")!;
    const w = window as unknown as { __lpX: number; __lpY: number };
    const x = w.__lpX + ddx, y = w.__lpY + ddy;
    c.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y,
    }));
  }, { ddx, ddy, pointerType });
}

// PR#44-Auflage (1): realer Zellfaerbungs-Beleg via Canvas-Pixel-Readback. Die
// getroffene Hex-Zelle rendert um ihr Zentrum, das vom exakten Druckpunkt leicht
// versetzt liegen kann (Hex-Versatz). Darum scannen wir einen kleinen Bereich um
// den Druckpunkt und zaehlen Pixel, deren Farbe (mit Toleranz) der Zielfarbe
// entspricht. 2D-Canvas-Readback ist im Main-Thread-Pfad in headless Chromium
// zuverlaessig (dieselbe Canvas, die die Visual-Specs screenshotten).
async function countColorNear(
  page: import("@playwright/test").Page, dx: number, dy: number, rgb: number[], half = 26, tol = 60,
): Promise<number> {
  return page.evaluate(({ dx, dy, rgb, half, tol }) => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const ratio = c.width / c.getBoundingClientRect().width; // CSS-px -> Geraete-px
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const x0 = Math.max(0, Math.round((dx - half) * ratio));
    const y0 = Math.max(0, Math.round((dy - half) * ratio));
    const w = Math.min(Math.round(half * 2 * ratio), c.width - x0);
    const h = Math.min(Math.round(half * 2 * ratio), c.height - y0);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - rgb[0]) <= tol && Math.abs(data[i + 1] - rgb[1]) <= tol && Math.abs(data[i + 2] - rgb[2]) <= tol) n++;
    }
    return n;
  }, { dx, dy, rgb, half, tol });
}

const collectErrors = (page: import("@playwright/test").Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return errors;
};

test.describe("GolHex AP-3 Long-Press-Farbrad", () => {
  test("Long-Press (Touch) oeffnet das Rad mit 12 Farben + Leer-Wahl (13)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    // kein Move -> Hold > 500 ms muss das Rad oeffnen
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch"); // Loslassen schliesst das Rad NICHT

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    // 12 Itten-Farben + 1 "leere Zelle / loeschen" (Marco-Wunsch 2026-06-14) = 13.
    await expect(wheel.locator("button[data-color-state]")).toHaveCount(13);
    // die 13. Wahl ist die Leer-/Loesch-Zelle (eigenes aria-label, distinkt).
    await expect(wheel.getByRole("button", { name: "Leere Zelle / loeschen" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Auswahl faerbt die Zelle + wechselt die aktive Pinselfarbe", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    // v33: die Pinsel-Swatches leben im Tab 1 (Farben). Vorzustand pruefen, Panel
    // wieder schliessen (Long-Press passiert auf der freien Leinwand, kein Overlay).
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Rot" }).first()).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Tab 1 Farben" }).click(); // Panel zu
    await page.waitForTimeout(200);

    await pointerDownOnCanvas(page, 220, 160, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // CR (Rot) = State-ID 1 -> Auswahl klicken.
    await wheel.locator('button[data-color-state="1"]').click();

    // Rad geschlossen.
    await expect(wheel).toHaveCount(0);
    // aktive Pinselfarbe ist jetzt Rot: Tab 1 oeffnen, Swatch aria-pressed=true.
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Rot", pressed: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Pan-Geste (schnelles Wischen) oeffnet KEIN Rad", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    // sofort > Touch-Slop bewegen + loslassen, bevor die 500 ms verstreichen
    await page.waitForTimeout(120);
    await pointerMoveAndUp(page, 60, 40, "touch"); // 60/40 px >> 8 px Slop
    await page.waitForTimeout(650); // ueber die Long-Press-Schwelle hinaus warten

    await expect(page.locator('[data-testid="color-wheel"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Abbruch: Tipp ausserhalb schliesst das Rad ohne Auswahl", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // Pinsel bleibt "Zyklus" (kein Farbwechsel beim Abbruch).
    // Auf den Overlay-Hintergrund tippen (nicht auf einen Farb-Button) -> schliesst.
    await wheel.click({ position: { x: 5, y: 5 } });
    await expect(wheel).toHaveCount(0);
    // Pinsel unveraendert: "Zyklus" weiterhin aktiv (v33: Swatch im Tab 1).
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Zyklus" })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("Maus: langer Klick oeffnet das Rad, Auswahl wechselt den Pinsel", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 240, 170, "mouse");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "mouse");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // CB (Blau) = State-ID 9 -> Auswahl.
    await wheel.locator('button[data-color-state="9"]').click();
    await expect(wheel).toHaveCount(0);
    // v33: Swatch im Tab 1 (Farben) verifizieren.
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Blau", pressed: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Worker-Pfad: Long-Press-Auswahl erreicht den OffscreenCanvas-Worker (state-Bruecke)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    // v33: Worker-Schalter im Tab 3 (Hex-Regeln). Aktivieren, Panel wieder schliessen
    // (Long-Press passiert auf der freien Leinwand).
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // Panel zu
    await page.waitForTimeout(400);

    // Long-Press im Worker-Modus -> Auswahl. Der Main-Thread muss den neuen
    // Zustand per "state"-postMessage an den Worker nachreichen (sonst zeigt der
    // Worker den alten Zustand). Beleg hier: kein Fehler + Pinselwechsel; der
    // postMessage-Pfad ist im Code (syncWorkerState) und im Worker-Handler (state)
    // verdrahtet — ein roher Pixel-Readback der OffscreenCanvas ist im Headless-
    // Chromium nicht zuverlaessig, daher der Verhaltens-/Fehlerfreiheits-Beleg.
    await pointerDownOnCanvas(page, 220, 160, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    await wheel.locator('button[data-color-state="5"]').click(); // CY (Gelb) = 5
    await expect(wheel).toHaveCount(0);
    // v33: Swatch im Tab 1 (Farben) verifizieren.
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Gelb", pressed: true })).toBeVisible();
    await page.getByRole("button", { name: "Tab 1 Farben" }).click(); // Panel wieder zu

    // Worker rendert weiter ohne Fehler (state-Update verarbeitet).
    await page.waitForTimeout(300);
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    expect(errors, "keine Fehler im Worker-Pfad bei Long-Press-Auswahl").toEqual([]);
  });

  // PR#44-Auflage (1): Farbrad-e2e haerten — die getroffene Zelle wird real ROT
  // gefaerbt (Pixel-Readback der Canvas), nicht nur der Pinsel-State geprueft.
  test("Auswahl faerbt die Zelle REAL rot (Canvas-Pixel-Readback)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    // Leere Leinwand + grosse Zellen (Default-Grid S) -> ein Treffer faerbt eine
    // klar sichtbare Flaeche. Druckpunkt = Leinwand-Mitte: liegt garantiert in der
    // Domaene (auch bei berandeten Formen Kreis/Hexagon), damit idx >= 0 ist.
    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);

    const cbox = await page.locator("canvas").first().boundingBox();
    const DX = Math.round(cbox!.width / 2), DY = Math.round(cbox!.height / 2);
    const RED = [255, 0, 0]; // CR = rgb(255,0,0) (Itten-Rot, sim-engine COLA[CR])
    // Vorzustand: keine roten Pixel um den Druckpunkt (leere Leinwand).
    const before = await countColorNear(page, DX, DY, RED);
    expect(before, "Vorzustand: keine roten Pixel um den Druckpunkt").toBe(0);

    await pointerDownOnCanvas(page, DX, DY, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    await wheel.locator('button[data-color-state="1"]').click(); // CR (Rot) = rgb(255,0,0)
    await expect(wheel).toHaveCount(0);
    await page.waitForTimeout(250); // einen rAF-Render abwarten

    // Nachzustand: die getroffene Zelle rendert real ROT -> rote Pixel sind da.
    // Schranke 15 (war 20): die Default-M-Ansicht zeichnet die Zelle jetzt als
    // HEXAGON statt als Quadrat-Raster (Schwelle 3.5->2.0, Hexagon-Render-Fix
    // 2026-06-09). Die Hex-Fuellung (hr*0.92-Polygon) deckt eine geringfuegig
    // kleinere Flaeche als der bisherige Quadrat-Block (hr*s*0.72-Rechteck) -> der
    // Pixel-Readback derselben EINEN Zelle ergibt 20 statt >20. Die Zusicherung
    // bleibt inhaltlich identisch (Zelle ist eindeutig rot gerendert; leer = 0,
    // oben verifiziert); nur an die korrekte Hex-Geometrie angepasst.
    const after = await countColorNear(page, DX, DY, RED);
    expect(after, "Nachzustand: getroffene Zelle ist real rot gerendert (Pixel-Readback)").toBeGreaterThan(15);
    expect(errors).toEqual([]);
  });

  // Marco-Wunsch 2026-06-14: die 13. Wahl "leere Zelle / loeschen" radiert eine
  // lebende Zelle REAL aus (Canvas-Pixel-Readback): erst rot faerben, dann via
  // Leer-Wahl im selben Rad loeschen -> rote Pixel verschwinden.
  test("13. Wahl 'Leer' loescht die getroffene Zelle REAL (Pixel-Readback)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);

    const cbox = await page.locator("canvas").first().boundingBox();
    const DX = Math.round(cbox!.width / 2), DY = Math.round(cbox!.height / 2);
    const RED = [255, 0, 0];

    // 1) Zelle rot faerben (Vorbedingung: rote Pixel da).
    await pointerDownOnCanvas(page, DX, DY, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");
    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    await wheel.locator('button[data-color-state="1"]').click(); // CR (Rot)
    await expect(wheel).toHaveCount(0);
    await page.waitForTimeout(250);
    const painted = await countColorNear(page, DX, DY, RED);
    expect(painted, "Zelle ist real rot gefaerbt (Vorbedingung)").toBeGreaterThan(15);

    // 2) erneut Long-Press auf DIESELBE Zelle -> 13. Wahl "Leer" -> Zelle wird tot.
    await pointerDownOnCanvas(page, DX, DY, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");
    await expect(wheel).toBeVisible();
    await wheel.getByRole("button", { name: "Leere Zelle / loeschen" }).click();
    await expect(wheel).toHaveCount(0);
    await page.waitForTimeout(250);

    // Nachzustand: keine roten Pixel mehr -> die Zelle wurde real geleert.
    const erased = await countColorNear(page, DX, DY, RED);
    expect(erased, "Zelle ist nach Leer-Wahl real geloescht (keine roten Pixel)").toBe(0);

    // Pinsel ist jetzt der Radiergummi: Tab 1 oeffnen, "Leer"-Swatch aria-pressed.
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Leer", pressed: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  // PR#44-Auflage (2): Pan-Slop schaerfen. Hold > 500 ms + Move > 8 px OHNE fruehes
  // Loslassen -> KEIN Rad (Bewegungs-Abbruch ist der Pruefstein, nicht der pointerup).
  test("Pan-Slop scharf: Hold >500ms + Move >8px (kein Up) oeffnet KEIN Rad", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    await page.waitForTimeout(120);
    await pointerMoveOnly(page, 20, 14, "touch"); // ~24 px >> 8 px Slop, Finger BLEIBT unten
    await page.waitForTimeout(650);               // weit ueber die 500-ms-Schwelle

    // Trotz gehaltenem Finger jenseits 500 ms: kein Rad (Move > Slop hat den
    // Long-Press-Timer abgebrochen).
    await expect(page.locator('[data-testid="color-wheel"]')).toHaveCount(0);

    await releaseAtOrigin(page, "touch"); // erst jetzt loslassen
    await expect(page.locator('[data-testid="color-wheel"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
