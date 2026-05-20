import { useState, useCallback, useEffect, useRef, useMemo, memo, Component } from "react";
// =============================================================================
// GolHex v19.1 — Hexagonal Game of Life (AUDIT-DRIVEN: GEN-DIRTY + DELTA + UNDO-POOL)
// Coworker Research / Coworkerz — 2026-05-20
// Project: GHX (KAT GHX, L003)
// Lineage: v19.0 -> v19.1 (audit-driven cleanup + perf + hardening)
//
// v19.1 — audit findings addressed:
//   B1  worker fillRandom/clear handlers now use postState() (Transferable + Pool)
//   B2  lastTickRef.current updated in MAX-speed branch (was stale on speed-switch)
//   B3  removed dead "if (wasRunning) {}" stub in engine-switch useEffect
//   B4  removed dead XXL inner-loop (maxBatch=1 made it unreachable)
//   P1  main loop: lastDrawnGen check — draw only when sim advanced (saves ~⅔
//       draws at slow speeds; ~200 ms/s at XXL)
//   P2  workerDrawLoop: lastDrawnGen check — only draw on new state from worker
//       (5/5 vs 1/5 frames; safe because gen-counter is a single source of truth,
//       not a dirty-flag race like v18.5.2)
//   P3  placePattern delta-sync — sends only changed cell indices instead of full
//       state-blob. Cheap stamp at XXL.
//   H1  worker setState/setCell length-validation
//   H2  Undo/Redo buffer-pool (MAX_HIST_POOL=10) — recordChange/applySnapshot/
//       undo/redo no longer allocate fresh Uint8Arrays each call
//   C1  consolidated mono font stack (was duplicated module + component scope)
//   C2  Dot extracted to module scope as memo'd component
//   C3  init draw consolidated into ResizeObserver path (was extra 50ms timeout)
//   C4  cleaned up engine-switch effect comment chunk
//   C5  removed orphan refactor-stub comment
//
// v19.0 focus preserved: zero-allocation steady state + responsive UI + max hardening
//
//   1. BUFFER-POOL (Worker ↔ Main)
//      Worker maintains a recycle pool of send-buffers (capped at 4 per type).
//      Main, on receiving a state-post, immediately transfers the OLD cell/
//      color/trail buffers BACK to worker via `recycle` message — worker
//      pushes them onto the pool for the next post. Steady-state allocations
//      drop from "3 typed-arrays per post" (v18.5.4) to ZERO. GC pressure
//      becomes constant instead of growing with simulation runtime.
//
//   2. BTN MEMOIZATION
//      Btn extracted to module scope as React.memo'd component. Static
//      onClicks (Play/Step/Random/Clear/Undo/Redo/Tool-Draw/Tool-Stamp) are
//      stable useCallbacks. Parametric Btn arrays (Speed/Grid/Density) get
//      useMemo'd onClick arrays so each button has a stable handler. Result:
//      setGeneration tick re-renders the StatBar only, not the toolbar — UI
//      thread no longer churns on every state update.
//
//   3. HARDENING
//      - try/catch around every worker postMessage including recycle
//      - Length-validation on recycled buffers (only N-sized accepted)
//      - Pool cleared on grid-resize (snapshots cross-grid are invalid)
//      - ErrorBoundary reset also clears History (was a v18.5 TODO)
//      - Page Visibility API: tab hidden auto-pauses sim, resumes is manual
//      - beforeunload: explicit worker teardown to avoid orphan workers
//      - Defensive guards: cell/color/trail length checks before every use
//      - Worker buffer-pool capped at MAX_POOL=4 per type (~600 KB at XXL)
//      - Dirty-Flag approach from v18.5.2 deliberately NOT reused (broke Pause).
//
// All v18.5.4 features preserved (Transferable Objects, 80 ms post-throttle,
// 200 ms React state-throttle). All v18.5 features preserved (Undo/Redo,
// Touch-aware threshold, XXL-responsive MAX-speed). All v18.4 features
// preserved (ErrorBoundary, localStorage, keyboard, sticky-disable, hover
// preview, length guards). All v18.3 features preserved (Dual engine,
// pinch/pan/zoom, dead-zone-drag, double-buffer step, frame budget).
//
// v18.5.1 focus: UX bug fixes reported by User1 (XXL + Touch)
//   A. TAP_THRESHOLD pointer-aware: 10 px mouse, 18 px touch — touch taps
//      "wobble" more, fixed-10 threshold misclassified pinches as taps and
//      vice versa.
//   B. Worker state-post throttle: limit `state` messages to 20 Hz (50 ms)
//      so XXL+high-speed doesn't flood the main-thread message queue and
//      starve click events ("pause must be clicked multiple times" bug).
//   C. Main MAX-speed at XXL: only 1 step per frame when N > 20000 (was 2)
//      — yields the main thread more often, click events arrive in time.
//   D. Worker forces final state-post on stop so the last frame isn't lost
//      to the throttle.
//
// v18.5 features preserved: Undo/Redo history stack, Ctrl+Z/Y/Shift+Z,
// branch-on-edit, ↶/↷ buttons, worker setState sync, grid-resize clears history.
// v18.4 features preserved: ErrorBoundary, localStorage settings, keyboard,
// worker-sticky-disable, stamp hover preview, length guards.
// v18.3 features preserved: Dual engine, pinch/pan/zoom, dead-zone-drag,
// double-buffer step, throttled state, frame budget.
// =============================================================================

// ─── ErrorBoundary: catches render failures, offers recovery ───
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    try { console.error("GolHex ErrorBoundary:", error, info); } catch (_) {}
  }
  reset = () => {
    // v19.0: remove via SETTINGS_KEY constant (was hardcoded "golhex.v18.settings").
    // Note: clearing hasError unmounts the error UI and remounts GolHexInner,
    // which gives a fresh historyRef/futureRef — history is implicitly reset.
    try { localStorage.removeItem(SETTINGS_KEY); } catch (_) {}
    this.setState({ hasError: false, error: null });
  };
  reload = () => {
    try { window.location.reload(); } catch (_) {}
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    const msg = this.state.error && this.state.error.message
      ? String(this.state.error.message).slice(0, 200)
      : "Unbekannter Fehler";
    return (
      <div style={{
        width: "100%", height: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(ellipse at top, #0B1A1F 0%, #020608 60%)",
        color: "#E8F5F2", fontFamily: "system-ui, sans-serif", padding: 24,
      }}>
        <div style={{
          maxWidth: 480, padding: "20px 24px",
          background: "rgba(11,26,31,0.85)",
          border: "1px solid rgba(255,51,85,0.5)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#FF3355", marginBottom: 8 }}>
            GolHex — Render-Fehler abgefangen
          </div>
          <div style={{ fontSize: 12, color: "#8CC4BB", marginBottom: 16, lineHeight: 1.5 }}>
            Die App hat einen unerwarteten Fehler erkannt und einen Absturz verhindert.
            Du kannst die Einstellungen zurücksetzen oder die Seite neu laden.
          </div>
          <div style={{
            fontFamily: "ui-monospace, monospace", fontSize: 10,
            color: "#5A8B83", background: "#020608",
            padding: "8px 10px", borderRadius: 6,
            marginBottom: 16, border: "1px solid rgba(92,240,204,0.1)",
            wordBreak: "break-word",
          }}>{msg}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={this.reset} style={{
              flex: 1, padding: "10px 14px",
              background: "rgba(92,240,204,0.22)",
              border: "1px solid #5CF0CC",
              borderRadius: 6, color: "#5CF0CC", cursor: "pointer",
              fontFamily: "ui-monospace, monospace", fontSize: 11,
            }}>Settings reset & retry</button>
            <button onClick={this.reload} style={{
              flex: 1, padding: "10px 14px",
              background: "rgba(21,65,70,0.55)",
              border: "1px solid rgba(92,240,204,0.18)",
              borderRadius: 6, color: "#E8F5F2", cursor: "pointer",
              fontFamily: "ui-monospace, monospace", fontSize: 11,
            }}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

// ─── Settings persistence ───
const SETTINGS_KEY = "golhex.v18.settings";
const SETTINGS_VERSION = 4;

// ─── History (Undo/Redo) ───
const HISTORY_MAX = 50; // ring-buffer depth — at XXL ~ 250KB/snap × 50 = 12 MB

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== SETTINGS_VERSION) return null;
    return obj;
  } catch (_) { return null; }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: SETTINGS_VERSION, ...s }));
  } catch (_) { /* quota / private-mode: silent */ }
}
function clampInt(v, min, max, fallback) {
  const n = Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

const S3 = Math.sqrt(3);
const PI3 = Math.PI / 3;

// ─── Theme tokens ───
const T = {
  bg:        "#020608",
  bg2:       "#070F13",
  bg3:       "#0B1A1F",
  panel:     "rgba(11, 26, 31, 0.85)",
  panelBd:   "rgba(92, 240, 204, 0.18)",
  text:      "#E8F5F2",
  sub:       "#8CC4BB",
  muted:     "#5A8B83",
  accent:    "#5CF0CC",
  accentDim: "rgba(92, 240, 204, 0.35)",
  stroke:    "rgba(92, 240, 204, 0.10)",
  btn:       "rgba(21, 65, 70, 0.55)",
  btnHov:    "rgba(26, 90, 96, 0.85)",
  btnAct:    "rgba(92, 240, 204, 0.22)",
  btnActBd:  "#5CF0CC",
  red:       "#FF3355",
  blue:      "#33CCFF",
  yellow:    "#FFD700",
  redA:      [255, 51, 85],
  blueA:     [51, 204, 255],
  yellowA:   [255, 215, 0],
};

// ─── Grid Sizes ───
const GRID_SIZES = [
  { l: "S",   rows: 40,  cols: 50,  hr: 12 },
  { l: "M",   rows: 80,  cols: 100, hr: 6 },
  { l: "L",   rows: 120, cols: 150, hr: 4 },
  { l: "XL",  rows: 160, cols: 200, hr: 3 },
  { l: "XXL", rows: 200, cols: 250, hr: 2.5 },
];

// ─── Speeds ───
const SPEEDS = [650, 460, 320, 220, 150, 95, 60, 16];
const SPLBL = ["0.5", "0.8", "1.1", "1.6", "2.4", "3.8", "6", "MAX"];

// ─── Densities ───
const DENS = [0.05, 0.09, 0.14, 0.20, 0.30];

// ─── Rules ───
const RULES = [
  { l: "B2/S34",  B: [2],    S: [3, 4] },
  { l: "B2/S35",  B: [2],    S: [3, 5] },
  { l: "B2/S23",  B: [2],    S: [2, 3] },
  { l: "B3/S34",  B: [3],    S: [3, 4] },
  { l: "B3/S23",  B: [3],    S: [2, 3] },
  { l: "B2/S245", B: [2],    S: [2, 4, 5] },
  { l: "B12/S34", B: [1, 2], S: [3, 4] },
  { l: "B2/S45",  B: [2],    S: [4, 5] },
  { l: "B1/S34",  B: [1],    S: [3, 4] },
  { l: "B12/S23", B: [1, 2], S: [2, 3] },
  { l: "B23/S34", B: [2, 3], S: [3, 4] },
  { l: "B2/S356", B: [2],    S: [3, 5, 6] },
  { l: "B34/S23", B: [3, 4], S: [2, 3] },
  { l: "B13/S34", B: [1, 3], S: [3, 4] },
  { l: "B24/S34", B: [2, 4], S: [3, 4] },
  { l: "B1/S245", B: [1],    S: [2, 4, 5] },
];

const birthLUT = [], survLUT = [];
for (let ri = 0; ri < RULES.length; ri++) {
  const bL = new Uint8Array(7), sL = new Uint8Array(7);
  for (const v of RULES[ri].B) bL[v] = 1;
  for (const v of RULES[ri].S) sL[v] = 1;
  birthLUT.push(bL);
  survLUT.push(sL);
}

// ─── Patterns ───
const PATS = {
  Pair:     { c: [[0,0],[0,1]], desc: "2 Zellen" },
  Triangle: { c: [[0,0],[0,1],[1,0]], desc: "3 Zellen" },
  Block:    { c: [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]], desc: "3x2 Block" },
  Diamond:  { c: [[0,1],[1,0],[1,2],[2,1]], desc: "Raute" },
  Pentagon: { c: [[0,1],[1,0],[1,1],[1,2],[2,1]], desc: "Fuenfeck" },
  Beehive:  { c: [[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]], desc: "Bienenstock" },
  Ring:     { c: [[0,1],[0,2],[1,0],[1,3],[2,0],[2,3],[3,1],[3,2]], desc: "Ring" },
  Line4:    { c: [[0,0],[0,1],[0,2],[0,3]], desc: "Linie" },
  Star:     { c: [[0,2],[1,1],[1,2],[1,3],[2,0],[2,2],[2,4],[3,1],[3,2],[3,3],[4,2]], desc: "Stern" },
  Glider:   { c: [[0,0],[0,1],[1,0],[1,1],[2,1]], desc: "Bays-Gleiter" },
};
const PAT_NAMES = Object.keys(PATS);

