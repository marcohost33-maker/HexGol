// Confirm the closePath hotspot: count Path2D.closePath/moveTo/lineTo calls per
// second during M running, and time them, to prove the hex-path construction is
// the dominant cost (not fill). Also test the hypothesis that DROPPING closePath
// (it is redundant: fill() auto-closes subpaths) removes the cost.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
const URL = "http://127.0.0.1:4173/";
const THROTTLE = Number(process.env.CPU || 6);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(patchClosePath) {
  const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"], { shell: true, stdio: "ignore" });
  await wait(2500);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.addInitScript((patch) => {
    for (const Proto of [Path2D.prototype, CanvasRenderingContext2D.prototype]) {
      window.__p = window.__p || { close: 0, closeMs: 0, line: 0, move: 0 };
      const oc = Proto.closePath;
      if (oc) Proto.closePath = function (...a) { if (patch) { window.__p.close++; return; } const t = performance.now(); const r = oc.apply(this, a); window.__p.close++; window.__p.closeMs += performance.now() - t; return r; };
      const ol = Proto.lineTo; if (ol) Proto.lineTo = function (...a) { window.__p.line++; return ol.apply(this, a); };
      const om = Proto.moveTo; if (om) Proto.moveTo = function (...a) { window.__p.move++; return om.apply(this, a); };
    }
    let last = performance.now(); window.__gaps = [];
    function tick(now) { window.__gaps.push(now - last); last = now; requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }, patchClosePath);
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForSelector("canvas");
  await page.locator('button[aria-label="Random"]').first().click().catch(() => {});
  await page.locator('button[aria-label="Start"]').first().click().catch(() => {});
  await wait(600);
  await page.evaluate(() => { window.__p = { close: 0, closeMs: 0, line: 0, move: 0 }; window.__gaps = []; });
  await wait(3000);
  const r = await page.evaluate(() => {
    const g = window.__gaps.slice().sort((a, b) => a - b);
    return { ...window.__p, frames: g.length, gapP50: g[(g.length * 0.5) | 0] || 0, gapMax: g[g.length - 1] || 0 };
  });
  console.log(`${patchClosePath ? "closePath SKIPPED" : "baseline        "}  frames=${String(r.frames).padStart(3)} fps~${(r.frames / 3).toFixed(1)}  gapP50=${r.gapP50.toFixed(1)}ms gapMax=${r.gapMax.toFixed(0)}ms  | closePath x${r.close} (${r.closeMs.toFixed(0)}ms)  lineTo x${r.line}  moveTo x${r.move}`);
  await browser.close(); server.kill(); await wait(500);
}
async function main() {
  console.log(`=== M running, ${THROTTLE}x throttle, 3s window ===`);
  await run(false);
  await run(true);
}
main().catch((e) => { console.error(e); process.exit(1); });
