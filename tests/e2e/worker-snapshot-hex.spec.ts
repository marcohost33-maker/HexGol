import { test, expect } from "@playwright/test";

// =============================================================================
// SNAPSHOT/REC-HEXAGON-BUG -- DAUERHAFTE LOESUNG (Marco, real 2026-06-16).
//
// SYMPTOM: Beim Foto-Aufnehmen (Snapshot) UND bei der Aufnahme (REC-Video)
// erschienen die Zellen als QUADRATE/leer statt als HEXAGONS -- obwohl die
// Live-Ansicht korrekt Hexagone zeigt.
//
// WURZEL (empirisch belegt): im OffscreenCanvas-Worker-Modus besitzt der Worker
// die per transferControlToOffscreen uebergebene Canvas. Auf WebKit/iOS (das
// Ziel des Share/REC-Features) ist das Main-Thread-Placeholder-<canvas> dann
// NICHT zuverlaessig lesbar -- toBlob()/captureStream() liefern ein leeres bzw.
// falsches Bild (WebKit; in Chromium liest der Placeholder zwar das Worker-Bild,
// auf iOS-Safari NICHT). shareCanvasImage()/Recorder lasen genau dieses
// Placeholder -> falsches/leeres Capture statt der Live-Hexagone.
//
// FIX (plattform-unabhaengig): der Worker reicht sein ECHTES Bild als ImageBitmap
// zurueck (captureFrame=Foto / mirror=Recording-Stream). Der Main-Thread zeichnet
// es auf eine IMMER lesbare, versteckte Spiegel-Canvas (data-testid=capture-mirror),
// von der Snapshot (toBlob) und Recorder (captureStream) das KORREKTE Live-
// Hexagon-Rendering beziehen. Der absichtliche Quadrat-Raster-Fast-Path
// (winzige/XXL-Zellen) bleibt unberuehrt -- der Worker rendert mit DERSELBEN
// usesRasterPath-Logik wie die Live-Anzeige (Capture == Live).
//
// DISKRIMINATOR (DOM-Kontrakt, KEIN window-Hook, plattform-unabhaengig):
//   1. data-render-mode="hex" auf der Live-Canvas -> Live rendert Hexagone.
//   2. Nach einem Snapshot ist die Spiegel-Canvas (capture-mirror) mit dem ECHTEN
//      Worker-Bild GEFUELLT (>0 Nicht-Hintergrund-Pixel). Diese Canvas wird AUSSCHLIESSLICH
//      durch den neuen captureFrame->ImageBitmap-Pfad bespielt.
//   FALSIFIKATION: ohne den Fix emittiert der Worker keinen Frame -> die Spiegel-
//   Canvas bleibt leer/0x0 -> der Test failt (verifiziert: emitFrame entfernt ->
//   filled=0). Damit greift der Test genau den Capture-Mechanismus, der auf iOS
//   den leeren Placeholder ersetzt.
// =============================================================================

const FIELD_CANVAS = 'canvas:not([aria-hidden="true"])';

test.describe("GolHex: Snapshot im Worker-Modus erfasst das Live-(Hexagon-)Render", () => {
  test("Worker-Snapshot fuellt die Spiegel-Canvas mit dem echten Render (nicht leer)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "OffscreenCanvas-Worker = Chromium");
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // --- Worker-Modus erzwingen (5XL -> Auto-Worker AN, >= Cap 90k) -------------
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    await page.locator("select").nth(1).selectOption("7");
    await page.waitForTimeout(500);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle, "Auto-Worker bei 5XL aktiv").toHaveText(/Worker AN \(Beta\)/);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);

    // Feld fuellen + hineinzoomen, bis der Worker den HEX-Pfad nimmt (pxR>=2).
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(400);
    const field = page.locator(FIELD_CANVAS).first();
    const box = await field.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);

    // (1) DISKRIMINATOR: Live-Canvas rendert HEXAGONE (nicht Raster/Quadrate).
    const liveMode = await field.evaluate((c: HTMLCanvasElement) => c.dataset.renderMode ?? null);
    expect(liveMode, "Live-Ansicht muss im Hex-Pfad sein (Diskriminator)").toBe("hex");

    // --- Snapshot ausloesen (Download-Pfad: kein Share -> deterministisch) -------
    await page.evaluate(() => {
      // @ts-expect-error Test-Stub
      try { delete navigator.canShare; } catch { /* ignore */ }
      // @ts-expect-error Test-Stub
      try { delete navigator.share; } catch { /* ignore */ }
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByTestId("snapshot-btn").click();
    const download = await downloadPromise;

    // Snapshot-PNG ist ein gueltiges, nicht-leeres Bild.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.length, "PNG non-empty").toBeGreaterThan(8);
    expect([buf[0], buf[1], buf[2], buf[3]], "PNG Magic Bytes").toEqual([0x89, 0x50, 0x4e, 0x47]);

    // (2) DISKRIMINATOR (Kern): die Spiegel-Canvas wurde durch den neuen
    // Worker-Frame-Pfad mit dem ECHTEN (Hexagon-)Render gefuellt. Ohne Fix
    // (kein emitFrame) bliebe sie leer/0x0 -> filled=0 -> Test failt.
    const mirror = await page.getByTestId("capture-mirror").evaluate((cv: HTMLCanvasElement) => {
      if (!cv.width || !cv.height) return { w: cv.width, h: cv.height, filled: 0 };
      const ctx = cv.getContext("2d", { alpha: false });
      if (!ctx) return { w: cv.width, h: cv.height, filled: -1 };
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let f = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) f++;
      return { w: cv.width, h: cv.height, filled: f, total: d.length / 4 };
    });
    expect(mirror.w, "Spiegel-Canvas wurde durch den Worker-Frame dimensioniert").toBeGreaterThan(0);
    expect(
      mirror.filled,
      `Spiegel-Canvas muss das echte Worker-(Hexagon-)Render enthalten. ` +
      `Ohne den Worker-Frame-Pfad bleibt sie leer -> filled=0. ` +
      `filled=${mirror.filled}, ${mirror.w}x${mirror.h}.`,
    ).toBeGreaterThan((mirror.total ?? 1) * 0.005);

    expect(errors, "keine Konsolen-/Page-Fehler im Worker-Snapshot-Pfad").toEqual([]);
  });
});
