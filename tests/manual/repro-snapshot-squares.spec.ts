import { test, expect } from "@playwright/test";
import * as fs from "fs";

// REPRO (Marco 2026-06-17): Snapshot zeigt QUADRATE statt Hexagons.
// Ziel: echten PNG-Output + Live-render-mode vor/nach Snapshot dumpen.
// Laeuft NICHT in CI (tests/manual/). Chromium (OffscreenCanvas-Worker).

const FIELD = 'canvas:not([aria-hidden="true"])';
const OUT = "test-results/repro";

async function liveMode(page: any) {
  return await page.locator(FIELD).first().evaluate((c: HTMLCanvasElement) => c.dataset.renderMode ?? null);
}

async function snap(page: any, tag: string) {
  await page.evaluate(() => {
    try { delete (navigator as any).canShare; } catch {}
    try { delete (navigator as any).share; } catch {}
  });
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.getByTestId("snapshot-btn").click();
  const d = await dl;
  const p = `${OUT}/snap-${tag}.png`;
  await d.saveAs(p);
  return p;
}

test("repro squares — large grid default zoom + zoomed", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "worker = chromium");
  test.setTimeout(90000);
  fs.mkdirSync(OUT, { recursive: true });
  const log: string[] = [];

  await page.goto("/");
  await page.waitForTimeout(400);

  // 4XL grid (hr=1.6, large -> raster-capable). option index: S0 M1 L2 XL3 XXL4 3XL5 4XL6 5XL7
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
  await page.waitForTimeout(200);
  await page.locator("select").nth(1).selectOption("6");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
  await page.waitForTimeout(150);

  await page.getByRole("button", { name: "Random", exact: true }).click();
  await page.waitForTimeout(400);

  // --- A) DEFAULT zoom (fit) ---
  log.push(`A default-fit: liveMode BEFORE snapshot = ${await liveMode(page)}`);
  const a = await snap(page, "A-default");
  log.push(`A default-fit: liveMode AFTER  snapshot = ${await liveMode(page)}  | png=${a} bytes=${fs.statSync(a).size}`);

  // --- C) MID zoom: live=raster (squares) but cells visible -> photo must be hexagons ---
  const field = page.locator(FIELD).first();
  const box = await field.boundingBox();
  const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  log.push(`C midzoom: liveMode = ${await liveMode(page)} (expect raster: live shows squares)`);
  await field.screenshot({ path: `${OUT}/C-mid-LIVE.png` });
  const c = await snap(page, "C-mid-PHOTO");
  log.push(`C midzoom: photo png=${c} bytes=${fs.statSync(c).size} (should show HEXAGONS)`);

  // --- B) zoom further until live=hex ---
  for (let i = 0; i < 22; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  log.push(`B zoomed: liveMode BEFORE snapshot = ${await liveMode(page)}`);
  const b = await snap(page, "B-zoomed");
  log.push(`B zoomed: liveMode AFTER  snapshot = ${await liveMode(page)}  | png=${b} bytes=${fs.statSync(b).size}`);

  // Also dump the mirror canvas render mode marker if any + worker active
  const dbg = await page.evaluate(() => {
    const cv = document.querySelector('canvas:not([aria-hidden="true"])') as HTMLCanvasElement;
    return { liveRenderMode: cv?.dataset.renderMode ?? null };
  });
  log.push("dbg=" + JSON.stringify(dbg));

  fs.writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  // eslint-disable-next-line no-console
  console.log("\n===REPRO===\n" + log.join("\n") + "\n===END===\n");
});
