import { test, expect } from "@playwright/test";

// Visual-Regression-Baselines fuer GolHex v29L.2 (2026-06-01). Deterministisch:
// KEINE laufende Sim (kein Start) — nur statische Zustaende, sodass die Snapshots
// reproduzierbar sind. Canvas-AA-Rauschen ist via playwright.config toHaveScreenshot
// (maxDiffPixelRatio 0.03) toleriert. Baselines werden im CI-Docker-Image via
// update-snapshots.yml erzeugt (Linux, deckungsgleich mit visual-regression.yml).
test.describe("GolHex v29L.2 visual baselines", () => {
  test("life: deterministischer Random-Fill (Default-Grid)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(700);
    // fester Default-Seed -> Random ist reproduzierbar (kein Wuerfeln)
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("canvas").first()).toHaveScreenshot("life-random-default.png");
  });

  test("XXL + Kreis-Rahmen (ImageData-Raster-Pfad, statisch)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    // v33: Groesse + Rahmen liegen im Tab 3 (Hex-Regeln). Auswahl treffen, dann
    // Panel schliessen (Overlay wuerde sonst die Canvas-Baseline ueberdecken).
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    await page.locator("select").nth(1).selectOption("4"); // XXL
    await page.getByRole("button", { name: "Kreis", exact: true }).click();
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // Panel zu
    await page.waitForTimeout(600);
    await expect(page.locator("canvas").first()).toHaveScreenshot("xxl-circle-frame.png");
  });

  // v33.0.2 P2-D (Codex-Review-Folgepunkt): Bisher deckte KEINE Visual-Baseline das
  // Rahmen-Umriss-Overlay ab. Im Worker-Modus besitzt der Worker die Feld-Canvas und
  // zeichnet den duennen Umriss NICHT — eine separate, immer-Main-Thread Overlay-Canvas
  // (aria-hidden) traegt ihn. Diese Baseline fixiert genau das: Worker AN (4XL ueber dem
  // Auto-Cap 90k) + Kreis-Rahmen, **leeres Feld** (kein Random/Start). Deterministisch,
  // weil keine Zellen gerendert werden -> der Worker malt nur den dunklen Hintergrund und
  // das Overlay den Teal-Kreis-Umriss. Schuetzt P2-B (view-sync) + die Overlay-Existenz:
  // verschwindet das Overlay oder driftet der Umriss, schlaegt die Baseline an.
  test("Worker-Modus: Rahmen-Umriss-Overlay (4XL Kreis, leeres Feld)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    // 4XL (160k > Auto-Worker-Cap 90k) -> Worker aktiviert sich selbst.
    await page.locator("select").nth(1).selectOption("6");
    await page.getByRole("button", { name: "Kreis", exact: true }).click();
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle, "Auto-Worker bei 4XL aktiv").toHaveText(/Worker AN \(Beta\)/);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // Panel zu
    // Overlay zeichnet erst, wenn der Worker WIRKLICH aktiv ist (workerActiveRef) —
    // grosszuegig warten, bis transferControlToOffscreen + "ready" durch sind.
    await page.waitForTimeout(1200);
    // Strukturelle Zusicherung: die Overlay-Canvas (aria-hidden) ist gemountet.
    await expect(page.locator('canvas[aria-hidden="true"]')).toHaveCount(1);
    // Composite (Feld-Worker-Render + Overlay-Umriss) ueber den Feld-Container.
    await expect(page.locator(".ghx-canvas")).toHaveScreenshot("worker-overlay-outline.png");
    expect(errors, "keine Konsolen-/Page-Fehler im Overlay-Pfad").toEqual([]);
  });

  // Snow (kanonischer Reiter, PR #63): deterministische Baseline fuer die NEUE,
  // massenerhaltende Schnee-Optik. DETERMINISTISCH ohne Timing-Flackern, weil NICHT
  // die rAF-Schleife laeuft (kein Start), sondern eine feste Zahl EINZELSCHRITTE ueber
  // den "Schritt"-Knopf (doStep) ausgeloest wird. Der Schnee-Seed ist RNG-frei
  // (Hintergrund-Dampf 0.4 + ein Eiskeim), also voll reproduzierbar; nach N Schritten
  // ist das Feld eindeutig bestimmt. Diese Baseline schlaegt an, wenn die Reiter-Optik
  // (oder der rval-Renderpfad) unbeabsichtigt driftet. Canvas-AA via config toleriert.
  test("snow: kanonischer Reiter, deterministisch gesteppt (statisch)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);
    // Tab 4 (Physik) -> reellwertiger Modus -> Schnee -> Seed.
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Physik (reellwertig)", exact: true }).click();
    await page.getByRole("button", { name: "Schnee", exact: true }).click();
    await page.getByRole("button", { name: "Neu initialisieren (Seed)" }).click();
    await page.getByRole("button", { name: "Tab 4 Physik" }).click(); // Panel zu
    await page.waitForTimeout(300);
    // Feste Zahl deterministischer Einzelschritte (kein Start/rAF) -> reproduzierbar.
    const stepBtn = page.getByRole("button", { name: "Schritt" });
    for (let i = 0; i < 30; i++) await stepBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator("canvas").first()).toHaveScreenshot("snow-reiter-stepped.png");
    expect(errors, "keine Konsolen-/Page-Fehler im Schnee-Pfad").toEqual([]);
  });
});
