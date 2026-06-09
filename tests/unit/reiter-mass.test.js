// Massenerhaltungs-Test fuer den kanonischen Reiter-Schritt (src/lib/sim-engine
// stepReiter, 2026-06-08). Die fruehere Variante war "leck" (rezeptive Zellen
// fingen den Diffusions-Einstrom nicht auf -> Masse versickerte am Eisrand). Die
// kanonische Form (Reiter, Chaos Solitons Fractals 23) faengt ihn auf und ist
// massenerhaltend bis auf den gamma-Quellterm. Belegte Invariante PRO Schritt:
//     sum(s') - sum(s)  ==  gamma * (#rezeptive Zellen von s)
// plus weiterhin: monotones Eiswachstum, Nicht-Negativitaet, Endlichkeit.
import { describe, it, expect } from "vitest";
import { buildNeighbors, stepReiter } from "../../src/lib/sim-engine.js";

const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const allFinite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
// Summe / Eiszahl nur ueber die Domaene (dmask), wie die App sie betrachtet.
const sumIn = (a, m) => { let s = 0; for (let i = 0; i < a.length; i++) if (m[i]) s += a[i]; return s; };
const iceIn = (a, m) => { let n = 0; for (let i = 0; i < a.length; i++) if (m[i] && a[i] >= 1) n++; return n; };
// Rezeptive UND in der Domaene liegende Zellen (nur diese tragen gamma zur
// Domaenen-Masse bei; ausserhalb erzeugtes gamma wird von der App genullt).
function receptiveCountIn(s, NL, m) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (!m[i]) continue;
    let r = s[i] >= 1;
    if (!r) { const b = i * 6; for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] >= 1) { r = true; break; } } }
    if (r) n++;
  }
  return n;
}

describe("stepReiter (kanonisch) — massenerhaltend bis auf gamma*#rezeptiv", () => {
  for (const shape of ["box", "circle", "hexagon"]) {
    it(`sum(s')-sum(s) == gamma*#rezeptiv pro Schritt, In-Domaene (${shape})`, () => {
      // Wie App.tsx: nach jedem Schritt werden Zellen ausserhalb der Domaene
      // genullt (permanente Waende). Der `edge`-Lookup ist an der Domaenengrenze
      // asymmetrisch (In-Domaene sieht Aussen als -1 = Null-Fluss), daher ist die
      // Erhaltung die ueber die DOMAENE — exakt das, was der Nutzer sieht.
      const R = 15, C = 15;
      const { edge, mask } = buildNeighbors(R, C, shape);
      const N = R * C;
      let s = new Float32Array(N), buf = new Float32Array(N);
      const rec = new Float32Array(N);
      for (let i = 0; i < N; i++) if (mask[i]) s[i] = 0.4; // Hintergrund-Dampf in der Domaene
      let mid = (R >> 1) * C + (C >> 1); if (!mask[mid]) { for (let i = 0; i < N; i++) if (mask[i]) { mid = i; break; } }
      s[mid] = 1;
      const alpha = 1.0, gamma = 0.03;
      let prevIce = iceIn(s, mask);
      for (let t = 0; t < 50; t++) {
        const recCount = receptiveCountIn(s, edge, mask);
        const before = sumIn(s, mask);
        const out = stepReiter(s, edge, alpha, gamma, buf, rec);
        buf = s; s = out;
        for (let i = 0; i < N; i++) if (!mask[i]) s[i] = 0; // Domaenenmaske wie in der App
        const delta = sumIn(s, mask) - before;
        // Kern-Invariante (In-Domaene): Massenzuwachs == gamma * #rezeptiv.
        expect(Math.abs(delta - gamma * recCount)).toBeLessThan(1e-3);
        expect(allFinite(s)).toBe(true);
        for (let i = 0; i < N; i++) expect(s[i]).toBeGreaterThanOrEqual(-1e-6);
        const ice = iceIn(s, mask);
        expect(ice).toBeGreaterThanOrEqual(prevIce); // Eis taut nie
        prevIce = ice;
      }
      expect(s[mid]).toBeGreaterThanOrEqual(1);
      expect(iceIn(s, mask)).toBeGreaterThan(1); // Flocke ist gewachsen
    });
  }

  it("ohne jedes Eis ist die reine Diffusion exakt massenerhaltend (delta==0)", () => {
    // Kein rezeptiver Bereich -> gamma*0 = 0 -> reine Diffusion muss die Masse
    // exakt halten (Null-Fluss-Rand). Stresstest der Erhaltung ohne Quellterm.
    const R = 12, C = 12;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C;
    let s = new Float32Array(N), buf = new Float32Array(N);
    const rec = new Float32Array(N);
    // glattes, sub-1 Feld (nichts wird Eis), zufaellig aber < 1
    for (let i = 0; i < N; i++) s[i] = 0.1 + 0.8 * ((i * 2654435761 >>> 0) % 1000) / 1000;
    const m0 = sum(s);
    for (let t = 0; t < 100; t++) { const out = stepReiter(s, edge, 1.0, 0.03, buf, rec); buf = s; s = out; }
    expect(Math.abs(sum(s) - m0)).toBeLessThan(1e-2); // reine Diffusion: Masse bleibt
    expect(allFinite(s)).toBe(true);
  });
});
