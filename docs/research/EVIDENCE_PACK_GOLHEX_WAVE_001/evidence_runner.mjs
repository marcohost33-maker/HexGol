// EVIDENCE_PACK_GOLHEX_WAVE_001 — Node evidence runner (ALG-001 + 007acc-FINAL-QA gates)
// Drives the ACTUAL shipped solver (src/lib/sim-core.js applyH/solveCN) — no re-implementation.
// Independent oracle (numpy/scipy expm) lives in ed_oracle.py (cross-language, cross-library).
//
// Measures per config: O1 norm drift, O2 Crank-Nicolson linear-system RESIDUAL (of the returned
// solution, recomputed in exact float64 — NOT the internal fixpoint increment), convergence flag.
// Exports small-graph trajectories for the Python exp(-iHt) ED oracle. Float32(UI) and
// Float64(reference) paths are logged SEPARATELY. PRNG algorithm + seed + full initial state saved.
//
// Usage:  node evidence_runner.mjs [--full]
//   default = CI-bounded grid; --full = extended local evidence grid.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { applyH, solveCN } from "../../../src/lib/sim-core.js";
import { buildNeighbors, rng } from "../../../src/lib/sim-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RES = join(__dirname, "results");
const LOGS = join(__dirname, "logs");
mkdirSync(RES, { recursive: true });
mkdirSync(LOGS, { recursive: true });

const FULL = process.argv.includes("--full");

// ---------------------------------------------------------------------------
// Graph builders -> NL (Int32Array length n*6, <0 = no neighbour). Also return n.
// ---------------------------------------------------------------------------
function ringNL(N) {
  const NL = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) { NL[i * 6] = (i - 1 + N) % N; NL[i * 6 + 1] = (i + 1) % N; }
  return { NL, n: N, kind: `ring_${N}` };
}
function hexTorusNL(R, C) {
  const { torus } = buildNeighbors(R, C, "box");
  return { NL: torus, n: R * C, kind: `hex_${R}x${C}_periodic` };
}
function hexOpenNL(R, C) {
  const { edge } = buildNeighbors(R, C, "box");
  return { NL: edge, n: R * C, kind: `open_patch_${R}x${C}` };
}
// Adversarial: directed ring (asymmetric adjacency -> H NON-Hermitian) to falsify norm gate.
function directedRingNL(N) {
  const NL = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) { NL[i * 6] = (i + 1) % N; } // forward only
  return { NL, n: N, kind: `directed_ring_${N}` };
}

// ---------------------------------------------------------------------------
// Initial states. Both recorded fully. PRNG = mulberry32-variant (sim-engine rng()).
// ---------------------------------------------------------------------------
function gaussianState(n, ArrT) {
  const re = new ArrT(n), im = new ArrT(n);
  const c = (n - 1) / 2;
  for (let i = 0; i < n; i++) re[i] = Math.exp(-((i - c) ** 2) / (2 * (n / 8) ** 2));
  let s = 0; for (let i = 0; i < n; i++) s += re[i] * re[i] + im[i] * im[i];
  const nrm = Math.sqrt(s); for (let i = 0; i < n; i++) re[i] /= nrm;
  return { re, im };
}
function randomState(n, seed, ArrT) {
  const r = rng(seed);
  const re = new ArrT(n), im = new ArrT(n);
  for (let i = 0; i < n; i++) { re[i] = r() - 0.5; im[i] = r() - 0.5; }
  let s = 0; for (let i = 0; i < n; i++) s += re[i] * re[i] + im[i] * im[i];
  const nrm = Math.sqrt(s); for (let i = 0; i < n; i++) { re[i] /= nrm; im[i] /= nrm; }
  return { re, im };
}

// Exact float64 H application + complex norm helpers (oracle-side arithmetic).
function normC(re, im) { let s = 0; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return Math.sqrt(s); }

// O2: residual of the RETURNED solution xNext against (I+iaH)x = (I-iaH)xCur, computed in float64.
function cnResidualRel(xNextRe, xNextIm, xCurRe, xCurIm, NL, J, V, dt) {
  const n = xCurRe.length, a = dt / 2;
  const hRe = new Float64Array(n), hIm = new Float64Array(n);
  // rhs = (I - i a H) xCur
  applyH(xCurRe, xCurIm, NL, J, V, hRe, hIm);
  const rhsRe = new Float64Array(n), rhsIm = new Float64Array(n);
  for (let i = 0; i < n; i++) { rhsRe[i] = xCurRe[i] + a * hIm[i]; rhsIm[i] = xCurIm[i] - a * hRe[i]; }
  // lhs = (I + i a H) xNext
  applyH(xNextRe, xNextIm, NL, J, V, hRe, hIm);
  let rn = 0, bn = 0;
  for (let i = 0; i < n; i++) {
    const lRe = xNextRe[i] - a * hIm[i], lIm = xNextIm[i] + a * hRe[i];
    const dRe = lRe - rhsRe[i], dIm = lIm - rhsIm[i];
    rn += dRe * dRe + dIm * dIm; bn += rhsRe[i] * rhsRe[i] + rhsIm[i] * rhsIm[i];
  }
  return Math.sqrt(rn) / Math.max(Math.sqrt(bn), 1e-300);
}

