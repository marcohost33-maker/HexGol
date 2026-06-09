// Pure UI-gesture + app-shell decision helpers (no DOM, no React).
// Extracted so the load-bearing logic is unit-testable (Coworkerz GolHex style:
// pure cores in src/lib/, see recorder.js / worker-support.js precedent).
//
// Two decisions live here:
//   1. shouldStartPan(idx, mask) — frame-pan hit-test (Marco bug 2026-06-09:
//      touching the BLACK margin around the framed field must NOT move the frame).
//   2. decideCloseAction(env)   — platform-honest "close the whole app" dispatch
//      (Marco bug 2026-06-09: closing only showed an image instead of closing).

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
export function isInsideDomain(idx, mask) {
  if (!Number.isInteger(idx) || idx < 0) return false; // black margin / off-grid / NaN
  if (mask == null) return true; // unknown mask → in-grid counts as inside (box)
  if (idx >= mask.length) return false; // defensive: stale mask vs. new grid
  return mask[idx] === 1;
}

// Convenience alias with intent-revealing name at the call site.
export function shouldStartPan(idx, mask) {
  return isInsideDomain(idx, mask);
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
