// HQST-Solver — dokumentierte Norm-Eigenschaften ueber LANGE Laeufe (200 Schritte).
// Bisher pruefte nur sim-core.test.js die Ein-Schritt-Norm von solveCN. Hier wird
// das in der Engine versprochene Langzeitverhalten der drei austauschbaren
// Integratoren belegt (SOLVERS-Registry):
//   - cn    (Crank-Nicolson, Cayley): UNITAER -> Norm bleibt ~1.
//   - euler (explizit):               NICHT normerhaltend -> Norm waechst/entgleist.
//   - rk4:                            beschraenkt (kein Blow-up), driftet aber.
// Tight-Binding-Parameter wie in App.tsx (J=0.15, V=0, dt=0.5): a*||H|| = 0.225 < 1.
import { describe, it, expect } from "vitest";
import { buildNeighbors, mkHqstWork, stepHQST, SOLVERS } from "../../src/lib/sim-engine.js";

const J = 0.15, V = 0.0, DT = 0.5;
const norm = (re, im) => { let s = 0; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return s; };

function seedPacket(R, C) {
  const N = R * C, re = new Float32Array(N), im = new Float32Array(N);
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) re[r * C + c] = Math.exp(-(((r - cr) ** 2) + ((c - cc) ** 2)) / 8);
  const nrm = Math.sqrt(norm(re, im)); for (let i = 0; i < N; i++) re[i] /= nrm; // normieren -> Norm 1
  return { re, im };
}

function runNorms(solverId, steps) {
  const R = 14, C = 14, N = R * C;
  const { edge } = buildNeighbors(R, C, "box"); // box -> symmetrische Adjazenz -> H hermitesch
  let { re, im } = seedPacket(R, C);
  let reBuf = new Float32Array(N), imBuf = new Float32Array(N);
  const work = mkHqstWork(N);
  const norms = [norm(re, im)];
  for (let t = 0; t < steps; t++) {
    stepHQST(re, im, edge, J, V, DT, reBuf, imBuf, work, solverId);
    let tmp; tmp = re; re = reBuf; reBuf = tmp; tmp = im; im = imBuf; imBuf = tmp;
    norms.push(norm(re, im));
  }
  return norms;
}

describe("HQST-Solver — Norm-Eigenschaften ueber lange Laeufe", () => {
  it("Crank-Nicolson ist unitaer: Norm bleibt ueber 200 Schritte ~1", () => {
    const norms = runNorms("cn", 200);
    for (const nm of norms) expect(Math.abs(nm - 1)).toBeLessThan(2e-2);
    expect(Math.abs(norms[norms.length - 1] - 1)).toBeLessThan(1e-2); // winzige Restdrift
  });

  it("Euler (explizit) ist NICHT normerhaltend: Norm waechst messbar (oder entgleist)", () => {
    const norms = runNorms("euler", 200);
    const last = norms[norms.length - 1];
    // explizites Euler fuer die Schroedingergleichung ist instabil -> Verstaerkung > 1.
    expect(last > norms[0] * 1.1 || !Number.isFinite(last)).toBe(true);
  });

  it("RK4 bleibt beschraenkt (kein Blow-up) ueber 200 Schritte, ist aber nicht strikt unitaer", () => {
    const norms = runNorms("rk4", 200);
    const last = norms[norms.length - 1];
    expect(Number.isFinite(last)).toBe(true);
    expect(last).toBeLessThan(10);              // explodiert nicht wie Euler
    expect(Math.abs(last - 1)).toBeLessThan(0.5); // nahe 1, aber driftet
  });

  it("RK4 haelt die Norm deutlich besser als Euler", () => {
    const cn = runNorms("cn", 120), rk = runNorms("rk4", 120), eu = runNorms("euler", 120);
    const drift = (a) => Math.abs(a[a.length - 1] - 1);
    expect(drift(cn)).toBeLessThan(drift(rk) + 1e-6); // cn am besten
    const euLast = eu[eu.length - 1];
    expect(!Number.isFinite(euLast) || drift(eu) > drift(rk)).toBe(true); // euler am schlechtesten
  });

  it("SOLVERS-Registry: cn/rk4/euler mit Funktion + Beschreibung", () => {
    expect(Object.keys(SOLVERS).sort()).toEqual(["cn", "euler", "rk4"]);
    for (const k of ["cn", "rk4", "euler"]) {
      expect(typeof SOLVERS[k].fn).toBe("function");
      expect(typeof SOLVERS[k].l).toBe("string");
    }
  });
});
