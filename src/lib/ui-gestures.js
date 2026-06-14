// Pure UI-gesture + app-shell decision helpers (no DOM, no React).
// Extracted so the load-bearing logic is unit-testable (Coworkerz GolHex style:
// pure cores in src/lib/, see recorder.js / worker-support.js precedent).
//
// Decisions that live here:
//   1. shouldStartPan(idx, mask) — frame-pan hit-test (Marco bug 2026-06-09:
//      touching the BLACK margin around the framed field must NOT move the frame).
//   2. decideCloseAction(env)   — platform-honest "close the whole app" dispatch
//      (Marco bug 2026-06-09: closing only showed an image instead of closing).
//   3. usesRasterPath(pxR, hr)  — HEX-CELLS-LOAD-BEARING render-path gate
//      (Marco bug, 3rd recurrence 2026-06-10: cells rendered as SQUARE pixel
//      blocks instead of hexagons). See the dedicated section below — this
//      function is REQUIRED-tested and must NEVER let the default grid rasterize.

// -----------------------------------------------------------------------------
// 1) Frame-pan hit-test
// -----------------------------------------------------------------------------
// A single-pointer drag may only start a VIEW PAN when the pointer went down
// INSIDE the framed domain (a live cell area). The black border around the field
// (outside the rectangular grid, OR inside the grid but outside a non-box frame
// mask such as circle/hexagon/ellipse/freeform) must leave the frame fixed.
//
//   idx  : cell index from pixelToOddR(...) — < 0 means outside the grid entirely.
//   mask : neighRef.current.mask (Uint8Array | array | null) — mask[idx] === 1
//          when the cell is inside the active frame domain. A null/absent mask
//          means "no domain constraint known" → treat any in-grid cell as inside
//          (fail-open only for the box default, never invents an index).
//
// Returns true ONLY when the touch is on the actual field; false for the black
// margin, invalid indices, or NaN.
export function isInsideDomain(idx, mask, gridLen) {
  if (!Number.isInteger(idx) || idx < 0) return false; // black margin / off-grid / NaN
  // STALE-MASK-GATE (iOS-Haertung 2026-06-10): waehrend eines Frame-/Groessen-
  // Wechsels kann die DOM-Render (R*C neu) der neighRef-Maske (alt) einen Tick
  // vorauseilen. Stimmt die Maskenlaenge nicht mit dem AKTUELLEN Gitter (gridLen)
  // ueberein, ist die Maske stale -> fail closed (KEIN Pan), statt gegen eine
  // veraltete Maske zu testen und den Rahmen faelschlich zu verschieben.
  if (Number.isInteger(gridLen) && gridLen > 0 && mask != null && mask.length !== gridLen) return false;
  if (mask == null) return true; // unknown mask → in-grid counts as inside (box)
  if (idx >= mask.length) return false; // defensive: stale mask vs. new grid
  return mask[idx] === 1;
}

// Convenience alias with intent-revealing name at the call site.
// gridLen (= aktuelles R*C) optional, aber empfohlen: aktiviert das Stale-Mask-Gate.
export function shouldStartPan(idx, mask, gridLen) {
  return isInsideDomain(idx, mask, gridLen);
}

