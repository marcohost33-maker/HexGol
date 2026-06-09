import { test, expect } from "@playwright/test";

// REGRESSION (Marco 2026-06-09): "wenn ich im schwarzen Bereich um das umrahmte
// Hexfeld touche, bewegt sich der Rahmen des Hexfeldes." Wurzel: das Pan/Drag
// startete auf dem GANZEN Canvas (auch im leeren schwarzen Rand) und verschob die
// View (tx/ty) inkl. Rahmen. Fix: Hit-Test beim pointerdown — Pan nur, wenn der
// Druckpunkt IM Feld (Domaenen-Maske) liegt (src/lib/ui-gestures.shouldStartPan,
// verdrahtet in src/App.tsx onDown/onMove). Touch im Rand laesst den Rahmen FIX.
//
// Observable-Kontrakt (kein window-Hook, per AGENTS.md): wir treiben echte
// Pointer-Drags auf der <canvas> und vergleichen Canvas-Screenshots. Ein Drag im
// schwarzen Rand DARF das Bild nicht (nennenswert) aendern; ein Drag durch das
// Feldzentrum DARF es aendern (Pan wirkt weiterhin).

// Hexagon-Rahmen auf kleinem Gitter waehlen: das Feld ist zentriert, die vier
// Ecken des Canvas sind schwarzer Rand (Maske entfernt sie). Random fuellt das
// Feld, damit eine View-Verschiebung sichtbar waere.
async function setupHexFilled(page: import("@playwright/test").Page) {
  await page.goto("/"); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Hexagon", exact: true }).click(); await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Random", exact: true }).click(); await page.waitForTimeout(300);
}

// Leichter Canvas-Fingerprint: grobes (32x18) Helligkeits-Raster aus dem aktuellen
// Canvas-Frame. In-Page berechnet (kein 8MB-ImageData ueber CDP -> kein Timeout).
async function grab(page: import("@playwright/test").Page): Promise<number[]> {
  return await page.evaluate(() => {
    const cv = document.querySelector("canvas") as HTMLCanvasElement;
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
// Anteil deutlich veraenderter Raster-Zellen zwischen zwei Fingerprints.
function diffRatio(before: number[], after: number[]): number {
  let diff = 0; const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) if (Math.abs(before[i] - after[i]) > 18) diff++;
  return n ? diff / n : 0;
}

async function dragPointer(page: import("@playwright/test").Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  // Mehrere Zwischenschritte (> Touch-Slop 6px), damit der Pan-Modus ausloesen
  // KOENNTE, wenn er nicht ge-gated waere.
  for (let s = 1; s <= 6; s++) {
    await page.mouse.move(x0 + (x1 - x0) * (s / 6), y0 + (y1 - y0) * (s / 6));
    await page.waitForTimeout(20);
  }
  await page.mouse.up(); await page.waitForTimeout(250);
}

test.describe("GolHex Frame-Pan Hit-Test (Marco 2026-06-09)", () => {
  test("Drag im SCHWARZEN Rand bewegt den Rahmen NICHT; Drag im Feld pant", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await setupHexFilled(page);

    const cv = page.locator("canvas").first();
    const box = await cv.boundingBox();
    expect(box, "Canvas hat eine Bounding-Box").not.toBeNull();
    const b = box!;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;

    // 1) Drag in der oberen-linken ECKE (schwarzer Rand des Hexagon-Rahmens).
    const before1 = await grab(page);
    await dragPointer(page, b.x + b.width * 0.06, b.y + b.height * 0.06, b.x + b.width * 0.30, b.y + b.height * 0.30);
    const after1 = await grab(page);
    const marginDiff = diffRatio(before1, after1);
    // Rand-Drag darf NICHT pannen -> Bild praktisch unveraendert (kleine Schwelle
    // gegen Antialiasing/Render-Jitter; ein echter Pan verschoebe zweistellig %).
    expect(marginDiff, `Rand-Drag bewegt Rahmen nicht (diff=${(marginDiff * 100).toFixed(2)}%)`).toBeLessThan(0.02);

    // 2) Drag durch das FELDZENTRUM -> Pan wirkt weiterhin (Bild aendert sich).
    const before2 = await grab(page);
    await dragPointer(page, cx, cy, cx - b.width * 0.22, cy - b.height * 0.22);
    const after2 = await grab(page);
    const fieldDiff = diffRatio(before2, after2);
    expect(fieldDiff, `Feld-Drag pant weiterhin (diff=${(fieldDiff * 100).toFixed(2)}%)`).toBeGreaterThan(marginDiff);

    expect(errors).toEqual([]);
  });
});
