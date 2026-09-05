// Canonical registry for GolHex' five Watzlawick-derived interaction axioms.
//
// A1-A4 already have an established runtime/UI source in sim-engine.js. Repeating
// their labels/descriptions here would create a second source that can drift, so
// this registry derives them from that existing runtime metadata and adds only
// the missing typed A5 contract. This is an intentionally small migration step:
// a later module split may move A1-A4 into this file and make sim-engine import
// them, but this version removes duplication without changing simulation code.
//
// IMPORTANT: control semantics are part of the contract. A1-A4 are independent
// boolean feature toggles. A5 is NOT a fifth boolean; it selects how neighbour
// interaction is interpreted (`off | sym | komp`).

import { AXIOMS as RUNTIME_BOOLEAN_AXIOMS } from "./sim-engine.js";

const BOOLEAN_CONTROL = Object.freeze({ kind: "boolean" });

export const WATZLAWICK_BOOLEAN_AXIOMS = Object.freeze(
  RUNTIME_BOOLEAN_AXIOMS.map((axiom) => Object.freeze({
    ...axiom,
    control: BOOLEAN_CONTROL,
  })),
);

export const WATZLAWICK_A5 = Object.freeze({
  id: "a5",
  short: "A5 Symmetrisch / komplementaer",
  desc: "Symmetrische vs. komplementaere Interaktion: Ueberleben verlangt K <= S; Geburt verlangt S > K.",
  control: Object.freeze({
    kind: "mode",
    default: "off",
    options: Object.freeze(["off", "sym", "komp"]),
  }),
});

export const WATZLAWICK_AXIOMS = Object.freeze([
  ...WATZLAWICK_BOOLEAN_AXIOMS,
  WATZLAWICK_A5,
]);

export const WATZLAWICK_AXIOM_BY_ID = Object.freeze(
  Object.fromEntries(WATZLAWICK_AXIOMS.map((axiom) => [axiom.id, axiom])),
);