// -----------------------------------------------------------------------------
// 2) Platform-honest close dispatch
// -----------------------------------------------------------------------------
// Result is one of:
//   "back"     — opened in-app from a launcher (history depth) → navigate back.
//   "close"    — installed/standalone (PWA/Electron/iOS-home-screen) → window.close()
//                actually closes the window; no fallback image needed.
//   "fallback" — plain browser tab: the spec forbids window.close() on a tab the
//                script did not open, so show the honest "you may close this now".
//
// env: { standalone:boolean, historyLength:number }
//   standalone  : window.matchMedia('(display-mode: standalone)').matches
//                 || navigator.standalone (iOS) — installed/app context.
//   historyLength : window.history.length (in-app launcher leaves > 1).
//
// Order (per envelope): a real in-app history wins (back to the launcher);
// otherwise installed/standalone → genuine close; otherwise → honest fallback.
export function decideCloseAction(env) {
  const standalone = !!(env && env.standalone);
  const historyLength = env && Number.isFinite(env.historyLength) ? env.historyLength : 0;
  // In standalone the app shell is the root: there is no launcher to go "back" to,
  // and window.close() genuinely closes the installed window. Prefer close there.
  if (standalone) return "close";
  // In-app (launcher opened us in the same tab): go back to the launcher.
  if (historyLength > 1) return "back";
  // Plain top-level browser tab with no app history: window.close() is refused by
  // the spec → caller still attempts it, but the honest outcome is the fallback.
  return "fallback";
}

// -----------------------------------------------------------------------------
// 3) HEX-CELLS-LOAD-BEARING render-path gate  ⚠️ DO NOT WEAKEN ⚠️
// -----------------------------------------------------------------------------
// GolHex is a HEXAGONAL Game of Life — cells MUST render as hexagons whenever
// they are large enough to perceive a shape at all. The ImageData raster
// fast-path (src/lib/raster-render.js) draws SQUARE pixel blocks; it exists only
// to keep genuinely huge grids (L/XL/XXL/…, ≥18k cells) from freezing, where a
// single cell is sub-pixel and its shape is not resolvable anyway.
//
// REGRESSION HISTORY (this has now bitten Marco THREE times — must be the last):
//   A pure `pxR < threshold` gate is STRUCTURALLY UNSAFE. On a narrow portrait
//   phone the default M grid (hr=6, world width 1060) fits at a tiny scale, so
//   its on-screen cell radius pxR = hr*s lands right on top of where the raster
//   threshold has to sit to catch L's freeze:
//       device   cw    M pxR     L pxR
//       390px   372   2.063     1.385
//       375px   357   1.980 ⚠️  1.330   ← M dips UNDER a 2.0 threshold → SQUARES
//       360px   342   1.897 ⚠️  1.273   ← iPhone mini / small Android
//   There is NO single pxR threshold that keeps M hexagonal on a 360–375px phone
//   AND still rasterizes L. So pxR alone can never be correct.
//
// THE FIX — gate on CELL-SIZE IDENTITY (`hr`) as well, not on pxR alone:
//   The freeze is a function of CELL COUNT, which correlates with small hr
//   (L=hr4, XL=hr3, … ; M=hr6, S=hr12 are the small/normal grids). So:
//     • hr > RASTER_MAX_HR  → ALWAYS hexagons (raster=false). This unconditionally
//       protects S (hr=12) and the DEFAULT M (hr=6) on EVERY viewport width and
//       zoom — they can never rasterize, full stop.
//     • hr ≤ RASTER_MAX_HR (the genuinely large grids) → raster only once cells
//       are sub-resolution (pxR < RASTER_PX_THRESHOLD).
//   RASTER_MAX_HR = 5 sits in the gap between M (hr=6) and L (hr=4): structural,
//   not tuned to a pixel count, so a future canvas/layout change cannot reopen the
//   bug for M. RASTER_PX_THRESHOLD = 2.0 still catches L (pxR ≤ 1.39) and below.
//
// ⚠️ Editing these constants is hex-cells-load-bearing. Lowering RASTER_MAX_HR to
// ≥6, or removing the hr gate, re-enables square cells on the default grid and
// WILL be caught by the REQUIRED unit test (tests/unit/raster-gate.test.js) and
// the e2e hex-shape guards (tests/e2e/mobile-hexshape*.spec.ts). Do not bypass.
export const RASTER_MAX_HR = 5;      // grids with hr > 5 (S, M) never rasterize
export const RASTER_PX_THRESHOLD = 2.0; // raster only when a large-grid cell < 2px

