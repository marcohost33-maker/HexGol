// =============================================================================
// hex.js - Pure functions for HexGol's hexagonal Game of Life.
//
// Extracted from App.jsx so that hex math, pattern classification and grid
// construction can be unit-tested without a DOM. The extraction is purely
// mechanical: every export here is a pure function whose output depends
// only on its arguments. No mutable module-scope state, no side effects.
// =============================================================================

export const S3 = Math.sqrt(3);

// Color indices for cells. C0 means dead.
export const C0 = 0, CR = 1, CB = 2, CY = 3;

// Animation timing thresholds. ALIVE_T is the age value for a fully-alive
// cell; trail cells decay from ALIVE_T toward zero in steps of FADE.
export const ALIVE_T = 200;
export const FADE = 8;

const PI2 = Math.PI * 2;
const PI3 = Math.PI / 3;
const cosR = 1, sinR = 0;
const cosB = Math.cos(PI2 / 3), sinB = Math.sin(PI2 / 3);
const cosY = Math.cos(4 * PI3),  sinY = Math.sin(4 * PI3);

// Trail-fade buckets indexed by age. Each bucket has an alpha value used
// by the sprite/stamp rendering paths.
export const TB = [
  { min:   1, max:  50, a: 0.12 },
  { min:  51, max: 100, a: 0.25 },
  { min: 101, max: 150, a: 0.42 },
  { min: 151, max: 199, a: 0.65 },
];

// Rule definitions. B = birth counts, S = survival counts.
export const RULES = [
  { l: "B2/S34",   B: [2],    S: [3, 4]    },
  { l: "B2/S35",   B: [2],    S: [3, 5]    },
  { l: "B2/S23",   B: [2],    S: [2, 3]    },
  { l: "B3/S34",   B: [3],    S: [3, 4]    },
  { l: "B3/S23",   B: [3],    S: [2, 3]    },
  { l: "B2/S245",  B: [2],    S: [2, 4, 5] },
  { l: "B12/S34",  B: [1, 2], S: [3, 4]    },
  { l: "B2/S45",   B: [2],    S: [4, 5]    },
  { l: "B1/S34",   B: [1],    S: [3, 4]    },
  { l: "B12/S23",  B: [1, 2], S: [2, 3]    },
  { l: "B23/S34",  B: [2, 3], S: [3, 4]    },
  { l: "B2/S356",  B: [2],    S: [3, 5, 6] },
  { l: "B34/S23",  B: [3, 4], S: [2, 3]    },
  { l: "B13/S34",  B: [1, 3], S: [3, 4]    },
  { l: "B24/S34",  B: [2, 4], S: [3, 4]    },
  { l: "B1/S245",  B: [1],    S: [2, 4, 5] },
];

// Pre-computed birth/survival lookup tables - hot-loop sentinel checks.
export const birthLUT = [];
export const survLUT  = [];
for (let ri = 0; ri < RULES.length; ri++) {
  const bL = new Uint8Array(7), sL = new Uint8Array(7);
  for (const b of RULES[ri].B) if (b < 7) bL[b] = 1;
  for (const s of RULES[ri].S) if (s < 7) sL[s] = 1;
  birthLUT.push(bL);
  survLUT.push(sL);
}

// Age-to-bucket lookup. -1 means dead.
export const ageBucket = new Int8Array(ALIVE_T);
ageBucket.fill(-1);
for (let b = 0; b < TB.length; b++) {
  for (let a = TB[b].min; a <= TB[b].max; a++) ageBucket[a] = b;
}

// Pre-computed unit-vector cos/sin for the six hex corners (pointy-top).
export const HC6 = new Float64Array(6);
export const HS6 = new Float64Array(6);
for (let i = 0; i < 6; i++) {
  const a = -Math.PI / 2 + i * PI3;
  HC6[i] = Math.cos(a);
  HS6[i] = Math.sin(a);
}

// Neighbor offsets for odd-r layout. Even rows shift differently from odd.
export const oddOff  = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
export const evenOff = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];

