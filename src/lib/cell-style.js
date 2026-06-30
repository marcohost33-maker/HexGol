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

// =============================================================================
// F10-ext (2026-06-30, #97 / #101): SPECIES identity + PHYSICS gradient under CVD.
//
// Orthogonal two-channel design (Anare Bau-Spec v2 §3). The 12-species hue CA
// keeps its identity under colour-vision deficiency by splitting the signal:
//   COLOUR = species FAMILY (6 CVD-safe Okabe-Ito hues) — needs no spatial
//            resolution, so it survives down to ~2px on-screen.
//   FORM   = lifecycle state (survivor/newborn/dying/dead) — survives even total
//            greyscale (achromatopsia).
// 6 × 4 = 24 CVD-safe combinations (was 12 → 0 distinguishable). The 12th bit
// (member A vs B inside a family) is resolved by an optional corner glyph (only
// at pxR >= GLYPH_MIN_PX) and always by inspect-on-tap.
//
// Marco-Entscheide 2026-06-30 encoded here:
//  (2) warm-trio vermillion → sky-blue swap on family 0 (better deuteranopia gap);
//  (3) dying ring carries the real last-known family colour (caller passes it).
// All thresholds/colours are asserted in tests/unit/cvd-validation.test.js.
// =============================================================================

// 6 CVD-safe species families. familyOf(colorId) = floor((colorId-1)/2), 0..5.
// Family 0 (Itten red family, ids 1-2) uses Okabe sky-blue, NOT vermillion: under
// deuteranopia vermillion collapses into the orange/yellow warm trio, while
// sky-blue separates cleanly. sky-blue (family 0) vs blue (family 4) is the
// canonical Okabe-Ito distinguishable pair, so all 6 stay pairwise distinct.
export const SPECIES_FAMILY = Object.freeze([
  OKABE_ITO.skyBlue,        // 0  ids 1-2  (Itten red family; swapped from vermillion)
  OKABE_ITO.orange,         // 1  ids 3-4
  OKABE_ITO.yellow,         // 2  ids 5-6
  OKABE_ITO.bluishGreen,    // 3  ids 7-8
  OKABE_ITO.blue,           // 4  ids 9-10
  OKABE_ITO.reddishPurple,  // 5  ids 11-12
]);

// Neutral ring colour when a dying cell has no recoverable family (Iter#1 default).
export const DYING_NEUTRAL = OKABE_ITO.reddishPurple;

/** Family index 0..5 for a live colour-id 1..12; -1 for dead/out-of-range. */
export function familyOf(colorId) {
  const c = colorId | 0;
  if (c < 1 || c > 12) return -1;
  return ((c - 1) / 2) | 0;
}
/** Family hex for a live colour-id, or null if dead/invalid. */
export function familyColor(colorId) {
  const f = familyOf(colorId);
  return f < 0 ? null : SPECIES_FAMILY[f];
}
/** Member inside the family: 0 = A (odd id), 1 = B (even id); -1 if invalid. */
export function memberOf(colorId) {
  const c = colorId | 0;
  if (c < 1 || c > 12) return -1;
  return (c - 1) & 1;
}

// #101-1 graceful form-cue degradation. The lifecycle FORM cues (newborn centre
// hole, dying ring) collapse to sub-pixel below a few on-screen pixels, so we GROW
// the hole fraction and THICKEN the ring as pxR shrinks, then drop the hole below
// FORM_MIN_PX (family colour alone still reads — that is the orthogonal design).
// pxR = hex world-radius × zoom = on-screen cell radius in px.
export const GLYPH_MIN_PX = 10;  // Tier-A member glyph only at/above this pxR
export const FORM_MIN_PX = 3;    // below this the hole cue collapses → colour-only

export function formParams(pxR) {
  const p = (typeof pxR === "number" && pxR > 0) ? pxR : 0;
  if (p >= 6)            return { mode: "full",      holeScale: 0.34, ringWidthK: 1.6, ringScale: 0.86 };
  if (p >= FORM_MIN_PX)  return { mode: "boosted",   holeScale: 0.46, ringWidthK: 2.4, ringScale: 0.90 };
  return                        { mode: "colorOnly", holeScale: 0.0,  ringWidthK: 2.6, ringScale: 0.92 };
}

// 3 CVD-safe colours for the discrete Mendel genotype field (AA / Aa / aa). Each
// pair is Machado-distinct (asserted). vermillion is deliberately avoided (it
// collapses with orange/yellow under deuteranopia — the very reason for the
// species swap above).
export const GENE_CVD = Object.freeze({
  AA: OKABE_ITO.blue,           // #0072B2
  Aa: OKABE_ITO.yellow,         // #F0E442
  aa: OKABE_ITO.reddishPurple,  // #CC79A7
});

// CVD-safe sequential colormap for the real-valued physics modes (snow / water /
// HQST / collatz). Cividis (Nuñez, Anderton & Renslow 2018, PLOS ONE) is built FOR
// colour-vision deficiency: it is perceptually ~uniform AND its luminance rises
// MONOTONICALLY, so the field value is readable by luminance alone (achromatopsia /
// full greyscale) — the WCAG-1.4.1 "not by colour alone" guarantee for a continuous
// heatmap, where every cell is filled and form-redundancy is impossible. Control
// points are matplotlib's _cividis_data (endpoints = canonical cividis); monotonic
// luminance is asserted in the unit oracle. t clamps to [0,1].
const CIVIDIS = Object.freeze([
  [0.0000, 0.000000, 0.135112, 0.304751],
  [0.0627, 0.000000, 0.176082, 0.407577],
  [0.1255, 0.103401, 0.220406, 0.435790],
  [0.1882, 0.195057, 0.264372, 0.425924],
  [0.2510, 0.267693, 0.310542, 0.422821],
  [0.3137, 0.326575, 0.345842, 0.427504],
  [0.3765, 0.401418, 0.411790, 0.440708],
  [0.4392, 0.474812, 0.473832, 0.467681],
  [0.5020, 0.556802, 0.526005, 0.472163],
  [0.5647, 0.638419, 0.604354, 0.458668],
  [0.6275, 0.720222, 0.667618, 0.430805],
  [0.6902, 0.798480, 0.730580, 0.392597],
  [0.7529, 0.875057, 0.793125, 0.339685],
  [1.0000, 1.000000, 0.916900, 0.273100],
]);

/** Cividis sample at t∈[0,1] → [r,g,b] integers 0..255 (linear interp between LUT stops). */
export function cividisRGB(t) {
  let x = t; if (!(x > 0)) x = 0; else if (x > 1) x = 1;
  let i = 1; while (i < CIVIDIS.length - 1 && CIVIDIS[i][0] < x) i++;
  const a = CIVIDIS[i - 1], b = CIVIDIS[i];
  const span = b[0] - a[0], f = span > 0 ? (x - a[0]) / span : 0;
  return [
    Math.round((a[1] + (b[1] - a[1]) * f) * 255),
    Math.round((a[2] + (b[2] - a[2]) * f) * 255),
    Math.round((a[3] + (b[3] - a[3]) * f) * 255),
  ];
}
/** Cividis sample at t∈[0,1] → "rgb(r,g,b)" string for ctx.fillStyle. */
export function cividisCss(t) {
  const [r, g, b] = cividisRGB(t);
  return `rgb(${r},${g},${b})`;
}
