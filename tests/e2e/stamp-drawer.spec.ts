import { test, expect } from "@playwright/test";

// v33 PR-B: Einwisch-Drawer (Farben/Formen) + Stempel-Mathematik. Realer DOM-/
// Verhaltens-Kontrakt (KEINE window-Hooks, AGENTS.md §2):
//   - Griff links oeffnet den Drawer (Primaer-Affordance, Recherche Thema 1).
//   - Tab 2 "Formen" zeigt Stempel-Typen + Groesse (1..4) + Farbanzahl (1..3) + Vorschau.
//   - Vorschau-Canvas rendert (nicht-leere Pixel).
//   - Stempel setzen: Feld leeren -> Stempel-Modus -> aufs Feld tippen -> Pop steigt.
//   - Keine Konsolen-/Page-Fehler im ganzen Ablauf.
// Laeuft im "mobile"-Projekt (390x844, playwright.config.ts).

async function popValue(page: import("@playwright/test").Page): Promise<number> {
  const txt = (await page.getByTestId("pop").textContent()) || "0";
  return Number(txt.replace(/[^\d]/g, "")) || 0;
}

test.describe("GolHex v33 Einwisch-Drawer + Stempel (PR-B)", () => {
  test("Griff oeffnet Drawer; Formen-Tab zeigt Stempel-Picker + Vorschau", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Startansicht: Drawer zu -> Griff sichtbar, Stempel-Picker nicht.
    const handle = page.getByRole("button", { name: "Farben & Stempel oeffnen" });
    await expect(handle).toBeVisible();
    await expect(page.getByRole("button", { name: "Stempel Ring" })).toBeHidden();

    // Griff-Tap oeffnet den Drawer (Tab 1 Farben). Dann auf "Formen" wechseln.
    await handle.click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Drawer Formen" }).click();
    await page.waitForTimeout(250);

    // Stempel-Typen + Kaestchen-Reihen sichtbar.
    for (const name of ["Stempel Ring", "Stempel Scheibe", "Stempel Hex", "Stempel Frei"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    // Groesse 1..4 + Farbanzahl 1..3 -> mindestens 7 Wert-Kaestchen.
    await expect(page.getByRole("button", { name: "Wert 4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Wert 3" }).first()).toBeVisible();

    // Vorschau-Canvas rendert nicht-leere Pixel (Stempel-Geometrie sichtbar).
    const drawn = await page.evaluate(() => {
      const cv = document.querySelector('canvas[aria-label="Stempel-Vorschau"]') as HTMLCanvasElement | null;
      if (!cv) return -1;
      const ctx = cv.getContext("2d");
      if (!ctx) return -1;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let nonBg = 0;
      // Hintergrund ist #0b0f14 (11,15,20). Zaehle deutlich andere Pixel.
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 15) + Math.abs(d[i + 2] - 20) > 40) nonBg++;
      }
      return nonBg;
    });
    expect(drawn, "Vorschau-Canvas hat gerenderte (nicht-Hintergrund) Pixel").toBeGreaterThan(50);

    expect(errors, "keine Fehler im Drawer-Ablauf").toEqual([]);
  });

  test("Stempel setzen: Feld leeren -> Tap aufs Feld erhoeht die Population", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Feld leeren -> Pop 0 (sauberer Ausgangspunkt).
    await page.getByRole("button", { name: "Leeren", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await popValue(page), "nach Leeren ist Pop 0").toBe(0);

    // Drawer -> Formen -> Ring, Groesse 2, Farbanzahl 2.
    await page.getByRole("button", { name: "Farben & Stempel oeffnen" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Drawer Formen" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Stempel Ring" }).click();
    // Groesse 2 (zweites Kaestchen der Groesse-Reihe) + Farbanzahl 2.
    await page.getByRole("button", { name: "Wert 2" }).first().click();
    await page.getByRole("button", { name: "Wert 2" }).nth(1).click();
    await page.waitForTimeout(150);

    // Im Formen-Modus (Tab 2) gibt es KEINEN Scrim: das Feld bleibt rechts des
    // Drawers (~300px breit) tappbar. Wir tippen in den sichtbaren Feld-Streifen
    // rechts -> der Stempel wird dort gesetzt (Auftrag 6: kein Bestaetigen).
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box, "Feld-Canvas hat ein Rechteck").not.toBeNull();
    const tapX = box!.x + box!.width * 0.92; // rechter Feld-Streifen, frei vom Drawer
    const tapY = box!.y + box!.height * 0.5;
    await page.mouse.click(tapX, tapY);
    await page.waitForTimeout(250);

    const popAfter = await popValue(page);
    // Ring(2) hat 12 Zellen; bei 2 Farben werden lebende Zellen gesetzt -> Pop > 0.
    expect(popAfter, `Stempel erhoeht Population (war 0, jetzt ${popAfter})`).toBeGreaterThan(0);
    expect(popAfter, "Ring(2) setzt hoechstens 12 Zellen").toBeLessThanOrEqual(12);

    expect(errors, "keine Fehler beim Stempel-Platzieren").toEqual([]);
  });
});
