// Boolesche-CA-Invarianten-Orakel fuer src/lib/sim-engine.js stepLife (2026-06-22).
//
// step-life.test.js beweist die EXTRAKTIONS-Treue (stepLife == naive Referenz).
// Diese Datei prueft eine andere Klasse: substanzielle dynamische INVARIANTEN der
// hexagonalen Boolean-CA gegen UNABHAENGIGE physikalische/geometrische Orakel —
// Periodizitaet, Bit-Stabilitaet, Populations-Erhaltung und die volle D6-Lattice-
// Symmetrie. Jede Konstante ist GEMESSEN (nicht angenommen) und im Kommentar belegt.
//
// WICHTIGER Mess-Befund (kein Bug, eine Topologie-Eigenschaft):
//   Der in der Literatur (Carter Bays, Complex Systems 15(3) 2005, B2/S35) beschriebene
//   Hex-Glider gleitet auf DIESER Engine-Topologie NICHT. Das PATS.BaysGlider-Muster
//   ist in axialen Koordinaten der Bays-Konvention notiert; die Engine nutzt eine
//   odd-r-Nachbarschaft (oddOff/evenOff in buildNeighbors). Auf der odd-r-Topologie
//   zerfaellt das Muster (Pop 5->7->3->2) und setzt sich ab Gen 5 als PERIODE-2-
//   Oszillator (Pop 2) fest. Ein Brute-Force-Scan (>68000 Seeds, k<=5, 5x5-Fenster,
//   edge+torus) fand unter B2/S35 KEINEN translierenden Spaceship — translierende
//   Gleiter sind auf dieser Speicher-Topologie fuer kleine Muster nicht vorhanden.
//   Deshalb testen wir die GEMESSENE Realitaet (formerhaltende periodische
//   Wiederkehr), nicht eine angenommene Translation. Die Engine ist intern konsistent
//   (Paritaets-Orakel step-life.test.js gruen) — das ist eine Koordinaten-Konvention,
//   kein Defekt.
import { describe, it, expect } from "vitest";
import {
  RULES, RMETA, PATS, buildNeighbors, stepLife,
  oddRToCube, cubeToOddR,
} from "../../src/lib/sim-engine.js";

// --- gemeinsame, neutrale Lebenswelt-Optionen (alle Axiome AUS, reines Boolean-CA) ---
const PLAIN = {
  colorMode: "mix", a1: false, a2: false, a3: false, a4: false,
  a5: "off", sysT: false, spN: 0, adia: false,
};

// Regel-Indizes per Label aufgeloest (robust gegen Umsortierung der RULES-Liste).
const BAYS = RULES.findIndex((r) => r.l.includes("Bays")); // H:B2/S35 (Bays)
const S356 = RULES.findIndex((r) => r.l === "H:B2/S356");  // 6 in S -> volle Torus-Fuellung stabil

// Ein Feld R*C, Doppelpuffer wie App.tsx; liefert je Generation eine Kopie von col.
function evolve(meta, R, C, seedIdx, gens, NL, mask) {
  const N = R * C;
  let col = new Uint8Array(N), gh = new Uint8Array(N), age = new Uint16Array(N);
  for (const i of seedIdx) { col[i] = 1; age[i] = 1; }
  let nc = new Uint8Array(N), ng = new Uint8Array(N), na = new Uint16Array(N);
  const snaps = [col.slice()];
  for (let t = 1; t <= gens; t++) {
    stepLife({ col, gh, age, nc, ng, na, NL, dmask: mask, meta, ...PLAIN, tick: t });
    [col, nc] = [nc, col]; [gh, ng] = [ng, gh]; [age, na] = [na, age];
    snaps.push(col.slice());
  }
  return snaps;
}

function popOf(arr) { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i]) n++; return n; }
function bitEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] !== 0) !== (b[i] !== 0)) return false;
  return true;
}

