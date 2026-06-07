import { describe, it, expect } from "vitest";
import { buildNeighbors } from "../../src/App.tsx";

// Portiert aus "golhex test dirichlet.js" (Drive-Monolith) an die integrierte
// Architektur (PR#41 openSys/Dirichlet-Rand). Der Drive-Test war self-contained mit
// eigener neigh()-Funktion; hier wird zusaetzlich die ECHTE integrierte
// Randerkennung buildNeighbors().bnd (App.tsx, von openSys in step() genutzt,
// Zeilen ~1058-1060) gegen die manuelle Randerkennung verankert.
//
// Dirichlet-Rand = offenes System: Randzellen halten einen konstanten Quellwert.
// Physik: stationaerer Diffusionszustand strebt gegen das Randprofil (Maximumprinzip
// fuer die diskrete Laplace-Gleichung). Rand=1, Inneres -> 1.

const R = 31, C = 31, N = R * C;

// hexNL berandet (kein Torus), wie der Drive-Test.
function hexNL() {
  const T = new Int32Array(N * 6);
  const odd = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
  const ev = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  for (let r = 0; r < R; r++) {
    const o = (r & 1) ? odd : ev;
    for (let c = 0; c < C; c++) {
      const b = (r * C + c) * 6;
      for (let k = 0; k < 6; k++) {
        const nr = r + o[k][0], nc = c + o[k][1];
        T[b + k] = (nr >= 0 && nr < R && nc >= 0 && nc < C) ? nr * C + nc : -1;
      }
    }
  }
  return T;
}

describe("dirichlet boundary (portiert): offenes System, Maximumprinzip", () => {
  const NL = hexNL();
  const isBoundary = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const b = i * 6; for (let k = 0; k < 6; k++) if (NL[b + k] < 0) { isBoundary[i] = 1; break; } }

  it("stationaerer Zustand: Inneres konvergiert gegen Randwert (Maximumprinzip)", () => {
    let u = new Float32Array(N);
    for (let i = 0; i < N; i++) if (isBoundary[i]) u[i] = 1; // Dirichlet: Rand fest 1
    let buf = new Float32Array(N);
    const diffuse = (u, buf) => {
      for (let i = 0; i < N; i++) {
        if (isBoundary[i]) { buf[i] = u[i]; continue; } // Rand fest
        const b = i * 6; let s = 0, c = 0;
        for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0) { s += u[j]; c++; } }
        buf[i] = u[i] + 0.5 * (s / c - u[i]);
      }
      return buf;
    };
    for (let t = 0; t < 2000; t++) { const o = diffuse(u, buf); buf = u; u = o; }
    let mn = 2, mx = -1;
    for (let i = 0; i < N; i++) { if (u[i] < mn) mn = u[i]; if (u[i] > mx) mx = u[i]; }
    // Maximumprinzip: kein Innenwert ueberschreitet den Randwert; alle konvergieren
    // gegen 1. min > 0.99 = praktisch konvergiert; max <= 1 (+Float32-Toleranz).
    expect(mn).toBeGreaterThan(0.99);
    expect(mx).toBeLessThanOrEqual(1 + 1e-5);
  });

  it("integrierte buildNeighbors().bnd stimmt mit manueller Randerkennung ueberein (box)", () => {
    // App.tsx nutzt fuer openSys die bnd-Maske aus buildNeighbors. Anti-Drift:
    // bnd muss exakt die Zellen mit >=1 fehlendem edge-Nachbarn markieren.
    const g = buildNeighbors(R, C, "box");
    let mismatch = 0;
    for (let i = 0; i < N; i++) {
      let bnd = 0; const b = i * 6; for (let k = 0; k < 6; k++) if (g.edge[b + k] < 0) { bnd = 1; break; }
      if (g.bnd[i] !== bnd) mismatch++;
    }
    expect(mismatch).toBe(0);
    // Sanity: bei box (volle Domaene) ist der Rand der Gitterrahmen, also > 0 Zellen.
    let nb = 0; for (let i = 0; i < N; i++) if (g.bnd[i]) nb++;
    expect(nb).toBeGreaterThan(0);
  });
});
