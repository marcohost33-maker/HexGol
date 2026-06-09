// Parity-Orakel fuer den extrahierten booleschen Life-Schritt (src/lib/sim-engine
// stepLife, 2026-06-08). stepLife wurde aus src/App.tsx step() herausgeloest und
// dabei optimiert (wiederverwendetes cnt-Int32Array statt N Array-Literale je
// Generation; maxN-Scan nur bei A5 sym/komp). Dieser Test beweist, dass die
// Optimierungen VERHALTENS-ERHALTEND sind: eine NAIVE Referenz (frisches cnt-Array
// pro Zelle, maxN immer berechnet) muss ueber zufaellige Regeln, Achsen, Formen,
// Topologien und viele Generationen BIT-IDENTISCHE Ausgaben (nc/ng/na + Statistik)
// liefern. Schlaegt der Test fehl, ist die Extraktion nicht mehr faithful.
import { describe, it, expect } from "vitest";
import {
  stepLife, buildNeighbors, RMETA, INT_META, WATZ_META,
  COSH, SINH, hexClass2, birthColorQuad, cMixVec, mMixCnt, driftHue, hash2, PRIMARY,
} from "../../src/lib/sim-engine.js";

// --- Naive Referenz (bewusst un-optimiert: belegt cnt frisch, scannt maxN immer) ---
function stepLifeNaive(g) {
  const { col, gh, age, nc, ng, na, NL, dmask, meta } = g;
  const colorMode = g.colorMode, a1 = g.a1, a2 = g.a2, a3 = g.a3, a4 = g.a4;
  const A5 = g.a5, sysT = g.sysT, spN = g.spN, adia = g.adia, tick = g.tick;
  const { bL, sL, smin, smax } = meta;
  const isINT = !!meta.isINT, b2 = meta.b2 || null, s2 = meta.s2 || null;
  const n = col.length; let births = 0, deaths = 0;
  for (let i = 0; i < n; i++) {
    if (dmask[i] === 0) { nc[i] = 0; ng[i] = 0; na[i] = 0; continue; }
    const base = i * 6;
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // frisch je Zelle
    let live = 0, sx = 0, sy = 0, mask = 0;
    const self = col[i], selfAlive = self !== 0;
    for (let k = 0; k < 6; k++) {
      const j = NL[base + k];
      if (j < 0) {
        if (adia) {
          if (selfAlive) { cnt[self]++; live++; sx += COSH[self]; sy += SINH[self]; mask |= (1 << k); }
          else if (a4 && gh[i]) live++;
        }
        continue;
      }
      const cj = col[j];
      if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); }
      else if (a4 && gh[j]) live++;
    }
    const cntSelf = selfAlive ? cnt[self] : 0;
    let maxN = 0; for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c]; // immer
    let eff = live;
    if (A5 === "sym") eff = selfAlive ? cntSelf : maxN;
    else if (A5 === "komp") eff = selfAlive ? live - cntSelf : live - maxN;
    let born = false, newC = 0;
    if (selfAlive) {
      let surv = eff <= 6 && sL[eff] === 1;
      if (surv && isINT && eff === 2 && s2 && !s2.includes(hexClass2(mask))) surv = false;
      if (!surv && a3 && age[i] >= 6 && eff >= smin - 1 && eff <= smax + 1) surv = true;
      if (sysT) { if (!surv && live > 0 && live < spN) surv = true; else if (surv && live > spN + 1) surv = false; }
      if (surv) { born = true; newC = (colorMode === "drift" && live > 0) ? driftHue(self, sx, sy) : self; }
    } else if (live > 0 && eff >= 0 && eff <= 6 && bL[eff] === 1) {
      let ok = true;
      if (isINT && eff === 2 && b2 && !b2.includes(hexClass2(mask))) ok = false;
      if (sysT && live > spN) ok = false;
      if (ok) {
        born = true;
        if (colorMode === "quad") newC = birthColorQuad(cnt, sx, sy);
        else if (a2) newC = mMixCnt(cnt, i);
        else newC = cMixVec(sx, sy, i);
      }
    }
    if (born) { nc[i] = newC; ng[i] = 0; na[i] = selfAlive ? (age[i] < 65535 ? age[i] + 1 : 65535) : 1; if (!selfAlive) births++; }
    else { na[i] = 0; if (selfAlive) deaths++; if (selfAlive && a4) { nc[i] = 0; ng[i] = 1; } else { nc[i] = 0; ng[i] = 0; } }
  }
  if (a1) {
    for (let i = 0; i < n; i++) {
      if (nc[i] !== 0 || ng[i] !== 0 || col[i] !== 0) continue;
      const base = i * 6; let silent = true;
      for (let k = 0; k < 6; k++) { const j = NL[base + k]; if (j < 0) continue; if (col[j] !== 0 || (a4 && gh[j])) { silent = false; break; } }
      if (silent && hash2(i, tick) < 0.012) { nc[i] = PRIMARY[Math.floor(hash2(i + 7, tick * 3 + 1) * 3)]; na[i] = 1; }
    }
  }
  return { births, deaths };
}

