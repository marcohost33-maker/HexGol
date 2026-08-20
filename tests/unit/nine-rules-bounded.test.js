import { describe, expect, it } from "vitest";
import { evaluateNineRules, STATUS, R2_MODUS } from "../../src/lib/nine-rules.js";

const S = (u) => ({ u, a: u });
const statusOf = (report, id) => report.rules.find((rule) => rule.id === id)?.status;

function* binaryTraces(maxLength) {
  for (let length = 1; length <= maxLength; length += 1) {
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const trace = [];
      for (let bit = length - 1; bit >= 0; bit -= 1) {
        trace.push(S((mask >> bit) & 1));
      }
      yield trace;
    }
  }
}

const config = Object.freeze({
  progressVariable: (s) => s.a,
  r2Modus: R2_MODUS.MINIMAL,
  terminalPredicate: (s) => s.u === 1,
  lifeModel: Object.freeze({
    name: "bounded-last-bit-proxy",
    version: "1",
    predicate: (last) => last.u === 1,
  }),
});

function oracleR2Minimal(trace, traceComplete) {
  if (trace.length < 2) return STATUS.NA;
  const grew = trace.some((s, i) => i > 0 && s.a > trace[i - 1].a);
  if (grew) return STATUS.PASS;
  return traceComplete ? STATUS.FAIL : STATUS.FAIL_VORLAEUFIG;
}

function oracleR3(trace) {
  return trace.length > 1 ? STATUS.PASS : STATUS.UNOBSERVED;
}

function oracleR7(trace, traceComplete) {
  if (trace.some((s) => s.u === 1)) return STATUS.PASS;
  return traceComplete ? STATUS.FAIL : STATUS.FAIL_VORLAEUFIG;
}

function oracleR8(trace) {
  if (trace.length < 2) return STATUS.NA;
  return trace.at(-1).u !== trace.at(-2).u ? STATUS.PASS : STATUS.FAIL;
}

function oracleR9(trace, traceComplete) {
  if (trace.length < 2) return STATUS.UNOBSERVED;
  const alive = trace.at(-1).u === 1;
  if (traceComplete) return alive ? STATUS.PASS : STATUS.FAIL;
  return alive ? STATUS.PASS_VORLAEUFIG : STATUS.FAIL_VORLAEUFIG;
}

const ORACLES = Object.freeze({
  R2: oracleR2Minimal,
  R3: oracleR3,
  R7: oracleR7,
  R8: oracleR8,
  R9: oracleR9,
});

function evalOne(trace, ruleId, traceComplete = false, cfg = config) {
  return statusOf(
    evaluateNineRules(trace, cfg, { enabled: [ruleId], traceComplete }),
    ruleId,
  );
}

describe("bounded finite-trace consistency oracle", () => {
  it("matches an independently stated oracle for all binary traces of length 1..5", () => {
    let cases = 0;
    const reached = new Set();

    for (const trace of binaryTraces(5)) {
      for (const traceComplete of [false, true]) {
        for (const [ruleId, oracle] of Object.entries(ORACLES)) {
          const expected = oracle(trace, traceComplete);
          const actual = evalOne(trace, ruleId, traceComplete);
          expect(actual, `${ruleId} trace=${trace.map((s) => s.u).join("")} complete=${traceComplete}`)
            .toBe(expected);
          reached.add(`${ruleId}:${actual}`);
          cases += 1;
        }
      }
    }

    // 2 + 4 + 8 + 16 + 32 = 62 traces; two completion modes; five independent rules.
    expect(cases).toBe(620);

    // Anti-vacuity: the campaign must actually exercise every semantically relevant
    // terminal/prefix class for these operators. If a refactor makes one unreachable,
    // the bounded gate turns red instead of silently shrinking its coverage.
    expect([...reached].sort()).toEqual([
      `R2:${STATUS.FAIL}`,
      `R2:${STATUS.FAIL_VORLAEUFIG}`,
      `R2:${STATUS.NA}`,
      `R2:${STATUS.PASS}`,
      `R3:${STATUS.PASS}`,
      `R3:${STATUS.UNOBSERVED}`,
      `R7:${STATUS.FAIL}`,
      `R7:${STATUS.FAIL_VORLAEUFIG}`,
      `R7:${STATUS.PASS}`,
      `R8:${STATUS.FAIL}`,
      `R8:${STATUS.NA}`,
      `R8:${STATUS.PASS}`,
      `R9:${STATUS.FAIL}`,
      `R9:${STATUS.FAIL_VORLAEUFIG}`,
      `R9:${STATUS.PASS}`,
      `R9:${STATUS.PASS_VORLAEUFIG}`,
      `R9:${STATUS.UNOBSERVED}`,
    ].sort());
  });

  it("keeps definitive good-prefix TRACE verdicts stable under every one-bit extension", () => {
    let checked = 0;
    for (const trace of binaryTraces(4)) {
      for (const ruleId of ["R2", "R3", "R7"]) {
        const before = evalOne(trace, ruleId, false);
        if (before !== STATUS.PASS) continue;
        for (const bit of [0, 1]) {
          const after = evalOne([...trace, S(bit)], ruleId, false);
          expect(after, `${ruleId} definitive PASS changed after extension`).toBe(STATUS.PASS);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps a MONOTONE safety counterexample definitively false under every extension", () => {
    const cfg = { ...config, r2Modus: R2_MODUS.MONOTONE };
    let checked = 0;

    for (const trace of binaryTraces(4)) {
      if (evalOne(trace, "R2", false, cfg) !== STATUS.FAIL) continue;
      for (const bit of [0, 1]) {
        expect(evalOne([...trace, S(bit)], "R2", false, cfg)).toBe(STATUS.FAIL);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("never turns missing CONFIG_ERROR setup into a positive verdict", () => {
    for (const trace of binaryTraces(5)) {
      const report = evaluateNineRules(trace, {}, { enabled: ["R2", "R4"] });
      for (const rule of report.rules) expect(rule.status).toBe(STATUS.CONFIG_ERROR);
      expect(report.overall).toBe(STATUS.CONFIG_ERROR);
    }
  });

  it("completion only finalizes open-prefix R7/R9 evidence; it does not invent observations", () => {
    for (const trace of binaryTraces(5)) {
      const r7Open = evalOne(trace, "R7", false);
      const r7Closed = evalOne(trace, "R7", true);
      if (r7Open === STATUS.FAIL_VORLAEUFIG) expect(r7Closed).toBe(STATUS.FAIL);
      if (r7Open === STATUS.PASS) expect(r7Closed).toBe(STATUS.PASS);

      const r9Open = evalOne(trace, "R9", false);
      const r9Closed = evalOne(trace, "R9", true);
      if (r9Open === STATUS.UNOBSERVED) expect(r9Closed).toBe(STATUS.UNOBSERVED);
      if (r9Open === STATUS.PASS_VORLAEUFIG) expect(r9Closed).toBe(STATUS.PASS);
      if (r9Open === STATUS.FAIL_VORLAEUFIG) expect(r9Closed).toBe(STATUS.FAIL);
    }
  });
});