// ─── Neighbor offsets (odd-r) ───
const oddOff  = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
const evenOff = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
// Axial direction vectors matching neighbor order (pointy-top)
const AX_DIR = [[0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]];

// ─── Trail / Age ───
const ALIVE_T = 200;
const FADE = 8;
const TB = [
  { min: 1, max: 50, a: 0.12 },
  { min: 51, max: 100, a: 0.25 },
  { min: 101, max: 150, a: 0.42 },
  { min: 151, max: 199, a: 0.65 },
];

// ─── Touch constants ───
// v18.5.1: pointer-type-aware. Touch wobbles more during contact (12-15 px is
// common during what the user perceives as a stationary tap), and a beginning
// pinch is briefly a single-finger contact — fixed 10 px misclassified both.
const TAP_THRESHOLD_MOUSE = 10;
const TAP_THRESHOLD_TOUCH = 18;
const TAP_TIME_MAX = 350; // ms (avoid long-press as tap)

// ─── Performance constants ───
// v18.5.4: 100 → 200 ms (10 Hz → 5 Hz). Halves toolbar re-render churn so
// click events reach React faster between long sim frames at XXL.
const STATE_UPDATE_INTERVAL_MS = 200;
const FRAME_BUDGET_MS = 8; // skip 2nd MAX-speed step if 1st exceeds this

const C0 = 0, CR = 1, CB = 2, CY = 3;

// ─── Hex corners ───
const HC6 = new Float64Array(6), HS6 = new Float64Array(6);
for (let i = 0; i < 6; i++) {
  const a = -Math.PI / 2 + i * PI3;
  HC6[i] = Math.cos(a);
  HS6[i] = Math.sin(a);
}

// ═══════════════════════════════════════════════════════════════════
// CANONICAL PIXEL-TO-HEX (Red Blob Games)
// ═══════════════════════════════════════════════════════════════════
function pixelToOddR(wx, wy, HR, ROWS, COLS) {
  const originX = S3 * HR * 0.5;
  const originY = HR;
  const lx = wx - originX;
  const ly = wy - originY;
  const qf = (lx * S3 / 3 - ly / 3) / HR;
  const rf = (ly * 2 / 3) / HR;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const row = r;
  const col = q + (r - (r & 1)) / 2;
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1;
  return row * COLS + col;
}

// ═══════════════════════════════════════════════════════════════════
// BUILD GRID DATA
// ═══════════════════════════════════════════════════════════════════
function buildGrid(R, C, HR) {
  const N = R * C;
  const GW = C * S3 * HR + S3 * HR * 0.5;
  const GH = R * 1.5 * HR + HR * 0.5;
  const NLE = new Int32Array(N * 6);
  const NLW = new Int32Array(N * 6);

  for (let r = 0; r < R; r++) {
    const off = (r & 1) ? oddOff : evenOff;
    const rShift = (r - (r & 1)) >> 1;
    for (let c = 0; c < C; c++) {
      const base = (r * C + c) * 6;
      const curQ = c - rShift;
      for (let k = 0; k < 6; k++) {
        const nr = r + off[k][0], nc = c + off[k][1];
        NLE[base + k] = (nr >= 0 && nr < R && nc >= 0 && nc < C)
          ? nr * C + nc : -1;
        const nq = curQ + AX_DIR[k][0];
        const nrAx = r + AX_DIR[k][1];
        const wr = ((nrAx % R) + R) % R;
        const wrShift = (wr - (wr & 1)) >> 1;
        const wc = ((nq + wrShift) % C + C) % C;
        NLW[base + k] = wr * C + wc;
      }
    }
  }

  const CX = new Float64Array(N), CY_ = new Float64Array(N);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const idx = r * C + c;
      CX[idx] = S3 * HR * (c + ((r & 1) ? 0.5 : 0)) + S3 * HR * 0.5;
      CY_[idx] = 1.5 * HR * r + HR;
    }
  }

  return { N, GW, GH, NLE, NLW, CX, CY: CY_, R, C, HR };
}

// ═══════════════════════════════════════════════════════════════════
// WORKER SOURCE — inlined as string, loaded via Blob URL
// Holds its own grid topology, double-buffer state, and step loop.
// ═══════════════════════════════════════════════════════════════════
const WORKER_CODE = `
"use strict";
let cell = null, color = null, trail = null;
let cellB = null, colorB = null, trailB = null;
let NL_E = null, NL_W = null;
let N = 0, gen = 0, pop = 0;
let ri = 0, torusOn = true, spd = 220;
let running = false;
let loopHandle = null;
// v18.5.4: state-posts throttled to ~12 Hz; v19.0 adds Buffer-Pool below.
let lastStatePostMs = 0;
const STATE_POST_MIN_MS = 80;
function nowMs() {
  return (typeof performance !== "undefined" ? performance.now() : Date.now());
}

// ─── v19.0 BUFFER-POOL ───
// Send-buffer recycle pools. Main returns used buffers via 'recycle' msg.
// MAX_POOL=4 caps memory: 4 × (cell+color+trail) at XXL ≈ 4 × 150KB = 600KB.
const MAX_POOL = 4;
const poolCell = [];
const poolColor = [];
const poolTrail = [];

function getCellBuf() {
  return poolCell.length ? poolCell.pop() : new Uint8Array(N);
}
function getColorBuf() {
  return poolColor.length ? poolColor.pop() : new Uint8Array(N);
}
function getTrailBuf() {
  return poolTrail.length ? poolTrail.pop() : new Int8Array(N);
}
function clearPool() {
  poolCell.length = 0; poolColor.length = 0; poolTrail.length = 0;
}

function postState() {
  // v19.0: recycled buffer from pool (zero alloc steady-state) or fresh.
  // Validation: only Nsized buffers ever enter pool, so length matches.
  try {
    const cellBuf = getCellBuf();
    const colorBuf = getColorBuf();
    const trailBuf = getTrailBuf();
    // Defensive: if pool gave us a wrong-sized buffer (shouldn't happen),
    // fall back to fresh allocation. Belt and braces.
    if (cellBuf.length !== N || colorBuf.length !== N || trailBuf.length !== N) {
      const c = new Uint8Array(N); c.set(cell);
      const co = new Uint8Array(N); co.set(color);
      const t = new Int8Array(N); t.set(trail);
      self.postMessage(
        { type: "state", cell: c, color: co, trail: t, gen: gen, pop: pop },
        [c.buffer, co.buffer, t.buffer]
      );
    } else {
      cellBuf.set(cell);
      colorBuf.set(color);
      trailBuf.set(trail);
      self.postMessage(
        { type: "state", cell: cellBuf, color: colorBuf, trail: trailBuf, gen: gen, pop: pop },
        [cellBuf.buffer, colorBuf.buffer, trailBuf.buffer]
      );
    }
    lastStatePostMs = nowMs();
  } catch (_) { /* worker dying / queue full — silent, next post will retry */ }
}
function maybePostState() {
  if (nowMs() - lastStatePostMs >= STATE_POST_MIN_MS) postState();
}

const ALIVE_T = 200, FADE = 8;
const C0 = 0, CR = 1, CB = 2, CY = 3;

// Rule LUTs (built from RULES sent on init)
let birthLUT = null, survLUT = null;

function buildLUTs(rules) {
  birthLUT = []; survLUT = [];
  for (let i = 0; i < rules.length; i++) {
    const bL = new Uint8Array(7), sL = new Uint8Array(7);
    for (const v of rules[i].B) bL[v] = 1;
    for (const v of rules[i].S) sL[v] = 1;
    birthLUT.push(bL); survLUT.push(sL);
  }
}

function step() {
  if (!cell || !cellB) return;
  const NL = torusOn ? NL_W : NL_E;
  const bL = birthLUT[ri], sL = survLUT[ri];
  cellB.fill(0); colorB.fill(0); trailB.fill(0);
  let p = 0;
  for (let i = 0; i < N; i++) {
    let cnt = 0, cR = 0, cB2 = 0, cY = 0;
    const base = i * 6;
    for (let k = 0; k < 6; k++) {
      const nb = NL[base + k];
      if (nb < 0) continue;
      if (cell[nb] > 0) {
        cnt++;
        const c = color[nb];
        if (c === CR) cR++;
        else if (c === CB) cB2++;
        else if (c === CY) cY++;
      }
    }
    if (cell[i] > 0) {
      if (sL[cnt]) {
        cellB[i] = cell[i] < ALIVE_T - 1 ? cell[i] + 1 : ALIVE_T - 1;
        colorB[i] = color[i];
        p++;
      } else {
        trailB[i] = FADE;
      }
    } else {
      if (bL[cnt]) {
        cellB[i] = 1;
        if (cR >= cB2 && cR >= cY) colorB[i] = CR;
        else if (cB2 >= cY) colorB[i] = CB;
        else colorB[i] = CY;
        p++;
      } else {
        trailB[i] = trail[i] > 0 ? trail[i] - 1 : 0;
      }
    }
  }
  // Swap
  const tc = cell, tco = color, tt = trail;
  cell = cellB; color = colorB; trail = trailB;
  cellB = tc; colorB = tco; trailB = tt;
  gen++; pop = p;
  // v18.5.1: throttled — was unconditional post (1 per step, flooded XXL+MAX)
  maybePostState();
}

function scheduleNext() {
  if (!running) return;
  if (spd === 16) {
    // MAX speed: step as fast as possible, yield via setTimeout 0
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    step();
    if (((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) < 8) {
      step();
    }
    loopHandle = setTimeout(scheduleNext, 0);
  } else {
    loopHandle = setTimeout(() => {
      if (!running) return;
      step();
      scheduleNext();
    }, spd);
  }
}

self.onmessage = function(e) {
  const m = e.data;
  if (m.type === "init") {
    N = m.N;
    NL_E = m.NL_E; NL_W = m.NL_W;
    cell = m.cell; color = m.color; trail = m.trail;
    cellB = new Uint8Array(N);
    colorB = new Uint8Array(N);
    trailB = new Int8Array(N);
    buildLUTs(m.rules);
    gen = m.gen || 0; pop = m.pop || 0;
    ri = m.ri || 0; torusOn = m.torus !== false; spd = m.spd || 220;
    // v19.0: any stale pool buffers from a previous grid size are wrong N
    clearPool();
  } else if (m.type === "recycle") {
    // v19.0: main hands back transferred buffers for reuse. Length-validate
    // (cross-grid recycles would be wrong N; reject them silently).
    if (m.cell && m.cell.length === N && poolCell.length < MAX_POOL) poolCell.push(m.cell);
    if (m.color && m.color.length === N && poolColor.length < MAX_POOL) poolColor.push(m.color);
    if (m.trail && m.trail.length === N && poolTrail.length < MAX_POOL) poolTrail.push(m.trail);
  } else if (m.type === "setRule") { ri = m.idx; }
  else if (m.type === "setTorus") { torusOn = !!m.v; }
  else if (m.type === "setSpeed") { spd = m.spd; }
  else if (m.type === "setState") {
    // v19.1 H1: length-validate before overwriting worker-side arrays.
    // A wrong-N payload (cross-grid race) would corrupt step() and pool.
    if (!m.cell || !m.color || !m.trail) return;
    if (m.cell.length !== N || m.color.length !== N || m.trail.length !== N) return;
    cell = m.cell; color = m.color; trail = m.trail;
    if (m.gen !== undefined) gen = m.gen;
    if (m.pop !== undefined) pop = m.pop;
  } else if (m.type === "setCell") {
    // v19.1 H1: bounds-check (was partial). idx and color must be integers.
    if (!cell) return;
    const k = m.idx | 0;
    if (k < 0 || k >= N) return;
    cell[k] = m.alive ? 1 : 0;
    color[k] = (m.color | 0) || 0;
  } else if (m.type === "step") {
    step();
  } else if (m.type === "start") {
    if (running) return;
    running = true;
    scheduleNext();
  } else if (m.type === "stop") {
    running = false;
    if (loopHandle !== null) {
      clearTimeout(loopHandle);
      loopHandle = null;
    }
    // v18.5.1: force-post final state so the user sees the last frame
    // (throttled posting would otherwise lose up to 50 ms of progress)
    if (cell) postState();
  } else if (m.type === "fillRandom") {
    if (!cell) return;
    const dens = m.dens;
    let p = 0;
    for (let i = 0; i < N; i++) {
      if (Math.random() < dens) {
        cell[i] = 1;
        const r = Math.random();
        color[i] = r < 0.333 ? CR : r < 0.666 ? CB : CY;
        p++;
      } else { cell[i] = 0; color[i] = 0; }
      trail[i] = 0;
    }
    gen = 0; pop = p;
    postState(); // v19.1 B1: transferable + pool path (was inline slice+post)
  } else if (m.type === "clear") {
    if (!cell) return;
    cell.fill(0); color.fill(0); trail.fill(0);
    cellB.fill(0); colorB.fill(0); trailB.fill(0);
    gen = 0; pop = 0;
    postState(); // v19.1 B1: transferable + pool path
  } else if (m.type === "setCells") {
    // v19.1 P3: delta-sync — main sends sparse list of changed cells.
    // Format: m.idx (Int32Array of indices), m.alive (Uint8Array 0/1),
    // m.color (Uint8Array per-cell color), m.popDelta (Int32 added/removed).
    if (!cell || !m.idx) return;
    const ii = m.idx, aa = m.alive, cc = m.color;
    const L = ii.length;
    for (let i = 0; i < L; i++) {
      const k = ii[i];
      if (k < 0 || k >= N) continue;
      cell[k] = aa[i] ? 1 : 0;
      cc && (color[k] = cc[i] | 0);
    }
    if (typeof m.popDelta === "number") pop += m.popDelta;
    // No state-post here — caller decides when to sync (running step will post next)
  }
};
`;

