import { describe, it, expect } from "vitest";
import { applyH, solveCN } from "../../src/lib/sim-core.js";

// Hermitesches Hopping auf periodischer Kette (2 Nachbarn in den 6 Hex-Slots).
function chainNL(N) {
  const NL = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) { NL[i * 6] = (i - 1 + N) % N; NL[i * 6 + 1] = (i + 1) % N; }
  return NL;
}
function makeWork(n) {
  return { bRe: new Float64Array(n), bIm: new Float64Array(n), hRe: new Float64Array(n), hIm: new Float64Array(n) };
}
function norm(re, im) { let s = 0; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return Math.sqrt(s); }

describe("HQST sim-core", () => {
  it("applyH: Tight-Binding-Operator verteilt -J auf Nachbarn (Sanity)", () => {
    const N = 8, NL = chainNL(N);
    const re = new Float32Array(N), im = new Float32Array(N);
    re[0] = 1;
    const hRe = new Float32Array(N), hIm = new Float32Array(N);
    applyH(re, im, NL, 1, 0, hRe, hIm);
    // Nachbarn von Zelle 0 (= 1 und N-1) erhalten -J*re[0] = -1; Zelle 2 ist unberuehrt.
    expect(hRe[1]).toBeCloseTo(-1, 5);
    expect(hRe[N - 1]).toBeCloseTo(-1, 5);
    expect(hRe[2]).toBe(0);
  });

  it("solveCN ist UNITAER: Norm bleibt ueber 500 Schritte erhalten", () => {
    const N = 64, J = 1, V = 0, dt = 0.1, STEPS = 500;
    const NL = chainNL(N);
    let re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i - N / 2) / 6; re[i] = Math.exp(-x * x) * Math.cos(0.6 * i); im[i] = Math.exp(-x * x) * Math.sin(0.6 * i); }
    const n0 = norm(re, im); for (let i = 0; i < N; i++) { re[i] /= n0; im[i] /= n0; }
    const w = makeWork(N); let rb = new Float32Array(N), ib = new Float32Array(N);
    for (let s = 0; s < STEPS; s++) { solveCN(re, im, NL, J, V, dt, rb, ib, w); [re, rb] = [rb, re]; [im, ib] = [ib, im]; }
    // a*||H|| = (dt/2)*~2 = 0.1 < 1 -> konvergent + normerhaltend (Float32-Toleranz).
    expect(Math.abs(norm(re, im) - 1)).toBeLessThan(5e-3);
  });

  it("solveCN konvergiert (gibt true) bei stabilen Parametern", () => {
    const N = 32, NL = chainNL(N);
    const re = new Float32Array(N), im = new Float32Array(N); re[N / 2] = 1;
    const w = makeWork(N), rb = new Float32Array(N), ib = new Float32Array(N);
    expect(solveCN(re, im, NL, 1, 0, 0.1, rb, ib, w)).toBe(true);
  });
});
