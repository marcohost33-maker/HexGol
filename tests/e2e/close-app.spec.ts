import { test, expect } from "@playwright/test";

// REGRESSION (Marco 2026-06-09): "Beenden zeigt nur ein Bild statt zu schliessen."
// Fix: closeApp() entscheidet plattform-ehrlich (src/lib/ui-gestures.decideCloseAction):
//   - installiert/standalone -> window.close() schliesst WIRKLICH (kein Bild),
//   - normaler Browser-Tab -> window.close() ist per Spec verboten -> ehrlicher
//     "GolHex beendet"-Hinweis (das ist KEIN Bug, sondern die Browser-Realitaet).
// Playwright laeuft als normaler Tab (nicht standalone) ohne App-History -> der
// Fallback-Pfad ist hier der korrekte, beobachtbare Ausgang.

test.describe("GolHex App-Schliessen (Marco 2026-06-09)", () => {
  test("Nicht-standalone mit App-History: Klick auf X navigiert zurueck (nicht nur ein Bild)", async ({ page }) => {
    // Playwright-Tab: nicht standalone, history.length > 1 -> "back"-Pfad. Beleg:
    // die App verschwindet (Navigation), statt nur ein Bild im selben App-Screen
    // anzuzeigen. Das ist der Launcher-Fall (zurueck zur Zentrale).
    await page.goto("/");
    await page.waitForTimeout(400);
    const close = page.getByRole("button", { name: "App schliessen" });
    await expect(close).toBeVisible();
    await close.click();
    await page.waitForTimeout(300);
    // Nach back-Navigation ist der GolHex-Schliessen-Button nicht mehr da.
    await expect(close).toHaveCount(0);
  });

  test("Browser-Tab ohne App-History: ehrlicher Beendet-Hinweis (Fallback-Pfad)", async ({ page }) => {
    // matchMedia(standalone)=false erzwingen UND history auf Laenge 1 stubben ->
    // decideCloseAction -> "fallback". window.close() ist im Tab verboten -> der
    // ehrliche "GolHex beendet"-Hinweis erscheint (kein Bug, Browser-Realitaet).
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      // @ts-expect-error test stub
      window.matchMedia = (q: string) =>
        q.includes("display-mode")
          ? ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } as unknown as MediaQueryList)
          : orig(q);
      try { Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 }); } catch { /* ignore */ }
    });
    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "App schliessen" }).click();
    await expect(page.getByText("GolHex beendet")).toBeVisible({ timeout: 2000 });
    await expect(page.getByText(/Du kannst diesen Tab/)).toBeVisible();
  });

  test("Standalone-Erkennung: kein Fallback-Bild, wenn display-mode standalone (matchMedia gestubbt)", async ({ page }) => {
    // matchMedia('(display-mode: standalone)') auf true zwingen + window.close()
    // beobachten. Erwartung: decideCloseAction -> "close" -> window.close() wird
    // gerufen und KEIN Beendet-Bild gezeigt (das Fenster wuerde real schliessen).
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      // @ts-expect-error test stub
      window.matchMedia = (q: string) =>
        q.includes("display-mode: standalone")
          ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } as unknown as MediaQueryList)
          : orig(q);
      // window.close() merken (Tab-Close wird vom Browser eh verweigert, aber wir
      // belegen, dass der close-Pfad und NICHT der back/fallback-Pfad lief).
      (window as unknown as { __closeCalled?: boolean }).__closeCalled = false;
      const realClose = window.close.bind(window);
      window.close = () => { (window as unknown as { __closeCalled?: boolean }).__closeCalled = true; try { realClose(); } catch { /* tab close verweigert */ } };
    });
    await page.goto("/");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "App schliessen" }).click();
    await page.waitForTimeout(400);

    const closeCalled = await page.evaluate(() => (window as unknown as { __closeCalled?: boolean }).__closeCalled);
    expect(closeCalled, "standalone -> window.close() wurde gerufen (close-Pfad)").toBe(true);
  });
});
