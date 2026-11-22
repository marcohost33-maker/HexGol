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

// E3, Marco-Entscheid 2026-11-22: A5 "sym" ist die DOKUMENTIERTE Regel
// (docs/watzlawick-rule.md Axiom 5, src/lib/watzlawick-axioms.js):
//   S = groesste gleichfarbige Nachbargruppe, K = lebende Nachbarn - S
//   Ueberleben verlangt zusaetzlich K <= S, Geburt verlangt zusaetzlich S > K.
// Die B/S-Schwellen der aktiven Regel gelten dabei auf der GESAMTzahl lebender
// Nachbarn. Verhaltensaenderung: bis v33.5.0 zaehlte "sym" nur gleichfarbige
// Nachbarn als Schwelle und kannte die K/S-Bedingung gar nicht.
describe("A5 sym = dokumentierte Regel (Ueberleben K<=S, Geburt S>K)", () => {
  const R = 18, C = 18, N = R * C;
  const B = new Set([2]), S = new Set([3, 4]); // RMETA[0] = H:B2/S34

  function orakel(col, NL, i) {
    const cnt = new Array(13).fill(0);
    let live = 0;
    for (let k = 0; k < 6; k++) { const j = NL[i * 6 + k]; if (j >= 0 && col[j] !== 0) { cnt[col[j]]++; live++; } }
    const s = Math.max(...cnt.slice(1)), kk = live - s;
    return col[i] !== 0 ? (S.has(live) && kk <= s) : (B.has(live) && s > kk);
  }

  for (const farben of [2, 3, 12]) {
    it(`jede Zelle folgt dem Orakel (${farben} Farben, 20 Zufallsfelder)`, () => {
      const rnd = mulberry32(777 + farben);
      let geprueft = 0, gesperrt = 0;
      for (let f = 0; f < 20; f++) {
        const col = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (rnd() < 0.45) col[i] = 1 + Math.floor(rnd() * farben);
        const r = schritt({ R, C, col, a5: "sym" });
        const NL = r.nb.torus;
        for (let i = 0; i < N; i++) {
          expect(r.nc[i] !== 0, `Zelle ${i}`).toBe(orakel(col, NL, i));
          geprueft++;
          // Positivkontrolle: die K/S-Bedingung muss im Feld wirklich greifen.
          let live = 0; for (let k = 0; k < 6; k++) { const j = NL[i * 6 + k]; if (j >= 0 && col[j] !== 0) live++; }
          if (col[i] !== 0 ? S.has(live) : B.has(live)) if (!orakel(col, NL, i)) gesperrt++;
        }
      }
      expect(geprueft).toBe(20 * N);
      if (farben > 1) expect(gesperrt).toBeGreaterThan(0);
    });
  }

  it("Ueberleben trotz Mehrheit anderer Farben ist moeglich, solange K <= S", () => {
    // Zelle (farbe 1) mit 2x Farbe 1 + 2x Farbe 2: live 4 in S34, S=2, K=2 -> lebt.
    const col = new Uint8Array(N);
    const nb = buildNeighbors(R, C, "box");
    const i = 9 * C + 9;
    col[i] = 1;
    const nach = Array.from({ length: 6 }, (_, k) => nb.torus[i * 6 + k]);
    col[nach[0]] = 1; col[nach[2]] = 1; col[nach[3]] = 2; col[nach[5]] = 2;
    expect(schritt({ R, C, col, a5: "sym" }).nc[i]).not.toBe(0);
  });

  // 'komp' bleibt unveraendert; das sichert das Paritaetsorakel in step-life.test.js.
  it("'off' bleibt die reine B/S-Regel", () => {
    const rnd = mulberry32(31337);
    const col = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (rnd() < 0.4) col[i] = 1 + Math.floor(rnd() * 3);
    const r = schritt({ R, C, col, a5: "off" });
    const NL = r.nb.torus;
    for (let i = 0; i < N; i++) {
      let live = 0; for (let k = 0; k < 6; k++) { const j = NL[i * 6 + k]; if (j >= 0 && col[j] !== 0) live++; }
      expect(r.nc[i] !== 0).toBe(col[i] !== 0 ? S.has(live) : B.has(live));
    }
  });
});