// =============================================================================
// buildGrid: construct an immutable description of a R x C odd-r grid.
//
// Returns precomputed neighbor index tables (NLE = edge-clamped, NLW = torus
// wrap) and pixel-space cell centers. Both N tables are flat Int32Array of
// length N*6 to allow tight inner loops in step().
// =============================================================================
export function buildGrid(R, C, HR) {
  const N = R * C;
  const GW = C * S3 * HR + HR;
  const GH = R * 1.5 * HR + HR;
  const NLE = new Int32Array(N * 6);
  const NLW = new Int32Array(N * 6);

  for (let r = 0; r < R; r++) {
    const off = (r & 1) ? oddOff : evenOff;
    for (let c = 0; c < C; c++) {
      const b = (r * C + c) * 6;
      for (let k = 0; k < 6; k++) {
        const nr = r + off[k][0];
        const nc = c + off[k][1];
        NLE[b + k] = (nr >= 0 && nr < R && nc >= 0 && nc < C) ? nr * C + nc : -1;
        const wr = ((nr % R) + R) % R;
        const wrOff = (wr & 1) ? oddOff : evenOff;
        const wc = c + wrOff[k][1];
        NLW[b + k] = wr * C + (((wc % C) + C) % C);
      }
    }
  }

  const cen = new Float32Array(N * 2);
  const vStep = 1.5 * HR, wStep = S3 * HR;
  let idx = 0;
  for (let r = 0; r < R; r++) {
    const xs = (r & 1) ? wStep * 0.5 : 0;
    for (let c = 0; c < C; c++) {
      cen[idx++] = xs + c * wStep + wStep * 0.5;
      cen[idx++] = r * vStep + HR;
    }
  }

  return {
    N, ROWS: R, COLS: C, HR,
    GRID_W: GW, GRID_H: GH,
    NLE, NLW,
    centers: cen,
    vStep, wStep,
  };
}

// =============================================================================
// pixelToOddR: canonical Red Blob Games pixel-to-hex picker.
// Reference: https://www.redblobgames.com/grids/hexagons/ (Amit Patel).
// Returns -1 when the world point falls outside the grid bounds.
// =============================================================================
export function pixelToOddR(wx, wy, HR, ROWS, COLS) {
  const wStep = S3 * HR;
  // Translate world coords so axial origin (q=0, r=0) sits at our (col=0, row=0).
  const lx = wx - wStep * 0.5;
  const ly = wy - HR;
  // Pixel -> fractional axial (pointy-top, standard formula).
  const qf = (lx * S3 / 3 - ly / 3) / HR;
  const rf = (ly * 2 / 3) / HR;
  const sf = -qf - rf;
  // Cube-round.
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Axial -> odd-r offset.
  const row = r;
  const col = q + (r - (r & 1)) / 2;
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1;
  return row * COLS + col;
}

// =============================================================================
// pixelToOddRSnap: pixelToOddR + nearest-hex fallback inside snapWorldRadius.
// Used when an off-grid tap should still register on the closest valid hex.
// =============================================================================
export function pixelToOddRSnap(wx, wy, HR, ROWS, COLS, snapWorldRadius) {
  const direct = pixelToOddR(wx, wy, HR, ROWS, COLS);
  if (direct >= 0) return direct;
  if (!Number.isFinite(snapWorldRadius) || snapWorldRadius <= 0) return -1;

  const wStep = S3 * HR;
  const lx = wx - wStep * 0.5;
  const ly = wy - HR;
  const qf = (lx * S3 / 3 - ly / 3) / HR;
  const rf = (ly * 2 / 3) / HR;
  const qBase = Math.round(qf);
  const rBase = Math.round(rf);

  let bestIdx = -1;
  let bestDistSq = snapWorldRadius * snapWorldRadius;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dq = -2; dq <= 2; dq++) {
      const rr = rBase + dr;
      const qq = qBase + dq;
      const col = qq + (rr - (rr & 1)) / 2;
      if (rr < 0 || rr >= ROWS || col < 0 || col >= COLS) continue;
      const cx = (col + (rr & 1) * 0.5) * wStep + wStep * 0.5;
      const cy = rr * 1.5 * HR + HR;
      const ddx = wx - cx, ddy = wy - cy;
      const dsq = ddx * ddx + ddy * ddy;
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestIdx = rr * COLS + col;
      }
    }
  }
  return bestIdx;
}

