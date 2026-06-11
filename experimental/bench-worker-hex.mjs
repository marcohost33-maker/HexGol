// Bench: Worker-Hex-Pfad (src/lib/hex-render.js) MIT vs OHNE Viewport-Culling,
// auf dem 5XL-Gitter (500x500 = 250'000 Zellen) HINEINGEZOOMT (pxR>=2). Belegt die
// load-bearing Perf-Behauptung der dauerhaften 5XL-Quadrate-Bug-Loesung:
//   "Hex-Pfad auf 250k ist nur dank Culling tragbar -- ohne Culling emittiert er
//    Vertices fuer alle 250k Zellen pro Frame (Freeze, gegen den der Raster-Pfad
//    urspruenglich gebaut war); mit Culling nur fuer die ~Viewport-Zahl Zellen."
//
// node-canvas ist nicht installiert -> wie experimental/bench-render-paths.mjs wird
// die CPU-seitige Vertex-Emission gemessen (moveTo + 5x lineTo = 6 Ecken/Zelle,
// addHexIdx-Arithmetik). Das ist die UNTERE SCHRANKE; das echte ctx.fill() von N
// Subpaths kommt obendrauf und skaliert ebenfalls mit der Zahl emittierter Zellen
// -> Culling, das die emittierte Zahl kappt, kappt BEIDE Kosten.
//
// Determinismus: festes Gitter, feste View, alle Zellen aktiv (Worst-Case life-Voll).

const ROWS = 500, COLS = 500, N = ROWS * COLS; // 5XL = 250'000
const hr = 1.3;                                 // 5XL hr (GRID_SIZES)
const s = 2.6;                                  // hineingezoomt: pxR = hr*s = 3.38 >= 2 -> Hex
const dpr = 3;                                  // iPhone-Klasse
const Wc = 360 * dpr, Hc = 700 * dpr;           // schmaler Hochkant-Canvas (Geraete-px)
const FRAMES = 60;

// Welt-Zentren wie cellCxRef/cellCyRef (hexCenter). Tx/ty so, dass die Bildmitte
// auf die Gittermitte zeigt (realer Hineinzoom-Fall: User schaut auf eine Region).
const S3 = Math.sqrt(3);
const CX = new Float32Array(N), CY = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const row = (i / COLS) | 0, c = i - row * COLS;
  CX[i] = 1.3 * 1.3 /*pad*/ + S3 * hr * (c + ((row & 1) ? 0.5 : 0));
  CY[i] = 1.3 * 1.3 + 1.5 * hr * row;
}
// Auf Gittermitte zentrieren (CSS-px-Transform: xCss = CX*s + tx).
const midCx = CX[(N / 2) | 0], midCy = CY[(N / 2) | 0];
const cwCss = Wc / dpr, chCss = Hc / dpr;
const tx = cwCss / 2 - midCx * s, ty = chCss / 2 - midCy * s;

const cosA = [], sinA = [];
for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * (Math.PI / 3); cosA.push(Math.cos(a)); sinA.push(Math.sin(a)); }

// Culling-Grenzen in Welt-Koordinaten (identisch zu renderHex).
const margin = hr * 1.3;
const wx0 = (0 - tx) / s - margin, wx1 = (cwCss - tx) / s + margin;
const wy0 = (0 - ty) / s - margin, wy1 = (chCss - ty) / s + margin;
const visible = (i) => { const x = CX[i], y = CY[i]; return x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1; };

function emitHex(i, rr, accAdd) { const x = CX[i], y = CY[i]; let s2 = 0; s2 += x + rr * cosA[0] + y + rr * sinA[0]; for (let k = 1; k < 6; k++) s2 += x + rr * cosA[k] + y + rr * sinA[k]; return accAdd + s2; }

function bench(withCulling) {
  let sink = 0;
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    for (let i = 0; i < N; i++) {
      if (withCulling && !visible(i)) continue;
      sink = emitHex(i, hr * 0.92, sink);
    }
  }
  const dt = performance.now() - t0;
  if (sink === -1) console.log("noopt");
  return dt;
}

// Zahl sichtbarer Zellen (das ist die Culling-Ersparnis).
let vis = 0; for (let i = 0; i < N; i++) if (visible(i)) vis++;

bench(true); bench(false); // Warmup (JIT)
const culled = bench(true), full = bench(false);
console.log(JSON.stringify({
  config: { grid: "5XL", rows: ROWS, cols: COLS, N, hr, s, pxR: +(hr * s).toFixed(2), dpr, canvas: `${Wc}x${Hc}`, frames: FRAMES },
  visibleCells: vis,
  cullPercent: +((1 - vis / N) * 100).toFixed(1),
  withCulling_ms_per_frame: +(culled / FRAMES).toFixed(3),
  withoutCulling_ms_per_frame: +(full / FRAMES).toFixed(3),
  speedup_x: +(full / culled).toFixed(1),
  note: "Vertex-CPU untere Schranke; echtes ctx.fill() von ~N Subpaths skaliert ebenfalls mit emittierter Zellzahl -> Culling kappt beide. Ohne Culling = Freeze-Klasse.",
}, null, 2));
