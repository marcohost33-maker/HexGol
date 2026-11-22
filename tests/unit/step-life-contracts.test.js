// Semantische Vertraege von stepLife, unabhaengig vom Paritaetsorakel.
//
// step-life.test.js vergleicht die Engine mit einer naiven KOPIE derselben Logik --
// ein Fehler, der in beiden steht, faellt dort nicht auf. Diese Suite prueft
// stattdessen beobachtbare Eigenschaften gegen das Ergebnis selbst.

import { describe, it, expect } from "vitest";
import { stepLife, buildNeighbors, RMETA } from "../../src/lib/sim-engine.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Ein Schritt; liefert Ergebnis-Puffer und die gemeldeten Zaehler. */
function schritt({ R, C, shape = "box", torus = true, col, gh, age, ...flags }) {
  const N = R * C;
  const nb = buildNeighbors(R, C, shape);
  const g = {
    col, gh: gh || new Uint8Array(N), age: age || new Uint16Array(N),
    nc: new Uint8Array(N), ng: new Uint8Array(N), na: new Uint16Array(N),
    NL: torus ? nb.torus : nb.edge, dmask: nb.mask,
    meta: RMETA[0], colorMode: "quad", a1: false, a2: false, a3: false, a4: false,
    a5: "off", sysT: false, spN: 0, adia: false, tick: 1, ...flags,
  };
  const out = stepLife(g);
  return { ...out, nc: g.nc, ng: g.ng, nb };
}

// Codex-Befund PR #228: die A1-Spontangeburten erhoehten `births` nicht. Das
// 9-Regel-Profil (R4) leitet daraus Ueberlebende ab und zaehlte Neugeborene als
// Ueberlebende; die Statistik-Zeile zeigte zu wenige Geburten.
describe("births/deaths zaehlen JEDEN Uebergang tot->lebend bzw. lebend->tot", () => {
  for (const a1 of [false, true]) {
    for (const a4 of [false, true]) {
      it(`a1=${a1} a4=${a4}: Zaehler == beobachtete Uebergaenge (30 Ticks, leeres + dichtes Feld)`, () => {
        const R = 20, C = 20, N = R * C;
        const rnd = mulberry32(4242);
        let spontan = 0;
        for (let tick = 1; tick <= 30; tick++) {
          for (const dichte of [0, 0.3]) {
            const col = new Uint8Array(N);
            for (let i = 0; i < N; i++) if (rnd() < dichte) col[i] = 1 + Math.floor(rnd() * 12);
            const r = schritt({ R, C, col, a1, a4, tick });
            let geb = 0, tod = 0;
            for (let i = 0; i < N; i++) {
              if (col[i] === 0 && r.nc[i] !== 0) geb++;
              if (col[i] !== 0 && r.nc[i] === 0) tod++;
            }
            if (dichte === 0) spontan += geb;
            expect(r.births).toBe(geb);
            expect(r.deaths).toBe(tod);
          }
        }
        // Positivkontrolle: mit A1 entstehen im leeren Feld tatsaechlich Geburten.
        if (a1) expect(spontan).toBeGreaterThan(0);
      });
    }
  }
});
