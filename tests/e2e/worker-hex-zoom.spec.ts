import { test, expect } from "@playwright/test";

// =============================================================================
// MARCO 5XL-QUADRATE-BUG -- DAUERHAFTE LOESUNG (4. Wiederholung 2026-06-11).
//
// WURZEL: der OffscreenCanvas-Render-Worker (src/worker/render-worker.js) kannte
// NUR den Raster-(Quadrat-)Pfad. Sobald er bei >=90k Zellen (3XL/4XL/5XL) die
// Canvas via transferControlToOffscreen besass (irreversibel), zeichnete ER auf
// JEDER Zoomstufe Quadrate -- auch HINEINGEZOOMT, wo eine 5XL-Zelle (hr=1.3) bei
// s>=1.54 -> pxR>=2 gross genug fuer eine echte Hexform ist. Der Main-Thread-Hex-
// Pfad (App.tsx draw, gated durch usesRasterPath) griff im Worker-Modus nie.
//
// FIX: der Worker waehlt jetzt pro Render denselben Pfad wie der Main-Thread
// (usesRasterPath, src/lib/ui-gestures.js): pxR<2 -> Raster (Quadrate ok, Freeze-
// Schutz fuer 250k), pxR>=2 -> renderHex (Path2D-Hexagone mit Viewport-Culling).
//
// BELEG (observable, KEIN window-Hook -> AGENTS.md §2): der Worker postet bei
// Modus-Wechsel `{type:"renderMode"}`, den die App auf canvas[data-render-mode]
// spiegelt. HERAUSGEZOOMT (fit) steht 5XL auf "raster"; HINEINGEZOOMT (Wheel-Zoom,
// pxR>=2) MUSS auf "hex" springen. FALSIFIKATION: ohne Fix kennt der Worker nur
// Raster -> er bliebe bei JEDER Zoomstufe "raster" -> dieser Test failt.
//
// DOM-Kontrakt: reale Controls (Tab-3, Groessen-Select, Random) + Wheel-Geste auf
// dem Feld-Canvas; keine window-Hooks.
// =============================================================================

const FIELD_CANVAS = 'canvas:not([aria-hidden="true"])';

test.describe("GolHex: 5XL hineingezoomt rendert HEXAGONE (Worker-Hex)", () => {
  test("5XL via Worker: herausgezoomt=Raster, hineingezoomt=Hexagone (data-render-mode)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "OffscreenCanvas-Worker = Chromium");
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    // 5XL (250k, value 7) -> Auto-Worker AN (>= Cap 90k).
    await page.locator("select").nth(1).selectOption("7");
    await page.waitForTimeout(500);
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle, "Auto-Worker bei 5XL aktiv").toHaveText(/Worker AN \(Beta\)/);

    // Panel schliessen, Feld fuellen (sichtbare Zellen, damit Render laeuft).
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);

    const field = page.locator(FIELD_CANVAS).first();
    await expect(field).toHaveCount(1);

    // --- HERAUSGEZOOMT (fit): 5XL-Zelle ist sub-2px -> Worker meldet "raster" ----
    const modeOut = await field.evaluate((c: HTMLCanvasElement) => c.dataset.renderMode ?? null);
    expect(modeOut, "5XL herausgezoomt -> Raster (Quadrate, Freeze-Schutz)").toBe("raster");

    // --- HINEINZOOMEN per Wheel bis pxR >= 2 (s >= 2/1.3 = 1.54) ----------------
    // Negative deltaY = Zoom-IN. Mehrere kraeftige Schritte ueber dem Feld-Zentrum.
    const box = await field.boundingBox();
    expect(box, "Feld-Canvas hat ein Rechteck").not.toBeNull();
    const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, -260); // kraeftiger Zoom-In-Schritt
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(400);

    // Jetzt MUSS der Worker den Hex-Pfad nehmen (pxR>=2). data-render-mode="hex".
    const modeIn = await field.evaluate((c: HTMLCanvasElement) => c.dataset.renderMode ?? null);
    expect(
      modeIn,
      `5XL HINEINGEZOOMT MUSS Hexagone (data-render-mode="hex"), NICHT Quadrate ("raster"). ` +
      `Genau das ist Marcos 5XL-Quadrate-Bug -- ohne Worker-Hex-Pfad bliebe es "raster".`,
    ).toBe("hex");

    expect(errors, "keine Konsolen-/Page-Fehler im Worker-Hex-Zoom-Pfad").toEqual([]);
  });
});
