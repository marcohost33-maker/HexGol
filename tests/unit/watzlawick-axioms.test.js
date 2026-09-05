import { describe, expect, it } from "vitest";
import { AXIOMS } from "../../src/lib/sim-engine.js";

describe("Watzlawick AXIOMS runtime SoT", () => {
  it("exports exactly A1-A5 once and in canonical order", () => {
    const ids = AXIOMS.map((axiom) => axiom.id);
    expect(AXIOMS).toHaveLength(5);
    expect(ids).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("grounds A5 as symmetric/complementary interaction, not a ninth-rule equivalence", () => {
    const a5 = AXIOMS.find((axiom) => axiom.id === "a5");
    expect(a5).toBeDefined();
    expect(a5.short).toMatch(/symmetr/i);
    expect(a5.short).toMatch(/komplement/i);
    expect(a5.desc).toContain("K <= S");
    expect(a5.desc).toContain("S > K");
    expect(a5.desc).not.toMatch(/9[- ]?regel|aequivalent/i);
  });
});
