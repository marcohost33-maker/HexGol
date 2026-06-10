import { test, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

// =============================================================================
// GAP-1 GUARD: "Zellen werden Quadrate" (Marco-Bug 2026-06-09, iPhone-only).
//
// WARUM dieser Test existiert (EVALUATION_STRATEGY §8.1, web-validiert 2026-06-09):
// Die Pixel-Visual-Baselines KODIERTEN den Bug. Auf dem schmalen Hochkant-Viewport
// (390 CSS-px) faellt das Standard-M-Gitter auf hr*s ~3.3 CSS-px/Zelle. Die alte
// Raster-Schwelle (`pxRgate < 3.5`, src/App.tsx draw()) schickte M damit in den
// ImageData-Raster-Fast-Path (src/lib/raster-render.js `plot()`), der QUADRATISCHE
// Pixelbloecke malt statt Hexagone. Im Pixel-Diff lag der Quadrat-vs-Hexagon-
// Unterschied einer ~3px-Zelle UNTER der 0.03-Toleranz -> kein Alarm. Der Fix
// senkte die Schwelle auf 2.0, sodass M wieder den echten Hex-Pfad nimmt.
//
// DPR3 IST LOAD-BEARING: der reale iPhone-Bug-Fall hat deviceScaleFactor 3. Erst
// bei DPR3 ist eine M-Zelle (~3.3 CSS-px) gross genug (~10 Geraete-px), dass die
// Hexagon-vs-Quadrat-Form ueberhaupt in Pixeln aufloest. Das playwright "mobile"-
// Projekt laeuft mit DPR1 (Layout-Belege), wo eine M-Zelle nur ~3 Geraete-px misst
// und keine Form-Aussage zulaesst. Darum erstellt dieser Test einen EIGENEN
// Kontext mit DPR3 (= echtes iPhone). Genau dieser Pfad fing den Bug nicht durch
// die Pixel-Baseline und braucht eine Form-Assertion.
//
// MECHANIK (additiv, KEINE neue Visual-Baseline): App ueber echte DOM-Controls
// treiben (Leeren + EIN kurzer Tap = genau eine Zelle, App.tsx onUp->paintCell),
// Canvas-Pixel LOKAL um die getippte Zelle lesen. pointy-top-Hexagon: schmale
// Ober-/Unterkante, breite Mitte -> obere/untere Zeile der Zell-Bounding-Box sind
// DEUTLICH schmaler als die Mitte, 4 BBox-Ecken LEER. Quadrat (Raster-Bug): alle
// Zeilen gleich breit, Ecken gefuellt. Diese Form-Metrik diskriminiert; ein
// Quadrat-Regress laesst den Test FAILEN (verifiziert gegen pre-fix Schwelle 3.5:
// dort quadratisch -> Test rot). Keine window-Hooks (AGENTS.md §2 e2e-Kontrakt).
// =============================================================================

const VIEWPORT = { width: 390, height: 844 };

// Kritische SCHMALE Hochkant-Breiten: hier fiel das Default-M-Gitter unter pxR<2.0
// und rasterte mit der alten pxR-only-Schwelle zu QUADRATEN (Bug 3. Wiederholung
// 2026-06-10). 390 = breites iPhone (knapp drueber); 375 = iPhone SE/8/13mini-Klasse;
// 360 = iPhone 12 mini / kleines Android. Der hr-Gate haelt ALLE hexagonal.
const NARROW_WIDTHS = [390, 375, 360];

test.describe("GolHex Mobile: Zellen sind HEXAGONAL, nicht quadratisch (GAP-1)", () => {
  test("eine M-Zelle rendert @DPR3 als Hexagon (schmale Ober-/Unterkante, leere Ecken)", async ({ browser, baseURL, browserName }) => {
    test.skip(browserName !== "chromium", "eigener DPR3-Kontext nutzt Chromium");
    test.setTimeout(60000);

    // browser-Fixture wiederverwenden (verwalteter webServer) statt 2. Browser-Start
    // -> kein ERR_CONNECTION_RESET-Flake unter Windows (Linux-CI war nie betroffen).
    let ctx: BrowserContext | null = null;
    try {
      // Echtes iPhone: 390x844 @ DPR3.
      ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, hasTouch: true });
      await ctx.addInitScript(() => { try { localStorage.setItem("golhex_intro_seen_v1", "1"); } catch { /* ignore */ } });
      const page = await ctx.newPage();

      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (t.includes("ERR_CONNECTION_RESET") || t.includes("Failed to load resource")) return; // Transport-Flake, kein App-Fehler
        errors.push("console: " + t);
      });

      await page.goto(baseURL || "http://127.0.0.1:4173/", { waitUntil: "load" });
      await page.waitForSelector("canvas");
      await page.waitForTimeout(400);

      // Leeren -> leeres Feld (deterministischer, statischer Ausgangszustand).
      await page.getByRole("button", { name: "Leeren", exact: true }).click();
      await page.waitForTimeout(250);

      // EIN kurzer Tap (down+up, ohne Move) im Feld-Inneren = genau eine Zelle.
      const canvas = page.locator("canvas").first();
      const box = await canvas.boundingBox();
      expect(box, "canvas hat ein Rechteck").not.toBeNull();
      const tapX = box!.x + box!.width * 0.42;
      const tapY = box!.y + box!.height * 0.45;
      await page.mouse.move(tapX, tapY);
      await page.mouse.down();
      await page.waitForTimeout(40);
      await page.mouse.up();
      await page.waitForTimeout(350);

      // Lokales Pixel-Fenster (+/-22 Geraete-px) um den Tap analysieren. Nur die
      // GETIPPTE Zelle ist gefuellt; die dimme Domaenen-Umriss-Linie wird durch das
      // Helligkeits-/Saettigungs-Kriterium ausgeschlossen.
      const shape = await page.evaluate((tap) => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        const ctx2d = c.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        const cx = Math.round((tap.x - rect.left) * dpr);
        const cy = Math.round((tap.y - rect.top) * dpr);
        const { data, width, height } = ctx2d.getImageData(0, 0, c.width, c.height);
        const filled = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= width || y >= height) return false;
          const i = (y * width + x) * 4;
          const R = data[i], G = data[i + 1], B = data[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          return mx > 110 && (mx - mn) > 40;
        };
        const RAD = 22; // Suchradius in Geraete-px (Zelle ~10px bei DPR3)
        let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0;
        for (let y = cy - RAD; y <= cy + RAD; y++) {
          for (let x = cx - RAD; x <= cx + RAD; x++) {
            if (filled(x, y)) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++; }
          }
        }
        if (n === 0) return { found: false } as const;
        const w = maxx - minx + 1, h = maxy - miny + 1;
        const rowWidth = (y: number) => { let a = 1e9, b = -1; for (let x = minx; x <= maxx; x++) if (filled(x, y)) { if (x < a) a = x; if (x > b) b = x; } return b < 0 ? 0 : b - a + 1; };
        const midY = (miny + maxy) >> 1;
        const widthMid = rowWidth(midY);
        const widthTop = rowWidth(miny);
        const widthBot = rowWidth(maxy);
        const tl = filled(minx + 1, miny + 1), tr = filled(maxx - 1, miny + 1);
        const bl = filled(minx + 1, maxy - 1), br = filled(maxx - 1, maxy - 1);
        const cornersFilled = [tl, tr, bl, br].filter(Boolean).length;
        return { found: true, w, h, widthMid, widthTop, widthBot, cornersFilled } as const;
      }, { x: tapX, y: tapY });

      expect(shape.found, "genau eine Zelle gemalt + gefunden").toBe(true);
      if (!shape.found) return;

      // Zelle gross genug fuer eine Form-Aussage (>= 6 Geraete-px; @DPR3 real ~10px).
      expect(shape.w, `Zell-Breite ${shape.w}px gross genug fuer Form-Test`).toBeGreaterThanOrEqual(6);
      expect(shape.h, `Zell-Hoehe ${shape.h}px gross genug fuer Form-Test`).toBeGreaterThanOrEqual(6);

      // HEXAGON-KRITERIUM A: Ober- UND Unterkante schmaler als die Mitte.
      // pointy-top-Hex: Spitze oben/unten -> Top/Bot-Zeile << Mittel-Zeile.
      // Quadrat (Raster-Bug): alle Zeilen gleich breit -> widthTop ~= widthMid -> FAIL.
      // Margin 0.75 (25% schmaler) robust gegen AA-Rauschen, faengt das Quadrat sicher.
      expect(shape.widthTop, `Oberkante (${shape.widthTop}px) schmaler als Mitte (${shape.widthMid}px) -> Hexagon, kein Quadrat`).toBeLessThan(shape.widthMid * 0.75);
      expect(shape.widthBot, `Unterkante (${shape.widthBot}px) schmaler als Mitte (${shape.widthMid}px) -> Hexagon, kein Quadrat`).toBeLessThan(shape.widthMid * 0.75);

      // HEXAGON-KRITERIUM B: hoechstens 1 der 4 BBox-Ecken gefuellt (Quadrat: 4).
      expect(shape.cornersFilled, `Hexagon: keine/eine gefuellte BBox-Ecke (Quadrat haette 4)`).toBeLessThanOrEqual(1);

      expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
    } finally {
      await ctx?.close(); // browser-Fixture NICHT schliessen (von Playwright verwaltet)
    }
  });

  // ===========================================================================
  // REQUIRED HEX-GATE (Marco-Kernforderung, Bug 3. Wiederholung 2026-06-10):
  // Auf den SCHMALEN Geraeten (375/360px), wo die alte pxR-only-Schwelle M zu
  // QUADRATEN machte, MUSS der Default-View den Path2D-Hexagon-Pfad nehmen, NICHT
  // den Raster-Pfad. Beleg: der observable Render-Marker canvas[data-render-mode]
  // (KEIN window-Hook -> AGENTS.md §2 e2e-Kontrakt). drawRaster() setzt "raster",
  // der Hex-Pfad setzt "hex". OHNE-FIX-ROT: mit der alten Schwelle steht M @ 375/360
  // auf "raster" -> dieser Test failt. Mit dem hr-Gate steht er auf "hex".
  // ===========================================================================
  for (const width of NARROW_WIDTHS) {
    test(`Default-M-View @ ${width}px nimmt den HEX-Pfad, nicht den Raster-Pfad`, async ({ browser, browserName, baseURL }) => {
      test.skip(browserName !== "chromium", "eigener DPR3-Kontext nutzt Chromium");
      test.setTimeout(60000);
      // browser-Fixture wiederverwenden (am verwalteten webServer angemeldet) statt
      // einen 2. Browser zu starten -> kein ERR_CONNECTION_RESET-Flake unter Windows.
      let ctx: BrowserContext | null = null;
      try {
        // Echtes iPhone-Profil: DPR3, schmaler Hochkant-Viewport (kritische Breite).
        // Intro-Flag vorseeden (wie playwright.config storageState), damit das Overlay
        // die DOM-Controls nicht abfaengt.
        ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
        await ctx.addInitScript(() => { try { localStorage.setItem("golhex_intro_seen_v1", "1"); } catch { /* ignore */ } });
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
        page.on("console", (m) => {
          // ECHTE JS-/App-Fehler sammeln; transienter Transport-Flake beim Asset-
          // Laden (ERR_CONNECTION_RESET, eigener Kontext + lokaler Preview-Server
          // unter Windows) ist KEIN App-Fehler und nicht load-bearing fuer den Hex-Gate.
          if (m.type() !== "error") return;
          const t = m.text();
          if (t.includes("ERR_CONNECTION_RESET") || t.includes("Failed to load resource")) return;
          errors.push("console: " + t);
        });

        await page.goto(baseURL || "http://127.0.0.1:4173/", { waitUntil: "load" });
        await page.waitForSelector("canvas");
        await page.waitForTimeout(400);
        // Default-Gitter ist M. Leeren -> ein Vollredraw mit gesetztem Marker.
        await page.getByRole("button", { name: "Leeren", exact: true }).click();
        await page.waitForTimeout(300);

        const mode = await page.evaluate(() => {
          const c = document.querySelector('canvas:not([aria-hidden="true"])') as HTMLCanvasElement | null;
          return c?.dataset.renderMode ?? null;
        });
        expect(mode, `Default-M @ ${width}px MUSS Hexagone (data-render-mode="hex"), NICHT "raster" (Quadrate)`).toBe("hex");
        expect(errors, "keine echten Konsolen-/Page-Fehler").toEqual([]);
      } finally {
        await ctx?.close();
      }
    });
  }
});
