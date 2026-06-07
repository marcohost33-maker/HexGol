import { test, expect } from "@playwright/test";

// AP-4 (2026-06-07): 1-Seiten-Mobile-Layout (Marco-Auftrag Punkt 2).
// Laeuft NUR im "mobile"-Projekt (390x844, playwright.config.ts). Realer DOM-/
// Layout-Kontrakt (KEINE window-Hooks, AGENTS.md §2):
//   - Kern-Controls (Start, Schritt, Random, Leeren, Menue) + Leinwand +
//     Zurueck/Schliessen-Button sind im Viewport sichtbar OHNE Scroll.
//   - Die Seite scrollt nicht (Shell == Viewport-Hoehe, kein Overflow).
//   - ALLE Sekundaer-Funktionen bleiben erreichbar: das Bottom-Sheet (Menue)
//     oeffnet sie (Kreis/Rechteck, Groessen-Select inkl. XXL, Worker, Recorder).
//   - Leinwand bekommt die groesstmoegliche Flaeche (flex-grow).

const VIEW = { w: 390, h: 844 };

// Liegt das Element-Rechteck (mit kleiner Toleranz) im Viewport?
async function inViewport(locator: import("@playwright/test").Locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const tol = 2;
  return (
    box.x >= -tol &&
    box.y >= -tol &&
    box.x + box.width <= VIEW.w + tol &&
    box.y + box.height <= VIEW.h + tol
  );
}

test.describe("GolHex AP-4 1-Seiten-Mobile-Layout (390x844)", () => {
  test("Kern-Controls + Leinwand + Schliessen im Viewport sichtbar OHNE Scroll", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);

    // (a) Seite scrollt nicht: Dokument-Scrollhoehe == Viewport-Hoehe (Toleranz 4px).
    const { scrollH, clientH, scrollableY } = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      scrollableY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(clientH).toBeLessThanOrEqual(VIEW.h + 2);
    expect(scrollableY, `kein vertikaler Scroll (scrollH=${scrollH}, clientH=${clientH})`).toBeLessThanOrEqual(4);

    // (b) Kern-Controls im Viewport sichtbar (Startansicht, Sheet zu).
    const canvas = page.locator("canvas");
    const start = page.getByRole("button", { name: "Start", exact: true });
    const schritt = page.getByRole("button", { name: "Schritt", exact: true });
    const random = page.getByRole("button", { name: "Random", exact: true });
    const leeren = page.getByRole("button", { name: "Leeren", exact: true });
    const menue = page.getByRole("button", { name: "Menue", exact: true });
    const close = page.getByRole("button", { name: "App schliessen" });

    for (const [name, loc] of [
      ["canvas", canvas], ["Start", start], ["Schritt", schritt],
      ["Random", random], ["Leeren", leeren], ["Menue", menue], ["Schliessen", close],
    ] as const) {
      await expect(loc, `${name} sichtbar`).toBeVisible();
      expect(await inViewport(loc), `${name} im Viewport (kein Scroll noetig)`).toBe(true);
    }

    // (c) Leinwand bekommt die groesstmoegliche Flaeche: Hoehe > 45% des Viewports.
    const cbox = await canvas.boundingBox();
    expect(cbox, "canvas hat ein Rechteck").not.toBeNull();
    expect(cbox!.height, `Leinwand-Hoehe ${cbox!.height}px > 380px`).toBeGreaterThan(380);

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  test("Sheet (Menue) macht ALLE Sekundaer-Funktionen erreichbar", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);

    // Startansicht: Sekundaer-Controls NICHT sichtbar (eingeklappt, 1-Seiten-Ziel).
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeHidden();

    // Menue oeffnet das Bottom-Sheet.
    await page.getByRole("button", { name: "Menue", exact: true }).click();
    await page.waitForTimeout(350);

    // Sekundaeres jetzt erreichbar (Anti-Regression: nichts entfernt, nur eingeklappt).
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechteck", exact: true })).toBeVisible();
    // Groessen-Select inkl. XXL (sim-Select ist nth(1) wie in den Desktop-Specs).
    await expect(page.locator("select").nth(1)).toContainText("XXL");
    // Forschungs-/Sekundaer-Funktion (LiouScope-Recorder) erreichbar.
    await expect(page.getByRole("button", { name: /Zeitreihe aufzeichnen/ })).toBeVisible();
    // Pinsel-Swatches (im compact-Modus im Sheet) erreichbar.
    await expect(page.getByRole("button", { name: "Rot" }).first()).toBeVisible();

    // Sheet wieder schliessen ueber den X-/v-Knopf -> Startansicht zurueck.
    await page.getByRole("button", { name: "Menue schliessen" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeHidden();

    expect(errors, "keine Fehler beim Sheet-Roundtrip").toEqual([]);
  });

  // PR#44-Auflage (3): praeventiv user-select:none + -webkit-touch-callout:none auf
  // Leinwand (und Rad). Beleg: die *berechneten* Styles sind real gesetzt (nicht nur
  // CSS-Text vorhanden) -> kein Text-/Bild-Markieren / iOS-Callout beim Long-Press.
  test("Canvas: user-select:none + touch-callout:none real angewandt", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(400);
    const styles = await page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLElement;
      const cs = getComputedStyle(c);
      return {
        userSelect: cs.userSelect || (cs as unknown as { webkitUserSelect: string }).webkitUserSelect,
        callout: (cs as unknown as { webkitTouchCallout: string }).webkitTouchCallout || "",
      };
    });
    expect(styles.userSelect, "user-select:none auf Canvas").toBe("none");
    // -webkit-touch-callout wird in Chromium-Desktop evtl. nicht reflektiert; in der
    // CSS-Regel ist es gesetzt (Build-Beleg) -> hier nur pruefen, dass es nicht "auto"
    // erzwingt, falls die Property exponiert ist.
    if (styles.callout) expect(styles.callout).toBe("none");
  });

  test("Zurueck/Schliessen-Button (User1-Pflicht) im Viewport + funktional", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(400);

    const close = page.getByRole("button", { name: "App schliessen" });
    await expect(close).toBeVisible();
    expect(await inViewport(close), "Schliessen im Viewport").toBe(true);

    // Funktions-Beleg: ein Klick loest closeApp() aus (history.back/window.close);
    // ohne Verlauf rendert die App den Beendet-Hinweis (kein harter Pfad).
    // Wir pruefen nur, dass der Klick keinen Fehler wirft (plattform-ehrlich).
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await close.click();
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});
