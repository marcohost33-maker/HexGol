// Bench: ImageData-Fast-Path vs Path2D-Vertex-Emission fuer winzige Zellen (XXL).
// Reproduzierbar, deterministisch. Misst die zwei RENDER-Hotpaths, die im
// draw(false)-Vollredraw von GolHex konkurrieren, sodass die Koexistenz-Routing-
// Entscheidung (Fast-Path bei hr*s<3.5 vs v31-Path2D-Buckets) mit Zahlen belegt ist.
//
// node-canvas ist hier nicht installiert -> ctx.fill() laesst sich nicht real
// timen. Daher werden die zwei CPU-seitigen Arbeitslasten gemessen, die jeder
// Pfad PRO FRAME erzwingt (das dominiert; der finale GPU-Blit ist in beiden ~gleich):
//   A) ImageData: d32.fill(bg) + pro aktiver Zelle ein (2*half+1)^2-Pixel-Block.
//   B) Path2D:    pro aktiver Zelle moveTo + 5x lineTo + closePath (7 Vertex-Ops),
//                 plus Float32-Trig pro Vertex (addHexIdx-Modell).
// XXL = 200x250 = 50000 Zellen; Snow/Water fuellen ~das ganze Feld.

const ROWS = 200, COLS = 250, N = ROWS * COLS;
const Wc = 1600, Hc = 1000;            // typ. Canvas-Pixel (DPR=1, breit)
const s = 0.4;                          // XXL-Fit-Scale (rausgezoomt)
const hr = 2.5;                         // XXL hr (GRID_SIZES)
const pxR = hr * s;                     // = 1.0 px/Zelle -> < 3.5 -> Fast-Path-Zone
const half = Math.max(0, Math.floor(hr * s * 0.72)); // wie drawRaster (DPR=1)
const FRAMES = 120;

// Welt-Zentren (einmal, wie cellCxRef/cellCyRef) + aktive Maske (Snow-Vollfeld).
const CX = new Float32Array(N), CY = new Float32Array(N), active = new Uint8Array(N);
const S3 = Math.sqrt(3);
for (let i = 0; i < N; i++) {
  const row = (i / COLS) | 0, c = i - row * COLS;
  CX[i] = S3 * hr * (c + ((row & 1) ? 0.5 : 0));
  CY[i] = 1.5 * hr * row;
  active[i] = 1; // Snow-Vollfeld: alle Zellen aktiv (Worst-Case fuer Path2D)
}
const tx = 50, ty = 30, packed = 0xff204060;

function benchImageData() {
  const img = new Uint32Array(Wc * Hc);
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    img.fill(0xff020608);
    for (let i = 0; i < N; i++) {
      if (!active[i]) continue;
      const px = Math.round((CX[i] * s + tx)), py = Math.round((CY[i] * s + ty));
      let y0 = py - half, y1 = py + half, x0 = px - half, x1 = px + half;
      if (y0 < 0) y0 = 0; if (y1 >= Hc) y1 = Hc - 1; if (x0 < 0) x0 = 0; if (x1 >= Wc) x1 = Wc - 1;
      for (let yy = y0; yy <= y1; yy++) { const r = yy * Wc; for (let xx = x0; xx <= x1; xx++) img[r + xx] = packed; }
    }
  }
  return performance.now() - t0;
}

// Path2D-Modell: die CPU-Kosten der Vertex-Emission (Trig + 7 Pfad-Ops/Zelle).
// Wir koennen Path2D in Node nicht instanziieren -> emulieren in ein Sink-Array,
// inkl. exakt der addHexIdx-Arithmetik (6 cos/sin praeberechnet, 6 Ecken).
function benchPath2D() {
  const cosA = [], sinA = [];
  for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * (Math.PI / 3); cosA.push(Math.cos(a)); sinA.push(Math.sin(a)); }
  let sink = 0;
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    for (let i = 0; i < N; i++) {
      if (!active[i]) continue;
      const x = CX[i], y = CY[i], rr = hr * 0.95;
      // moveTo + 5 lineTo + closePath  (Vertex-Arithmetik wie addHexIdx)
      sink += x + rr * cosA[0] + y + rr * sinA[0];
      for (let k = 1; k < 6; k++) sink += x + rr * cosA[k] + y + rr * sinA[k];
    }
  }
  const dt = performance.now() - t0;
  if (sink === -1) console.log("noopt");
  return dt;
}

// Warmup (JIT)
benchImageData(); benchPath2D();
const a = benchImageData(), b = benchPath2D();
const activeCount = active.reduce((s, v) => s + v, 0);
console.log(JSON.stringify({
  config: { rows: ROWS, cols: COLS, N, activeCount, pxR, half, frames: FRAMES, canvas: `${Wc}x${Hc}` },
  imageData_ms_total: +a.toFixed(1), imageData_ms_per_frame: +(a / FRAMES).toFixed(3),
  path2d_vertexcpu_ms_total: +b.toFixed(1), path2d_vertexcpu_ms_per_frame: +(b / FRAMES).toFixed(3),
  note: "path2d_vertexcpu ist NUR CPU-Vertex-Emission (untere Schranke); echtes ctx.fill() von ~50k Subpaths kommt obendrauf (in-lineage v30: 18k Subpaths=0.7fps)."
}, null, 2));
