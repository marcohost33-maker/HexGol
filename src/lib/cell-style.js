// =============================================================================
// GolHex F10 — Colorblind-safe cell encoding (pure, DOM/Canvas-free).
//
// PURPOSE (WCAG 1.4.1 "use of color"): the live boolean cellular automaton
// distinguishes cell states by COLOUR ALONE in the default render. For viewers
// with colour-vision deficiency (CVD) that is not robust. This module maps the
// four boolean life-states to a CVD-safe Okabe-Ito palette PLUS a per-state
// FORM cue (hole / ring). The Okabe-Ito colours themselves stay distinct under
// real CVD simulation (Machado 2009 deuteranopia/protanopia/tritanopia); the
// form cue is the independent second channel that survives even full greyscale
// (achromatopsia) — so states are never distinguished by colour alone. Both are
// asserted in tests/unit/cvd-validation.test.js.
//
// OPT-IN: cvdMode === false returns the sentinel { kind: "default" }. Callers
// MUST then keep their existing colour path unchanged, so the default render is
// byte-identical to today and every existing visual baseline stays valid.
//
// PURE: this file imports nothing and touches no canvas/DOM. It only decides
// {fill, stroke, hole} from a state descriptor, so it is fully unit-testable.
//
// State derivation (mirrors src/lib/sim-engine.js stepLife outputs):
//   color : cell colour-id, 0 = dead, 1..12 = alive (Itten hue id)
//   age   : 0 = dead, 1 = just born this generation, >1 = was already alive
//   ghost : 1 = just died with the a4 decay overlay, else 0
//
//   survivor : color != 0 && age  > 1   (alive, and alive last gen too)
//   newborn  : color != 0 && age <= 1   (alive, born this generation)
//   dying    : color == 0 && ghost       (was alive, now a decay ghost)
//   dead     : color == 0 && !ghost      (empty)
//
// Okabe-Ito 8-colour palette (CVD-safe), exact hex values (Wong, Nature Methods
// 2011; corrected — NOT the erroneous RGB table). Quella-validated:
//   #0072B2 blue · #E69F00 orange · #009E73 bluish-green · #CC79A7 reddish-purple
//   #D55E00 vermillion · #56B4E9 sky-blue · #F0E442 yellow · #000000 black
// =============================================================================

// Full Okabe-Ito palette (exported for the UI legend / palette row in the mockup).
export const OKABE_ITO = Object.freeze({
  blue: "#0072B2",
  orange: "#E69F00",
  bluishGreen: "#009E73",
  reddishPurple: "#CC79A7",
  vermillion: "#D55E00",
  skyBlue: "#56B4E9",
  yellow: "#F0E442",
  black: "#000000",
});

// Per-state CVD style. Only the three "visible" states carry a style; "dead"
// renders nothing (the existing thin grid line stays the dead-cell cue).
//  - fill   : hex fill colour, or null for no fill (form cue carries the state)
//  - stroke : hex outline colour, or null for no outline
//  - hole   : true => punch a background-coloured dot in the centre (form cue)
export const CVD_STYLE = Object.freeze({
  survivor: Object.freeze({ kind: "survivor", fill: OKABE_ITO.blue, stroke: null, hole: false }),
  newborn: Object.freeze({ kind: "newborn", fill: OKABE_ITO.orange, stroke: null, hole: true }),
  dying: Object.freeze({ kind: "dying", fill: null, stroke: OKABE_ITO.reddishPurple, hole: false }),
  dead: Object.freeze({ kind: "dead", fill: null, stroke: null, hole: false }),
});

// Sentinel for cvdMode === false: callers keep their existing colour path.
const DEFAULT_STYLE = Object.freeze({ kind: "default", fill: null, stroke: null, hole: false });

/**
 * Classify the boolean life-state of a single cell from its render layers.
 * Pure; no clamping of valid inputs needed beyond truthiness/comparison.
 *
 * @param {{color:number, age:number, ghost:number}} state
 * @returns {"survivor"|"newborn"|"dying"|"dead"}
 */
export function classifyCell(state) {
  const s = state || {};
  const color = (s.color | 0);
  const age = (s.age | 0);
  const ghost = (s.ghost | 0);
  if (color !== 0) return age > 1 ? "survivor" : "newborn";
  if (ghost !== 0) return "dying";
  return "dead";
}

/**
 * Resolve the render style for a cell.
 *
 * @param {{color:number, age:number, ghost:number}} state  cell render layers
 * @param {boolean} cvdMode  true => Colorblind-safe encoding; false => default
 * @returns {{kind:string, fill:(string|null), stroke:(string|null), hole:boolean}}
 *   cvdMode false  => { kind: "default", ... } — caller keeps its colour path.
 *   cvdMode true   => the CVD style for the classified state.
 */
export function cellStyle(state, cvdMode) {
  if (!cvdMode) return DEFAULT_STYLE;
  return CVD_STYLE[classifyCell(state)];
}
