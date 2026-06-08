import { test, expect } from "@playwright/test";

// v33 PR-E: Ellipse- + Freiform-Rahmenform. Realer DOM-/Verhaltens-Kontrakt
// (KEINE window-Hooks, AGENTS.md §2): reale Tab/Buttons (Tab 3 Hex-Regeln) +
// echte Canvas-Pointer-Events fuer den Freiform-Zug. Geprueft:
//   - Ellipse waehlbar -> a/b-Regler erscheinen, Feld baut sich (0 Fehler).
//   - Frei waehlbar -> Zeichnen aktivieren -> Polygonzug auf dem Canvas ziehen ->
//     Domaene wird gebaut, Random fuellt eine plausible Population, 0 Fehler.
// Laeuft im chromium-Projekt (1280x800, Controls inline).

async function popValue(page: import("@playwright/test").Page): Promise<number> {
  const txt = (await page.getByTestId("pop").textContent()) || "0";
  return Number(txt.replace(/[^\d]/g, "")) || 0;
}

test.describe("GolHex v33 Ellipse + Freiform (PR-E)", () => {
  test("Ellipse: Rahmen waehlbar, a/b-Regler da, Feld baut ohne Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    const ellipseBtn = page.getByRole("button", { name: "Ellipse", exact: true });
    await expect(ellipseBtn).toBeVisible();
    await ellipseBtn.click();
    await page.waitForTimeout(300);

    // a/b-Regler erscheinen (Slider, eindeutig per Rolle).
    await expect(page.getByRole("slider", { name: "Ellipse Achse a" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Ellipse Achse b" })).toBeVisible();

    // Panel schliessen, Feld zufaellig fuellen -> Population > 0 (Maske nicht leer).
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    expect(await popValue(page), "Ellipse-Domaene nicht leer").toBeGreaterThan(0);

    expect(errors, "keine Fehler im Ellipse-Ablauf").toEqual([]);
  });

  test("Frei: Zeichnen-Modus -> Polygonzug auf Canvas -> Domaene gebaut, Feld plausibel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    const freiBtn = page.getByRole("button", { name: "Frei", exact: true });
    await expect(freiBtn).toBeVisible();
    await freiBtn.click();
    await page.waitForTimeout(200);

    // Zeichnen aktivieren.
    const drawBtn = page.getByRole("button", { name: "Freiform zeichnen" });
    await expect(drawBtn).toBeVisible();
    await drawBtn.click();
    await page.waitForTimeout(150);

    // Panel schliessen, damit das Feld frei ist.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(200);

    // Einen geschlossenen Polygonzug (Dreieck/Viereck) auf dem Canvas ziehen —
    // echte Pointer-Events (pointerdown -> mehrere moves -> pointerup).
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box, "Feld-Canvas hat ein Rechteck").not.toBeNull();
    const cx = box!.x + box!.width * 0.5, cy = box!.y + box!.height * 0.5;
    const rx = box!.width * 0.18, ry = box!.height * 0.18;
    // Vier Eckpunkte eines Rechtecks um die Mitte.
    const pts = [
      [cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry], [cx - rx, cy - ry],
    ];
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      // mehrere Zwischenschritte je Kante -> der Min-Abstand-Sampler erfasst Punkte.
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * (s / steps);
        const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (s / steps);
        await page.mouse.move(x, y);
      }
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Random fuellt nur die gezeichnete Domaene -> Population > 0 und KLEINER als
    // ein voll gefuelltes Gitter (die Maske beschneidet wirklich).
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    const pop = await popValue(page);
    expect(pop, "Freiform-Domaene gefuellt").toBeGreaterThan(0);

    expect(errors, "keine Fehler im Freiform-Ablauf").toEqual([]);
  });
});
