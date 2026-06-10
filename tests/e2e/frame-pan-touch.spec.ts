import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// =============================================================================
// REGRESSION (Bug 2, 2026-06-10): "Box-Rahmen verschiebt sich bei Touch im
// schwarzen Rand." Gegenstueck zu frame-pan-margin.spec.ts (das mit MAUS im
// chromium-Desktop-Projekt die Hexagon-Ecken prueft). Dieser Test fuehrt ECHTE
// TOUCH-Gesten (mobile-Projekt, hasTouch) ueber den DEFAULT-Box-Rahmen auf dem
// schmalen Hochkant-Viewport (390x844) — genau Marcos iPhone-Szenario.
//
// EHRLICHER BEFUND: In Chromium-Touch-Emulation ist der Bug NICHT reproduzierbar
// (der pointerdown-Hit-Test panOk=shouldStartPan blockiert den Rand korrekt; ein
// echter iPhone-WebKit-Pfad bleibt das Final-Gate, nicht auf PC beweisbar). Dieser
// Test verriegelt daher das KORREKTE Verhalten gegen kuenftige Regression:
//   - Touch-Drag im SCHWARZEN Rand (oberhalb des zentrierten Box-Felds)
//     -> View (tx/ty) bzw. Canvas-Bild bleibt FIX (kein Pan).
//   - Touch-Drag durch das FELDZENTRUM -> Pan wirkt (Bild aendert sich).
// Observable-Kontrakt: KEINE window-Hooks (AGENTS.md §2). Wir lesen den Canvas-
// Fingerprint vor/nach und vergleichen.
// =============================================================================

async function grab(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const cv = document.querySelector('canvas:not([aria-hidden="true"])') as HTMLCanvasElement;
    const ctx = cv.getContext("2d");
    if (!ctx) return [] as number[];
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const GX = 32, GY = 18, cell: number[] = new Array(GX * GY).fill(0);
    const bw = cv.width / GX, bh = cv.height / GY;
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      let sum = 0, cnt = 0;
      const x0 = Math.floor(gx * bw), x1 = Math.floor((gx + 1) * bw);
      const y0 = Math.floor(gy * bh), y1 = Math.floor((gy + 1) * bh);
      for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
        const i = (y * cv.width + x) * 4; sum += d[i] + d[i + 1] + d[i + 2]; cnt++;
      }
      cell[gy * GX + gx] = cnt ? sum / cnt : 0;
    }
    return cell;
  });
}
function diffRatio(before: number[], after: number[]): number {
  let diff = 0; const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) if (Math.abs(before[i] - after[i]) > 18) diff++;
  return n ? diff / n : 0;
}

// Echte Touch-Geste ueber PointerEvents (pointerType:"touch") auf der Feld-Canvas.
// Mehrere move-Schritte > Touch-Slop (6px), damit der Pan-Modus ausloesen KOENNTE,
// wenn er nicht ge-gated waere.
async function touchDrag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const steps = 8;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + (x1 - x0) * (s / steps);
    const y = y0 + (y1 - y0) * (s / steps);
    const phase = s === 0 ? "down" : s === steps ? "up" : "move";
    await page.evaluate(([cx, cy, ph]) => {
      const cv = document.querySelector('canvas:not([aria-hidden="true"])') as HTMLCanvasElement;
      const type = ph === "down" ? "pointerdown" : ph === "up" ? "pointerup" : "pointermove";
      const ev = new PointerEvent(type, {
        pointerId: 1, pointerType: "touch", isPrimary: true,
        clientX: cx as number, clientY: cy as number, bubbles: true, cancelable: true,
        buttons: ph === "up" ? 0 : 1,
      });
      cv.dispatchEvent(ev);
    }, [x, y, phase] as const);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(220);
}

test.describe("GolHex Frame-Pan TOUCH (Box-Default, Bug 2 2026-06-10)", () => {
  test("Touch-Drag im schwarzen Rand bewegt den Box-Rahmen NICHT; Feld-Drag pant", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });

    await page.goto("/"); await page.waitForTimeout(400);
    // Box ist Default. Random fuellt das Feld, damit ein Pan sichtbar waere.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);

    const cv = page.locator('canvas:not([aria-hidden="true"])').first();
    const b = (await cv.boundingBox())!;
    expect(b, "Canvas hat eine Bounding-Box").not.toBeNull();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;

    // 1) Schwarzer Rand: in Box-Hochkant ist das Feld vertikal zentriert -> oberes
    //    Band ist schwarzer Rand. Drag dort darf NICHT pannen.
    const beforeMargin = await grab(page);
    await touchDrag(page, b.x + b.width * 0.5, b.y + b.height * 0.035, b.x + b.width * 0.5, b.y + b.height * 0.30);
    const afterMargin = await grab(page);
    const marginDiff = diffRatio(beforeMargin, afterMargin);
    expect(marginDiff, `Rand-Touch bewegt Box-Rahmen NICHT (diff=${(marginDiff * 100).toFixed(2)}%)`).toBeLessThan(0.02);

    // 2) Feldzentrum: Pan wirkt weiterhin (Bild aendert sich deutlich).
    const beforeField = await grab(page);
    await touchDrag(page, cx, cy, cx - b.width * 0.22, cy);
    const afterField = await grab(page);
    const fieldDiff = diffRatio(beforeField, afterField);
    expect(fieldDiff, `Feld-Touch pant weiterhin (diff=${(fieldDiff * 100).toFixed(2)}%)`).toBeGreaterThan(marginDiff);

    expect(errors, "keine echten Konsolen-/Page-Fehler").toEqual([]);
  });
});