/**
 * Decide whether a FULL redraw uses the ImageData raster (square) fast-path
 * instead of the Path2D hexagon path. Pure + side-effect-free so it is unit-
 * testable and identical on the main thread and (conceptually) the worker.
 *
 * @param {number} pxR  on-screen cell radius in CSS px = hr * view.scale
 * @param {number} hr   the grid stage's hex radius in world units (GRID_SIZES.hr)
 * @returns {boolean}   true → raster (squares, huge grids only); false → hexagons
 */
export function usesRasterPath(pxR, hr) {
  // Guard against NaN/garbage: when in doubt, draw hexagons (the correct shape).
  if (!Number.isFinite(pxR) || !Number.isFinite(hr)) return false;
  // Normal/default grids (S hr=12, M hr=6) are ALWAYS hexagons — width-independent.
  if (hr > RASTER_MAX_HR) return false;
  // Large grids: raster only once a cell is too small to resolve a hexagon.
  return pxR < RASTER_PX_THRESHOLD;
}

// -----------------------------------------------------------------------------
// 4) Long-Press-Farbrad: 13. Wahl "leere Zelle / loeschen" (Marco-Wunsch 2026-06-14)
// -----------------------------------------------------------------------------
// Das radiale Long-Press-Farbrad bietet die 12 Itten-Toene (State-IDs 1..12) zum
// SOFORT-Faerben der gedrueckten Zelle + Pinselwechsel. Marco-Wunsch: eine 13.
// Wahl, die die Zelle LEERT (auf tot = C0 = 0 setzt) und als "Radiergummi"-Pinsel
// (brush "erase") aktiv bleibt — konsistent mit dem schon vorhandenen "erase"-
// Pfad in paintCell (App.tsx) und dem Panel-Swatch "Leer".
//
// Diese Wahl ist KEINE Farb-State-ID, sondern ein Sentinel. Wir halten die
// Entscheidung "Farbe vs. Leeren" rein + unit-testbar (gleicher Stil wie oben),
// damit der load-bearing Selektions-Pfad gegen ein unabhaengiges Orakel geprueft
// werden kann (nicht nur per e2e).
export const WHEEL_ERASE = "erase"; // Sentinel der 13. Wahl (deckt sich mit brush="erase")
export const DEAD_STATE = 0;        // C0 — tote/leere Zelle (sim-engine const C0)

/**
 * Bilde eine Farbrad-Auswahl auf ihre Wirkung ab.
 *   - 12 gueltige Farb-State-IDs (1..12) -> { erase:false, cellState:<id>, brush:<id> }
 *     (Zelle wird auf die Farbe gesetzt, Pinsel wechselt auf die Farbe).
 *   - WHEEL_ERASE ("erase")            -> { erase:true,  cellState:0,    brush:"erase" }
 *     (Zelle wird geleert/getoetet, Pinsel wird zum Radiergummi).
 *
 * Fail-closed: jede ungueltige Eingabe (NaN, 0, <0, >12, undefined, Objekte)
 * faellt auf die Erase-Semantik NICHT zurueck, sondern wird als "keine gueltige
 * Auswahl" (null) gemeldet — der Aufrufer ignoriert sie dann (kein stilles
 * Setzen einer falschen Farbe, kein versehentliches Loeschen).
 *
 * @param {number|string} sel  Wheel-Auswahl: 1..12 (Farbe) oder WHEEL_ERASE.
 * @returns {{erase:boolean, cellState:number, brush:(number|string)}|null}
 */
export function wheelSelectionEffect(sel) {
  if (sel === WHEEL_ERASE) {
    return { erase: true, cellState: DEAD_STATE, brush: WHEEL_ERASE };
  }
  if (Number.isInteger(sel) && sel >= 1 && sel <= 12) {
    return { erase: false, cellState: sel, brush: sel };
  }
  return null; // ungueltige Auswahl -> Aufrufer ignoriert (fail closed)
}
