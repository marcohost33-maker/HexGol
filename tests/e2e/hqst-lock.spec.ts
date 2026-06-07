import { test, expect } from "@playwright/test";

// PR#43-Auflage (Equalita): e2e-Verhaltenstest der HQST-Sperre.
// Vertrag (src/App.tsx): N > HQST_CELL_CAP (90'000) -> im HQST-Modus erscheint die
// ehrliche UI-Sperr-Meldung UND der Sim-Step wird uebersprungen (kein stiller
// Freeze): step() setzt runRef=false + setRunning(false) statt den teuren
// Crank-Nicolson-Loeser auf einem Riesen-Gitter laufen zu lassen.
//
// 4XL = 400x400 = 160'000 Zellen (> 90'000 Cap), Size-Select-Index 6.
test.describe("GolHex HQST-Sperre (>90k Zellen)", () => {
  test("4XL + HQST: Sperr-Meldung sichtbar, Start wird sofort abgebrochen (Step uebersprungen)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(400);

    // v33: Physik/HQST liegen im Tab 4 (Physik).
    await page.getByRole("button", { name: "Tab 4 Physik" }).click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Physik (reellwertig)", exact: true }).click();
    await page.getByRole("button", { name: "HQST", exact: true }).click();
    await page.waitForTimeout(150);

    // v33: Gitter-Groesse + HQST-Sperr-Meldung liegen im Tab 3 (Hex-Regeln).
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);
    const sizeSel = page.locator("select").nth(1);
    await sizeSel.selectOption("6"); // index 6 = 4XL (400x400 = 160'000)
    await page.waitForTimeout(400);

    // (1) Ehrliche UI-Sperr-Meldung ist sichtbar.
    await expect(page.getByText(/HQST \(Quantenwelle\) ist ab/)).toBeVisible();
    await expect(page.getByText(/gesperrt/)).toBeVisible();

    // (2) Start wird sofort abgebrochen: der step() bricht im HQST-Lock ab und
    //     setzt running=false -> der Button kehrt von "Pause" auf "Start" zurueck
    //     und der Gen-Zaehler bleibt bei 0 (kein Step ausgefuehrt).
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(700);

    // Start-Button wieder da (Sim nicht laufend -> Step uebersprungen).
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    // Gen-Zaehler bleibt 0 (kein HQST-Step lief).
    const gen = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => /^Gen\s/.test(s.textContent || ""));
      const m = (el?.textContent || "").match(/Gen\s+(\d+)/);
      return m ? Number(m[1]) : -1;
    });
    expect(gen, "kein HQST-Step ausgefuehrt -> Gen bleibt 0").toBe(0);

    expect(errors, "keine Konsolen-/Page-Fehler bei gesperrtem HQST").toEqual([]);
  });
});