// ═══════════════════════════════════════════════════════════════════
// v19.0 — Module-scope styles + memoized Btn so toolbar doesn't re-render
// on every setGeneration/setPopulation tick.
// ═══════════════════════════════════════════════════════════════════
const _monoStack = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
const btnStyleBase = {
  background: T.btn, color: T.text,
  border: `1px solid ${T.stroke}`,
  borderRadius: 6, padding: "6px 10px", cursor: "pointer",
  fontFamily: _monoStack, fontSize: 11, fontWeight: 500,
  whiteSpace: "nowrap", transition: "all 0.15s ease",
  minHeight: 30, minWidth: 30,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  userSelect: "none",
  WebkitTapHighlightColor: "transparent",
};
const btnStyleActive = {
  background: T.btnAct,
  borderColor: T.btnActBd,
  color: T.accent,
  boxShadow: `0 0 8px ${T.accent}33, inset 0 0 8px ${T.accent}11`,
};
const btnStyleIcon = { minWidth: 36, minHeight: 36, padding: "6px 8px", fontSize: 13 };
const btnStyleDisabled = { opacity: 0.4, cursor: "not-allowed" };

// v19.1 C2: Dot extracted from GolHexInner (was inline → recreated each render)
const Dot = memo(function Dot({ c }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: 4,
      background: c, boxShadow: `0 0 6px ${c}`, marginRight: 4,
    }} />
  );
});

