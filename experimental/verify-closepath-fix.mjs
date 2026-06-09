// Verify the chosen fix is (a) fast and (b) pixel-identical for BOTH fill and
// stroke. Strategy under test: replace closePath() with an explicit lineTo back
// to the first vertex (geometrically closes the polygon for fill AND stroke,
// avoids Skia's expensive closePath). Renders the same hex grid two ways on an
// OffscreenCanvas and compares pixels + times the path build.
import { chromium } from "@playwright/test";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage();
const r = await page.evaluate(() => {
  const W = 600, H = 600;
  const PI3 = Math.PI / 3;
  const cosA = [], sinA = [];
  for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * PI3; cosA.push(Math.cos(a)); sinA.push(Math.sin(a)); }
  function buildGrid(useClosePath) {
    const p = new Path2D();
    for (let gy = 0; gy < 30; gy++) for (let gx = 0; gx < 30; gx++) {
      const x = 12 + gx * 20, y = 12 + gy * 20, rr = 8;
      p.moveTo(x + rr * cosA[0], y + rr * sinA[0]);
      for (let k = 1; k < 6; k++) p.lineTo(x + rr * cosA[k], y + rr * sinA[k]);
      if (useClosePath) p.closePath(); else p.lineTo(x + rr * cosA[0], y + rr * sinA[0]);
    }
    return p;
  }
  function renderTo(useClosePath, op) {
    const c = new OffscreenCanvas(W, H); const ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const p = buildGrid(useClosePath);
    ctx.fillStyle = "#3cc"; ctx.strokeStyle = "#f0f"; ctx.lineWidth = 1.5;
    if (op === "fill") ctx.fill(p); else ctx.stroke(p);
    return ctx.getImageData(0, 0, W, H).data;
  }
  function diff(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
  const fillDiff = diff(renderTo(true, "fill"), renderTo(false, "fill"));
  const strokeDiff = diff(renderTo(true, "stroke"), renderTo(false, "stroke"));
  // timing
  function timeBuild(useClosePath) {
    const N = 300; const t = performance.now();
    for (let i = 0; i < N; i++) buildGrid(useClosePath);
    return (performance.now() - t) / N;
  }
  return { fillDiff, strokeDiff, msClose: timeBuild(true), msLineTo: timeBuild(false) };
});
console.log("Pixel diff (fill):   ", r.fillDiff, r.fillDiff === 0 ? "IDENTICAL" : "DIFFERS");
console.log("Pixel diff (stroke): ", r.strokeDiff, r.strokeDiff === 0 ? "IDENTICAL" : "DIFFERS");
console.log(`Build 900 hexes:  closePath=${r.msClose.toFixed(3)}ms   lineTo-to-start=${r.msLineTo.toFixed(3)}ms   speedup ${(r.msClose / r.msLineTo).toFixed(1)}x`);
await browser.close();
