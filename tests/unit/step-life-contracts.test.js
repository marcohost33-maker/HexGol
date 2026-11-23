// Semantische Vertraege von stepLife, unabhaengig vom Paritaetsorakel.
//
// step-life.test.js vergleicht die Engine mit einer naiven KOPIE derselben Logik --
// ein Fehler, der in beiden steht, faellt dort nicht auf. Diese Suite prueft
// stattdessen beobachtbare Eigenschaften gegen das Ergebnis selbst.

import { describe, it, expect } from "vitest";
import { stepLife, buildNeighbors, RMETA, INT_META, hexClass2 } from "../../src/lib/sim-engine.js";

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

// INT (Callahan o/m/p) bei genau 2 Nachbarn: die Klasse ist der WINKEL zwischen den
// beiden Nachbarn (o = 60 Grad, m = 120 Grad, p = 180 Grad; Kommentar in sim-engine).
// Die Bits der Maske folgen aber der Tabellen-Reihenfolge von buildNeighbors
// (oben-links, oben-rechts, links, rechts, unten-links, unten-rechts) -- nicht dem
// Umlauf. Orakel hier: echte Weltkoordinaten der Nachbarzellen.
describe("INT: hexClass2 klassifiziert nach dem geometrischen Winkel", () => {
  const S3 = Math.sqrt(3);
  const welt = (r, c) => [(c + ((r & 1) ? 0.5 : 0)) * S3, r * 1.5];
  for (const row of [4, 5]) {
    it(`alle 15 Nachbarpaare stimmen mit dem Winkel ueberein (Reihe ${row}, ${row & 1 ? "ungerade" : "gerade"})`, () => {
      const R = 10, C = 10, c = 4, i = row * C + c;
      const nb = buildNeighbors(R, C, "box");
      const [x0, y0] = welt(row, c);
      const dirs = Array.from({ length: 6 }, (_, k) => {
        const j = nb.edge[i * 6 + k];
        const [x, y] = welt((j / C) | 0, j % C);
        return [x - x0, y - y0];
      });
      let n = 0;
      for (let a = 0; a < 6; a++) {
        for (let b = a + 1; b < 6; b++) {
          const [ax, ay] = dirs[a], [bx, by] = dirs[b];
          const grad = Math.round((Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))) * 180) / Math.PI);
          const soll = grad === 60 ? "o" : grad === 120 ? "m" : grad === 180 ? "p" : `?${grad}`;
          expect(hexClass2((1 << a) | (1 << b)), `Paar ${a}/${b}`).toBe(soll);
          n++;
        }
      }
      expect(n).toBe(15);
    });
  }
});

// A4-Geister zaehlen als Nachbar (live++), fehlten aber in der Richtungsmaske:
// bei genau 2 Nachbarn, davon ein Geist, lieferte hexClass2 null -> jede
// INT-Bedingung sperrte still, egal wie die beiden lagen.
describe("INT + A4: ein Geist-Nachbar zaehlt auch fuer die Anordnung", () => {
  const R = 10, C = 10, N = R * C;
  const nb = buildNeighbors(R, C, "box");
  const i = 4 * C + 4;
  const nach = (k) => nb.edge[i * 6 + k];
  // k=0 (oben-links) und k=1 (oben-rechts) liegen 60 Grad auseinander -> "o".
  it("Positivkontrolle: zwei lebende o-Nachbarn gebaeren unter INT B2o", () => {
    const col = new Uint8Array(N); col[nach(0)] = 1; col[nach(1)] = 1;
    expect(schritt({ R, C, col, torus: false, meta: INT_META[0] }).nc[i]).not.toBe(0);
  });
  it("lebend + Geist in o-Anordnung gebaeren unter INT B2o mit A4", () => {
    const col = new Uint8Array(N), gh = new Uint8Array(N);
    col[nach(0)] = 1; gh[nach(1)] = 1;
    expect(schritt({ R, C, col, gh, torus: false, a4: true, meta: INT_META[0] }).nc[i]).not.toBe(0);
  });
  it("lebend + Geist in p-Anordnung gebaeren unter INT B2o NICHT", () => {
    const col = new Uint8Array(N), gh = new Uint8Array(N);
    // k=2 (links) und k=3 (rechts) liegen 180 Grad auseinander.
    col[nach(2)] = 1; gh[nach(3)] = 1;
    expect(schritt({ R, C, col, gh, torus: false, a4: true, meta: INT_META[0] }).nc[i]).toBe(0);
  });
});