const Btn = memo(function Btn({ active, onClick, children, icon, title, disabled }) {
  return (
    <button
      style={{
        ...btnStyleBase,
        ...(active ? btnStyleActive : null),
        ...(icon ? btnStyleIcon : null),
        ...(disabled ? btnStyleDisabled : null),
      }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
});

// ─── Memoized StatBar: only re-renders when stats change, not toolbar ───
const StatBar = memo(function StatBar({ generation, population, gridLbl, ruleLbl, torus, engine, styles }) {
  return (
    <div style={styles.statRow}>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Gen</span>
        <span style={styles.statVal}>{generation}</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Pop</span>
        <span style={styles.statVal}>{population}</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Grid</span>
        <span style={styles.statVal}>{gridLbl}</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Regel</span>
        <span style={styles.statVal}>{ruleLbl}</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Topo</span>
        <span style={styles.statVal}>{torus ? "Torus" : "Rand"}</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statLbl}>Engine</span>
        <span style={styles.statVal}>{engine === "worker" ? "Worker" : "Main"}</span>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
function GolHexInner() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // ─── State (hydrated from localStorage if available) ───
  const _initial = loadSettings() || {};
  const [running, setRunning] = useState(false); // never persist running
  const [generation, setGeneration] = useState(0);
  const [population, setPopulation] = useState(0);
  const [gridSizeIdx, setGridSizeIdx] = useState(clampInt(_initial.gridSizeIdx, 0, 4, 0));
  const [ruleIdx, setRuleIdx] = useState(clampInt(_initial.ruleIdx, 0, 15, 0));
  const [speedIdx, setSpeedIdx] = useState(clampInt(_initial.speedIdx, 0, 7, 4));
  const [densIdx, setDensIdx] = useState(clampInt(_initial.densIdx, 0, 4, 2));
  const [torus, setTorus] = useState(_initial.torus !== false);
  const [tool, setTool] = useState(_initial.tool === "stamp" ? "stamp" : "draw");
  const [patIdx, setPatIdx] = useState(clampInt(_initial.patIdx, 0, 9, 0));
  const [showRules, setShowRules] = useState(!!_initial.showRules);
  const [showAdvanced, setShowAdvanced] = useState(!!_initial.showAdvanced);
  const [engine, setEngine] = useState(_initial.engine === "worker" ? "worker" : "main");
  const [engineNotice, setEngineNotice] = useState("");
  const [workerDisabled, setWorkerDisabled] = useState(false);

  // Persist settings on change (debounced via simple guard)
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings({
        gridSizeIdx, ruleIdx, speedIdx, densIdx, torus, tool, patIdx,
        showRules, showAdvanced, engine,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [gridSizeIdx, ruleIdx, speedIdx, densIdx, torus, tool, patIdx,
      showRules, showAdvanced, engine]);

  // ─── Refs ───
  const rR = useRef(false);
  const gridRef = useRef(null);
  // Double-buffer: swap pointers each step, no realloc.
  // *A holds current state; *B is the scratch buffer for the next state.
  const cellRef = useRef(null);     // current Uint8Array
  const colorRef = useRef(null);    // current Uint8Array
  const trailRef = useRef(null);    // current Int8Array
  const cellBRef = useRef(null);    // scratch Uint8Array
  const colorBRef = useRef(null);   // scratch Uint8Array
  const trailBRef = useRef(null);   // scratch Int8Array
  const populationRef = useRef(0);  // current population, updated inline in step
  const lastStateUpdateRef = useRef(0); // last setState time
  const genRef = useRef(0);
  const ruleRef = useRef(0);
  const torusRef = useRef(true);
  const speedRef = useRef(4);
  const toolRef = useRef("draw");
  const patIdxRef = useRef(0);
  const engineRef = useRef("main");
  const hoverIdxRef = useRef(-1);

  // ─── History / Redo (session memory only — never persisted) ───
  const historyRef = useRef([]); // oldest first; pop() = most recent
  const futureRef = useRef([]);  // top = next redo target
  const [historyCount, setHistoryCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);
  // v19.1 H2: snapshot-buffer pool. Eliminates per-undo alloc storm.
  // Cap MAX_HIST_POOL=10 (~1.5 MB at XXL: 10 × 3 × 50KB). Snapshots that
  // overflow MAX get GC'd normally — pool is best-effort.
  const histPoolRef = useRef([]);

  // Worker refs
  const workerRef = useRef(null);
  const workerUrlRef = useRef(null);
  const workerReadyRef = useRef(false);

  // View
  const viewRef = useRef({ ox: 0, oy: 0, zoom: 1 });

  // Pointer state (Dead-Zone-Drag pattern, Steve Ruiz)
  // pointers: Map<pointerId, { sx, sy, lx, ly, st, moved, mode, lastIdx, button }>
  //   sx, sy: original pointerdown screen coords
  //   lx, ly: last recorded pointermove coords (ONLY updated when moved=true)
  //   st: pointerdown timestamp
  //   moved: whether threshold has been crossed
  //   mode: "tap" | "draw" | "pan" | "pinch"
  //   lastIdx: last painted cell index (for drag-paint dedup)
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  const animRef = useRef(null);
  const lastTickRef = useRef(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  // v19.1 P1/P2: gen-counter dirty check. draw() at 60 Hz wastes cycles when
  // the sim hasn't advanced since the last frame. lastDrawnGenRef is bumped
  // by draw() itself and compared at the next frame. SAFE — unlike the v18.5.2
  // dirty-flag attempt, this is unidirectional: only draw mutates the marker,
  // step/onmessage just bump genRef. No race possible.
  const lastDrawnGenRef = useRef(-1);
  // Force-redraw triggers (zoom/pan/grid-resize/hover/etc.) need to invalidate
  // the marker so the next loop tick redraws even at the same gen.
  const invalidateDraw = useCallback(() => { lastDrawnGenRef.current = -1; }, []);

  // ═══════════════════════════════════════════════════════════════════
  // WORKER HELPERS
  // ═══════════════════════════════════════════════════════════════════
  const teardownWorker = useCallback(() => {
    if (workerRef.current) {
      try { workerRef.current.terminate(); } catch (_) {}
      workerRef.current = null;
    }
    if (workerUrlRef.current) {
      try { URL.revokeObjectURL(workerUrlRef.current); } catch (_) {}
      workerUrlRef.current = null;
    }
    workerReadyRef.current = false;
  }, []);

  // Safe-post: never throw across the boundary if worker is gone.
  const postToWorker = useCallback((msg) => {
    const w = workerRef.current;
    if (!w) return false;
    try { w.postMessage(msg); return true; }
    catch (_) { return false; }
  }, []);

  const setupWorker = useCallback(() => {
    teardownWorker();
    if (typeof Worker === "undefined") {
      setWorkerDisabled(true);
      setEngineNotice("Worker nicht unterstützt — Main-Engine bleibt aktiv");
      setEngine("main");
      setTimeout(() => setEngineNotice(""), 4000);
      return null;
    }
    try {
      const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      workerRef.current = w;
      workerUrlRef.current = url;
      w.onmessage = (e) => {
        const m = e.data;
        if (!m || m.type !== "state") return;
        // Update main-thread snapshot from worker state
        const g = gridRef.current;
        if (!g) return;
        // Defensive: validate array lengths match current grid
        if (!m.cell || m.cell.length !== g.N) return;
        // v19.0: hand the OLD buffers back to worker for recycling. We had
        // them, we're about to drop them — instead transfer back to feed the
        // pool. Steady state: zero GC pressure on either side.
        const oldCell = cellRef.current;
        const oldColor = colorRef.current;
        const oldTrail = trailRef.current;
        cellRef.current = m.cell;
        colorRef.current = m.color;
        trailRef.current = m.trail;
        populationRef.current = m.pop;
        genRef.current = m.gen;
        if (oldCell && oldColor && oldTrail
            && oldCell.length === g.N
            && oldColor.length === g.N
            && oldTrail.length === g.N
            && oldCell.buffer.byteLength > 0) {
          try {
            workerRef.current && workerRef.current.postMessage(
              { type: "recycle", cell: oldCell, color: oldColor, trail: oldTrail },
              [oldCell.buffer, oldColor.buffer, oldTrail.buffer]
            );
          } catch (_) { /* fine — fresh alloc next post */ }
        }
        const now = performance.now();
        if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL_MS) {
          lastStateUpdateRef.current = now;
          setGeneration(m.gen);
          setPopulation(m.pop);
        }
        // Draw is on rAF (workerDrawLoop)
      };
      w.onerror = (err) => {
        try { console.error("Worker error:", err); } catch (_) {}
        setWorkerDisabled(true);
        setEngineNotice("Worker-Fehler — Main-Engine aktiv (Button deaktiviert)");
        setEngine("main");
        setTimeout(() => setEngineNotice(""), 4000);
      };
      w.onmessageerror = () => {
        try { console.warn("Worker messageerror"); } catch (_) {}
      };
      return w;
    } catch (err) {
      setWorkerDisabled(true);
      setEngineNotice("Worker nicht verfügbar — Main-Engine aktiv");
      setEngine("main");
      setTimeout(() => setEngineNotice(""), 4000);
      return null;
    }
  }, [teardownWorker]);

  // Send initial state to worker (defensive: check refs exist & match grid)
  const sendInitToWorker = useCallback(() => {
    const w = workerRef.current;
    const g = gridRef.current;
    if (!w || !g) return;
    const cell = cellRef.current, col = colorRef.current, trail = trailRef.current;
    if (!cell || !col || !trail || cell.length !== g.N) return;
    try {
      w.postMessage({
        type: "init",
        N: g.N,
        NL_E: new Int32Array(g.NLE),
        NL_W: new Int32Array(g.NLW),
        cell: new Uint8Array(cell),
        color: new Uint8Array(col),
        trail: new Int8Array(trail),
        rules: RULES.map(r => ({ B: r.B, S: r.S })),
        ri: ruleRef.current,
        torus: torusRef.current,
        spd: SPEEDS[speedRef.current],
        gen: genRef.current,
        pop: populationRef.current,
      });
      workerReadyRef.current = true;
    } catch (_) { workerReadyRef.current = false; }
  }, []);


  const initGrid = useCallback((sizeIdx) => {
    const gs = GRID_SIZES[sizeIdx];
    const g = buildGrid(gs.rows, gs.cols, gs.hr);
    gridRef.current = g;
    cellRef.current = new Uint8Array(g.N);
    colorRef.current = new Uint8Array(g.N);
    trailRef.current = new Int8Array(g.N);
    cellBRef.current = new Uint8Array(g.N);
    colorBRef.current = new Uint8Array(g.N);
    trailBRef.current = new Int8Array(g.N);
    populationRef.current = 0;
    lastStateUpdateRef.current = 0;
    genRef.current = 0;
    setGeneration(0);
    setPopulation(0);
    const canvas = canvasRef.current;
    if (canvas) {
      const cw = canvas.width / (window.devicePixelRatio || 1);
      const ch = canvas.height / (window.devicePixelRatio || 1);
      const zx = cw / g.GW, zy = ch / g.GH;
      const z = Math.min(zx, zy) * 0.95;
      viewRef.current = {
        ox: (cw - g.GW * z) / 2,
        oy: (ch - g.GH * z) / 2,
        zoom: z,
      };
    }
  }, []);

  // ─── Resize canvas (guards against 0×0 container) ───
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const cont = containerRef.current;
    if (!canvas || !cont) return;
    const rect = cont.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvasSizeRef.current = { w, h };
    }
  }, []);

  // ─── Step simulation (double-buffer, inline pop count, throttled state) ───
  const step = useCallback(() => {
    const g = gridRef.current;
    const cell = cellRef.current;
    const col = colorRef.current;
    const trail = trailRef.current;
    const cellB = cellBRef.current;
    const colB = colorBRef.current;
    const trailB = trailBRef.current;
    if (!g || !cell || !col || !trail || !cellB || !colB || !trailB) return;
    // Length-match guard: protects against grid-resize race (alloc-in-flight)
    if (cell.length !== g.N || cellB.length !== g.N) return;

    const { N } = g;
    const NL = torusRef.current ? g.NLW : g.NLE;
    const ri = ruleRef.current;
    const bL = birthLUT[ri], sL = survLUT[ri];
    if (!bL || !sL) return;

    // Clear scratch buffer cell/color in one pass (faster than allocating)
    cellB.fill(0);
    colB.fill(0);
    trailB.fill(0);

    let pop = 0;

    for (let i = 0; i < N; i++) {
      let cnt = 0, cntR = 0, cntB2 = 0, cntY = 0;
      const base = i * 6;
      for (let k = 0; k < 6; k++) {
        const nb = NL[base + k];
        if (nb < 0) continue;
        if (cell[nb] > 0) {
          cnt++;
          const c = col[nb];
          if (c === CR) cntR++;
          else if (c === CB) cntB2++;
          else if (c === CY) cntY++;
        }
      }

      if (cell[i] > 0) {
        if (sL[cnt]) {
          cellB[i] = cell[i] < ALIVE_T - 1 ? cell[i] + 1 : ALIVE_T - 1;
          colB[i] = col[i];
          pop++;
        } else {
          trailB[i] = FADE;
        }
      } else {
        if (bL[cnt]) {
          cellB[i] = 1;
          if (cntR >= cntB2 && cntR >= cntY) colB[i] = CR;
          else if (cntB2 >= cntY) colB[i] = CB;
          else colB[i] = CY;
          pop++;
        } else {
          trailB[i] = trail[i] > 0 ? trail[i] - 1 : 0;
        }
      }
    }

    // Swap buffers (zero allocation)
    cellRef.current = cellB;
    colorRef.current = colB;
    trailRef.current = trailB;
    cellBRef.current = cell;
    colorBRef.current = col;
    trailBRef.current = trail;

    populationRef.current = pop;
    genRef.current++;

    // Throttle React state updates to 10Hz so toolbar stays responsive
    const now = performance.now();
    if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL_MS) {
      lastStateUpdateRef.current = now;
      setGeneration(genRef.current);
      setPopulation(pop);
    }
  }, []);

  // ─── Draw single hex path ───
  const drawHexPath = (ctx, cx, cy, r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const px = cx + HC6[i] * r;
      const py = cy + HS6[i] * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  // ─── Draw ───
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const g = gridRef.current;
    const cell = cellRef.current;
    const col = colorRef.current;
    const trail = trailRef.current;
    if (!canvas || !g || !cell || !col || !trail) return;
    if (cell.length !== g.N) return; // alloc-race guard
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = canvasSizeRef.current;
    if (!w || !h) return;
    const { ox, oy, zoom } = viewRef.current;
    const { N, HR, CX, CY: CYA } = g;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background gradient
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h));
    grad.addColorStop(0, "#0A1418");
    grad.addColorStop(1, T.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(zoom, zoom);

    const pxR = HR * zoom;
    const showGrid = pxR >= 4;

    const invZ = 1 / zoom;
    const vx0 = -ox * invZ, vy0 = -oy * invZ;
    const vx1 = vx0 + w * invZ, vy1 = vy0 + h * invZ;

    for (let i = 0; i < N; i++) {
      const cx = CX[i], cy = CYA[i];
      if (cx + HR < vx0 || cx - HR > vx1 || cy + HR < vy0 || cy - HR > vy1) continue;

      const alive = cell[i] > 0;
      const hasTrail = trail[i] > 0;

      if (!alive && !hasTrail && !showGrid) continue;

      if (alive) {
        const age = cell[i];
        const c = col[i];
        const rgb = c === CR ? T.redA : c === CB ? T.blueA : c === CY ? T.yellowA : T.blueA;
        let alpha = 1.0;
        for (const tb of TB) {
          if (age >= tb.min && age <= tb.max) { alpha = tb.a; break; }
        }
        if (age >= ALIVE_T - 1) alpha = 0.7;
        if (age <= 5) alpha = 1.0;

        if (pxR >= 4) {
          ctx.fillStyle = c === CR ? "rgba(255,80,120,0.18)"
            : c === CB ? "rgba(80,210,255,0.18)"
            : "rgba(255,225,60,0.18)";
          drawHexPath(ctx, cx, cy, HR * 1.15);
          ctx.fill();
        }

        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
        drawHexPath(ctx, cx, cy, HR);
        ctx.fill();

        if (showGrid) {
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.3)`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      } else if (hasTrail) {
        const fa = (trail[i] / FADE) * 0.15;
        ctx.fillStyle = `rgba(92,240,204,${fa})`;
        drawHexPath(ctx, cx, cy, HR);
        ctx.fill();
        if (showGrid) {
          ctx.strokeStyle = T.stroke;
          ctx.lineWidth = 0.3;
          ctx.stroke();
        }
      } else if (showGrid) {
        drawHexPath(ctx, cx, cy, HR);
        ctx.strokeStyle = T.stroke;
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }
    }

    // ─── Stamp hover preview (ghost outline of pattern at pointer) ───
    const hi = hoverIdxRef.current;
    if (toolRef.current === "stamp" && hi >= 0 && hi < N) {
      const pat = PATS[PAT_NAMES[patIdxRef.current]];
      if (pat) {
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const [pr, pc] of pat.c) {
          if (pr < minR) minR = pr; if (pr > maxR) maxR = pr;
          if (pc < minC) minC = pc; if (pc > maxC) maxC = pc;
        }
        const offR = Math.floor((minR + maxR) / 2);
        const offC = Math.floor((minC + maxC) / 2);
        const cr = Math.floor(hi / g.C);
        const cc = hi % g.C;
        ctx.lineWidth = 1.4;
        for (const [pr, pc] of pat.c) {
          const r = cr + pr - offR, c = cc + pc - offC;
          if (r < 0 || r >= g.R || c < 0 || c >= g.C) continue;
          const idx = r * g.C + c;
          const gx = CX[idx], gy = CYA[idx];
          ctx.fillStyle = "rgba(92,240,204,0.18)";
          drawHexPath(ctx, gx, gy, HR);
          ctx.fill();
          ctx.strokeStyle = "rgba(92,240,204,0.7)";
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }, []);

  // ─── Animation loop (with frame-time budget for MAX-speed) ───
  const loop = useCallback(() => {
    if (!rR.current) {
      draw();
      return;
    }
    // v19.1 P1: gen-counter dirty check (see lastDrawnGenRef declaration)
    const now = performance.now();
    const spd = SPEEDS[speedRef.current];
    if (spd === 16) {
      // MAX speed: multiple steps per frame, but respect frame budget.
      // v18.5.1: XXL (N>20000) → only 1 step per frame so click events
      // get processed between frames. Smaller grids batch more aggressively.
      // v19.1 B4: at XXL with maxBatch=1, the inner loop was unreachable —
      // simplified to a single step + conditional 2nd-step gate.
      const g = gridRef.current;
      const N_ = g ? g.N : 0;
      const t0 = performance.now();
      step();
      if (N_ <= 20000) {
        // Smaller grids can afford a 2nd step if budget allows
        const tStep = performance.now() - t0;
        if (tStep < FRAME_BUDGET_MS) {
          const maxBatch = N_ > 8000 ? 4 : 8;
          for (let i = 1; i < maxBatch; i++) {
            step();
            if (performance.now() - t0 > FRAME_BUDGET_MS * 2) break;
          }
        }
      }
      // v19.1 B2: keep lastTickRef fresh so switching MAX → slower speed
      // doesn't immediately fire a stale-timestamp step.
      lastTickRef.current = now;
    } else if (now - lastTickRef.current >= spd) {
      step();
      lastTickRef.current = now;
    }
    // v19.1 P1: only redraw when sim advanced (saves ~⅔ frames at slow speeds)
    if (lastDrawnGenRef.current !== genRef.current) {
      lastDrawnGenRef.current = genRef.current;
      draw();
    }
    animRef.current = requestAnimationFrame(loop);
  }, [step, draw]);

  useEffect(() => {
    // Worker-mode draw loop (inline so deps stay clean)
    // v19.1 P2: gen-counter dirty check — draw only when worker posted new
    // state. Safe (not the v18.5.2 dirty-flag race): genRef.current is bumped
    // by w.onmessage when validated state arrives, lastDrawnGenRef is only
    // mutated by draws in this loop. Single-writer per ref → no race.
    const workerDrawLoop = () => {
      if (!rR.current) return;
      if (lastDrawnGenRef.current !== genRef.current) {
        lastDrawnGenRef.current = genRef.current;
        draw();
      }
      animRef.current = requestAnimationFrame(workerDrawLoop);
    };

    if (engineRef.current === "worker") {
      if (running) {
        postToWorker({ type: "start" });
        rR.current = true;
        if (!animRef.current) {
          animRef.current = requestAnimationFrame(workerDrawLoop);
        }
      } else {
        postToWorker({ type: "stop" });
        rR.current = false;
        if (animRef.current) {
          cancelAnimationFrame(animRef.current);
          animRef.current = null;
        }
        setGeneration(genRef.current);
        setPopulation(populationRef.current);
        draw();
      }
      return () => { if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; } };
    }
    // Main engine
    rR.current = running;
    if (running) {
      lastTickRef.current = performance.now();
      animRef.current = requestAnimationFrame(loop);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      setGeneration(genRef.current);
      setPopulation(populationRef.current);
      draw();
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [running, loop, draw, engine]);

  // ─── Screen → world ───
  const screenToWorld = useCallback((mx, my) => {
    const { ox, oy, zoom } = viewRef.current;
    return { wx: (mx - ox) / zoom, wy: (my - oy) / zoom };
  }, []);

  // ─── Apply zoom around screen point ───
  const applyZoom = useCallback((mx, my, newZoom) => {
    const { ox, oy, zoom } = viewRef.current;
    const nz = Math.max(0.1, Math.min(newZoom, 20));
    viewRef.current = {
      ox: mx - (mx - ox) * (nz / zoom),
      oy: my - (my - oy) * (nz / zoom),
      zoom: nz,
    };
    if (!rR.current) draw();
  }, [draw]);

  // ═══════════════════════════════════════════════════════════════════
  // HISTORY HELPERS — must be declared BEFORE every consumer (toggleAt,
  // paintAt-trigger in handlePointerMove, fillRandom, clearGrid).
  // Otherwise: TDZ — "Cannot access 'X' before initialization" at first render.
  // ═══════════════════════════════════════════════════════════════════
  // v19.1 H2: snapshot acquire/release through the pool.
  const MAX_HIST_POOL = 10;
  const acquireSnapshot = useCallback(() => {
    const g = gridRef.current;
    if (!g) return null;
    const free = histPoolRef.current.pop();
    if (free && free.cell && free.cell.length === g.N
              && free.cell.buffer.byteLength > 0) {
      return free;
    }
    return {
      cell: new Uint8Array(g.N),
      color: new Uint8Array(g.N),
      trail: new Int8Array(g.N),
      gen: 0, pop: 0, N: g.N,
    };
  }, []);
  const releaseSnapshot = useCallback((s) => {
    if (!s || !s.cell) return;
    if (histPoolRef.current.length < MAX_HIST_POOL
        && s.cell.buffer.byteLength > 0) {
      histPoolRef.current.push(s);
    }
  }, []);

  const clearHistory = useCallback(() => {
    // v19.1 H2: release all snapshots back to pool
    while (historyRef.current.length) releaseSnapshot(historyRef.current.pop());
    while (futureRef.current.length) releaseSnapshot(futureRef.current.pop());
    setHistoryCount(0);
    setFutureCount(0);
  }, [releaseSnapshot]);

  const recordChange = useCallback(() => {
    const g = gridRef.current;
    const cell = cellRef.current;
    const col = colorRef.current;
    const trail = trailRef.current;
    if (!g || !cell || !col || !trail) return;
    if (cell.length !== g.N) return; // alloc-race guard
    // v19.1 H2: get snapshot from pool (or fresh), copy current state into it.
    const snap = acquireSnapshot();
    if (!snap) return;
    snap.cell.set(cell);
    snap.color.set(col);
    snap.trail.set(trail);
    snap.gen = genRef.current;
    snap.pop = populationRef.current;
    historyRef.current.push(snap);
    if (historyRef.current.length > HISTORY_MAX) {
      releaseSnapshot(historyRef.current.shift());
    }
    // branch-on-edit: release all redo snapshots
    while (futureRef.current.length) releaseSnapshot(futureRef.current.pop());
    setHistoryCount(historyRef.current.length);
    setFutureCount(0);
  }, [acquireSnapshot, releaseSnapshot]);

  const applySnapshot = useCallback((snap) => {
    const g = gridRef.current;
    if (!g || !snap || snap.N !== g.N) return;
    rR.current = false;
    setRunning(false);
    if (engineRef.current === "worker") postToWorker({ type: "stop" });
    // v19.1 H2: copy into existing cellRef buffers when length matches —
    // saves 3 fresh allocations per undo/redo. Falls back to new Uint8Array
    // if buffers aren't ready (initial mount race) or got detached.
    const cR = cellRef.current, coR = colorRef.current, tR = trailRef.current;
    const buffersReusable = cR && coR && tR
      && cR.length === g.N && coR.length === g.N && tR.length === g.N
      && cR.buffer.byteLength > 0
      && coR.buffer.byteLength > 0
      && tR.buffer.byteLength > 0;
    if (buffersReusable) {
      cR.set(snap.cell);
      coR.set(snap.color);
      tR.set(snap.trail);
    } else {
      cellRef.current = new Uint8Array(snap.cell);
      colorRef.current = new Uint8Array(snap.color);
      trailRef.current = new Int8Array(snap.trail);
    }
    populationRef.current = snap.pop;
    genRef.current = snap.gen;
    lastStateUpdateRef.current = 0;
    lastDrawnGenRef.current = -1; // v19.1 P1/P2: force redraw (gen may equal last)
    setGeneration(snap.gen);
    setPopulation(snap.pop);
    if (engineRef.current === "worker") {
      // Worker sync needs allocations — buffers must be transferable copies.
      postToWorker({
        type: "setState",
        cell: new Uint8Array(snap.cell),
        color: new Uint8Array(snap.color),
        trail: new Int8Array(snap.trail),
        gen: snap.gen,
        pop: snap.pop,
      });
    }
    draw();
  }, [draw, postToWorker]);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const cell = cellRef.current, col = colorRef.current, trail = trailRef.current;
    const g = gridRef.current;
    if (!g || !cell) return;
    // v19.1 H2: pooled "current → future" snapshot
    const cur = acquireSnapshot();
    if (cur) {
      cur.cell.set(cell);
      cur.color.set(col);
      cur.trail.set(trail);
      cur.gen = genRef.current;
      cur.pop = populationRef.current;
      futureRef.current.push(cur);
    }
    const snap = hist.pop();
    setHistoryCount(hist.length);
    setFutureCount(futureRef.current.length);
    applySnapshot(snap);
    releaseSnapshot(snap); // applySnapshot copied data out; snap free
  }, [applySnapshot, acquireSnapshot, releaseSnapshot]);

  const redo = useCallback(() => {
    const fut = futureRef.current;
    if (fut.length === 0) return;
    const cell = cellRef.current, col = colorRef.current, trail = trailRef.current;
    const g = gridRef.current;
    if (!g || !cell) return;
    // v19.1 H2: pooled "current → history" snapshot
    const cur = acquireSnapshot();
    if (cur) {
      cur.cell.set(cell);
      cur.color.set(col);
      cur.trail.set(trail);
      cur.gen = genRef.current;
      cur.pop = populationRef.current;
      historyRef.current.push(cur);
      if (historyRef.current.length > HISTORY_MAX) {
        releaseSnapshot(historyRef.current.shift());
      }
    }
    const snap = fut.pop();
    setHistoryCount(historyRef.current.length);
    setFutureCount(fut.length);
    applySnapshot(snap);
    releaseSnapshot(snap);
  }, [applySnapshot, acquireSnapshot, releaseSnapshot]);

  // ─── Place pattern ───
  // v19.1 P3: delta-sync. Worker receives only the indices that changed
  // (typically ≤ 12 cells per stamp), not the full state blob (~150 KB at XXL).
  const placePattern = useCallback((centerRow, centerCol) => {
    const g = gridRef.current;
    const cell = cellRef.current;
    const col = colorRef.current;
    if (!g || !cell) return;
    const pat = PATS[PAT_NAMES[patIdxRef.current]];
    if (!pat) return;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [pr, pc] of pat.c) {
      minR = Math.min(minR, pr); maxR = Math.max(maxR, pr);
      minC = Math.min(minC, pc); maxC = Math.max(maxC, pc);
    }
    const offR = Math.floor((minR + maxR) / 2);
    const offC = Math.floor((minC + maxC) / 2);
    const colors = [CR, CB, CY];
    const c = colors[Math.floor(Math.random() * 3)];
    // v19.1 P3: collect changed indices for delta-sync to worker
    const patLen = pat.c.length;
    const idxBuf = new Int32Array(patLen);
    const aliveBuf = new Uint8Array(patLen);
    const colBuf = new Uint8Array(patLen);
    let nChanged = 0, added = 0;
    for (const [pr, pc] of pat.c) {
      const r = centerRow + pr - offR;
      const cc = centerCol + pc - offC;
      if (r >= 0 && r < g.R && cc >= 0 && cc < g.C) {
        const idx = r * g.C + cc;
        if (cell[idx] === 0) added++;
        cell[idx] = 1;
        col[idx] = c;
        idxBuf[nChanged] = idx;
        aliveBuf[nChanged] = 1;
        colBuf[nChanged] = c;
        nChanged++;
      }
    }
    populationRef.current += added;
    setPopulation(populationRef.current);
    if (engineRef.current === "worker" && nChanged > 0) {
      // Send only the affected indices (Transferable) — saves N-sized post
      const idxT = idxBuf.slice(0, nChanged);
      const aliveT = aliveBuf.slice(0, nChanged);
      const colT = colBuf.slice(0, nChanged);
      try {
        workerRef.current && workerRef.current.postMessage(
          { type: "setCells", idx: idxT, alive: aliveT, color: colT, popDelta: added },
          [idxT.buffer, aliveT.buffer, colT.buffer]
        );
      } catch (_) { /* fine */ }
    }
    draw();
  }, [draw]);

  // ─── Toggle cell at screen position ───
  const toggleAt = useCallback((mx, my) => {
    const g = gridRef.current;
    if (!g) return;
    const { wx, wy } = screenToWorld(mx, my);
    const idx = pixelToOddR(wx, wy, g.HR, g.R, g.C);
    if (idx < 0) return;
    recordChange(); // snapshot before mutation (tap or stamp)
    if (toolRef.current === "stamp") {
      const row = Math.floor(idx / g.C);
      const c = idx % g.C;
      placePattern(row, c);
      return;
    }
    const cell = cellRef.current;
    const colA = colorRef.current;
    let newAlive, newColor;
    if (cell[idx] > 0) {
      cell[idx] = 0;
      colA[idx] = C0;
      populationRef.current = Math.max(0, populationRef.current - 1);
      newAlive = false; newColor = 0;
    } else {
      cell[idx] = 1;
      const colors = [CR, CB, CY];
      newColor = colors[Math.floor(Math.random() * 3)];
      colA[idx] = newColor;
      populationRef.current++;
      newAlive = true;
    }
    setPopulation(populationRef.current);
    // Inform worker
    if (engineRef.current === "worker") {
      postToWorker({ type: "setCell", idx, alive: newAlive, color: newColor });
    }
    if (!rR.current) draw();
    return idx;
  }, [screenToWorld, placePattern, draw, postToWorker, recordChange]);

  // ─── Paint alive at screen position (drag) ───
  const paintAt = useCallback((mx, my, lastIdx) => {
    const g = gridRef.current;
    if (!g) return lastIdx;
    const { wx, wy } = screenToWorld(mx, my);
    const idx = pixelToOddR(wx, wy, g.HR, g.R, g.C);
    if (idx < 0 || idx === lastIdx) return lastIdx;
    const cell = cellRef.current;
    const colA = colorRef.current;
    if (cell[idx] === 0) {
      cell[idx] = 1;
      const colors = [CR, CB, CY];
      const nc = colors[Math.floor(Math.random() * 3)];
      colA[idx] = nc;
      populationRef.current++;
      setPopulation(populationRef.current);
      if (engineRef.current === "worker") {
        postToWorker({ type: "setCell", idx, alive: true, color: nc });
      }
      if (!rR.current) draw();
    }
    return idx;
  }, [screenToWorld, draw, postToWorker]);

  // ═══════════════════════════════════════════════════════════════════
  // POINTER HANDLERS — Dead-Zone-Drag pattern (Steve Ruiz)
  // ═══════════════════════════════════════════════════════════════════
  const handlePointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    pointersRef.current.set(e.pointerId, {
      sx: mx, sy: my,
      lx: mx, ly: my,
      st: performance.now(),
      moved: false,
      mode: "tap",
      lastIdx: -1,
      button: e.button,
      isTouch: e.pointerType === "touch",
      panStart: { ...viewRef.current },
    });

    // Two-pointer touch → pinch
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].lx - pts[1].lx;
      const dy = pts[0].ly - pts[1].ly;
      pinchRef.current = {
        dist: Math.hypot(dx, dy),
        cx: (pts[0].lx + pts[1].lx) / 2,
        cy: (pts[0].ly + pts[1].ly) / 2,
        zoom: viewRef.current.zoom,
        ox: viewRef.current.ox,
        oy: viewRef.current.oy,
      };
      // Cancel any drawing
      for (const p of pointersRef.current.values()) {
        p.mode = "pinch";
        p.moved = true;
      }
    }
  }, []);

  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const p = pointersRef.current.get(e.pointerId);
    // Hover preview for stamp tool (no captured pointer)
    if (!p) {
      if (toolRef.current === "stamp" && e.pointerType !== "touch") {
        const g = gridRef.current;
        if (g) {
          const { wx, wy } = screenToWorld(mx, my);
          const idx = pixelToOddR(wx, wy, g.HR, g.R, g.C);
          if (idx !== hoverIdxRef.current) {
            hoverIdxRef.current = idx;
            if (!rR.current) draw();
          }
        }
      }
      return;
    }

    // Pinch handling
    if (pinchRef.current && pointersRef.current.size === 2) {
      // Update this pointer's position
      p.lx = mx;
      p.ly = my;
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].lx - pts[1].lx;
      const dy = pts[0].ly - pts[1].ly;
      const dist = Math.hypot(dx, dy);
      const cx = (pts[0].lx + pts[1].lx) / 2;
      const cy = (pts[0].ly + pts[1].ly) / 2;
      const pi = pinchRef.current;
      const scale = dist / pi.dist;
      const nz = Math.max(0.1, Math.min(pi.zoom * scale, 20));
      // Apply zoom around pinch center, plus pan delta
      const panDx = cx - pi.cx;
      const panDy = cy - pi.cy;
      viewRef.current = {
        ox: cx - (cx - (pi.ox + panDx)) * (nz / pi.zoom),
        oy: cy - (cy - (pi.oy + panDy)) * (nz / pi.zoom),
        zoom: nz,
      };
      if (!rR.current) draw();
      return;
    }

    // Dead-Zone-Drag: measure drift against ORIGINAL pointerdown
    const driftX = mx - p.sx;
    const driftY = my - p.sy;
    const drift = Math.hypot(driftX, driftY);

    if (!p.moved) {
      // POINTING state: still in dead-zone
      // v18.5.1: pointer-type-aware threshold (touch needs more slack)
      const threshold = p.isTouch ? TAP_THRESHOLD_TOUCH : TAP_THRESHOLD_MOUSE;
      if (drift < threshold) {
        // Do NOT update lx/ly; do NOT pan
        return;
      }
      // Threshold crossed → determine mode
      p.moved = true;
      // Modifier keys or non-primary button → pan
      // For draw tool: drag = paint
      // For stamp tool: drag = pan (stamp is tap-only)
      const isPan = e.ctrlKey || e.shiftKey || e.metaKey
        || p.button === 1 || p.button === 2
        || toolRef.current === "stamp";
      p.mode = isPan ? "pan" : "draw";
      // Consume accumulated drift on first move
      p.lx = mx;
      p.ly = my;
      if (p.mode === "draw") {
        // Snapshot once per drag-stroke (not per painted cell)
        recordChange();
        // Start painting from current position
        p.lastIdx = paintAt(mx, my, -1);
      }
      return;
    }

    // DRAGGING state: incremental delta
    const incX = mx - p.lx;
    const incY = my - p.ly;
    p.lx = mx;
    p.ly = my;

    if (p.mode === "pan") {
      viewRef.current = {
        ...viewRef.current,
        ox: viewRef.current.ox + incX,
        oy: viewRef.current.oy + incY,
      };
      if (!rR.current) draw();
    } else if (p.mode === "draw") {
      p.lastIdx = paintAt(mx, my, p.lastIdx);
    }
    // mode === "none" or "pinch": ignore (survivor of pinch, or pinch ongoing)
  }, [paintAt, draw, screenToWorld, recordChange]);

  const handlePointerUp = useCallback((e) => {
    const p = pointersRef.current.get(e.pointerId);
    if (!p) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const dt = performance.now() - p.st;

    // Only fire tap if this wasn't a pinch participant
    if (!p.moved && dt < TAP_TIME_MAX && p.mode !== "pinch") {
      toggleAt(p.sx, p.sy);
    }

    pointersRef.current.delete(e.pointerId);

    // When one finger of a pinch lifts, cancel pinch; reset survivor to neutral.
    // Treat the survivor as already-moved so it cannot tap, but ALSO clear
    // its accumulated state by using the current position as new origin.
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      for (const surv of pointersRef.current.values()) {
        // Reset survivor: mark as moved (no spurious tap), no pan/draw mode,
        // and update sx/sy/lx/ly to current pos so future moves are relative
        // to right now, not the original pinch start.
        surv.moved = true;
        surv.mode = "none";
        surv.sx = surv.lx;
        surv.sy = surv.ly;
      }
    }
  }, [toggleAt]);

  const handlePointerLeave = useCallback(() => {
    if (hoverIdxRef.current !== -1) {
      hoverIdxRef.current = -1;
      if (!rR.current) draw();
    }
  }, [draw]);

  const handlePointerCancel = useCallback((e) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      for (const surv of pointersRef.current.values()) {
        surv.moved = true;
        surv.mode = "none";
        surv.sx = surv.lx;
        surv.sy = surv.ly;
      }
    }
  }, []);

  // ─── Native wheel listener with passive:false (iOS Safari fix) ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyZoom(mx, my, viewRef.current.zoom * factor);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // ─── iOS gesture event prevention ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prevent = (e) => e.preventDefault();
    canvas.addEventListener("gesturestart", prevent, { passive: false });
    canvas.addEventListener("gesturechange", prevent, { passive: false });
    canvas.addEventListener("gestureend", prevent, { passive: false });
    return () => {
      canvas.removeEventListener("gesturestart", prevent);
      canvas.removeEventListener("gesturechange", prevent);
      canvas.removeEventListener("gestureend", prevent);
    };
  }, []);

  // ─── Suppress context menu ───
  const handleContext = useCallback((e) => e.preventDefault(), []);

  // ─── Actions ───
  const fillRandom = useCallback(() => {
    const g = gridRef.current;
    const cell = cellRef.current;
    const col = colorRef.current;
    const trail = trailRef.current;
    if (!g || !cell) return;
    recordChange(); // snapshot before random-fill
    const dens = DENS[densIdx];
    // If worker active, let worker do the fill (avoids large state postMessage)
    if (engineRef.current === "worker") {
      if (postToWorker({ type: "fillRandom", dens })) return;
      // fallthrough to main-thread fill if post failed
    }
    const colors = [CR, CB, CY];
    let pop = 0;
    for (let i = 0; i < g.N; i++) {
      if (Math.random() < dens) {
        cell[i] = 1;
        col[i] = colors[Math.floor(Math.random() * 3)];
        pop++;
      } else {
        cell[i] = 0;
        col[i] = C0;
      }
      trail[i] = 0;
    }
    populationRef.current = pop;
    setPopulation(pop);
    genRef.current = 0;
    setGeneration(0);
    lastStateUpdateRef.current = 0;
    if (!rR.current) draw();
  }, [densIdx, draw, postToWorker, recordChange]);

  const clearGrid = useCallback(() => {
    const g = gridRef.current;
    if (!g) return;
    recordChange();
    if (engineRef.current === "worker") {
      if (postToWorker({ type: "clear" })) return;
    }
    cellRef.current.fill(0);
    colorRef.current.fill(0);
    trailRef.current.fill(0);
    cellBRef.current.fill(0);
    colorBRef.current.fill(0);
    trailBRef.current.fill(0);
    populationRef.current = 0;
    genRef.current = 0;
    lastStateUpdateRef.current = 0;
    setGeneration(0);
    setPopulation(0);
    if (!rR.current) draw();
  }, [draw, postToWorker, recordChange]);

  const changeGridSize = useCallback((idx) => {
    rR.current = false;
    setRunning(false);
    if (engineRef.current === "worker") {
      postToWorker({ type: "stop" });
    }
    setGridSizeIdx(idx);
    initGrid(idx);
    clearHistory(); // snapshots have wrong N after resize
    // Re-init worker with new topology
    if (engineRef.current === "worker" && !workerDisabled) {
      setupWorker();
      // Defer sendInit slightly to ensure worker has spun up
      setTimeout(() => sendInitToWorker(), 0);
    }
  }, [initGrid, setupWorker, sendInitToWorker, postToWorker, workerDisabled, clearHistory]);

  const fitView = useCallback(() => {
    const g = gridRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const { w, h } = canvasSizeRef.current;
    const zx = w / g.GW, zy = h / g.GH;
    const z = Math.min(zx, zy) * 0.95;
    viewRef.current = {
      ox: (w - g.GW * z) / 2,
      oy: (h - g.GH * z) / 2,
      zoom: z,
    };
    if (!rR.current) draw();
  }, [draw]);

  const stepOnce = useCallback(() => {
    if (engineRef.current === "worker") {
      if (postToWorker({ type: "step" })) return;
    }
    step();
    draw();
  }, [step, draw, postToWorker]);

  const zoomBtn = useCallback((dir) => {
    const { w, h } = canvasSizeRef.current;
    const factor = dir > 0 ? 1.3 : 1 / 1.3;
    applyZoom(w / 2, h / 2, viewRef.current.zoom * factor);
  }, [applyZoom]);

  // ─── Init on mount ───
  // v19.1 C3: consolidated 50ms initial-draw timeout into ResizeObserver path.
  // The observer fires on initial layout anyway and reliably triggers draw.
  // A microtask-scheduled draw covers the (rare) case where RO doesn't fire
  // immediately (e.g. element already at final size).
  useEffect(() => {
    resizeCanvas();
    initGrid(0);
    const ro = new ResizeObserver(() => {
      resizeCanvas();
      if (!rR.current) {
        lastDrawnGenRef.current = -1; // force redraw next frame
        draw();
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    // Microtask draw: covers no-layout-change cases
    Promise.resolve().then(() => { if (!rR.current) draw(); });
    return () => ro.disconnect();
  }, [resizeCanvas, initGrid, draw]);

  useEffect(() => { ruleRef.current = ruleIdx; if (engineRef.current === "worker") postToWorker({ type: "setRule", idx: ruleIdx }); }, [ruleIdx, postToWorker]);
  useEffect(() => { torusRef.current = torus; if (engineRef.current === "worker") postToWorker({ type: "setTorus", v: torus }); }, [torus, postToWorker]);
  useEffect(() => { speedRef.current = speedIdx; if (engineRef.current === "worker") postToWorker({ type: "setSpeed", spd: SPEEDS[speedIdx] }); }, [speedIdx, postToWorker]);
  useEffect(() => {
    toolRef.current = tool;
    if (tool !== "stamp" && hoverIdxRef.current !== -1) {
      hoverIdxRef.current = -1;
      if (!rR.current) draw();
    }
  }, [tool, draw]);
  useEffect(() => { patIdxRef.current = patIdx; }, [patIdx]);

  // Engine switching (single source of truth)
  // The `running` effect below handles starting/stopping the loop in each mode.
  // This effect only handles worker setup/teardown and pauses the loop during
  // the switch to avoid double-RAF / double-start races.
  useEffect(() => {
    // Auto-revert to main if worker became disabled mid-session
    if (engine === "worker" && workerDisabled) {
      setEngine("main");
      return;
    }
    engineRef.current = engine;
    // Pause any in-flight loop while we transition
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    rR.current = false;
    if (engine === "worker") {
      const w = setupWorker();
      if (w) sendInitToWorker();
    } else {
      postToWorker({ type: "stop" });
      teardownWorker();
    }
    // The `running` useEffect below has `engine` in deps and will re-run
    // automatically, restarting the loop on the new engine if needed.
    // v19.1 B3+C4: removed dead `wasRunning` stub-block — re-trigger happens
    // implicitly via the dep on `engine` in the running useEffect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, workerDisabled]);

  // Cleanup worker on unmount
  useEffect(() => () => teardownWorker(), [teardownWorker]);

  // v19.0: Page Visibility API — tab hidden auto-pauses sim. Tab-hidden
  // rAFs throttle in browsers anyway; explicit pause avoids the awkward
  // post-resume burst of catch-up frames + makes user intent explicit.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && rR.current) {
        setRunning(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // v19.0: beforeunload — explicit worker teardown so no orphan worker
  // threads survive page-close (matters on PWA / installed-app contexts).
  useEffect(() => {
    const onBye = () => { try { teardownWorker(); } catch (_) {} };
    window.addEventListener("beforeunload", onBye);
    return () => window.removeEventListener("beforeunload", onBye);
  }, [teardownWorker]);

  // ═══════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  //   Space    Play / Pause
  //   S        Single step
  //   R        Random fill
  //   C        Clear
  //   F        Fit view
  //   1..5     Grid size S..XXL
  //   T        Toggle Torus / Edge
  //   E        Toggle Engine (if Worker available)
  //   D        Tool: Draw
  //   P        Tool: Stamp (place pattern)
  //   ?        Toggle rules legend
  //   M        Toggle "More" panel
  //   +/-      Zoom in/out around center
  //   Esc      Close panels
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when typing in an input
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // Undo / Redo must be handled BEFORE the generic modifier-skip below.
      // Ctrl+Z = Undo, Ctrl+Y or Ctrl+Shift+Z = Redo (also Cmd on macOS).
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const kl = e.key.toLowerCase();
        if (kl === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (kl === "y" || (kl === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); setRunning(r => !r); return; }
      if (k === "s" || k === "S") { e.preventDefault(); stepOnce(); return; }
      if (k === "r" || k === "R") { e.preventDefault(); fillRandom(); return; }
      if (k === "c" || k === "C") { e.preventDefault(); clearGrid(); return; }
      if (k === "f" || k === "F") { e.preventDefault(); fitView(); return; }
      if (k === "t" || k === "T") { e.preventDefault(); setTorus(v => !v); return; }
      if (k === "e" || k === "E") {
        e.preventDefault();
        if (!workerDisabled) setEngine(en => en === "main" ? "worker" : "main");
        return;
      }
      if (k === "d" || k === "D") { e.preventDefault(); setTool("draw"); return; }
      if (k === "p" || k === "P") { e.preventDefault(); setTool("stamp"); return; }
      if (k === "?" || (k === "/" && e.shiftKey)) {
        e.preventDefault(); setShowRules(v => !v); return;
      }
      if (k === "m" || k === "M") { e.preventDefault(); setShowAdvanced(v => !v); return; }
      if (k === "Escape") {
        e.preventDefault();
        setShowRules(false); setShowAdvanced(false);
        return;
      }
      if (k === "+" || k === "=") { e.preventDefault(); zoomBtn(1); return; }
      if (k === "-" || k === "_") { e.preventDefault(); zoomBtn(-1); return; }
      // Number keys: grid size (1..5)
      if (k >= "1" && k <= "5") {
        e.preventDefault();
        const idx = parseInt(k, 10) - 1;
        if (idx >= 0 && idx < GRID_SIZES.length) changeGridSize(idx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepOnce, fillRandom, clearGrid, fitView, changeGridSize, zoomBtn, workerDisabled, undo, redo]);

  // ═══════════════════════════════════════════════════════════════════
  // UI STYLES
  // ═══════════════════════════════════════════════════════════════════
  // v19.1 C1: monoStack is the same value as module-scope _monoStack used by
  // memoized Btn. We keep the local alias for the (component-scope) styles
  // object below — single source of truth via _monoStack.
  const fontStack = "'Space Grotesk', 'Inter', system-ui, sans-serif";
  const monoStack = _monoStack;

  const styles = {
    root: {
      width: "100%", height: "100vh", overflow: "hidden",
      display: "flex", flexDirection: "column",
      background: `radial-gradient(ellipse at top, ${T.bg3} 0%, ${T.bg} 60%)`,
      color: T.text, fontFamily: fontStack,
    },
    topbar: {
      display: "flex", alignItems: "center", padding: "10px 14px",
      background: `linear-gradient(180deg, ${T.bg2} 0%, ${T.bg2}DD 100%)`,
      borderBottom: `1px solid ${T.panelBd}`,
      gap: 14, flexShrink: 0,
    },
    brand: {
      fontFamily: fontStack, fontSize: 16, fontWeight: 700,
      letterSpacing: "-0.02em", color: T.accent,
      textShadow: `0 0 12px ${T.accent}55`,
    },
    brandSub: {
      fontFamily: monoStack, fontSize: 9, color: T.muted,
      letterSpacing: "0.15em", textTransform: "uppercase",
      marginLeft: 4,
    },
    statRow: {
      display: "flex", gap: 14, marginLeft: "auto",
      fontFamily: monoStack, fontSize: 10, color: T.sub,
    },
    statItem: {
      display: "flex", flexDirection: "column", lineHeight: 1.1,
    },
    statLbl: {
      color: T.muted, fontSize: 8, letterSpacing: "0.15em",
      textTransform: "uppercase",
    },
    statVal: {
      color: T.accent, fontSize: 13, fontWeight: 600,
      fontFamily: monoStack,
    },
    toolbar: {
      display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 14px",
      background: T.panel, backdropFilter: "blur(8px)",
      borderBottom: `1px solid ${T.panelBd}`,
      alignItems: "center", flexShrink: 0,
    },
    group: {
      display: "flex", alignItems: "center", gap: 4,
      padding: "4px 6px", borderRadius: 8,
      background: "rgba(7, 15, 19, 0.5)",
      border: `1px solid ${T.stroke}`,
    },
    groupLbl: {
      fontFamily: monoStack, fontSize: 9, color: T.muted,
      letterSpacing: "0.12em", textTransform: "uppercase",
      marginRight: 4, paddingLeft: 4,
    },
    btn: {
      background: T.btn, color: T.text,
      border: `1px solid ${T.stroke}`,
      borderRadius: 6, padding: "6px 10px", cursor: "pointer",
      fontFamily: monoStack, fontSize: 11, fontWeight: 500,
      whiteSpace: "nowrap", transition: "all 0.15s ease",
      minHeight: 30, minWidth: 30,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
    },
    btnActive: {
      background: T.btnAct,
      borderColor: T.btnActBd,
      color: T.accent,
      boxShadow: `0 0 8px ${T.accent}33, inset 0 0 8px ${T.accent}11`,
    },
    btnIcon: {
      minWidth: 36, minHeight: 36, padding: "6px 8px",
      fontSize: 13,
    },
    select: {
      background: T.btn, color: T.text,
      border: `1px solid ${T.stroke}`,
      borderRadius: 6, padding: "6px 8px",
      fontFamily: monoStack, fontSize: 11, fontWeight: 500,
      cursor: "pointer", outline: "none",
      WebkitTapHighlightColor: "transparent",
    },
    divider: {
      width: 1, height: 22,
      background: `linear-gradient(180deg, transparent, ${T.accent}44, transparent)`,
      margin: "0 4px",
    },
    rulesPanel: {
      padding: "12px 18px",
      background: `linear-gradient(180deg, ${T.bg3} 0%, ${T.bg2} 100%)`,
      borderBottom: `1px solid ${T.panelBd}`,
      fontFamily: monoStack, fontSize: 11, lineHeight: 1.7,
      color: T.sub,
      maxHeight: 220, overflowY: "auto",
    },
    rulesTitle: {
      fontFamily: fontStack, fontSize: 14, fontWeight: 600,
      color: T.accent, marginBottom: 8, letterSpacing: "-0.01em",
    },
    canvasWrap: {
      flex: 1, position: "relative", overflow: "hidden",
      background: T.bg,
    },
    canvas: {
      display: "block",
      cursor: tool === "stamp" ? "crosshair" : "cell",
      touchAction: "none",
      WebkitUserSelect: "none",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
    },
    floatControls: {
      position: "absolute", right: 14, bottom: 14,
      display: "flex", flexDirection: "column", gap: 6,
      zIndex: 10,
    },
    floatBtn: {
      background: T.panel, backdropFilter: "blur(12px)",
      border: `1px solid ${T.panelBd}`,
      borderRadius: 10, width: 44, height: 44,
      color: T.accent, cursor: "pointer",
      fontFamily: monoStack, fontSize: 16, fontWeight: 600,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.15s ease",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
    },
    hint: {
      position: "absolute", left: 14, bottom: 14,
      padding: "6px 10px",
      background: T.panel, backdropFilter: "blur(8px)",
      border: `1px solid ${T.stroke}`,
      borderRadius: 8,
      fontFamily: monoStack, fontSize: 10, color: T.muted,
      letterSpacing: "0.05em",
      pointerEvents: "none",
      maxWidth: "60%",
      lineHeight: 1.5,
    },
  };

  // v19.1 C2/C5: Dot was inline (re-created each render). Moved to module scope.
  // Stable callbacks so memoized Btn doesn't re-render on every gen/pop tick.
  const toggleRunning = useCallback(() => setRunning(r => !r), []);
  const onToolDraw = useCallback(() => setTool("draw"), []);
  const onToolStamp = useCallback(() => setTool("stamp"), []);
  const onEngineMain = useCallback(() => setEngine("main"), []);
  const onEngineWorker = useCallback(() => { if (!workerDisabled) setEngine("worker"); }, [workerDisabled]);
  const toggleAdvanced = useCallback(() => setShowAdvanced(s => !s), []);
  const toggleRules = useCallback(() => setShowRules(s => !s), []);
  const onTorusOn = useCallback(() => setTorus(true), []);
  const onTorusOff = useCallback(() => setTorus(false), []);
  const onZoomIn = useCallback(() => zoomBtn(1), [zoomBtn]);
  const onZoomOut = useCallback(() => zoomBtn(-1), [zoomBtn]);
  // Parametric buttons: stable per-index handlers via useMemo.
  const onSpeedClicks = useMemo(() => SPLBL.map((_, i) => () => setSpeedIdx(i)), []);
  const onGridClicks = useMemo(
    () => GRID_SIZES.map((_, i) => () => changeGridSize(i)),
    [changeGridSize]
  );
  const onDensClicks = useMemo(() => DENS.map((_, i) => () => setDensIdx(i)), []);

  return (
    <div style={styles.root}>
      {/* Embedded font from Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${T.bg}; }
        select option { background: ${T.bg2}; color: ${T.text}; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bg2}; }
        ::-webkit-scrollbar-thumb { background: ${T.accent}44; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${T.accent}88; }
      `}</style>

      {/* ─── Top bar ─── */}
      <div style={styles.topbar}>
        <div>
          <span style={styles.brand}>GolHex</span>
          <span style={styles.brandSub}>v19.1</span>
        </div>
        <StatBar
          generation={generation}
          population={population}
          gridLbl={GRID_SIZES[gridSizeIdx].l}
          ruleLbl={RULES[ruleIdx].l}
          torus={torus}
          engine={engine}
          styles={styles}
        />
      </div>

      {/* ─── Primary toolbar ─── */}
      <div style={styles.toolbar}>
        {/* Play group */}
        <div style={styles.group}>
          <Btn icon active={running} onClick={toggleRunning}
            title={running ? "Pause" : "Start"}>
            {running ? "\u23F8" : "\u25B6"}
          </Btn>
          <Btn icon onClick={stepOnce} title="Ein Schritt">+1</Btn>
          <Btn icon onClick={fillRandom} title="Zufaellig fuellen">{"\u2735"}</Btn>
          <Btn icon onClick={clearGrid} title="Leeren">{"\u00D7"}</Btn>
          <Btn icon onClick={undo} disabled={historyCount === 0}
            title={`Rueckgaengig (Ctrl+Z) \u2014 ${historyCount} verfuegbar`}>{"\u21B6"}</Btn>
          <Btn icon onClick={redo} disabled={futureCount === 0}
            title={`Wiederholen (Ctrl+Y) \u2014 ${futureCount} verfuegbar`}>{"\u21B7"}</Btn>
        </div>

        {/* Tool group */}
        <div style={styles.group}>
          <span style={styles.groupLbl}>Werkzeug</span>
          <Btn active={tool === "draw"} onClick={onToolDraw}>Zeichnen</Btn>
          <Btn active={tool === "stamp"} onClick={onToolStamp}>Stempel</Btn>
          {tool === "stamp" && (
            <select style={styles.select} value={patIdx} onChange={e => setPatIdx(+e.target.value)}>
              {PAT_NAMES.map((n, i) => (
                <option key={i} value={i}>{n}</option>
              ))}
            </select>
          )}
        </div>

        {/* Speed group */}
        <div style={styles.group}>
          <span style={styles.groupLbl}>Tempo</span>
          {SPLBL.map((s, i) => (
            <Btn key={i} active={i === speedIdx} onClick={onSpeedClicks[i]}>
              {s}
            </Btn>
          ))}
        </div>

        {/* Grid size group */}
        <div style={styles.group}>
          <span style={styles.groupLbl}>Groesse</span>
          {GRID_SIZES.map((gs, i) => (
            <Btn key={i} active={i === gridSizeIdx} onClick={onGridClicks[i]}>
              {gs.l}
            </Btn>
          ))}
        </div>

        {/* Engine */}
        <div style={styles.group}>
          <span style={styles.groupLbl}>Engine</span>
          <Btn active={engine === "main"} onClick={onEngineMain} title="Main Thread (default)">Main</Btn>
          <Btn
            active={engine === "worker"}
            onClick={onEngineWorker}
            disabled={workerDisabled}
            title={workerDisabled ? "Worker in dieser Session deaktiviert" : "Web Worker (off main thread)"}
          >{workerDisabled ? "Worker ⊘" : "Worker"}</Btn>
        </div>

        {/* Show advanced toggle */}
        <Btn active={showAdvanced} onClick={toggleAdvanced}>
          {showAdvanced ? "\u25B2" : "\u25BC"} Mehr
        </Btn>

        <Btn active={showRules} onClick={toggleRules}>
          ? Regeln
        </Btn>
      </div>

      {/* ─── Advanced toolbar ─── */}
      {showAdvanced && (
        <div style={styles.toolbar}>
          {/* Rule */}
          <div style={styles.group}>
            <span style={styles.groupLbl}>Regel</span>
            <select style={styles.select} value={ruleIdx} onChange={e => setRuleIdx(+e.target.value)}>
              {RULES.map((r, i) => (
                <option key={i} value={i}>{r.l}</option>
              ))}
            </select>
          </div>

          {/* Density */}
          <div style={styles.group}>
            <span style={styles.groupLbl}>Dichte</span>
            {DENS.map((d, i) => (
              <Btn key={i} active={i === densIdx} onClick={onDensClicks[i]}>
                {Math.round(d * 100)}%
              </Btn>
            ))}
          </div>

          {/* Topology */}
          <div style={styles.group}>
            <span style={styles.groupLbl}>Topo</span>
            <Btn active={torus} onClick={onTorusOn}>Torus</Btn>
            <Btn active={!torus} onClick={onTorusOff}>Rand</Btn>
          </div>
        </div>
      )}

      {/* ─── Rules legend ─── */}
      {showRules && (
        <div style={styles.rulesPanel}>
          <div style={styles.rulesTitle}>Hexagonales Game of Life</div>
          <div>
            Jede Zelle hat <span style={{ color: T.accent }}>6 Nachbarn</span> (Pointy-Top-Hex).
          </div>
          <div>
            <span style={{ color: T.text }}>B</span> = Geburt — tote Zelle wird lebendig wenn sie genau B Nachbarn hat.
          </div>
          <div>
            <span style={{ color: T.text }}>S</span> = Ueberleben — lebende Zelle bleibt am Leben wenn sie genau S Nachbarn hat.
          </div>
          <div style={{ marginTop: 6 }}>
            <Dot c={T.red} />Rot
            <Dot c={T.blue} />Blau
            <Dot c={T.yellow} />Gelb
            — Farbe wird von der Mehrheit der Nachbarn geerbt.
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ color: T.accent }}>Trail</span>: sterbende Zellen hinterlassen einen verblassenden Schatten ({FADE} Schritte).
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ color: T.accent }}>Torus</span>: Raender verbinden sich gegenueberliegend.
            <span style={{ color: T.accent, marginLeft: 8 }}>Rand</span>: Zellen am Rand haben weniger Nachbarn.
          </div>
          <div style={{ marginTop: 6, color: T.text, fontSize: 10 }}>
            Steuerung: <span style={{ color: T.accent }}>Tap/Click</span> = Zelle toggle,
            &nbsp;<span style={{ color: T.accent }}>Drag</span> = malen (Zeichnen-Modus),
            &nbsp;<span style={{ color: T.accent }}>Ctrl/Shift+Drag</span> oder <span style={{ color: T.accent }}>Pinch</span> = pan/zoom,
            &nbsp;<span style={{ color: T.accent }}>Scroll</span> = Zoom
          </div>
          <div style={{ marginTop: 8, color: T.text, fontSize: 10 }}>
            Tastatur:
            &nbsp;<span style={{ color: T.accent }}>Leertaste</span> Play/Pause,
            &nbsp;<span style={{ color: T.accent }}>S</span> Schritt,
            &nbsp;<span style={{ color: T.accent }}>R</span> Zufall,
            &nbsp;<span style={{ color: T.accent }}>C</span> Leeren,
            &nbsp;<span style={{ color: T.accent }}>F</span> Fit,
            &nbsp;<span style={{ color: T.accent }}>1–5</span> Grid,
            &nbsp;<span style={{ color: T.accent }}>T</span> Torus,
            &nbsp;<span style={{ color: T.accent }}>E</span> Engine,
            &nbsp;<span style={{ color: T.accent }}>D/P</span> Tool,
            &nbsp;<span style={{ color: T.accent }}>+/−</span> Zoom,
            &nbsp;<span style={{ color: T.accent }}>?</span> Regeln,
            &nbsp;<span style={{ color: T.accent }}>M</span> Mehr,
            &nbsp;<span style={{ color: T.accent }}>Strg+Z</span> Undo,
            &nbsp;<span style={{ color: T.accent }}>Strg+Y</span> Redo,
            &nbsp;<span style={{ color: T.accent }}>Esc</span> schliessen
          </div>
        </div>
      )}

      {/* Engine notice toast */}
      {engineNotice && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          padding: "8px 14px", background: T.panel, backdropFilter: "blur(10px)",
          border: `1px solid ${T.red}88`, borderRadius: 8,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: T.text, zIndex: 100,
          boxShadow: `0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px ${T.red}33`,
        }}>{engineNotice}</div>
      )}

      {/* ─── Canvas ─── */}
      <div ref={containerRef} style={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          style={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContext}
        />
        {/* Floating zoom controls */}
        <div style={styles.floatControls}>
          <button style={styles.floatBtn} onClick={onZoomIn} title="Zoom in">+</button>
          <button style={styles.floatBtn} onClick={onZoomOut} title="Zoom out">{"\u2212"}</button>
          <button style={{ ...styles.floatBtn, fontSize: 11 }} onClick={fitView} title="Fit">FIT</button>
        </div>
        {/* Hint */}
        <div style={styles.hint}>
          {tool === "draw"
            ? "Tap = Zelle | Drag = malen | Pinch/Scroll = Zoom | Leertaste = Play"
            : `Tap = ${PAT_NAMES[patIdx]} platzieren | Pinch/Scroll = Zoom | D = Zeichnen`}
        </div>
      </div>
    </div>
  );
}

// ─── Default export: GolHexInner wrapped in ErrorBoundary ───
export default function GolHex() {
  return (
    <ErrorBoundary>
      <GolHexInner />
    </ErrorBoundary>
  );
}