// =============================================================================
// pointInHex: pointy-top hexagon containment test (centered at origin).
// Retained for completeness; production picking uses pixelToOddR.
// =============================================================================
export function pointInHex(dx, dy, r) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > S3 * r * 0.5 || ady > r) return false;
  return ady <= r - adx / S3;
}

// =============================================================================
// cMix / mMix: color mixing rules for cell birth.
//   cMix: circular average over R/B/Y vectors, deterministic tie-break on idx
//   mMix: plurality vote with deterministic tie-break on (row, col)
// =============================================================================
export function cMix(nR, nB, nY, ci) {
  if (nR + nB + nY === 0) return CR;
  const sx = nR * cosR + nB * cosB + nY * cosY;
  const sy = nR * sinR + nB * sinB + nY * sinY;
  if (sx * sx + sy * sy < 1e-10) {
    return [CR, CB, CY][((ci * 31 + 7) >>> 0) % 3];
  }
  let a = Math.atan2(sy, sx);
  if (a < 0) a += PI2;
  if (a < PI3 || a >= 5 * PI3) return CR;
  if (a < Math.PI) return CB;
  return CY;
}

export function mMix(nR, nB, nY, r, c) {
  if (nR > nB && nR > nY) return CR;
  if (nB > nR && nB > nY) return CB;
  if (nY > nR && nY > nB) return CY;
  const t = [], m = Math.max(nR, nB, nY);
  if (nR === m && nR > 0) t.push(CR);
  if (nB === m && nB > 0) t.push(CB);
  if (nY === m && nY > 0) t.push(CY);
  return t.length ? t[((r * 31 + c * 17 + 7) >>> 0) % t.length] : CR;
}

// =============================================================================
// rng: seeded mulberry32 PRNG. Each call to the returned closure produces
// the next [0, 1) value deterministically given the original seed.
// =============================================================================
export function rng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Viewport math.
// =============================================================================
export function minZoom(cw, ch, gw, gh) {
  return Math.max(cw / gw, ch / gh, 0.08);
}

export function fitView(cw, ch, gw, gh) {
  const z = minZoom(cw, ch, gw, gh);
  return { zoom: z, panX: (cw - gw * z) / 2, panY: (ch - gh * z) / 2 };
}

// paintableView: like fitView but enforces a minimum on-screen hex radius.
// targetPxR specifies the comfort threshold for the active pointer type.
export function paintableView(cw, ch, gw, gh, hr, targetPxR) {
  const fitZ = minZoom(cw, ch, gw, gh);
  const paintZ = targetPxR / hr;
  if (paintZ <= fitZ) return fitView(cw, ch, gw, gh);
  const cx = gw / 2, cy = gh / 2;
  return {
    zoom: paintZ,
    panX: cw / 2 - cx * paintZ,
    panY: ch / 2 - cy * paintZ,
  };
}

