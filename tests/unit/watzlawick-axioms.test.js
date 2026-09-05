import { describe, expect, it } from "vitest";
import { AXIOMS } from "../../src/lib/sim-engine.js";
import {
  WATZLAWICK_A5,
  WATZLAWICK_AXIOMS,
  WATZLAWICK_BOOLEAN_AXIOMS,
} from "../../src/lib/watzlawick-axioms.js";

describe("Watzlawick axiom metadata SoT", () => {
  it("exports exactly A1-A5 once and in canonical order", () => {
    const ids = WATZLAWICK_AXIOMS.map((axiom) => axiom.id);
    expect(WATZLAWICK_AXIOMS).toHaveLength(5);
    expect(ids).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("models A5 as a mode, not a fifth boolean toggle", () => {
    expect(WATZLAWICK_A5.short).toMatch(/symmetr/i);
    expect(WATZLAWICK_A5.short).toMatch(/komplement/i);
    expect(WATZLAWICK_A5.desc).toContain("K <= S");
    expect(WATZLAWICK_A5.desc).toContain("S > K");
    expect(WATZLAWICK_A5.desc).not.toMatch(/9[- ]?regel|aequivalent/i);
    expect(WATZLAWICK_A5.control).toEqual({
      kind: "mode",
      default: "off",
      options: ["off", "sym", "komp"],
    });
  });

  it("keeps the current App boolean-control adapter limited to A1-A4", () => {
    const booleanIds = WATZLAWICK_BOOLEAN_AXIOMS.map((axiom) => axiom.id);
    expect(booleanIds).toEqual(["a1", "a2", "a3", "a4"]);
    expect(AXIOMS.map((axiom) => axiom.id)).toEqual(booleanIds);
    expect(AXIOMS.some((axiom) => axiom.id === "a5")).toBe(false);
  });
});
