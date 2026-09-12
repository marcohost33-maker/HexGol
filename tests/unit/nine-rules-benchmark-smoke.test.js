import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DEGRADABLE_KEYS,
  makeConfig,
  percentile,
  stats,
} from "../../experimental/bench-nine-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

// Run the harness as a child process, exactly the way the npm script and the
// workflow do. Returns the spawn result plus the path it was told to write to,
// so a test can assert that NOTHING was written when the run was rejected.
function runHarness(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hexgol-nine-rules-bench-"));
  const output = join(dir, "result.json");
  const run = spawnSync(process.execPath, ["experimental/bench-nine-rules.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      BENCH_LENGTHS: "8,16",
      BENCH_TARGET_STATES: "64",
      BENCH_MIN_SAMPLES: "4",
      BENCH_OUTPUT: output,
      ...extraEnv,
    },
  });
  return { run, output, dir };
}

describe("nine-rule benchmark harness", () => {
  it("runs a tiny observe-only benchmark and emits the machine-readable v1 schema", () => {
    const { run, output, dir } = runHarness();

    try {
      expect(run.status, run.stderr || run.stdout).toBe(0);
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report.schema).toBe("hexgol.nine-rules-benchmark.v1");
      expect(report.lengths).toEqual([8, 16]);
      expect(Object.keys(report.profiles)).toEqual(["local", "golhex", "full"]);
      expect(report.rows).toHaveLength(6);
      expect(report.rows.every((row) => row.n >= 4)).toBe(true);
      expect(report.rows.every((row) => row.p50Ms >= 0 && row.p95Ms >= row.p50Ms)).toBe(true);
      expect(report.rows.every((row) => row.probeStatusCounts.CONFIG_ERROR === 0)).toBe(true);
      // The probe is stronger than "no CONFIG_ERROR": every enabled rule must
      // actually have been exercised, so no rule may sit at N/A or UNOBSERVED.
      expect(report.rows.every((row) => row.probeStatusCounts["N/A"] === 0)).toBe(true);
      expect(report.rows.every((row) => row.probeStatusCounts.UNOBSERVED === 0)).toBe(true);
      expect(report.rows.every((row) => row.probeStatusCounts.PASS === row.enabledRules)).toBe(true);

      expect(report.hotPathAnalysis.R2.traceLengthComplexity).toBe("O(T)");
      expect(report.hotPathAnalysis.R2.note).toMatch(/trace\.map/i);
      // R2 makes three full passes, not one: the map, the isNum check and the
      // increase search all walk the whole trace before any mode branch runs.
      expect(report.hotPathAnalysis.R2.fullTracePasses).toBe(3);
      expect(report.hotPathAnalysis.R2.note).toMatch(/THREE full passes/i);
      expect(report.hotPathAnalysis.R2.note).toMatch(/vals\.some/i);
      expect(report.hotPathAnalysis.R7.traceLengthComplexity).toMatch(/O\(T\)/);
      expect(report.hotPathAnalysis.R7.note).toMatch(/findIndex|full scan/i);
      expect(report.hotPathAnalysis.R4.populationComplexity).toBe("O(P^2) worst case");
      expect(report.hotPathAnalysis.R9.traceLengthComplexity).toMatch(/Delegated/i);
      expect(report.hotPathAnalysis.R9.note).toMatch(/outside this evaluator-core baseline/i);
      expect(report.hotPathAnalysis.profileExpectation.local).toMatch(/approximately flat/i);
      expect(report.hotPathAnalysis.profileExpectation.golhex).toMatch(/R2.*R7/i);

      for (const fit of Object.values(report.scaling)) {
        expect(fit).toHaveProperty("rSquared");
        expect(fit.rSquared === null || Number.isFinite(fit.rSquared)).toBe(true);
      }
      expect(report.interpretation.thresholdPolicy).toMatch(/observe-only/i);
      expect(report.interpretation.cachePolicy).toMatch(/incremental caching only if/i);
      expect(report.interpretation.complexityPolicy).toMatch(/descriptive only/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aborts with a non-zero exit when the sanity probe hits a CONFIG_ERROR", () => {
    const { run, output, dir } = runHarness({ BENCH_SELFTEST_DEGRADE: "progressVariable" });
    try {
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).not.toBe(0);
      expect(out).toMatch(/semantic sanity probe failed/);
      expect(out).toMatch(/R2=CONFIG_ERROR/);
      // A rejected run must leave no report behind; otherwise a later reader
      // could mistake the fast error path for a measurement.
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aborts with a non-zero exit when a rule silently degenerates to N/A", () => {
    // Dropping terminalPredicate does NOT raise CONFIG_ERROR -- R7 just reports
    // N/A and skips its full trace scan, which measured roughly 10x faster at
    // T=4096. A CONFIG_ERROR-only guard exits 0 here and reports the cheaper
    // number as if it were the real one.
    const { run, output, dir } = runHarness({ BENCH_SELFTEST_DEGRADE: "terminalPredicate" });
    try {
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).not.toBe(0);
      expect(out).toMatch(/semantic sanity probe failed/);
      expect(out).toMatch(/R7=N\/A/);
      // No rule is in CONFIG_ERROR here -- that is the whole point. (The word
      // itself appears in the explanatory part of the message, so match the
      // rule-to-status form, not the bare word.)
      expect(out).not.toMatch(/R\d+=CONFIG_ERROR/);
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown self-test switch instead of ignoring it", () => {
    expect(() => makeConfig("nicht-vorhanden")).toThrow(/BENCH_SELFTEST_DEGRADE must be one of/);
    expect(DEGRADABLE_KEYS).toContain("progressVariable");
    expect(DEGRADABLE_KEYS).toContain("terminalPredicate");
    // No switch at all is the normal case and must not throw.
    expect(() => makeConfig(undefined)).not.toThrow();
    expect(() => makeConfig("")).not.toThrow();
  });

  it("reports p95 from the upper tail, not from the median", () => {
    // Deterministic input, so the mutation p95 := p50 cannot hide behind timing
    // noise. Sorted 1..20: ceil(0.50*20)-1 = index 9 -> 10; ceil(0.95*20)-1 =
    // index 18 -> 19.
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.50)).toBe(10);
    expect(percentile(sorted, 0.95)).toBe(19);

    const shuffled = [7, 20, 3, 14, 1, 9, 18, 5, 12, 2, 16, 10, 6, 19, 4, 13, 8, 17, 11, 15];
    const s = stats(shuffled);
    expect(s.n).toBe(20);
    expect(s.p50Ms).toBe(10);
    expect(s.p95Ms).toBe(19);
    expect(s.p95Ms).toBeGreaterThan(s.p50Ms);
    expect(s.minMs).toBe(1);
    expect(s.maxMs).toBe(20);
    expect(s.meanMs).toBeCloseTo(10.5, 10);

    // Edges: an empty sample set must not throw, a single sample is its own
    // median and its own tail.
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([42], 0.50)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });
});
