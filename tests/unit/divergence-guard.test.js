import { describe, it, expect } from "vitest";
import { buildNeighbors, stepHQST, mkHqstWork } from "../../src/App.tsx";

// Portiert aus "golhex test divergence guard.js" (Drive-Monolith) an die integrierte
// Architektur (PR#41 solverDiverged). Der Drive-Test grabte stepHQST/mkHqstWork per
// fs/regex aus golhex_v31.jsx; hier werden die ECHTEN, integrierten Funktionen aus
// src/App.tsx importiert (named exports, export-only).
//
// Der Divergenz-Waechter lebt in App.tsx inline im step()-Effect (Zeilen ~1025-1039):
// nach jedem HQST-Schritt wird die Amplitude geprueft; bei !Number.isFinite oder
// maxA > 1e4 wird das Feld genullt, solverDiverged gesetzt und der Lauf gestoppt.
// guard() unten ist eine EXAKTE Replik dieser inline-Pruefung.
// Geprueft:
//  (1) EULER entgleist (instabil fuer Schroedinger) und wird abgefangen; das Feld
//      bleibt danach endlich (kein Inf/NaN ueberlebt).
//  (2) CN (Crank-Nicolson, unitaer) laeuft ungestoert -> Waechter feuert NICHT.
//  (3) RK4 bleibt unter der Schranke -> kein faelschliches Abfangen.

// EXAKTE Replik der inline-Waechter-Pruefung aus App.tsx step().
function guard(re, im, N) {
  let maxA = 0, bad = false;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(re[i]) + Math.abs(im[i]);
    if (a > maxA) maxA = a;
    if (!Number.isFinite(a)) { bad = true; break; }
  }
  return bad || maxA > 1e4;
}

const R = 61, C = 61;
const g = buildNeighbors(R, C, "hexagon");
const NL = g.edge, N = R * C, mask = g.mask;

function run(solverId, steps) {
  let re = new Float32Array(N), im = new Float32Array(N);
  let s = 99;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < N; i++) if (mask[i] && rnd() < 0.3) { re[i] = rnd() - 0.5; im[i] = rnd() - 0.5; }
  let reB = new Float32Array(N), imB = new Float32Array(N), work = mkHqstWork(N);
  let caught = -1;
  for (let t = 1; t <= steps; t++) {
    stepHQST(re, im, NL, 0.15, 0.0, 0.5, reB, imB, work, solverId);
    [re, reB] = [reB, re]; [im, imB] = [imB, im];
    for (let i = 0; i < N; i++) if (!mask[i]) { re[i] = 0; im[i] = 0; }
    if (guard(re, im, N)) { re.fill(0); im.fill(0); caught = t; break; }
  }
  let finite = true;
  for (let i = 0; i < N; i++) if (!Number.isFinite(re[i]) || !Number.isFinite(im[i])) { finite = false; break; }
  return { caught, finite };
}

describe("divergence guard (portiert): faengt echte Divergenz, schont stabile Solver", () => {
  it("(1) EULER entgleist und wird abgefangen, Feld danach endlich", () => {
    const e = run("euler", 5000);
    expect(e.caught).toBeGreaterThan(0); // wurde abgefangen
    expect(e.finite).toBe(true);         // kein Inf/NaN ueberlebt
  });

  it("(2) CN laeuft ungestoert (Waechter ruht)", () => {
    const c = run("cn", 5000);
    expect(c.caught).toBe(-1); // nie abgefangen
    expect(c.finite).toBe(true);
  });

  it("(3) RK4 bleibt unter der Schranke (kein faelschliches Abfangen)", () => {
    const r = run("rk4", 5000);
    expect(r.caught).toBe(-1);
    expect(r.finite).toBe(true);
  });
});
