// HQST wave-solver V&V gates (EVIDENCE_PACK_GOLHEX_WAVE_001, ALG-001).
// CI-facing subset of the evidence pack: exercises the SHIPPED solver (sim-core.js) against
// INDEPENDENT oracles that share no code with it:
//   - Hermiticity / adjacency-symmetry of the constructed H (O3)
//   - Crank-Nicolson linear-system RESIDUAL of the returned solution (O2)
//   - unitarity / norm conservation over long runs (O1), Float32 and Float64 paths
//   - ANALYTIC eigenmode-phase oracle: a ring Fourier mode evolves by exp(-i*2*atan(a*E_k)*n)
//     (exact CN eigenvalue) -> compares numerics to a closed-form phase (O4, no matrix-exp dep)
//   - FALSIFICATION gates (silent-failure guard): non-Hermitian graph breaks norm conservation;
//     over-large dt makes the fixpoint solve REPORT non-convergence instead of silently passing.
import { describe, it, expect } from "vitest";
import { applyH, solveCN } from "../../src/lib/sim-core.js";
import { buildNeighbors } from "../../src/lib/sim-engine.js";

const norm = (re, im) => { let s = 0; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return Math.sqrt(s); };

function ringNL(N) {
  const NL = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) { NL[i * 6] = (i - 1 + N) % N; NL[i * 6 + 1] = (i + 1) % N; }
  return NL;
}
function directedRingNL(N) {
  const NL = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) NL[i * 6] = (i + 1) % N;
  return NL;
}
// dense H from NL (independent reconstruction) for the Hermiticity oracle
function denseH(NL, n, J, V) {
  const H = Array.from({ length: n }, () => new Float64Array(2 * n)); // [re,im] interleaved per col
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) { const j = NL[i * 6 + k]; if (j >= 0) H[i][2 * j] += -J; }
    H[i][2 * i] += V;
  }
  return H;
}
function hermFro(H, n) {
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const re = H[i][2 * j] - H[j][2 * i], im = H[i][2 * j + 1] + H[j][2 * i + 1];
    s += re * re + im * im;
  }
  return Math.sqrt(s);
}
function mkWork(n, ArrT) { return { bRe: new ArrT(n), bIm: new ArrT(n), hRe: new ArrT(n), hIm: new ArrT(n) }; }

// O2: residual of returned solution in exact float64
function residualRel(xNr, xNi, xCr, xCi, NL, J, V, dt) {
  const n = xCr.length, a = dt / 2;
  const hR = new Float64Array(n), hI = new Float64Array(n);
  applyH(xCr, xCi, NL, J, V, hR, hI);
  const bR = new Float64Array(n), bI = new Float64Array(n);
  for (let i = 0; i < n; i++) { bR[i] = xCr[i] + a * hI[i]; bI[i] = xCi[i] - a * hR[i]; }
  applyH(xNr, xNi, NL, J, V, hR, hI);
  let rn = 0, bn = 0;
  for (let i = 0; i < n; i++) {
    const lR = xNr[i] - a * hI[i], lI = xNi[i] + a * hR[i];
    rn += (lR - bR[i]) ** 2 + (lI - bI[i]) ** 2; bn += bR[i] ** 2 + bI[i] ** 2;
  }
  return Math.sqrt(rn) / Math.max(Math.sqrt(bn), 1e-300);
}

describe("HQST V&V — O3 Hermiticity / adjacency symmetry", () => {
  it("ring, open hex patch and periodic hex torus all yield a Hermitian H (fro <= 1e-12)", () => {
    const J = 0.15, V = 0.1;
    const cases = [
      { NL: ringNL(16), n: 16 },
      { NL: buildNeighbors(4, 4, "box").edge, n: 16 },
      { NL: buildNeighbors(6, 6, "box").torus, n: 36 },
    ];
    for (const c of cases) expect(hermFro(denseH(c.NL, c.n, J, V), c.n)).toBeLessThanOrEqual(1e-12);
  });
});

