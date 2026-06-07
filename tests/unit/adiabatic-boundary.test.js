import { describe, it, expect } from "vitest";
import { buildNeighbors } from "../../src/App.tsx";

// Portiert aus "golhex test adiabatic bool.js" (Drive-Monolith) an die integrierte
// Architektur (PR#41 boundaryMode). Der Drive-Test grabte buildNeighbors per
// fs/regex aus golhex_v31.jsx; hier wird der ECHTE, integrierte buildNeighbors aus
// src/App.tsx importiert (named export, export-only).
//
// Die boundaryMode-Live-Zaehlung lebt in App.tsx inline im step()-Effect
// (Zeilen ~1087-1101) und ist nicht als reine Funktion exportierbar, ohne Logik zu
// verschieben. liveCount() unten ist daher eine EXAKTE Replik dieser inline-Logik
// (boolescher Pfad: j<0 -> "adiabatic" + selfAlive -> live++, sonst nichts).
// Geprueft werden drei Kernaussagen:
//  (1) ANTI-REGRESSION: im Inneren (alle 6 Nachbarn vorhanden) ist die effektive
//      Lebendzahl bei boundaryMode "null" und "adiabatic" BIT-IDENTISCH.
//  (2) WIRKUNG: lebende Randzellen sehen unter "adiabatic" mehr Nachbarn als unter
//      "null" (gespiegelte fehlende Nachbarn zaehlen die Zelle selbst).
//  (3) DETERMINISMUS: dieselbe Eingabe -> dieselbe Zaehlung.

// EXAKTE Replik der inline-Logik aus App.tsx step() (boolescher Modus, boundaryMode).
function liveCount(i, col, NL, bc) {
  const base = i * 6; let live = 0; const self = col[i], selfAlive = self !== 0;
  for (let k = 0; k < 6; k++) {
    const j = NL[base + k];
    if (j < 0) { if (bc === "adiabatic" && selfAlive) live++; continue; }
    if (col[j] !== 0) live++;
  }
  return live;
}

describe("adiabatic boundary (portiert): boundaryMode null vs adiabatic", () => {
  const R = 41, C = 41, N = R * C;
  const g = buildNeighbors(R, C, "hexagon");
  const NL = g.edge; // berandet (kein Torus) -> fehlende Nachbarn moeglich

  // Deterministischer Zufallszustand in der Domaene (mulberry32, fixer Seed).
  function seededField() {
    let s = 12345;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const col = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (g.mask[i] && rnd() < 0.5) col[i] = 1 + Math.floor(rnd() * 12);
    return col;
  }
  const col = seededField();

  it("(1) ANTI-REGRESSION: Innenzellen identisch (null == adiabatic)", () => {
    let innerChecked = 0, innerDiff = 0;
    for (let i = 0; i < N; i++) {
      if (!g.mask[i]) continue;
      let missing = false; for (let k = 0; k < 6; k++) if (NL[i * 6 + k] < 0) { missing = true; break; }
      if (missing) continue;
      innerChecked++;
      if (liveCount(i, col, NL, "null") !== liveCount(i, col, NL, "adiabatic")) innerDiff++;
    }
    expect(innerChecked).toBeGreaterThan(0); // es gibt echte Innenzellen
    expect(innerDiff).toBe(0); // adiabatisch beruehrt ausschliesslich den Rand
  });

  it("(2) WIRKUNG: lebende Randzellen sehen unter adiabatic mehr Nachbarn", () => {
    let boundaryLiveCells = 0;
    for (let i = 0; i < N; i++) {
      if (!g.mask[i]) continue;
      let missing = false; for (let k = 0; k < 6; k++) if (NL[i * 6 + k] < 0) { missing = true; break; }
      if (!missing) continue;
      if (col[i] !== 0 && liveCount(i, col, NL, "adiabatic") > liveCount(i, col, NL, "null")) boundaryLiveCells++;
    }
    expect(boundaryLiveCells).toBeGreaterThan(0); // gespiegelte Nachbarn wirken
  });

  it("(3) DETERMINISMUS: gleiche Eingabe -> gleiche Zaehlung", () => {
    let diff = 0;
    for (let i = 0; i < N; i++) {
      if (!g.mask[i]) continue;
      if (liveCount(i, col, NL, "adiabatic") !== liveCount(i, col, NL, "adiabatic")) diff++;
    }
    expect(diff).toBe(0);
  });
});