function mkWork(n, ArrT) {
  return { bRe: new ArrT(n), bIm: new ArrT(n), hRe: new ArrT(n), hIm: new ArrT(n) };
}

// Run one config; returns per-step arrays + summary. Optionally capture ED checkpoints.
function runConfig(graph, J, V, dt, steps, dtype, initKind, seed, capture) {
  const ArrT = dtype === "f32" ? Float32Array : Float64Array;
  const { NL, n } = graph;
  let init;
  if (initKind === "gauss") init = gaussianState(n, ArrT);
  else init = randomState(n, seed, ArrT);
  let re = ArrT.from(init.re), im = ArrT.from(init.im);
  let reBuf = new ArrT(n), imBuf = new ArrT(n);
  const work = mkWork(n, ArrT);
  const n0 = normC(re, im);
  let normDriftMax = 0, resMax = 0, convAll = true, blowUp = false;
  const cap = { times: [], states: [] };
  const capSet = capture ? new Set(capture) : null;
  if (capSet && capSet.has(0)) { cap.times.push(0); cap.states.push({ re: Array.from(re), im: Array.from(im) }); }
  for (let t = 1; t <= steps; t++) {
    const xCurRe = Float64Array.from(re), xCurIm = Float64Array.from(im);
    const conv = solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work);
    if (conv === false) convAll = false;
    // residual measured on returned solution in exact float64
    const rel = cnResidualRel(Float64Array.from(reBuf), Float64Array.from(imBuf), xCurRe, xCurIm, NL, J, V, dt);
    if (rel > resMax) resMax = rel;
    let tmp = re; re = reBuf; reBuf = tmp; tmp = im; im = imBuf; imBuf = tmp;
    const nt = normC(re, im);
    if (!Number.isFinite(nt) || nt > 1e6) { blowUp = true; break; }
    const d = Math.abs(nt - n0); if (d > normDriftMax) normDriftMax = d;
    if (capSet && capSet.has(t)) { cap.times.push(t); cap.states.push({ re: Array.from(re), im: Array.from(im) }); }
  }
  return { n, n0, normDriftMax, resMax, convAll, blowUp,
    aHnorm: dt / 2 * 6 * J, // a*||H|| upper bound (||H||<=6J+V, V small)
    cap };
}

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------
const Js = FULL ? [0.05, 0.10, 0.15, 0.20] : [0.05, 0.15];
const dts = FULL ? [0.025, 0.05, 0.10, 0.20] : [0.05, 0.10];
const Vs = FULL ? [0.0, 0.1] : [0.0];
const stepsMain = FULL ? 500 : 200;

const bigGraphs = () => [ringNL(6), ringNL(16), hexOpenNL(4, 4), hexTorusNL(FULL ? 24 : 8, FULL ? 24 : 8)];
// small graphs for ED oracle (<= 64 nodes, controlled)
const edGraphs = () => [ringNL(6), ringNL(16), hexOpenNL(4, 4), hexTorusNL(6, 6)];

// --- Main sweep: O1 norm drift + O2 residual, both dtype paths ------------
const sweepRows = [["graph", "n", "J", "V", "dt", "steps", "dtype", "init", "seed", "aHnorm", "conv_all", "blow_up", "norm_drift_max", "residual_rel_max"]];
const SEED = 1234567;
for (const g of bigGraphs()) {
  for (const J of Js) for (const V of Vs) for (const dt of dts) {
    for (const dtype of ["f32", "f64"]) {
      for (const [ik, sd] of [["gauss", 0], ["rand", SEED]]) {
        const r = runConfig(g, J, V, dt, stepsMain, dtype, ik, sd, null);
        sweepRows.push([g.kind, r.n, J, V, dt, stepsMain, dtype, ik, sd, r.aHnorm.toFixed(4),
          r.convAll, r.blowUp, r.normDriftMax.toExponential(6), r.resMax.toExponential(6)]);
      }
    }
  }
}
writeFileSync(join(RES, "norm_drift.csv"), sweepRows.map(r => r.join(",")).join("\n") + "\n");

// residuals.csv = same runs but residual-focused view (per graph/dtype the max residual & conv)
const resRows = [["graph", "n", "J", "V", "dt", "dtype", "aHnorm", "conv_all", "residual_rel_max"]];
for (const row of sweepRows.slice(1)) {
  resRows.push([row[0], row[1], row[2], row[3], row[4], row[6], row[9], row[10], row[13]]);
}
writeFileSync(join(RES, "residuals.csv"), resRows.map(r => r.join(",")).join("\n") + "\n");

