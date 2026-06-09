// Micro-Benchmark: optimierter stepLife (wiederverwendetes cnt-Int32Array, maxN
// nur bei A5 sym/komp) vs. naive Variante (frisches cnt-Array je Zelle, maxN
// immer). Misst den booleschen Kern-Schritt direkt (jetzt pure/exportiert).
//   node experimental/bench-step-life.mjs
import {
  stepLife, buildNeighbors, RMETA,
  COSH, SINH, hexClass2, birthColorQuad, cMixVec, mMixCnt, driftHue, hash2, PRIMARY,
} from "../src/lib/sim-engine.js";

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
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let live = 0, sx = 0, sy = 0, mask = 0;
    const self = col[i], selfAlive = self !== 0;
    for (let k = 0; k < 6; k++) {
      const j = NL[base + k];
      if (j < 0) { if (adia) { if (selfAlive) { cnt[self]++; live++; sx += COSH[self]; sy += SINH[self]; mask |= (1 << k); } else if (a4 && gh[i]) live++; } continue; }
      const cj = col[j];
      if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); } else if (a4 && gh[j]) live++;
    }
    const cntSelf = selfAlive ? cnt[self] : 0;
    let maxN = 0; for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c];
    let eff = live;
    if (A5 === "sym") eff = selfAlive ? cntSelf : maxN; else if (A5 === "komp") eff = selfAlive ? live - cntSelf : live - maxN;
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
      if (ok) { born = true; if (colorMode === "quad") newC = birthColorQuad(cnt, sx, sy); else if (a2) newC = mMixCnt(cnt, i); else newC = cMixVec(sx, sy, i); }
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

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function bench(label, fn, R, C, gens, optsBase) {
  const N = R * C;
  const { torus, mask } = buildNeighbors(R, C, "box");
  const rnd = mulberry32(12345);
  let col = new Uint8Array(N), gh = new Uint8Array(N), age = new Uint16Array(N);
  for (let i = 0; i < N; i++) if (rnd() < 0.3) { col[i] = 1 + Math.floor(rnd() * 12); age[i] = 1 + Math.floor(rnd() * 10); }
  let nc = new Uint8Array(N), ng = new Uint8Array(N), na = new Uint16Array(N);
  // Warmup
  for (let t = 0; t < 5; t++) { fn({ col, gh, age, nc, ng, na, NL: torus, dmask: mask, ...optsBase, tick: t + 1 }); [col, nc] = [nc, col]; [gh, ng] = [ng, gh]; [age, na] = [na, age]; }
  const t0 = performance.now();
  for (let t = 0; t < gens; t++) { fn({ col, gh, age, nc, ng, na, NL: torus, dmask: mask, ...optsBase, tick: t + 1 }); [col, nc] = [nc, col]; [gh, ng] = [ng, gh]; [age, na] = [na, age]; }
  const dt = performance.now() - t0;
  console.log(`${label.padEnd(28)} ${R}x${C}=${N}  ${gens} gen  ->  ${dt.toFixed(1)} ms total, ${(dt / gens).toFixed(3)} ms/gen`);
  return dt;
}

const cfgs = [
  { name: "Default (a5=off,quad)", opts: { meta: RMETA[0], colorMode: "quad", a1: false, a2: false, a3: false, a4: false, a5: "off", sysT: false, spN: 0, adia: false } },
  { name: "A5=sym,quad,a4", opts: { meta: RMETA[0], colorMode: "quad", a1: false, a2: false, a3: false, a4: true, a5: "sym", sysT: false, spN: 0, adia: false } },
];
for (const { name, R, C } of [{ R: 300, C: 300 }, { R: 500, C: 500 }]) {
  for (const cfg of cfgs) {
    console.log(`\n--- ${cfg.name} @ ${R}x${C} ---`);
    const opt = bench("stepLife (optimiert)", stepLife, R, C, 60, cfg.opts);
    const nai = bench("stepLifeNaive", stepLifeNaive, R, C, 60, cfg.opts);
    console.log(`  Speedup: ${(nai / opt).toFixed(2)}x`);
  }
}
