import { test, expect } from "@playwright/test";

// AP-1 (2026-06-07): OffscreenCanvas-Worker (Stufe 1) Funktions-/Regressionstest.
// Beweist, dass der off-main-thread Pfad real funktioniert (nicht nur, dass das
// Default-AUS nichts bricht): Worker-Toggle aktivieren -> Sim laeuft im Worker ->
// Raster-Render auf der transferierten OffscreenCanvas -> Gen-Zaehler steigt
// (Worker-Telemetrie-Bruecke) -> Groessen-/Form-Wechsel ohne Konsolenfehler ->
// Worker wieder AUS -> Main-Thread-Fallback uebernimmt eine frische Canvas.
//
// Chromium unterstuetzt OffscreenCanvas + transferControlToOffscreen + Worker,
// daher ist der Beta-Schalter sichtbar (Feature-Detection, fail-closed).
test.describe("GolHex AP-1 OffscreenCanvas worker", () => {
  test("worker toggle: off-main-thread sim+render, telemetry, frame switch, fallback", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(500);
    // v33: Worker-Schalter + Groesse + Rahmenformen liegen im Tab 3 (Hex-Regeln);
    // die Bottom-Steuerung (Random/Start/Pause) + Gen-Zeile bleiben darunter sichtbar.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    // Feature-Detection-Beweis: in Chromium ist der Beta-Schalter da.
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/Worker AUS \(Beta\)/);

    // Grosse Zellzahl in den Raster-Fast-Path bringen (XXL -> hr*s < 3.5).
    await page.locator("select").nth(1).selectOption("4"); // XXL
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(200);

    // Worker aktivieren -> transferControlToOffscreen + init.
    await toggle.click();
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);
    await page.waitForTimeout(400);

    // Sim im Worker starten -> Telemetrie-Bruecke aktualisiert den Gen-Zaehler.
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(1500);

    // Gen-Zaehler muss gestiegen sein (Beweis: der Worker steppt + meldet zurueck).
    const genText = await page.locator("text=/^Gen/").first().innerText().catch(() => "");
    // Robuster: die Zahl neben "Gen" lesen.
    const gen = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => /^Gen\s/.test(s.textContent || ""));
      const m = (el?.textContent || "").match(/Gen\s+(\d+)/);
      return m ? Number(m[1]) : -1;
    });
    expect(gen, "Gen-Zaehler aus Worker-Telemetrie > 0").toBeGreaterThan(0);

    // Pausieren + Form wechseln (Worker bekommt config-Update, rendert weiter).
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Hexagon", exact: true }).click();
    await page.waitForTimeout(300);

    // Worker wieder ausschalten -> frische Canvas + Main-Thread-Fallback.
    await page.getByRole("button", { name: /Worker AN \(Beta\)/ }).click();
    await expect(page.getByRole("button", { name: /Worker AUS \(Beta\)/ })).toBeVisible();
    await page.waitForTimeout(300);

    // Canvas lebt, Main-Thread-Sim laeuft wieder (kurz starten).
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("canvas")).toHaveCount(1);

    expect(errors, "keine Konsolen-/Page-Fehler im Worker-Pfad").toEqual([]);
  });
});