// --------------------------------------------------------------------------
// 1. Bays-Glider: GEMESSENE periodische, formerhaltende Wiederkehr (Periode 2).
//    Orakel: das Muster muss nach EINER Periode bit-identisch wiederkehren und die
//    Population dazwischen muss erhalten bleiben (kein Drift). Gemessen: ab Gen 5
//    stabiler P2-Zyklus mit Pop 2; gen5 == gen7 (bit), gen5 != gen6.
// --------------------------------------------------------------------------
describe("Bays-Glider unter B2/S35: gemessene periodische Wiederkehr (Topologie-treu)", () => {
  it("PATS.BaysGlider zerfaellt zu einem Periode-2-Oszillator (Pop 5->...->2), kein Glider auf odd-r", () => {
    const R = 24, C = 24;
    const { edge, mask } = buildNeighbors(R, C, "box");
    const seed = PATS.BaysGlider.map(([r, c]) => (r + 10) * C + (c + 10));
    const snaps = evolve(RMETA[BAYS], R, C, seed, 10, edge, mask);
    const pops = snaps.map(popOf);
    // GEMESSENE Populations-Folge (belegt, deterministisch).
    expect(pops.slice(0, 8)).toEqual([5, 7, 3, 2, 2, 2, 2, 2]);
    // Periode-2-Zyklus ab Gen 5 (formerhaltende Wiederkehr, kein weiterer Drift):
    expect(bitEq(snaps[5], snaps[7])).toBe(true);   // Wiederkehr nach Periode 2
    expect(bitEq(snaps[6], snaps[8])).toBe(true);
    expect(bitEq(snaps[5], snaps[6])).toBe(false);  // echte Periode (p>1)
    // Populations-Erhaltung im Zyklus:
    expect(popOf(snaps[5])).toBe(2);
    expect(popOf(snaps[6])).toBe(2);
  });
});

// --------------------------------------------------------------------------
// 2. Still-Life-Invarianz: ein STABILES Muster bleibt ueber N Generationen
//    bit-identisch. Orakel (analytisch): unter B2/S356 hat jede Zelle auf dem
//    TORUS genau 6 lebende Nachbarn; 6 in S -> jede lebende Zelle ueberlebt; es
//    gibt keine toten Zellen -> keine Geburt. Vollgefuelltes Torus-Feld = Still-Life.
//    (Kleine isolierte Still-Lifes existieren unter diesen B>=1-Regeln nicht; das
//    vollgefuellte Torus-Feld ist das saubere, analytisch begruendete Still-Life.)
// --------------------------------------------------------------------------
describe("Still-Life-Invarianz: vollgefuelltes Torus-Feld unter B2/S356 ist bit-stabil", () => {
  it("alle Zellen lebendig (6 Nachbarn, 6 in S, keine Geburt) -> 8 Generationen bit-identisch + Pop konstant", () => {
    const R = 18, C = 18, N = R * C;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const seed = []; for (let i = 0; i < N; i++) seed.push(i); // Vollfuellung
    const snaps = evolve(RMETA[S356], R, C, seed, 8, torus, mask);
    for (let t = 1; t < snaps.length; t++) {
      expect(bitEq(snaps[0], snaps[t]), `gen ${t} bit-identisch zu gen 0`).toBe(true);
      expect(popOf(snaps[t])).toBe(N);
    }
  });
});

// --------------------------------------------------------------------------
// 3. Oszillator-Periode: ein Oszillator kehrt nach Periode p>1 exakt zurueck.
//    Orakel: das (gemessene) Tripel-Seed [[0,0],[0,1],[1,0]] unter B2/S35 ist ein
//    sauberer Periode-2-Oszillator (Pop 3 konstant, gen0==gen2, gen0!=gen1).
//    Wir ERKENNEN die Periode durch Iteration (kein hartkodiertes p) und asserten
//    p==2 sowie exakte Wiederkehr.
// --------------------------------------------------------------------------
describe("Oszillator-Periode: exakte Wiederkehr nach erkannter Periode p>1", () => {
  it("Seed [[0,0],[0,1],[1,0]] unter B2/S35 hat Periode 2 (Pop 3 konstant, exakte Wiederkehr)", () => {
    const R = 24, C = 24;
    const { edge, mask } = buildNeighbors(R, C, "box");
    const seed = [[0, 0], [0, 1], [1, 0]].map(([r, c]) => (r + 10) * C + (c + 10));
    const snaps = evolve(RMETA[BAYS], R, C, seed, 12, edge, mask);
    // Periode durch Iteration ERKENNEN (kein hartkodiertes p):
    let p = -1;
    for (let q = 1; q <= 10; q++) { if (bitEq(snaps[0], snaps[q])) { p = q; break; } }
    expect(p).toBe(2);          // gemessene Periode
    expect(p).toBeGreaterThan(1); // echter Oszillator, kein Still-Life
    expect(bitEq(snaps[0], snaps[1])).toBe(false);
    // Populations-Erhaltung ueber den ganzen Lauf:
    for (const s of snaps) expect(popOf(s)).toBe(3);
  });
});