// --- ED export: small graphs, checkpoints for Python exp(-iHt) oracle -----
const edExport = { prng: "mulberry32-variant (sim-engine.js rng())", seed: SEED, configs: [] };
const edParams = FULL
  ? [{ J: 0.15, V: 0.0, dt: 0.05, steps: 40 }, { J: 0.15, V: 0.1, dt: 0.10, steps: 40 }, { J: 0.20, V: 0.0, dt: 0.025, steps: 80 }]
  : [{ J: 0.15, V: 0.0, dt: 0.05, steps: 40 }, { J: 0.15, V: 0.0, dt: 0.10, steps: 40 }];
const checkpoints = [0, 5, 10, 20, 40];
for (const g of edGraphs()) {
  for (const p of edParams) {
    for (const dtype of ["f32", "f64"]) {
      const r = runConfig(g, p.J, p.V, p.dt, Math.max(...checkpoints), dtype, "rand", SEED,
        checkpoints.filter(c => c <= p.steps));
      edExport.configs.push({
        graph: g.kind, n: g.n, J: p.J, V: p.V, dt: p.dt, dtype,
        NL: Array.from(g.NL), times: r.cap.times, states: r.cap.states,
        conv_all: r.convAll, norm_drift_max: r.normDriftMax, residual_rel_max: r.resMax,
      });
    }
  }
}
writeFileSync(join(RES, "ed_export.json"), JSON.stringify(edExport));

// --- Adversarial: drive to failure boundaries (falsification) -------------
const advRows = [["case", "graph", "n", "J", "V", "dt", "aHnorm", "conv_all", "blow_up", "norm_drift_max", "residual_rel_max", "expectation"]];
// (a) large dt on a DEGREE-6 graph -> a*||H|| approaches/exceeds 1 -> fixpoint (Jacobi/
//     Richardson) iteration must fail to converge. Convergence radius: a*rho(H)<1,
//     rho(H)<=6J (Gershgorin). J=0.2 => boundary dt = 2/(6*0.2) ~= 1.67.
//     (A degree-2 ring has rho(H)<=4J and would NOT cross this boundary at the same dt.)
for (const dt of [1.0, 1.5, 2.0, 3.0]) {
  const r = runConfig(hexTorusNL(8, 8), 0.20, 0.0, dt, 50, "f64", "rand", SEED, null);
  advRows.push(["large_dt", "hex_8x8_periodic", r.n, 0.20, 0.0, dt, r.aHnorm.toFixed(3), r.convAll, r.blowUp,
    r.normDriftMax.toExponential(4), r.resMax.toExponential(4), "conv=false and/or residual large when a*rho(H)>=1"]);
}
// (b) non-Hermitian H (directed ring) -> unitarity broken -> norm NOT conserved
for (const dt of [0.05, 0.2]) {
  const r = runConfig(directedRingNL(16), 0.20, 0.0, dt, 200, "f64", "rand", SEED, null);
  advRows.push(["non_hermitian", "directed_ring_16", r.n, 0.20, 0.0, dt, r.aHnorm.toFixed(3), r.convAll, r.blowUp,
    r.normDriftMax.toExponential(4), r.resMax.toExponential(4), "norm drift >> unitary case (H not hermitian)"]);
}
// (c) degenerate spectrum: V=0 ring has many degenerate pairs; large graph flat -> stress
{
  const r = runConfig(ringNL(64), 0.20, 0.0, 0.2, 300, "f64", "gauss", 0, null);
  advRows.push(["degenerate_spectrum", "ring_64", r.n, 0.20, 0.0, 0.2, r.aHnorm.toFixed(3), r.convAll, r.blowUp,
    r.normDriftMax.toExponential(4), r.resMax.toExponential(4), "still unitary; degeneracy must not break solve"]);
}
writeFileSync(join(RES, "adversarial.csv"), advRows.map(r => r.join(",")).join("\n") + "\n");

// --- summary log ----------------------------------------------------------
const worstNormF32 = Math.max(...sweepRows.slice(1).filter(r => r[6] === "f32").map(r => Number(r[12])));
const worstNormF64 = Math.max(...sweepRows.slice(1).filter(r => r[6] === "f64").map(r => Number(r[12])));
const worstResF32 = Math.max(...sweepRows.slice(1).filter(r => r[6] === "f32").map(r => Number(r[13])));
const worstResF64 = Math.max(...sweepRows.slice(1).filter(r => r[6] === "f64").map(r => Number(r[13])));
const convFails = sweepRows.slice(1).filter(r => r[10] === "false").length;
const summary = {
  full: FULL, node: process.version,
  configs_swept: sweepRows.length - 1,
  worst_norm_drift_f32: worstNormF32, worst_norm_drift_f64: worstNormF64,
  worst_residual_rel_f32: worstResF32, worst_residual_rel_f64: worstResF64,
  main_grid_conv_fails: convFails,
};
writeFileSync(join(LOGS, "runner_summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
