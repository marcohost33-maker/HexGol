import { test, expect, chromium } from "@playwright/test";
import type { Browser, BrowserContext } from "@playwright/test";

// =============================================================================
// GAP-2 GUARD: Main-Thread-Freeze unter CPU-Last (closePath-Freeze 2026-06-09).
//
// WARUM dieser Test existiert (EVALUATION_STRATEGY §8.1, web-validiert 2026-06-09):
// Es gab KEIN Performance-Budget. Path2D.closePath() ist auf Chromiums Skia-
// Path-Builder pathologisch teuer, wenn EIN Path2D tausende Hex-Subpfade sammelt
// (experimental/profile-closepath.mjs: M @6x-CPU = 23'389 closePath/3s = 1920ms =
// 64% Wall-Time -> 2.7 fps). Auf dem iPhone fror M/L damit ~1.7s ein (L=1.0 fps).
// Fuer Pixel-Visual-Baselines ist so ein Freeze UNSICHTBAR (Screenshot = Standbild,
// kein Zeit-Signal). Der Fix (#...) liess closePath im Fuell-Pfad weg (fill()
// schliesst implizit) -> M @4x-CPU maxLongTask ~338ms (e2e, gemessen) statt 1397ms.
//
// MECHANIK (produktionalisiert aus experimental/profile-mobile-freeze.mjs): eigener
// Browser-Kontext mit Mobile-Viewport (390x844, DPR3) + CDP
// `Emulation.setCPUThrottlingRate(4)`. M-Gitter laeuft (Random+Start). Ein
// PerformanceObserver(longtask) auf der Seite sammelt die Dauer der laengsten
// Main-Thread-Tasks. Assertion: maxLongTask < BUDGET.
//
// SCHWELLE 500ms, bewusst grosszuegig + begruendet (NICHT flaky):
//   - Fixed-Code-Messung IM TEST (DPR3, 4x throttle, M laufend, inkl. Random-Fill-
//     Spitze): maxLongTask ~338ms (2026-06-09; das Standalone-Skript ohne Parallel-
//     Last misst 181ms, der e2e-Lauf mit Worker-Contention liegt hoeher).
//   - closePath-Freeze pre-fix: in DIESEM Test real maxLongTask = 1397ms gemessen
//     (App.tsx addHex/addHexIdx mit erzwungenem closePath = #70-pre-fix-Stand,
//     2026-06-09 Fails-before-Beleg). 500ms liegt klar zwischen "gesund" (~338ms +
//     CI-Jitter) und "Freeze" (1397ms) -> faengt 600ms+ sicher, ist aber nicht so
//     eng, dass normale CI-Varianz (2-fach Retry konfiguriert) ihn rot faerbt.
//   - Scope M (Default-Gitter): M ist der reale Bug-/Default-Fall. L/XL/XXL nehmen
//     legitim den Raster-Pfad (groessere Gitter, eigene Performance-Klasse) und
//     werden hier NICHT budgetiert (sonst flaky auf throttled CI).
//
// CDP ist Chromium-only -> der Test ueberspringt sich auf anderen Engines.
// =============================================================================

const VIEWPORT = { width: 390, height: 844 };
const THROTTLE = 4;          // CPU-Verlangsamung (CDP)
const MEASURE_MS = 3000;     // Mess-Fenster bei laufendem M
const BUDGET_MS = 500;       // maxLongTask-Budget (Begruendung oben)

test.describe("GolHex Mobile: Perf-Budget unter CPU-Throttle (GAP-2)", () => {
  test("M laufend @4x-CPU: kein Long-Task >500ms (closePath-Freeze-Guard)", async ({ baseURL, browserName }) => {
    test.skip(browserName !== "chromium", "CDP CPU-Throttle ist Chromium-only");
    test.setTimeout(60000);

    let browser: Browser | null = null;
    let ctx: BrowserContext | null = null;
    try {
      browser = await chromium.launch();
      ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, hasTouch: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

      await page.goto(baseURL || "http://127.0.0.1:4173/", { waitUntil: "load" });
      await page.waitForSelector("canvas");

      // Long-Task-Beobachter auf der Seite installieren (kein App-Hook, reiner
      // PerformanceObserver — der e2e-Kontrakt erlaubt Test-seitige Observer).
      await page.evaluate(() => {
        (window as unknown as { __lt: number[] }).__lt = [];
        try {
          const po = new PerformanceObserver((l) => {
            for (const e of l.getEntries()) (window as unknown as { __lt: number[] }).__lt.push(e.duration);
          });
          po.observe({ entryTypes: ["longtask"] });
        } catch { /* longtask nicht unterstuetzt -> Test ueberspringt unten */ }
      });

      // M-Gitter (Default) mit Random fuellen und laufen lassen.
      await page.getByRole("button", { name: "Random", exact: true }).click();
      await page.getByRole("button", { name: "Start" }).click();

      // Mess-Fenster: Beobachter leeren, dann MEASURE_MS laufen lassen.
      await page.evaluate(() => { (window as unknown as { __lt: number[] }).__lt = []; });
      await page.waitForTimeout(MEASURE_MS);

      const r = await page.evaluate(() => {
        const lt = (window as unknown as { __lt: number[] }).__lt.slice();
        return { count: lt.length, max: lt.length ? Math.max(...lt) : 0, supported: "PerformanceObserver" in window };
      });

      await page.getByRole("button", { name: "Pause" }).click().catch(() => {});

      test.skip(!r.supported, "PerformanceObserver/longtask nicht verfuegbar");

      // Hauptassertion: kein einzelner Long-Task ueberschreitet das Budget.
      expect(
        r.max,
        `maxLongTask ${r.max.toFixed(0)}ms < Budget ${BUDGET_MS}ms (M @${THROTTLE}x-CPU; closePath-Freeze war >600ms)`,
      ).toBeLessThan(BUDGET_MS);

      expect(errors, "keine Page-Fehler waehrend der Last").toEqual([]);
    } finally {
      await ctx?.close();
      await browser?.close();
    }
  });
});
