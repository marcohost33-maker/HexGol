// Canonical metadata for GolHex' five Watzlawick-derived interaction axioms.
//
// IMPORTANT: control semantics are part of the contract. A1-A4 are independent
// boolean feature toggles in the current simulator. A5 is NOT a fifth boolean;
// it selects how neighbour interaction is interpreted (`off | sym | komp`).
// Keeping that distinction explicit prevents UI metadata from silently changing
// simulation semantics.

export const WATZLAWICK_AXIOMS = Object.freeze([
  Object.freeze({
    id: "a1",
    short: "A1 Stille spricht",
    desc: "Man kann nicht nicht kommunizieren: vollstaendig stille Leerzonen keimen selten spontan.",
    control: Object.freeze({ kind: "boolean" }),
  }),
  Object.freeze({
    id: "a2",
    short: "A2 Beziehung > Inhalt",
    desc: "Inhalts-/Beziehungsaspekt: Nachbar-Mehrheit (mMix) klassifiziert den Inhalt statt Mischung (cMix).",
    control: Object.freeze({ kind: "boolean" }),
  }),
  Object.freeze({
    id: "a3",
    short: "A3 Interpunktion",
    desc: "Interpunktion der Ereignisfolge: alte Zellen (Alter >= 6) erhalten +/-1 Ueberlebens-Toleranz.",
    control: Object.freeze({ kind: "boolean" }),
  }),
  Object.freeze({
    id: "a4",
    short: "A4 Analog",
    desc: "Digital + analog: sterbende Zellen hinterlassen einen Halbzustand (Ghost), 1 Generation als Nachbar.",
    control: Object.freeze({ kind: "boolean" }),
  }),
  Object.freeze({
    id: "a5",
    short: "A5 Symmetrisch / komplementaer",
    desc: "Symmetrische vs. komplementaere Interaktion: Ueberleben verlangt K <= S; Geburt verlangt S > K.",
    control: Object.freeze({
      kind: "mode",
      default: "off",
      options: Object.freeze(["off", "sym", "komp"]),
    }),
  }),
]);

export const WATZLAWICK_AXIOM_BY_ID = Object.freeze(
  Object.fromEntries(WATZLAWICK_AXIOMS.map((axiom) => [axiom.id, axiom])),
);

export const WATZLAWICK_BOOLEAN_AXIOMS = Object.freeze(
  WATZLAWICK_AXIOMS.filter((axiom) => axiom.control.kind === "boolean"),
);

export const WATZLAWICK_A5 = WATZLAWICK_AXIOM_BY_ID.a5;
