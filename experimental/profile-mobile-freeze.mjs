// Mobile-load profiler: drives the REAL built app under a 390x844 mobile
// viewport + 6x CPU throttle (CDP) and measures main-thread long-tasks while
// the simulation runs at various grid sizes. Surfaces the main-thread jank a
// desktop hides. No app hooks — uses PerformanceObserver(longtask) injected
// from the test side + rAF interval sampling.
//
// Usage: node experimental/profile-mobile-freeze.mjs
// Requires: npm run preview running on :4173 (script starts its own).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const URL = "http://127.0.0.1:4173/";
const THROTTLE = Number(process.env.CPU || 6);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"], { shell: true, stdio: "ignore" });
  await wait(2500);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

  await page.goto(URL, { waitUntil: "load" });
  await page.waitForSelector("canvas");

  // Install a long-task + rAF-gap observer on the page.
  await page.evaluate(() => {
    window.__lt = [];
    window.__gaps = [];
    try {
      const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); });
      po.observe({ entryTypes: ["longtask"] });
    } catch {}
    let last = performance.now();
    function tick(now) { window.__gaps.push(now - last); last = now; requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  });

  async function sample(label, ms) {
    await page.evaluate(() => { window.__lt = []; window.__gaps = []; });
    await wait(ms);
    const r = await page.evaluate(() => {
      const lt = window.__lt.slice(), gaps = window.__gaps.slice();
      const longCount = lt.filter((d) => d >= 50).length;
      const maxLt = lt.length ? Math.max(...lt) : 0;
      const sumLt = lt.reduce((a, b) => a + b, 0);
      gaps.sort((a, b) => a - b);
      const p50 = gaps.length ? gaps[(gaps.length * 0.5) | 0] : 0;
      const p95 = gaps.length ? gaps[(gaps.length * 0.95) | 0] : 0;
      const maxGap = gaps.length ? gaps[gaps.length - 1] : 0;
      return { frames: gaps.length, p50, p95, maxGap, longCount, maxLt, sumLt, totalLt: lt.length };
    });
    console.log(`${label.padEnd(22)} frames=${String(r.frames).padStart(3)}  fps~${(r.frames / (ms / 1000)).toFixed(1).padStart(5)}  gapP50=${r.p50.toFixed(1).padStart(6)}ms  gapP95=${r.p95.toFixed(1).padStart(7)}ms  maxGap=${r.maxGap.toFixed(0).padStart(5)}ms  longTasks(>=50ms)=${String(r.longCount).padStart(3)}  maxLT=${r.maxLt.toFixed(0)}ms`);
    return r;
  }

  async function setSize(prefix) {
    // Size <select> lives in Tab 3 (Hex-Regeln) on the mobile one-page layout.
    // Open the tab, pick the option starting with `prefix (`, then close the tab.
    const tab = page.locator('button[aria-label="Tab 3 Hex-Regeln"]').first();
    if (await tab.count()) await tab.click().catch(() => {});
    await wait(250);
    let done = false;
    const selects = page.locator("select");
    const n = await selects.count();
    for (let i = 0; i < n; i++) {
      const s = selects.nth(i);
      const opts = await s.locator("option").allTextContents();
      const idx = opts.findIndex((t) => t.startsWith(prefix + " ("));
      if (idx >= 0) { await s.selectOption({ index: idx }).catch(() => {}); done = true; break; }
    }
    if (await tab.count()) await tab.click().catch(() => {}); // close tab -> canvas full
    await wait(400);
    return done;
  }

  async function clickBtn(label) {
    const b = page.locator(`button[aria-label="${label}"]`).first();
    if (await b.count()) { await b.click().catch(() => {}); return true; }
    return false;
  }

  console.log(`=== Mobile freeze profile  viewport=390x844 DPR3  CPU throttle ${THROTTLE}x ===`);
  console.log("(longTasks >=50ms = jank; maxGap = worst single frame stall)\n");

  // idle baseline at default size
  await sample("idle (default M)", 1500);

  // Random + Start at default M
  await clickBtn("Random");
  await clickBtn("Start");
  await sample("M running", 2500);
  await clickBtn("Pause");

  // bump to L/XL/XXL (still main-thread; worker gate is 90k = 3XL)
  for (const size of ["L", "XL", "XXL", "3XL"]) {
    const ok = await setSize(size);
    if (!ok) { console.log(`${size}: size option not found (sheet?)`); continue; }
    await clickBtn("Random");
    await clickBtn("Start");
    await sample(`${size} running`, 2500);
    await clickBtn("Pause");
    await wait(300);
  }

  await browser.close();
  server.kill();
}
main().catch((e) => { console.error(e); process.exit(1); });
