import { test, expect } from "@playwright/test";

// Auto-Worker (Marco-Entscheid M-2, 2026-06-07): Bei Riesen-Gittern
// (>= HQST_CELL_CAP = 90'000 Zellen) wird der OffscreenCanvas-Worker AUTOMATISCH
// eingeschaltet, sofern der Browser ihn unterstuetzt (Chromium tut das). Der
// Haupt-Thread friert dort sonst ein (Data AP-D2: >=170k unbrauchbar). Der
// User-Schalter gewinnt aber immer (manueller Override).
//
// Beweis-Matrix (Stop-Condition aus dem Auftrag):
//  - 5XL (500x500 = 250'000) -> Worker AN automatisch + laufende Generationen.
//  - Manueller Override moeglich (Worker wieder AUS per Schalter).
//  - Kleines Gitter (S) aktiviert den Worker NICHT automatisch.
//
// Treibt die App durch reale DOM-Controls (Groessen-Select nth(1), Buttons),
// keine window-Hooks (AGENTS.md e2e-Contract).
test.describe("GolHex Auto-Worker (M-2) bei Riesen-Gittern", () => {
  test("5XL aktiviert Worker automatisch + laufende Gens; Override moeglich", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Ausgangslage: kleines Default-Gitter (M) -> Worker AUS (Automatik darf
    // nicht greifen, weil M unter dem Cap liegt).
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/Worker AUS \(Beta\)/);

    // Auf 5XL (250'000 Zellen, value="7") wechseln -> Automatik schaltet ein.
    await page.locator("select").nth(1).selectOption("7"); // 5XL
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);

    // Plain-Notiz, dass die Automatik eingeschaltet hat, ist sichtbar.
    await expect(page.getByText(/automatisch eingeschaltet/)).toBeVisible();

    // Worker steppt real: Random + Start -> Gen-Zaehler (Worker-Telemetrie) steigt.
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(1500);

    const gen = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => /^Gen\s/.test(s.textContent || ""));
      const m = (el?.textContent || "").match(/Gen\s+(\d+)/);
      return m ? Number(m[1]) : -1;
    });
    expect(gen, "Gen-Zaehler aus Worker-Telemetrie > 0 bei Auto-Worker").toBeGreaterThan(0);

    // Manueller Override: User schaltet den Worker bewusst AUS -> Warnung erscheint.
    await toggle.click();
    await expect(toggle).toHaveText(/Worker AUS \(Beta\)/);
    await expect(page.getByText(/Haupt-Thread\s+kann hier einfrieren/)).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler im Auto-Worker-Pfad").toEqual([]);
  });

  test("kleines Gitter (S) aktiviert den Worker NICHT automatisch", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toBeVisible();

    // Auf das kleinste Gitter (S, value="0") wechseln -> Worker bleibt AUS.
    await page.locator("select").nth(1).selectOption("0"); // S
    await page.waitForTimeout(300);
    await expect(toggle).toHaveText(/Worker AUS \(Beta\)/);
    // Keine Auto-Notiz, keine Einfrier-Warnung auf kleinem Gitter.
    await expect(page.getByText(/automatisch eingeschaltet/)).toHaveCount(0);

    expect(errors, "keine Konsolen-/Page-Fehler auf kleinem Gitter").toEqual([]);
  });

  test("ohne OffscreenCanvas: kein Auto-Worker, aber ehrliche Riesen-Gitter-Warnung", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    // Feature-Detection auf "nicht unterstuetzt" zwingen, BEVOR die App laedt
    // (Fallback-Geraet ohne OffscreenCanvas, z.B. aeltere Safari). supportsOffscreenWorker
    // verlangt OffscreenCanvas + transferControlToOffscreen + Worker -> einen davon
    // entfernen genuegt (fail-closed).
    await page.addInitScript(() => {
      try { delete (window as { OffscreenCanvas?: unknown }).OffscreenCanvas; } catch { /* ignore */ }
      // @ts-ignore - robust auch, wenn delete im Strict-Mode nicht greift
      window.OffscreenCanvas = undefined;
    });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Beta-Schalter ist ausgeblendet (Feature-Detection negativ).
    await expect(page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ })).toHaveCount(0);

    // Riesen-Gitter (5XL) waehlen -> kein Auto-Worker moeglich, aber ehrliche Warnung.
    await page.locator("select").nth(1).selectOption("7"); // 5XL
    await page.waitForTimeout(300);
    await expect(page.getByText(/unterstuetzt den Worker nicht/)).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler ohne OffscreenCanvas").toEqual([]);
  });
});
