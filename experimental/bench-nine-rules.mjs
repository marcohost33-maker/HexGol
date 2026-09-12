import { performance } from "node:perf_hooks";
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateNineRules, RULES, R2_MODUS, STATUS } from "../src/lib/nine-rules.js";

export function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === "") {
    if (fallback !== null && fallback !== undefined) return fallback;
    throw new Error(`${name} must not contain an empty value`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function parseLengths(value) {
  if (!value) return [16, 64, 256, 1024, 4096];
  const lengths = value.split(",").map((part) => parsePositiveInt(part.trim(), null, "BENCH_LENGTHS"));
  if (new Set(lengths).size !== lengths.length) throw new Error("BENCH_LENGTHS must be unique");
  return lengths;
}

export const PROFILES = Object.freeze({
  local: ["R1", "R3", "R5", "R6", "R8"],
  golhex: ["R1", "R2", "R3", "R7", "R8", "R9"],
  full: RULES.map((rule) => rule.id),
});

// Code-derived cost model. Keep this next to the benchmark so timing data is not
// interpreted without knowing which rule actually scans which dimension.
// T = trace length, P = population size returned by config.population().
export const HOT_PATH_ANALYSIS = Object.freeze({
  R1: {
    traceLengthComplexity: "O(1)",
    note: "Reads the current/last state only relative to trace length.",
  },
  R2: {
    traceLengthComplexity: "O(T)",
    note: "Makes THREE full passes over the trace before any mode branch runs: "
      + "trace.map() materializes the progress values (nine-rules.js:267), a first "
      + "vals.some() checks that every value is numeric (:268), and a second "
      + "vals.some() searches for any increase (:274). The ORDERED window loop that "
      + "follows is bounded by r2Fenster, so those three full passes -- not the "
      + "window -- are the trace-length hot path. MONOTONE adds a fourth full pass "
      + "in the worst case.",
    fullTracePasses: 3,
    benchmarkCoverage: "Enabled in golhex and full profiles.",
  },
  R3: {
    traceLengthComplexity: "O(1)",
    note: "Checks trace length/history presence only.",
  },
  R4: {
    traceLengthComplexity: "O(1) with respect to T",
    populationComplexity: "O(P^2) worst case",
    note: "Pairwise discriminator/comparator search can inspect every population pair; benchmark P is fixed at 12 and may exit early, so this benchmark does not characterize large-P scaling.",
  },
  R5: {
    traceLengthComplexity: "O(1)",
    note: "Validates the last state's orientation only.",
  },
  R6: {
    traceLengthComplexity: "O(1)",
    note: "Compares only the last transition.",
  },
  R7: {
    traceLengthComplexity: "O(T) worst case",
    note: "Uses trace.findIndex(terminalPredicate) (nine-rules.js:422); the benchmark puts the terminal state last, deliberately exercising the full scan.",
    fullTracePasses: 1,
    benchmarkCoverage: "Enabled in golhex and full profiles.",
  },
  R8: {
    traceLengthComplexity: "O(1)",
    note: "Compares only the last two intrinsic values.",
  },
  R9: {
    traceLengthComplexity: "Delegated to lifeModel.predicate",
    note: "The benchmark proxy predicate is O(1). Arbitrary application life models may scan the trace and are explicitly outside this evaluator-core baseline.",
  },
  profileExpectation: {
    local: "Should remain approximately flat as T grows because its enabled rules are O(1) in trace length.",
    golhex: "Expected to grow with T because R2 makes three full trace passes and R7 performs a worst-case full terminal scan in this fixture.",
    full: "Expected to grow with T for the same R2/R7 reason; R4 population cost is held constant by fixed P=12.",
  },
});

export function buildTrace(length) {
  return Array.from({ length }, (_, i) => ({
    u: i % 7,
    q: { q: i % 11, r: -((i % 11) >> 1) },
    d: { q: 1, r: 0 },
    progress: i,
    terminal: i === length - 1,
    population: Array.from({ length: 12 }, (__, j) => ({ id: j, bucket: (i + j) % 4 })),
  }));
}

const BASE_CONFIG = Object.freeze({
  progressVariable: (state) => state.progress,
  r2Modus: R2_MODUS.ORDERED,
  r2Fenster: 128,
  r2Delta: 0,
  r2ReversalToleranz: 0,
  population: (state) => state.population,
  discriminator: (a, b) => a.bucket !== b.bucket,
  terminalPredicate: (state) => state.terminal === true,
  lifeModel: Object.freeze({
    name: "benchmark-proxy",
    version: "1",
    predicate: (last, trace) => trace.length >= 2 && last.u !== undefined,
  }),
});

// Fault injection for this harness's OWN tests: drop exactly one config key so a
// test can prove that the semantic sanity probe aborts. The switch can never make
// a measurement look better, because every degraded config is rejected before the
// timed loop starts -- that is the single property it exists to demonstrate.
// Unknown values are rejected rather than ignored (fail-closed).
export const DEGRADABLE_KEYS = Object.freeze(["progressVariable", "terminalPredicate", "lifeModel"]);

export function makeConfig(degradeKey) {
  if (degradeKey === undefined || degradeKey === "") return BASE_CONFIG;
  if (!DEGRADABLE_KEYS.includes(degradeKey)) {
    throw new Error(
      `BENCH_SELFTEST_DEGRADE must be one of ${DEGRADABLE_KEYS.join(",")} -- got "${degradeKey}"`,
    );
  }
  return Object.freeze({ ...BASE_CONFIG, [degradeKey]: undefined });
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    n: samples.length,
    meanMs: total / samples.length,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

export function statusHistogram(result) {
  return Object.fromEntries(
    Object.values(STATUS).map((status) => [
      status,
      result.rules.filter((rule) => rule.status === status).length,
    ]),
  );
}

export const PROBE_FAILURE_PREFIX = "semantic sanity probe failed";

// Untimed semantic sanity probe. Every enabled rule must reach PASS on the
// benchmark fixture. This is deliberately stricter than "no CONFIG_ERROR":
// CONFIG_ERROR is a fast error path, but N/A and UNOBSERVED are just as
// dangerous, because a rule that is never exercised silently drops its cost out
// of the number. Measured on this fixture at T=4096: removing terminalPredicate
// degrades R7 to N/A and makes R7 roughly 10x cheaper -- an invalid configuration
// masquerading as performance, which the old CONFIG_ERROR-only check let through
// with exit code 0. Every enabled rule reaching PASS is a property of the fixture
// for every trace length >= 2; a single-state trace exercises no rule and is
// correctly rejected here.
export function probeOrThrow(trace, enabled, config) {
  const probe = evaluateNineRules(trace, config, { enabled, traceComplete: true });
  const unhealthy = probe.rules.filter((rule) => rule.status !== STATUS.PASS);
  if (unhealthy.length > 0) {
    const detail = unhealthy.map((rule) => `${rule.id}=${rule.status}`).join(",");
    throw new Error(
      `${PROBE_FAILURE_PREFIX}: ${detail}. Every enabled rule must reach PASS on the `
      + "benchmark fixture; CONFIG_ERROR, N/A and UNOBSERVED all mean the measured "
      + "work is not the work being claimed.",
    );
  }
  return statusHistogram(probe);
}

function benchmarkOne(trace, enabled, config, { targetStates, minSamples }) {
  // Keep total processed states roughly comparable across trace lengths while
  // retaining enough samples for a useful p95 at the largest default case.
  const iterations = Math.max(minSamples, Math.floor(targetStates / trace.length));
  const warmup = Math.max(5, Math.floor(iterations / 5));
  const options = { enabled, traceComplete: true };

  const probeStatusCounts = probeOrThrow(trace, enabled, config);

  for (let i = 0; i < warmup; i++) evaluateNineRules(trace, config, options);

  const heapBefore = process.memoryUsage().heapUsed;
  const samples = new Array(iterations);
  let sink = 0;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const result = evaluateNineRules(trace, config, options);
    samples[i] = performance.now() - t0;
    // Observable sink prevents a future optimizing runtime from proving the
    // result unused. It is not part of the timed evaluator work except a single
    // integer read/add after the call.
    sink += result.rules.length + result.rules.reduce((n, rule) => n + rule.status.length, 0);
  }
  const heapAfter = process.memoryUsage().heapUsed;

  const s = stats(samples);
  return {
    ...s,
    opsPerSecondFromMean: s.meanMs > 0 ? 1000 / s.meanMs : null,
    probeStatusCounts,
    heapDeltaBytesObserved: heapAfter - heapBefore,
    heapNote: "process.memoryUsage delta is observational only; GC makes it unsuitable as a gate",
    sink,
  };
}

// Fit a simple least-squares line time = intercept + slope * traceLength per
// profile. R^2 describes this sample's linear fit quality; neither is a proof of
// algorithmic complexity. The code-derived model above remains authoritative.
export function linearFit(profileRows) {
  if (profileRows.length < 2) {
    return { interceptMs: null, slopeMsPerState: null, rSquared: null };
  }
  const n = profileRows.length;
  const sx = profileRows.reduce((s, r) => s + r.traceLength, 0);
  const sy = profileRows.reduce((s, r) => s + r.meanMs, 0);
  const sxx = profileRows.reduce((s, r) => s + r.traceLength ** 2, 0);
  const sxy = profileRows.reduce((s, r) => s + r.traceLength * r.meanMs, 0);
  const denom = n * sxx - sx * sx;
  const slopeMsPerState = denom === 0 ? null : (n * sxy - sx * sy) / denom;
  const interceptMs = slopeMsPerState === null ? null : (sy - slopeMsPerState * sx) / n;
  if (slopeMsPerState === null || interceptMs === null) {
    return { interceptMs, slopeMsPerState, rSquared: null };
  }
  const meanY = sy / n;
  const ssTot = profileRows.reduce((s, r) => s + (r.meanMs - meanY) ** 2, 0);
  const ssRes = profileRows.reduce((s, r) => {
    const predicted = interceptMs + slopeMsPerState * r.traceLength;
    return s + (r.meanMs - predicted) ** 2;
  }, 0);
  const rSquared = ssTot === 0 ? null : 1 - (ssRes / ssTot);
  return { interceptMs, slopeMsPerState, rSquared };
}

export function runBenchmark({ lengths, targetStates, minSamples, config, log = () => {} }) {
  const rows = [];
  for (const length of lengths) {
    const trace = buildTrace(length);
    for (const [profile, enabled] of Object.entries(PROFILES)) {
      const measured = benchmarkOne(trace, enabled, config, { targetStates, minSamples });
      rows.push({
        profile,
        enabledRules: enabled.length,
        traceLength: length,
        ...measured,
      });
      log(
        `${profile.padEnd(6)} L=${String(length).padStart(4)} ` +
        `n=${String(measured.n).padStart(5)} ` +
        `p50=${measured.p50Ms.toFixed(4)}ms p95=${measured.p95Ms.toFixed(4)}ms ` +
        `mean=${measured.meanMs.toFixed(4)}ms`,
      );
    }
  }

  const scaling = Object.fromEntries(
    Object.keys(PROFILES).map((profile) => [
      profile,
      linearFit(rows.filter((row) => row.profile === profile)),
    ]),
  );

  return {
    schema: "hexgol.nine-rules-benchmark.v1",
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    parameters: { targetStates, minSamples },
    profiles: PROFILES,
    lengths,
    rows,
    scaling,
    hotPathAnalysis: HOT_PATH_ANALYSIS,
    interpretation: {
      thresholdPolicy: "observe-only; no CI performance threshold from a single machine",
      cachePolicy: "introduce incremental caching only if repeated production/UI measurements justify invalidation complexity",
      complexityPolicy: "timing-fit slope/R^2 are descriptive only; code-derived path analysis determines asymptotic claims",
    },
  };
}

function main() {
  const report = runBenchmark({
    lengths: parseLengths(process.env.BENCH_LENGTHS),
    targetStates: parsePositiveInt(process.env.BENCH_TARGET_STATES, 200_000, "BENCH_TARGET_STATES"),
    minSamples: parsePositiveInt(process.env.BENCH_MIN_SAMPLES, 40, "BENCH_MIN_SAMPLES"),
    config: makeConfig(process.env.BENCH_SELFTEST_DEGRADE),
    log: (line) => console.log(line),
  });
  const output = resolve(process.cwd(), process.env.BENCH_OUTPUT || "nine-rules-benchmark.json");
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${output}`);
}

// Run only when invoked as the entry point, so a test can import the pure helpers
// (percentile/stats/probeOrThrow) without starting a measurement. realpathSync
// normalizes drive-letter casing and symlinks, which a raw argv[1] comparison
// gets wrong on Windows. If this guard ever failed open, the harness would write
// no report and both the smoke test and the workflow summary step would fail on
// the missing file -- it cannot fail silently.
const isEntryPoint = process.argv[1]
  && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (isEntryPoint) main();
