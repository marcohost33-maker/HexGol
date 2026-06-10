import { test, expect } from "@playwright/test";

// Bug #1 (echtes iPhone, KORRIGIERTE Richtung): Einen SELBST gezeichneten
// Freiform-Rahmen bekommt man nicht mehr weg — man muss die App neu starten.
//
// ROOT CAUSE (verifiziert, file:line):
//   - src/App.tsx (Freiform-Panel-Button) leerte NUR das Polygon
//     (setFreeformPolygon([])), liess aber frameShape === "freeform".
//   - src/App.tsx frameOptsFor(): polygon < 3 Punkte -> undefined.
//   - src/lib/sim-engine.js buildNeighbors()/inDomain(): `if (!polygon) return false`
//     fuer ALLE Zellen => leere Domaene (inCount 0). Das Feld ist "eingefroren",
//     der Rahmen-Umriss bleibt — nur ein App-Neustart half.
//   Empirisch (node, R=C=40): box.mask=1600, freeform-leer.mask=0.
//
// FIX: Der Panel-Button heisst jetzt "Rahmen entfernen" (keine Label-Kollision
// mehr mit dem Zell-"Leeren"/doClear) und ruft clearFreeformFrame() ->
// setFrameShape("box") -> volles Gitter wiederhergestellt, Umriss-Render weg,
// Worker-regeom (shape:box), OHNE Reload.
//
// Realer DOM-/Verhaltens-Kontrakt (KEINE window-Hooks, AGENTS.md §2): reale
// Tab/Buttons + echte Canvas-Pointer-Events. Observable: die sichtbare
// Population (data-testid="pop") nach "Random" misst die Groesse der aktiven
// Domaene. Voll-Gitter-Random >> Freiform-Random; nach dem Reset muss Random
// wieder ~das volle Gitter fuellen.

async function popValue(page: import("@playwright/test").Page): Promise<number> {
  const txt = (await page.getByTestId("pop").textContent()) || "0";
  return Number(txt.replace(/[^\d]/g, "")) || 0;
}

// Zieht einen geschlossenen Rechteck-Polygonzug (~18% der Canvas) um die Mitte —
// echte Pointer-Events, identisch zu frame-ellipse-freeform.spec.ts.
async function drawFreeformRect(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box, "Feld-Canvas hat ein Rechteck").not.toBeNull();
  const cx = box!.x + box!.width * 0.5, cy = box!.y + box!.height * 0.5;
  const rx = box!.width * 0.18, ry = box!.height * 0.18;
  const pts = [
    [cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry], [cx - rx, cy - ry],
  ];
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const steps = 8;
    for (let s = 1; s <= steps; s++) {
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * (s / steps);
      const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (s / steps);
      await page.mouse.move(x, y);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.describe("GolHex #1 Freiform-Rahmen entfernbar ohne Neustart", () => {
  test("Frei -> Polygon -> 'Rahmen entfernen' -> volles Feld wiederhergestellt (kein Reload)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Referenz: volles (box) Gitter -> Random -> Population des vollen Feldes.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    const popFull = await popValue(page);
    expect(popFull, "Voll-Gitter-Random fuellt").toBeGreaterThan(0);

    // Freiform waehlen + Polygon zeichnen.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Frei", exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Freiform zeichnen" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // Panel zu
    await page.waitForTimeout(200);
    await drawFreeformRect(page);

    // Random fuellt NUR die kleine Freiform-Domaene -> << voll.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    const popFreeform = await popValue(page);
    expect(popFreeform, "Freiform-Domaene gefuellt (Vorbedingung)").toBeGreaterThan(0);
    expect(popFreeform, "Freiform-Domaene ist eine echte Teilmenge (kleiner als voll)")
      .toBeLessThan(popFull * 0.85);

    // KERN: "Rahmen entfernen" druecken. Erwartung: zurueck zum vollen Feld.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    const removeBtn = page.getByRole("button", { name: "Rahmen entfernen", exact: true });
    await expect(removeBtn, "eindeutiges Label 'Rahmen entfernen' (keine Kollision mit Zell-Leeren)").toBeVisible();
    await removeBtn.click();
    await page.waitForTimeout(300);

    // Beleg, dass die Domaene wieder VOLL ist: Random fuellt wieder ~das ganze
    // Gitter. VOR dem Fix blieb die Domaene leer (mask=0) -> Random fuellt 0 ->
    // popReset == 0 -> dieser assert war rot.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // Panel zu
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    const popReset = await popValue(page);
    expect(popReset, "nach 'Rahmen entfernen' fuellt Random wieder das volle Feld")
      .toBeGreaterThan(popFull * 0.7);

    expect(errors, "keine Fehler beim Rahmen-Entfernen").toEqual([]);
  });
});
