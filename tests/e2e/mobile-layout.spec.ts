import { test, expect } from "@playwright/test";

// v33.2 Mobile-Layout-Haertung (iPhone 390x844). Zwei von Marco mit Fotos
// gemeldete UI-Bugs (IMG_0433/0434) als realer DOM-/Layout-Kontrakt belegt —
// KEINE window-Hooks (AGENTS.md §2), nur echte DOM-Geometrie:
//
//   BUG A: die obere Tab-Leiste (4 Tabs + ⓘ + Aktions-Icons) ueberlappt auf
//          390px -> die Tab-Label-Texte schneiden sich gegenseitig.
//   BUG B: der offene Tab-Inhalt (Physik-Panel mit der 3-spaltigen
//          STATISTIK-DETAIL-Farbliste) ist BREITER als der Viewport ->
//          horizontaler Touch-Drag verschiebt das Panel seitwaerts.
//
// Beide Asserts waeren OHNE den Fix ROT (Silent-Failure-Gate): pre-fix gemessen
// (a) Tab-Label-Bounding-Boxen ueberlappen, (b) Panel-scrollWidth > clientWidth
// und ein horizontaler Wisch verschiebt scrollLeft.

const VIEW = { w: 390, h: 844 };

test.describe("GolHex v33 Mobile-Layout-Fix (390x844)", () => {
  // ---- BUG A: Tab-Leiste ueberlappt nicht ---------------------------------
  test("BUG A: Tab-Label-Texte ueberlappen NICHT (4 Tabs lesbar auf 390px)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Die vier Tab-Buttons. Das innere Label-<span> ist das, was visuell
    // ueberlaufen/abschneiden kann (whiteSpace:nowrap, fontSize:9).
    const labelBoxes = await page.evaluate(() => {
      const out: { id: string; x: number; right: number; w: number; sw: number }[] = [];
      for (let id = 1; id <= 4; id++) {
        const btn = document.querySelector(`button[aria-label^="Tab ${id} "]`) as HTMLElement | null;
        if (!btn) continue;
        // letztes span = Label-Zeile (erstes = Icon)
        const spans = btn.querySelectorAll("span");
        const label = spans[spans.length - 1] as HTMLElement;
        const r = label.getBoundingClientRect();
        out.push({ id: String(id), x: r.x, right: r.x + r.width, w: r.width, sw: label.scrollWidth });
      }
      return out;
    });

    expect(labelBoxes.length, "alle 4 Tab-Labels vorhanden").toBe(4);

    // (a) Kein Label-Text wird abgeschnitten: scrollWidth (Textbreite) <=
    //     clientWidth/Box-Breite (+1px Rundung). Bei nowrap-Ueberlauf ist
    //     scrollWidth > width -> ROT vor dem Fix.
    for (const b of labelBoxes) {
      expect(b.sw, `Tab ${b.id}: Label-Text passt in die Box (sw=${b.sw} <= w=${Math.ceil(b.w)})`)
        .toBeLessThanOrEqual(Math.ceil(b.w) + 1);
    }

    // (b) Benachbarte Label-Boxen ueberschneiden sich nicht (sortiert nach x).
    const sorted = [...labelBoxes].sort((p, q) => p.x - q.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x, `Tab ${sorted[i].id}.x (${sorted[i].x.toFixed(1)}) >= Tab ${sorted[i - 1].id}.right (${sorted[i - 1].right.toFixed(1)}) — keine Ueberlappung`)
        .toBeGreaterThanOrEqual(sorted[i - 1].right - 1);
    }

    // (c) Die gesamte Top-Leiste laeuft nicht ueber den Viewport (kein H-Overflow).
    const bar = await page.evaluate(() => {
      const tabBtn = document.querySelector('button[aria-label^="Tab 1 "]') as HTMLElement | null;
      const bar = tabBtn?.closest('div[style*="height: 52px"], div[style*="height:52px"]') as HTMLElement | null
        || (tabBtn?.parentElement?.parentElement as HTMLElement | null);
      if (!bar) return null;
      return { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth };
    });
    if (bar) {
      expect(bar.scrollWidth, `Tab-Leiste kein H-Overflow (sw=${bar.scrollWidth} <= cw=${bar.clientWidth})`)
        .toBeLessThanOrEqual(bar.clientWidth + 1);
    }

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  // ---- BUG B: Tab-Panel scrollt/verschiebt nicht seitwaerts ----------------
  test("BUG B: Physik-Tab-Panel ist horizontal FIX (kein Seitwaerts-Shift)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Physik-Tab oeffnen (Voll-Overlay mit STATISTIK-DETAIL-Farbliste).
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(350);
    const panel = page.getByRole("dialog", { name: /Panel .*Physik/ });
    await expect(panel).toBeVisible();

    // (a) Der Panel-Inhalt ist nicht breiter als das Panel selbst: weder das
    //     Dialog-Wurzel noch der scrollende Inhaltscontainer noch ein Kind
    //     laeuft horizontal ueber. scrollWidth > clientWidth == ROT vor Fix.
    const overflow = await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]') as HTMLElement | null;
      if (!dlg) return null;
      // alle Nachfahren auf H-Overflow gegen die Panel-Breite pruefen
      const panelW = dlg.clientWidth;
      let worst = { tag: "", sw: 0, cw: panelW };
      const all = dlg.querySelectorAll<HTMLElement>("*");
      // Wurzel selbst zuerst
      if (dlg.scrollWidth > worst.sw) worst = { tag: "dialog-root", sw: dlg.scrollWidth, cw: dlg.clientWidth };
      all.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1 && el.scrollWidth > worst.sw) {
          worst = { tag: el.getAttribute("data-tab") || el.className || el.tagName, sw: el.scrollWidth, cw: el.clientWidth };
        }
      });
      return { panelW, dialogScrollWidth: dlg.scrollWidth, dialogClientWidth: dlg.clientWidth, worst };
    });
    expect(overflow, "Dialog gefunden").not.toBeNull();
    // Dialog-Wurzel selbst darf nicht breiter scrollen als sie ist.
    expect(overflow!.dialogScrollWidth, `Panel-Wurzel kein H-Overflow (sw=${overflow!.dialogScrollWidth} <= cw=${overflow!.dialogClientWidth})`)
      .toBeLessThanOrEqual(overflow!.dialogClientWidth + 1);
    // Kein Nachfahre laeuft ueber die Panel-Breite hinaus.
    expect(overflow!.worst.sw, `kein Kind breiter als Panel (worst="${overflow!.worst.tag}" sw=${overflow!.worst.sw} cw=${overflow!.worst.cw})`)
      .toBeLessThanOrEqual(overflow!.panelW + 1);

    // (b) Ein horizontaler Wisch im Panel verschiebt NICHTS (scrollLeft bleibt 0).
    //     Vor dem Fix konnte der ueberlaufende Inhalt seitwaerts gescrollt werden.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    const cy = box!.y + box!.height * 0.55;
    const x0 = box!.x + box!.width * 0.8;
    const x1 = box!.x + box!.width * 0.15;
    await page.mouse.move(x0, cy);
    await page.mouse.down();
    for (let i = 0; i <= 8; i++) {
      await page.mouse.move(x0 + (x1 - x0) * (i / 8), cy);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    const maxScrollLeft = await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]') as HTMLElement | null;
      if (!dlg) return -1;
      let m = dlg.scrollLeft;
      dlg.querySelectorAll<HTMLElement>("*").forEach((el) => { if (el.scrollLeft > m) m = el.scrollLeft; });
      return m;
    });
    expect(maxScrollLeft, `kein horizontaler Shift nach Wisch (maxScrollLeft=${maxScrollLeft})`).toBeLessThanOrEqual(1);

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });
});