// =============================================================================
// classify: simulate a pattern in isolation under a given rule and return
// a short label describing its long-run behavior.
//
// Possible outputs:
//   "Dead"           - empty initial pattern
//   "Dies@N"         - went extinct at generation N
//   "P1"             - reached a still life
//   "PN" (N > 1)     - reached an oscillator/spaceship of period N
//   "Chaos"          - did not stabilize within maxGen generations
// =============================================================================
export function classify(cells, ruleIdx, maxGen) {
  maxGen = maxGen || 300;
  const tR = 24, tC = 24, tN = tR * tC;
  const tG = buildGrid(tR, tC, 6);
  const cA = new Uint8Array(tN), aA = new Uint8Array(tN);
  const cB = new Uint8Array(tN), aB = new Uint8Array(tN);
  const bL = birthLUT[ruleIdx], sL = survLUT[ruleIdx];
  const cr = Math.floor(tR / 2) - 2;
  const cc = Math.floor(tC / 2) - 2;

  for (const [r, c] of cells) {
    const rr = cr + r, ccc = cc + c;
    if (rr >= 0 && rr < tR && ccc >= 0 && ccc < tC) {
      const idx = rr * tC + ccc;
      cA[idx] = CR;
      aA[idx] = ALIVE_T;
    }
  }

  const hashes = new Map();
  const hash = () => {
    let h = 0;
    for (let i = 0; i < tN; i++) if (cA[i]) h = (h * 31 + i) | 0;
    return h;
  };
  hashes.set(hash(), 0);

  let pop0 = 0;
  for (let i = 0; i < tN; i++) if (cA[i]) pop0++;
  if (pop0 === 0) return "Dead";

  for (let g = 1; g <= maxGen; g++) {
    cB.fill(0);
    aB.fill(0);
    for (let i = 0; i < tN; i++) {
      const nb = tG.NLE;
      let nR = 0, nB = 0, nY = 0;
      for (let k = 0; k < 6; k++) {
        const ni = nb[i * 6 + k];
        if (ni < 0) continue;
        if (cA[ni] && aA[ni] >= ALIVE_T) {
          const cc2 = cA[ni];
          if (cc2 === CR) nR++;
          else if (cc2 === CB) nB++;
          else nY++;
        }
      }
      const nc = nR + nB + nY;
      if (cA[i] && aA[i] >= ALIVE_T) {
        if (sL[nc]) { cB[i] = cA[i]; aB[i] = ALIVE_T; }
        else { cB[i] = cA[i]; aB[i] = Math.max(0, aA[i] - FADE); }
      } else if (bL[nc]) {
        cB[i] = cMix(nR, nB, nY, i);
        aB[i] = ALIVE_T;
      } else if (cA[i] && aA[i] > 0) {
        cB[i] = cA[i];
        aB[i] = Math.max(0, aA[i] - FADE);
      }
    }
    cA.set(cB);
    aA.set(aB);

    let pop = 0;
    for (let i = 0; i < tN; i++) if (cA[i] && aA[i] >= ALIVE_T) pop++;
    if (pop === 0) return "Dies@" + g;

    const h = hash();
    if (hashes.has(h)) {
      const pg = hashes.get(h);
      const per = g - pg;
      return per === 1 ? "P1" : ("P" + per);
    }
    hashes.set(h, g);
  }
  return "Chaos";
}

// =============================================================================
// Standard built-in patterns. Coordinates are [row, col] offsets from the
// top-left of the pattern's bounding box.
// =============================================================================
export const PATS = {
  Block:      { c: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
  Pair:       { c: [[0, 0], [0, 1]] },
  Triangle:   { c: [[0, 0], [0, 1], [1, 0]] },
  Diamond:    { c: [[0, 1], [1, 0], [1, 2], [2, 1]] },
  Ring:       { c: [[0, 1], [0, 2], [1, 0], [1, 3], [2, 0], [2, 3], [3, 1], [3, 2]] },
  Beehive:    { c: [[0, 1], [0, 2], [1, 0], [1, 3], [2, 1], [2, 2]] },
  Line4:      { c: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  Star:       { c: [[0, 2], [1, 1], [1, 2], [1, 3], [2, 0], [2, 2], [2, 4], [3, 1], [3, 2], [3, 3], [4, 2]] },
  Pentagon:   { c: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
  BaysGlider: { c: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 1]] },
};
export const PAT_KEYS = Object.keys(PATS);

// =============================================================================
// Grid size presets and other UI-side constants kept here so unit tests
// can exercise the same values used by the live App.
// =============================================================================
export const GRID_SIZES = [
  { l: "S",   rows:  40, cols:  50, hr: 12  },
  { l: "M",   rows:  80, cols: 100, hr:  6  },
  { l: "L",   rows: 120, cols: 150, hr:  4  },
  { l: "XL",  rows: 160, cols: 200, hr:  3  },
  { l: "XXL", rows: 200, cols: 250, hr:  2.5 },
];

export const SPEEDS = [650, 460, 320, 220, 150, 95, 60, 16];
export const SPLBL  = ["0.5x", "0.8x", "1.1x", "1.6x", "2.4x", "3.8x", "6x", "MAX"];
export const DENS   = [0.05, 0.09, 0.14, 0.20, 0.30];

// Generic clamp helper used in viewport math.
export const cl = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
