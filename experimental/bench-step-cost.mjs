// Benchmark: per-step compute cost of stepLife across grid sizes.
// Profiles the dominant main-thread cost in the rAF loop (App.tsx step()).
// Runs the REAL engine (sim-engine.js) — no mocks. Reports ms/step + how many
// steps fit in the 12ms STEP_BUDGET_MS of the running loop.
import { buildNeighbors, stepLife, RMETA, COSH, SINH, GRID_SIZES, rng } from "../src/lib/sim-engine.js";

const meta = RMETA[0]; // default rule (B/S)
function makeGrid(R, C, fill) {
  const N = R * C;
  const { torus, mask } = buildNeighbors(R, C, "rect", {});
  const col = new Uint8Array(N), gh = new Uint8Array(N), age = new Uint32Array(N);
  const nc = new Uint8Array(N), ng = new Uint8Array(N), na = new Uint32Array(N);
  const r = rng(12345);
  for (let i = 0; i < N; i++) { if (mask[i] && r() < fill) col[i] = 1 + (r() * 12 | 0); }
  return { col, gh, age, nc, ng, na, NL: torus, dmask: mask, meta,
    colorMode: "mono", a1: false, a2: false, a3: false, a4: false, a5: "off",
    sysT: false, spN: 0, adia: false, tick: 1, N };
}

function bench(label, R, C, fill) {
  const g = makeGrid(R, C, fill);
  // warmup
  for (let k = 0; k < 5; k++) { stepLife(g); swap(g); }
  const iters = 40;
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) { stepLife(g); swap(g); }
  const ms = (performance.now() - t0) / iters;
  const stepsIn12ms = (12 / ms).toFixed(1);
  console.log(`${label.padEnd(6)} ${(R*C).toString().padStart(7)} cells  fill=${fill}  ${ms.toFixed(3)} ms/step  -> ${stepsIn12ms} steps fit in 12ms budget`);
  return ms;
}
function swap(g) {
  [g.col, g.nc] = [g.nc, g.col]; [g.gh, g.ng] = [g.ng, g.gh]; [g.age, g.na] = [g.na, g.age];
}

console.log("=== stepLife per-step cost (default rule B/S, mono color) ===");
for (const s of GRID_SIZES) bench(s.l, s.rows, s.cols, 0.3);
console.log("\n=== same, sparse (fill=0.05, e.g. after settle) ===");
for (const s of GRID_SIZES) bench(s.l, s.rows, s.cols, 0.05);
