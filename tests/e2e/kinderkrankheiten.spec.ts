/**
 * KINDERKRANKHEITEN-GATE — kanonische Vorlage (Vero, 2026-08-07)
 *
 * Marco-Standing-Order: vor JEDER Freigabe pruefen, dass eine App keine
 * "Kinderkrankheiten" hat. Diese Datei ist die Vorlage; sie wird unveraendert
 * in jede App mit Playwright kopiert (`e2e/kinderkrankheiten.spec.ts` bzw. der
 * dortige Test-Ordner).
 *
 * Geprueft wird GENAU:
 *   K-1  Die erste Seite passt ohne vertikales Scrollen in den Bildschirm.
 *   K-2  Nirgends horizontales Scrollen.
 *   K-3  Kein einzelnes Element ragt ueber die Fensterbreite hinaus
 *        (nennt den Verursacher, damit der Befund reparierbar ist).
 *   K-4  Das Programmfenster ist fixiert: der Seitenkopf bleibt beim Scrollen
 *        stehen. Uebersprungen — mit sichtbarem Grund — wenn die App keinen
 *        <header> hat; NIE stillschweigend als bestanden gewertet.
 *
 * NICHT geprueft: Aesthetik, Farbwahl, Abstaende. Das ist Gestaltung.
 *
 * Anpassung je App: nur START_PATH, falls die erste Seite nicht "/" ist.
 * Alles Uebrige ist absichtlich app-unabhaengig.
 */

import { test, expect, type Page } from "@playwright/test";

const START_PATH = "/";
const SLACK = 1; // 1px fuer fraktionale Geraete-Pixel

async function openStart(page: Page) {
  await page.goto(START_PATH);
  // Kein app-spezifischer Selektor: warten, bis das Layout ruhig ist.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { scrollH: d.scrollHeight, innerH: window.innerHeight, scrollW: d.scrollWidth, clientW: d.clientWidth };
  });
}

async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > limit + 1 || r.left < -1) {
        const label = el.getAttribute("aria-label") ?? String(el.className ?? "").slice(0, 40);
        out.push(`${el.tagName.toLowerCase()}${label ? ` [${label}]` : ""} rechts=${Math.round(r.right)} > ${limit}`);
      }
      if (out.length >= 5) break;
    }
    return out;
  });
}

test.describe("Kinderkrankheiten", () => {
  test("K-1: die erste Seite scrollt nicht vertikal", async ({ page }) => {
    await openStart(page);
    const m = await metrics(page);
    expect(
      m.scrollH,
      `Erste Seite ist ${m.scrollH}px hoch, sichtbar sind ${m.innerH}px - sie muss ohne Scrollen hineinpassen`,
    ).toBeLessThanOrEqual(m.innerH + SLACK);
  });

  test("K-2: die erste Seite scrollt nicht horizontal", async ({ page }) => {
    await openStart(page);
    const m = await metrics(page);
    expect(
      m.scrollW,
      `Erste Seite ist ${m.scrollW}px breit bei ${m.clientW}px Fenster - horizontales Scrollen ist immer ein Fehler`,
    ).toBeLessThanOrEqual(m.clientW + SLACK);
  });

  test("K-3: kein Element ragt ueber die Fensterbreite hinaus", async ({ page }) => {
    await openStart(page);
    const zuBreit = await overflowingElements(page);
    expect(zuBreit, `Diese Elemente ragen hinaus:\n${zuBreit.join("\n")}`).toEqual([]);
  });

  test("K-4: der Seitenkopf bleibt beim Scrollen stehen", async ({ page }) => {
    await openStart(page);
    const kopf = page.locator("header").first();
    const hatKopf = (await kopf.count()) > 0 && (await kopf.isVisible().catch(() => false));
    test.skip(!hatKopf, "Diese App hat keinen sichtbaren <header> - K-4 ist hier nicht anwendbar");

    const vorher = await kopf.boundingBox();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(250);
    const nachher = await kopf.boundingBox();

    expect(vorher && nachher, "Der Seitenkopf muss vor und nach dem Scrollen sichtbar sein").toBeTruthy();
    const drift = Math.round((nachher!.y ?? 0) - (vorher!.y ?? 0));
    expect(
      Math.abs(drift),
      `Der Seitenkopf ist beim Scrollen um ${drift}px gewandert - das Programmfenster soll fixiert sein`,
    ).toBeLessThanOrEqual(2);
  });
});
