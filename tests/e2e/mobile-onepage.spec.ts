import { test, expect } from "@playwright/test";

// v33 1-Seiten-Mobile-Layout (Layout-Redesign 2026-06-07, PR-A). Laeuft NUR im
// "mobile"-Projekt (390x844, playwright.config.ts). Realer DOM-/Layout-Kontrakt
// (KEINE window-Hooks, AGENTS.md §2):
//   - Top-Leiste (Tabs + Schliessen), Feld (flex, max) und Steuerung unten
//     (Play/Schritt/Random/Leeren/Undo) sind im Viewport sichtbar OHNE Scroll.
//   - Die Seite scrollt nicht (Shell == Viewport-Hoehe, kein Overflow).
//   - ALLE Sekundaer-Funktionen bleiben erreichbar: die Tab-Panels (Overlay UEBER
//     dem Feld) oeffnen sie (Kreis/Rechteck + Groessen-Select inkl. XXL in Tab 3,
//     Recorder in Tab 4, Farb-Swatches in Tab 1). Tab-Tipp schliesst wieder.
//   - Feld bekommt die groesstmoegliche Flaeche (flex-grow).

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

test.describe("GolHex v33 1-Seiten-Mobile-Layout (390x844)", () => {
  test("Top-Leiste + Feld + Steuerung unten im Viewport sichtbar OHNE Scroll", async ({ page }) => {
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

    // (b) Kern-Controls im Viewport sichtbar (Startansicht, kein Panel offen).
    const canvas = page.locator("canvas");
    const start = page.getByRole("button", { name: "Start", exact: true });
    const schritt = page.getByRole("button", { name: "Schritt", exact: true });
    const random = page.getByRole("button", { name: "Random", exact: true });
    const leeren = page.getByRole("button", { name: "Leeren", exact: true });
    const tab1 = page.getByRole("button", { name: "Tab 1 Farben" });
    const tab3 = page.getByRole("button", { name: "Tab 3 Hex-Regeln" });
    const close = page.getByRole("button", { name: "App schliessen" });

    for (const [name, loc] of [
      ["canvas", canvas], ["Start", start], ["Schritt", schritt],
      ["Random", random], ["Leeren", leeren], ["Tab1", tab1], ["Tab3", tab3], ["Schliessen", close],
    ] as const) {
      await expect(loc, `${name} sichtbar`).toBeVisible();
      expect(await inViewport(loc), `${name} im Viewport (kein Scroll noetig)`).toBe(true);
    }

    // (c) Feld bekommt die groesstmoegliche Flaeche: Hoehe > 380px.
    const cbox = await canvas.boundingBox();
    expect(cbox, "canvas hat ein Rechteck").not.toBeNull();
    expect(cbox!.height, `Feld-Hoehe ${cbox!.height}px > 380px`).toBeGreaterThan(380);

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  test("Tab-Panels machen ALLE Sekundaer-Funktionen erreichbar", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);

    // Startansicht: Sekundaer-Controls NICHT sichtbar (kein Panel offen).
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeHidden();

    // Tab 3 (Hex-Regeln) oeffnet das Overlay-Panel.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(350);
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechteck", exact: true })).toBeVisible();
    // Groessen-Select inkl. XXL (sim-Select ist nth(1) wie in den Desktop-Specs).
    await expect(page.locator("select").nth(1)).toContainText("XXL");

    // Tab 4 (Physik): Forschungs-/Sekundaer-Funktion (LiouScope-Recorder) erreichbar.
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: /Zeitreihe aufzeichnen/ })).toBeVisible();

    // Tab 1 (Farben): Pinsel-Swatches erreichbar.
    await page.getByRole("button", { name: "Tab 1 Farben" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Rot" }).first()).toBeVisible();

    // Panel ueber den Schliessen-Knopf (v) zu -> Startansicht zurueck.
    await page.getByRole("button", { name: "Panel schliessen" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Kreis", exact: true })).toBeHidden();

    expect(errors, "keine Fehler beim Panel-Roundtrip").toEqual([]);
  });

  // PR#44-Auflage: praeventiv user-select:none + -webkit-touch-callout:none auf
  // Leinwand. Beleg: die *berechneten* Styles sind real gesetzt (nicht nur CSS-Text).
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
    if (styles.callout) expect(styles.callout).toBe("none");
  });

  test("Schliessen-Button (User1-Pflicht) im Viewport + funktional", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(400);

    const close = page.getByRole("button", { name: "App schliessen" });
    await expect(close).toBeVisible();
    expect(await inViewport(close), "Schliessen im Viewport").toBe(true);

    // Funktions-Beleg: ein Klick loest closeApp() aus (history.back/window.close);
    // wir pruefen nur, dass der Klick keinen Fehler wirft (plattform-ehrlich).
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await close.click();
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });

  // v33 PR-A: noch nicht implementierte Aktionen sind sichtbar disabled (TODO PR-C/D),
  // damit kein stiller Funktions-Vortaeuschung entsteht (Silent-Failure-Gate).
  test("PR-C/D-Platzhalter (Snapshot/Speichern/Redo/1.Figur) sind disabled", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(400);
    for (const name of [/Snapshot \(kommt in PR-C\)/, /Speichern \(kommt in PR-D\)/, /Redo \(kommt in PR-C\)/, /Zur ersten Figur \(kommt in PR-C\)/]) {
      await expect(page.getByRole("button", { name }), `${name} disabled`).toBeDisabled();
    }
  });
});