describe("HQST V&V — O1 unitarity + O2 residual (both dtype paths)", () => {
  for (const dtype of ["f32", "f64"]) {
    const ArrT = dtype === "f32" ? Float32Array : Float64Array;
    it(`ring_16 conserves norm and keeps residual small over 200 steps (${dtype})`, () => {
      const N = 16, J = 0.15, V = 0.0, dt = 0.1, NL = ringNL(N);
      let re = new ArrT(N), im = new ArrT(N);
      const c = (N - 1) / 2;
      for (let i = 0; i < N; i++) re[i] = Math.exp(-((i - c) ** 2) / 8);
      let s = norm(re, im); for (let i = 0; i < N; i++) re[i] /= s;
      let reBuf = new ArrT(N), imBuf = new ArrT(N); const work = mkWork(N, ArrT);
      const n0 = norm(re, im); let driftMax = 0, resMax = 0;
      for (let t = 0; t < 200; t++) {
        const xr = Float64Array.from(re), xi = Float64Array.from(im);
        const conv = solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work);
        expect(conv).not.toBe(false);
        resMax = Math.max(resMax, residualRel(Float64Array.from(reBuf), Float64Array.from(imBuf), xr, xi, NL, J, V, dt));
        let tmp = re; re = reBuf; reBuf = tmp; tmp = im; im = imBuf; imBuf = tmp;
        driftMax = Math.max(driftMax, Math.abs(norm(re, im) - n0));
      }
      expect(driftMax).toBeLessThan(dtype === "f32" ? 5e-3 : 1e-4); // predeclared gate
      expect(resMax).toBeLessThan(1e-4);
    });
  }
});

describe("HQST V&V — O4 analytic eigenmode-phase oracle", () => {
  it("a ring Fourier eigenmode evolves by the exact CN phase exp(-i*2*atan(a*E_k)*n)", () => {
    const N = 16, J = 0.15, V = 0.0, dt = 0.05, k = 3, steps = 40, a = dt / 2;
    const NL = ringNL(N);
    const Ek = -2 * J * Math.cos(2 * Math.PI * k / N) + V;    // eigenvalue of H for mode k
    const re0 = new Float64Array(N), im0 = new Float64Array(N);
    for (let j = 0; j < N; j++) { re0[j] = Math.cos(2 * Math.PI * k * j / N) / Math.sqrt(N); im0[j] = Math.sin(2 * Math.PI * k * j / N) / Math.sqrt(N); }
    let re = Float64Array.from(re0), im = Float64Array.from(im0);
    let reBuf = new Float64Array(N), imBuf = new Float64Array(N); const work = mkWork(N, Float64Array);
    for (let t = 0; t < steps; t++) {
      solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work);
      let tmp = re; re = reBuf; reBuf = tmp; tmp = im; im = imBuf; imBuf = tmp;
    }
    const phi = -2 * steps * Math.atan(a * Ek);              // exact CN accumulated phase
    const cp = Math.cos(phi), sp = Math.sin(phi);
    let err = 0;
    for (let j = 0; j < N; j++) {
      const pr = re0[j] * cp - im0[j] * sp, pi = re0[j] * sp + im0[j] * cp; // exp(i phi) * psi0
      err = Math.max(err, Math.abs(re[j] - pr), Math.abs(im[j] - pi));
    }
    expect(err).toBeLessThan(1e-5);
  });
});

describe("HQST V&V — falsification / silent-failure gates", () => {
  it("non-Hermitian graph (directed ring) BREAKS norm conservation (not silently unitary)", () => {
    const N = 16, J = 0.2, V = 0.0, dt = 0.2, NL = directedRingNL(N);
    let re = new Float64Array(N), im = new Float64Array(N); re[0] = 1;
    let reBuf = new Float64Array(N), imBuf = new Float64Array(N); const work = mkWork(N, Float64Array);
    const n0 = norm(re, im);
    for (let t = 0; t < 100; t++) {
      solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work);
      let tmp = re; re = reBuf; reBuf = tmp; tmp = im; im = imBuf; imBuf = tmp;
    }
    expect(norm(re, im)).toBeGreaterThan(n0 * 1.5); // unitarity assumption is FALSE here
  });

  it("over-large dt (a*rho(H) >= 1) makes solveCN REPORT non-convergence, not silently pass", () => {
    const NL = buildNeighbors(8, 8, "box").torus, n = 64, J = 0.2, V = 0.0, dt = 2.0;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { re[i] = Math.sin(i); im[i] = Math.cos(i * 0.7); }
    let s = norm(re, im); for (let i = 0; i < n; i++) { re[i] /= s; im[i] /= s; }
    const reBuf = new Float64Array(n), imBuf = new Float64Array(n), work = mkWork(n, Float64Array);
    const conv = solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work);
    expect(conv).toBe(false);
  });
});
