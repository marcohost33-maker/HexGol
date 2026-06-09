// Manual probe: iPhone-viewport screenshot of DEFAULT (M) view + measure pxRgate.
// Renders a deterministic Random pattern and captures canvas-only screenshot.
// Usage: node tests/manual/hex-render-probe.mjs <outPath> [label]
import { chromium } from "@playwright/test";

const OUT = process.argv[2] || "/tmp/probe.png";
const LABEL = process.argv[3] || "probe";
const SIZEIDX = process.argv[4]; // optional: select grid size via the <select>
const GRID = [
  { l: "S", R: 40, C: 50, hr: 12 }, { l: "M", R: 80, C: 100, hr: 6 },
  { l: "L", R: 120, C: 150, hr: 4 }, { l: "XL", R: 160, C: 200, hr: 3 },
  { l: "XXL", R: 200, C: 250, hr: 2.5 }, { l: "3XL", R: 300, C: 300, hr: 2 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3, // iPhone-class DPR
  isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas");

// Optionally switch grid size via the real <select> control (DOM-driven, no hook).
if (SIZEIDX !== undefined) {
  // The size <select> lives inside the "Hex-Regeln" drawer (tab id 3) -> open it.
  await page.getByRole("button", { name: /Hex-Regeln/ }).first().click();
  await page.waitForTimeout(150);
  const sel = page.locator("select", { has: page.locator("option", { hasText: /\d+x\d+/ }) }).first();
  await sel.selectOption(String(SIZEIDX));
  await page.waitForTimeout(150);
  // Close the drawer again so the canvas screenshot is unobstructed.
  await page.getByRole("button", { name: /Hex-Regeln/ }).first().click();
  await page.waitForTimeout(250);
}
const gi = SIZEIDX !== undefined ? Number(SIZEIDX) : 1;
const G = GRID[gi];

// Draw a deterministic Random pattern so cells are visible.
const randomBtn = page.getByRole("button", { name: /^Random$/ });
if (await randomBtn.count()) await randomBtn.first().click();
await page.waitForTimeout(300);

// Measure pxRgate from live geometry: replicate fitView math against the live canvas.
const probe = await page.evaluate((G) => {
  const c = document.querySelector("canvas");
  const dpr = window.devicePixelRatio || 1;
  const cw = c.width / dpr, ch = c.height / dpr;
  const S3 = Math.sqrt(3); const PAD = (hr) => hr * 1.3;
  const R = G.R, C = G.C, hr = G.hr;
  const w = S3 * hr, v = 1.5 * hr, pad = PAD(hr);
  const W = pad * 2 + w * (C + 0.5), H = pad * 2 + v * R;
  const s = Math.min(cw / W, ch / H) * 0.98;
  return { dpr, canvasCssW: cw, canvasCssH: ch, hr, scale: s, pxRgate: hr * s };
}, G);

const canvas = await page.$("canvas");
await canvas.screenshot({ path: OUT });

console.log(JSON.stringify({ label: LABEL, grid: G.l, ...probe, consoleErrors: errors.length, out: OUT }, null, 2));
await browser.close();
