import { describe, expect, it } from "vitest";
import {
  APPLICABILITY,
  FINALITY,
  STATUS,
  VERDICT,
  andAll,
  andAllSemantic,
  evaluateNineRules,
  statusSemantics,
} from "../../src/lib/nine-rules.js";

describe("9-rule verdict dimensions", () => {
  it("maps every compatibility status to explicit orthogonal dimensions", () => {
    expect(statusSemantics(STATUS.PASS)).toEqual({
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.TRUE,
      finality: FINALITY.FINAL,
    });
    expect(statusSemantics(STATUS.PASS_VORLAEUFIG)).toEqual({
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.TRUE,
      finality: FINALITY.PROVISIONAL,
    });
    expect(statusSemantics(STATUS.UNOBSERVED)).toEqual({
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.UNKNOWN,
      finality: FINALITY.PROVISIONAL,
    });
    expect(statusSemantics(STATUS.FAIL_VORLAEUFIG)).toEqual({
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.FALSE,
      finality: FINALITY.PROVISIONAL,
    });
    expect(statusSemantics(STATUS.FAIL)).toEqual({
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.FALSE,
      finality: FINALITY.FINAL,
    });
    expect(statusSemantics(STATUS.NA)).toEqual({
      applicability: APPLICABILITY.NA,
      verdict: null,
      finality: null,
    });
    expect(statusSemantics(STATUS.CONFIG_ERROR)).toEqual({
      applicability: APPLICABILITY.CONFIG_ERROR,
      verdict: null,
      finality: null,
    });
  });

  it("conjoins truth and finality without a single truth-rank axis", () => {
    expect(andAllSemantic([STATUS.FAIL, STATUS.UNOBSERVED])).toEqual({
      status: STATUS.FAIL,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.FALSE,
      finality: FINALITY.FINAL,
    });

    expect(andAllSemantic([STATUS.FAIL_VORLAEUFIG, STATUS.UNOBSERVED])).toEqual({
      status: STATUS.FAIL_VORLAEUFIG,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.FALSE,
      finality: FINALITY.PROVISIONAL,
    });

    expect(andAllSemantic([STATUS.PASS, STATUS.UNOBSERVED])).toEqual({
      status: STATUS.UNOBSERVED,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.UNKNOWN,
      finality: FINALITY.PROVISIONAL,
    });

    expect(andAllSemantic([STATUS.PASS, STATUS.PASS_VORLAEUFIG])).toEqual({
      status: STATUS.PASS_VORLAEUFIG,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.TRUE,
      finality: FINALITY.PROVISIONAL,
    });
  });

  it("keeps applicability outside truth aggregation", () => {
    expect(andAllSemantic([STATUS.NA, STATUS.NA])).toEqual({
      status: STATUS.NA,
      applicability: APPLICABILITY.NA,
      verdict: null,
      finality: null,
    });
    expect(andAll([STATUS.NA, STATUS.PASS])).toBe(STATUS.PASS);
    expect(andAll([STATUS.PASS, STATUS.CONFIG_ERROR])).toBe(STATUS.CONFIG_ERROR);
  });

  it("rejects unknown compact verdicts instead of silently ranking them", () => {
    expect(() => statusSemantics("MAYBE")).toThrow(TypeError);
    expect(() => andAll([STATUS.PASS, "MAYBE"])).toThrow(TypeError);
  });

  it("exposes dimensions per rule and for the aggregate while retaining overall", () => {
    const report = evaluateNineRules(
      [{ u: 0 }, { u: 1 }],
      { terminalPredicate: (s) => s.u === 1 },
      { enabled: ["R7"], traceComplete: false },
    );

    expect(report.overall).toBe(STATUS.PASS);
    expect(report.overallSemantics).toEqual({
      status: STATUS.PASS,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.TRUE,
      finality: FINALITY.FINAL,
    });
    expect(report.rules[0]).toMatchObject({
      status: STATUS.PASS,
      applicability: APPLICABILITY.APPLICABLE,
      verdict: VERDICT.TRUE,
      finality: FINALITY.FINAL,
      specVersion: "9R-v1.1.0",
    });
  });
});