// kleiner deterministischer PRNG (mulberry32) fuer reproduzierbare Startfelder
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeState(N, rnd, density) {
  const col = new Uint8Array(N), gh = new Uint8Array(N), age = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    if (rnd() < density) { col[i] = 1 + Math.floor(rnd() * 12); age[i] = 1 + Math.floor(rnd() * 10); }
    else if (rnd() < 0.1) gh[i] = 1; // einige Geisterzellen fuer A4-Pfade
  }
  return { col, gh, age };
}

function runGenerations(neigh, dmask, init, opts, gens) {
  const N = init.col.length;
  // Doppelpuffer wie in App.tsx (Refs werden getauscht)
  let col = init.col.slice(), gh = init.gh.slice(), age = init.age.slice();
  let nc = new Uint8Array(N), ng = new Uint8Array(N), na = new Uint16Array(N);
  const stats = [];
  for (let t = 1; t <= gens; t++) {
    const s = opts.fn({
      col, gh, age, nc, ng, na, NL: neigh, dmask,
      meta: opts.meta, colorMode: opts.colorMode,
      a1: opts.a1, a2: opts.a2, a3: opts.a3, a4: opts.a4,
      a5: opts.a5, sysT: opts.sysT, spN: opts.spN, adia: opts.adia, tick: t,
    });
    stats.push(s.births, s.deaths);
    [col, nc] = [nc, col]; [gh, ng] = [ng, gh]; [age, na] = [na, age];
  }
  return { col, gh, age, stats };
}

describe("stepLife — Extraktion + Optimierung byte-identisch zur naiven Referenz", () => {
  const metas = [
    { name: "RMETA[0] B2/S34", meta: RMETA[0] },
    { name: "RMETA[3] B3/S34", meta: RMETA[3] },
    { name: "INT_META[0] B2o/S2", meta: INT_META[0] },
    { name: "INT_META[2] B2p/S2o", meta: INT_META[2] },
    { name: "WATZ_META B23/S12345", meta: WATZ_META },
  ];
  const shapes = ["box", "circle", "hexagon"];
  const a5opts = ["off", "sym", "komp"];
  const colorModes = ["quad", "drift", "mix"];

  let combo = 0;
  for (const { name, meta } of metas) {
    for (const shape of shapes) {
      for (const a5 of a5opts) {
        // colorMode + Achsen-Flags je Kombo deterministisch variieren
        const cm = colorModes[combo % colorModes.length];
        const torus = (combo % 2) === 0;
        const opts = {
          meta, colorMode: cm,
          a1: (combo % 3) === 0, a2: (combo % 4) === 0,
          a3: (combo % 2) === 0, a4: (combo % 5) !== 0,
          a5, sysT: (combo % 6) === 0, spN: 3,
          adia: (combo % 7) === 0,
        };
        combo++;
        it(`${name} | ${shape} | a5=${a5} | cm=${cm} | torus=${torus}`, () => {
          const R = 14, C = 16;
          const { edge, torus: tor, mask } = buildNeighbors(R, C, shape);
          const NL = torus ? tor : edge;
          const rnd = mulberry32(0x1234 + combo * 7919);
          const init = makeState(R * C, rnd, 0.4);
          const a = runGenerations(NL, mask, init, { ...opts, fn: stepLife }, 25);
          const b = runGenerations(NL, mask, init, { ...opts, fn: stepLifeNaive }, 25);
          expect(Array.from(a.col)).toEqual(Array.from(b.col));
          expect(Array.from(a.gh)).toEqual(Array.from(b.gh));
          expect(Array.from(a.age)).toEqual(Array.from(b.age));
          expect(a.stats).toEqual(b.stats);
        });
      }
    }
  }

  it("cnt-Wiederverwendung: aufeinanderfolgende Zellen lecken keine Zaehlung (B2/S34, dichtes Feld)", () => {
    // Regressionsschutz speziell fuer den wiederverwendeten cnt-Puffer: ein nicht
    // sauber geleerter Puffer wuerde Farben/Counts der Vorzelle in die naechste
    // tragen -> hier mit maximaler Dichte (jede Zelle belebt) am ehesten sichtbar.
    const R = 20, C = 22;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const rnd = mulberry32(99991);
    const init = makeState(R * C, rnd, 0.95);
    const opts = { meta: RMETA[0], colorMode: "quad", a1: false, a2: false, a3: false, a4: true, a5: "sym", sysT: false, spN: 0, adia: true };
    const a = runGenerations(torus, mask, init, { ...opts, fn: stepLife }, 30);
    const b = runGenerations(torus, mask, init, { ...opts, fn: stepLifeNaive }, 30);
    expect(Array.from(a.col)).toEqual(Array.from(b.col));
    expect(a.stats).toEqual(b.stats);
  });
});