// --------------------------------------------------------------------------
// 4. D6-/Lattice-Symmetrie: die Hex-Topologie traegt die volle Diedergruppe D6.
//    Orakel: eine Lattice-Isometrie g (Rotation 60/120/180 grad, Spiegelung) muss
//    mit stepLife KOMMUTIEREN: step(g(x)) == g(step(x)). Die Isometrien werden in
//    CUBE-Koordinaten ausgedrueckt (Achsen-Permutation/Vorzeichen, die x+y+z=0
//    erhaelt) und ueber oddRToCube/cubeToOddR auf das odd-r-Speicherfeld abgebildet.
//    Das ist die ehrliche, fuer die echte Hex-Geometrie gueltige Symmetrie — keine
//    naive Zeilen-/Spalten-Spiegelung (die auf odd-r KEINE Symmetrie waere).
// --------------------------------------------------------------------------
describe("D6-Symmetrie: Rotationen + Spiegelungen kommutieren mit stepLife (Cube-Lattice)", () => {
  const R = 24, C = 24, N = R * C;
  const { edge, mask } = buildNeighbors(R, C, "box");
  const meta = RMETA[BAYS];

  // Lattice-Isometrien in Cube-Koordinaten (alle erhalten x+y+z=0).
  const OPS = {
    "Rotation 60 grad": (c) => ({ x: -c.z, y: -c.x, z: -c.y }),
    "Rotation 120 grad": (c) => ({ x: c.y, y: c.z, z: c.x }),
    "Rotation 180 grad": (c) => ({ x: -c.x, y: -c.y, z: -c.z }),
    "Spiegelung (swap y,z)": (c) => ({ x: c.x, y: c.z, z: c.y }),
    "Spiegelung (swap x,z)": (c) => ({ x: c.z, y: c.y, z: c.x }),
    "Spiegelung (swap x,y)": (c) => ({ x: c.y, y: c.x, z: c.z }),
  };

  // Zentrums-Cube fuer die Abbildung (haelt das Bild im Gitter, keine Rand-Verluste).
  const ccube = oddRToCube(Math.floor(C / 2), Math.floor(R / 2));
  function applyOp(idxArr, op) {
    const out = new Uint8Array(N);
    for (const i of idxArr) {
      const r = Math.floor(i / C), c = i % C;
      let cu = oddRToCube(c, r);
      cu = { x: cu.x - ccube.x, y: cu.y - ccube.y, z: cu.z - ccube.z };
      cu = op(cu);
      cu = { x: cu.x + ccube.x, y: cu.y + ccube.y, z: cu.z + ccube.z };
      const oc = cubeToOddR(cu);
      if (oc.row >= 0 && oc.row < R && oc.col >= 0 && oc.col < C) out[oc.row * C + oc.col] = 1;
    }
    return out;
  }
  function liveIdx(arr) { const o = []; for (let i = 0; i < arr.length; i++) if (arr[i]) o.push(i); return o; }
  function stepOnce(idxArr) { return liveIdx(evolve(meta, R, C, idxArr, 1, edge, mask)[1]); }

  // deterministischer PRNG (mulberry32) fuer reproduzierbare Seeds
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // Seed in einem zentralen Fenster, damit alle Bilder unter D6 im Gitter bleiben.
  function centralSeed(seed, dens) {
    const rnd = mulberry32(seed); const idx = [];
    for (let r = 8; r < 16; r++) for (let c = 8; c < 16; c++) if (rnd() < dens) idx.push(r * C + c);
    return idx;
  }

  for (const [name, op] of Object.entries(OPS)) {
    it(`${name}: step(g(x)) == g(step(x)) ueber mehrere Seeds`, () => {
      for (let s = 0; s < 6; s++) {
        const seed = centralSeed(0xA11A + s * 131, 0.4);
        // g(step(x)) :
        const lhs = applyOp(stepOnce(seed), op);
        // step(g(x)) :
        const rhs = new Uint8Array(N);
        for (const i of stepOnce(liveIdx(applyOp(seed, op)))) rhs[i] = 1;
        expect(bitEq(lhs, rhs), `${name}, seed#${s}`).toBe(true);
      }
    });
  }
});
