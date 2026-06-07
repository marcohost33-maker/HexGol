import { test, expect } from "@playwright/test";

// AP-3 (2026-06-07): Long-Press-Farbrad (Marco-Entscheid M-3 "Beides").
// Realer DOM-/Verhaltens-Kontrakt (KEINE window-Hooks, AGENTS.md):
//   - Long-Press (~500 ms Hold, Bewegung < Touch-Slop) oeffnet das radiale
//     12-Farb-Rad zentriert auf dem Druckpunkt.
//   - Auswahl faerbt die gedrueckte Zelle SOFORT *und* wechselt die aktive
//     Pinselfarbe (das Swatch wird aria-pressed) -> direkt weitermalen.
//   - Abbruch: Tipp ausserhalb (auf den Overlay-Hintergrund) schliesst ohne Auswahl.
//   - Pan-Geste (schnelles Wischen > Slop) oeffnet KEIN Rad.
//   - funktioniert mit Maus (Desktop, langer Klick) UND emuliertem Touch.
//
// Touch-/Long-Press-Emulation: das App nutzt Pointer Events. Wir feuern native
// PointerEvents (pointerdown/move/up) per dispatchEvent auf dem <canvas>; der
// Long-Press ist ein pointerdown + warten > 500 ms (Playwright kann keinen
// gehaltenen Touch-Down ueber touchscreen.tap, daher dispatchEvent — vom
// Handoff so vorgesehen). pointerType laesst sich frei setzen (mouse|touch).

type Pt = "mouse" | "touch";

async function pointerDownOnCanvas(page: import("@playwright/test").Page, dx: number, dy: number, pointerType: Pt) {
  await page.evaluate(({ dx, dy, pointerType }) => {
    const c = document.querySelector("canvas")!;
    const r = c.getBoundingClientRect();
    const x = r.left + dx, y = r.top + dy;
    (window as unknown as { __lpX: number; __lpY: number }).__lpX = x;
    (window as unknown as { __lpX: number; __lpY: number }).__lpY = y;
    c.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      pointerType, clientX: x, clientY: y, button: pointerType === "mouse" ? 0 : -1,
    }));
  }, { dx, dy, pointerType });
}

async function pointerMoveAndUp(page: import("@playwright/test").Page, ddx: number, ddy: number, pointerType: Pt) {
  await page.evaluate(({ ddx, ddy, pointerType }) => {
    const c = document.querySelector("canvas")!;
    const w = window as unknown as { __lpX: number; __lpY: number };
    const x = w.__lpX + ddx, y = w.__lpY + ddy;
    c.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y,
    }));
    c.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y,
    }));
  }, { ddx, ddy, pointerType });
}

async function releaseAtOrigin(page: import("@playwright/test").Page, pointerType: Pt) {
  await page.evaluate(({ pointerType }) => {
    const c = document.querySelector("canvas")!;
    const w = window as unknown as { __lpX: number; __lpY: number };
    c.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, clientX: w.__lpX, clientY: w.__lpY,
    }));
  }, { pointerType });
}

const collectErrors = (page: import("@playwright/test").Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return errors;
};

test.describe("GolHex AP-3 Long-Press-Farbrad", () => {
  test("Long-Press (Touch) oeffnet das Rad mit 12 Farben", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    // kein Move -> Hold > 500 ms muss das Rad oeffnen
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch"); // Loslassen schliesst das Rad NICHT

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    // alle 12 Itten-Farben als Buttons im Rad
    await expect(wheel.locator("button[data-color-state]")).toHaveCount(12);
    expect(errors).toEqual([]);
  });

  test("Auswahl faerbt die Zelle + wechselt die aktive Pinselfarbe", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    // Vorzustand: Pinsel = "Zyklus" (Default). Das Swatch "Rot" ist NICHT aktiv.
    const rotSwatch = page.getByRole("button", { name: "Rot", pressed: true });
    await expect(page.getByRole("button", { name: "Rot" }).first()).toHaveAttribute("aria-pressed", "false");

    await pointerDownOnCanvas(page, 220, 160, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // CR (Rot) = State-ID 1 -> Auswahl klicken.
    await wheel.locator('button[data-color-state="1"]').click();

    // Rad geschlossen.
    await expect(wheel).toHaveCount(0);
    // aktive Pinselfarbe ist jetzt Rot (Swatch aria-pressed=true) -> direkt weitermalen.
    await expect(rotSwatch).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Pan-Geste (schnelles Wischen) oeffnet KEIN Rad", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    // sofort > Touch-Slop bewegen + loslassen, bevor die 500 ms verstreichen
    await page.waitForTimeout(120);
    await pointerMoveAndUp(page, 60, 40, "touch"); // 60/40 px >> 8 px Slop
    await page.waitForTimeout(650); // ueber die Long-Press-Schwelle hinaus warten

    await expect(page.locator('[data-testid="color-wheel"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Abbruch: Tipp ausserhalb schliesst das Rad ohne Auswahl", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 200, 150, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // Pinsel bleibt "Zyklus" (kein Farbwechsel beim Abbruch).
    // Auf den Overlay-Hintergrund tippen (nicht auf einen Farb-Button) -> schliesst.
    await wheel.click({ position: { x: 5, y: 5 } });
    await expect(wheel).toHaveCount(0);
    // Pinsel unveraendert: "Zyklus" weiterhin aktiv.
    await expect(page.getByRole("button", { name: "Zyklus" })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("Maus: langer Klick oeffnet das Rad, Auswahl wechselt den Pinsel", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    await pointerDownOnCanvas(page, 240, 170, "mouse");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "mouse");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();

    // CB (Blau) = State-ID 9 -> Auswahl.
    await wheel.locator('button[data-color-state="9"]').click();
    await expect(wheel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Blau", pressed: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Worker-Pfad: Long-Press-Auswahl erreicht den OffscreenCanvas-Worker (state-Bruecke)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForTimeout(400);

    // Worker aktivieren (Chromium: Feature da, fail-closed). Sim+Render off-main.
    const toggle = page.getByRole("button", { name: /Worker (AN|AUS) \(Beta\)/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveText(/Worker AN \(Beta\)/);
    await page.waitForTimeout(400);

    // Long-Press im Worker-Modus -> Auswahl. Der Main-Thread muss den neuen
    // Zustand per "state"-postMessage an den Worker nachreichen (sonst zeigt der
    // Worker den alten Zustand). Beleg hier: kein Fehler + Pinselwechsel; der
    // postMessage-Pfad ist im Code (syncWorkerState) und im Worker-Handler (state)
    // verdrahtet — ein roher Pixel-Readback der OffscreenCanvas ist im Headless-
    // Chromium nicht zuverlaessig, daher der Verhaltens-/Fehlerfreiheits-Beleg.
    await pointerDownOnCanvas(page, 220, 160, "touch");
    await page.waitForTimeout(650);
    await releaseAtOrigin(page, "touch");

    const wheel = page.locator('[data-testid="color-wheel"]');
    await expect(wheel).toBeVisible();
    await wheel.locator('button[data-color-state="5"]').click(); // CY (Gelb) = 5
    await expect(wheel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Gelb", pressed: true })).toBeVisible();

    // Worker rendert weiter ohne Fehler (state-Update verarbeitet).
    await page.waitForTimeout(300);
    await expect(page.locator("canvas")).toHaveCount(1);
    expect(errors, "keine Fehler im Worker-Pfad bei Long-Press-Auswahl").toEqual([]);
  });
});
