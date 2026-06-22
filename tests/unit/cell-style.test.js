import { describe, it, expect } from "vitest";
import { cellStyle, classifyCell, CVD_STYLE, OKABE_ITO } from "../../src/lib/cell-style.js";

// F10 — pure CVD-safe cell encoding. Oracle is independent of any canvas/DOM:
// the exact Okabe-Ito hex values (Wong, Nature Methods 2011) + the WCAG-1.4.1
// requirement that the three *visible* states stay distinguishable by FORM alone
// (greyscale / deuteranopia proxy), not by colour.

describe("OKABE_ITO palette — exact corrected hex values (Quella-validated)", () => {
  it("matches the canonical 8-colour Okabe-Ito set exactly", () => {
    expect(OKABE_ITO.blue).toBe("#0072B2");
    expect(OKABE_ITO.orange).toBe("#E69F00");
    expect(OKABE_ITO.bluishGreen).toBe("#009E73");
    expect(OKABE_ITO.reddishPurple).toBe("#CC79A7");
    expect(OKABE_ITO.vermillion).toBe("#D55E00");
    expect(OKABE_ITO.skyBlue).toBe("#56B4E9");
    expect(OKABE_ITO.yellow).toBe("#F0E442");
    expect(OKABE_ITO.black).toBe("#000000");
  });
});

describe("classifyCell — boolean life-state from render layers", () => {
  it("survivor = alive and was alive last gen (age > 1)", () => {
    expect(classifyCell({ color: 9, age: 2, ghost: 0 })).toBe("survivor");
    expect(classifyCell({ color: 5, age: 65535, ghost: 0 })).toBe("survivor");
  });
  it("newborn = alive and just born (age <= 1)", () => {
    expect(classifyCell({ color: 3, age: 1, ghost: 0 })).toBe("newborn");
    // defensive: age 0 but alive colour (shouldn't normally happen) still newborn
    expect(classifyCell({ color: 3, age: 0, ghost: 0 })).toBe("newborn");
  });
  it("dying = dead colour with a decay ghost", () => {
    expect(classifyCell({ color: 0, age: 0, ghost: 1 })).toBe("dying");
  });
  it("dead = no colour, no ghost", () => {
    expect(classifyCell({ color: 0, age: 0, ghost: 0 })).toBe("dead");
  });
  it("ghost is ignored while the cell is alive (alive wins)", () => {
    // a living cell is never 'dying' even if a stale ghost flag were set
    expect(classifyCell({ color: 7, age: 5, ghost: 1 })).toBe("survivor");
  });
});

describe("cellStyle — OFF (cvdMode false) leaves the default colour path untouched", () => {
  it("returns the default sentinel for every state when cvdMode is false", () => {
    for (const state of [
      { color: 9, age: 5, ghost: 0 },
      { color: 3, age: 1, ghost: 0 },
      { color: 0, age: 0, ghost: 1 },
      { color: 0, age: 0, ghost: 0 },
    ]) {
      const s = cellStyle(state, false);
      expect(s.kind).toBe("default");
      // no CVD colour/form leaks into the default path
      expect(s.fill).toBeNull();
      expect(s.stroke).toBeNull();
      expect(s.hole).toBe(false);
    }
  });
});

describe("cellStyle — ON (cvdMode true) — correct Okabe-Ito colour + form cue", () => {
  it("survivor: full blue fill, no hole, no ring", () => {
    const s = cellStyle({ color: 9, age: 3, ghost: 0 }, true);
    expect(s.kind).toBe("survivor");
    expect(s.fill).toBe("#0072B2");
    expect(s.stroke).toBeNull();
    expect(s.hole).toBe(false);
  });
  it("newborn: orange fill + central hole (form cue)", () => {
    const s = cellStyle({ color: 3, age: 1, ghost: 0 }, true);
    expect(s.kind).toBe("newborn");
    expect(s.fill).toBe("#E69F00");
    expect(s.hole).toBe(true);
    expect(s.stroke).toBeNull();
  });
  it("dying: ring/outline only, no fill (form cue)", () => {
    const s = cellStyle({ color: 0, age: 0, ghost: 1 }, true);
    expect(s.kind).toBe("dying");
    expect(s.fill).toBeNull();
    expect(s.stroke).toBe("#CC79A7");
    expect(s.hole).toBe(false);
  });
  it("dead: no fill, no stroke, no hole (thin line stays the dead cue)", () => {
    const s = cellStyle({ color: 0, age: 0, ghost: 0 }, true);
    expect(s.kind).toBe("dead");
    expect(s.fill).toBeNull();
    expect(s.stroke).toBeNull();
    expect(s.hole).toBe(false);
  });
});

describe("WCAG 1.4.1 — three visible states distinguishable by FORM alone (greyscale)", () => {
  // The form signature is (hasFill, hasStroke, hasHole) — colour-stripped. Each of
  // the three visible states must have a UNIQUE signature, so a colourblind viewer
  // (or a greyscale render) can still tell them apart by shape, not hue.
  const sig = (s) => `${s.fill !== null}|${s.stroke !== null}|${s.hole}`;
  const survivor = cellStyle({ color: 9, age: 3, ghost: 0 }, true);
  const newborn = cellStyle({ color: 3, age: 1, ghost: 0 }, true);
  const dying = cellStyle({ color: 0, age: 0, ghost: 1 }, true);

  it("survivor / newborn / dying have pairwise-distinct form signatures", () => {
    const sigs = [sig(survivor), sig(newborn), sig(dying)];
    expect(new Set(sigs).size).toBe(3); // all distinct
  });

  it("survivor (fill,no-hole) differs from newborn (fill,hole) by the hole cue", () => {
    expect(survivor.hole).toBe(false);
    expect(newborn.hole).toBe(true);
    // both filled, so colour-blindness of fill alone is NOT sufficient — the hole is.
    expect(survivor.fill !== null && newborn.fill !== null).toBe(true);
  });

  it("dying differs from both filled states by being outline-only (no fill)", () => {
    expect(dying.fill).toBeNull();
    expect(dying.stroke).not.toBeNull();
  });
});

// fails-before-style guard: if the survivor/newborn mapping were swapped (a
// realistic copy-paste bug), this assertion catches it — the colour must follow
// the state, not the other way round.
describe("fails-before guard — survivor must be blue, newborn must be orange", () => {
  it("the two filled states do not share a colour (swap would be detected)", () => {
    const survivor = cellStyle({ color: 9, age: 3, ghost: 0 }, true);
    const newborn = cellStyle({ color: 3, age: 1, ghost: 0 }, true);
    expect(survivor.fill).toBe(CVD_STYLE.survivor.fill);
    expect(newborn.fill).toBe(CVD_STYLE.newborn.fill);
    expect(survivor.fill).not.toBe(newborn.fill);
    // explicit anchor against the spec values
    expect(survivor.fill).toBe("#0072B2");
    expect(newborn.fill).toBe("#E69F00");
  });
});

// Defensive: malformed / partial state objects must not throw (silent-failure gate).
describe("robustness — malformed state inputs are classified, never throw", () => {
  it("undefined / empty object classify as dead, never crash", () => {
    expect(() => cellStyle(undefined, true)).not.toThrow();
    expect(cellStyle(undefined, true).kind).toBe("dead");
    expect(cellStyle({}, true).kind).toBe("dead");
    expect(cellStyle(null, false).kind).toBe("default");
  });
});
