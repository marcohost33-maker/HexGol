import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateNineRules, RULES, R2_MODUS, STATUS } from "../src/lib/nine-rules.js";

function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === "") {
    if (fallback !== null && fallback !== undefined) return fallback;
    throw new Error(`${name} must not contain an empty value`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseLengths(value) {
  if (!value) return [16, 64, 256, 1024, 4096];
  const lengths = value.split(",").map((part) => parsePositiveInt(part.trim(), null, "BENCH_LENGTHS"));
  if (new Set(lengths).size !== lengths.length) throw new Error("BENCH_LENGTHS must be unique");
  return lengths;
}

const LENGTHS = parseLengths(process.env.BENCH_LENGTHS);
const TARGET_STATES = parsePositiveInt(process.env.BENCH_TARGET_STATES, 200_000, "BENCH_TARGET_STATES");
const MIN_SAMPLES = parsePositiveInt(process.env.BENCH_MIN_SAMPLES, 40, "BENCH_MIN_SAMPLES");
const OUTPUT = resolve(process.cwd(), process.env.BENCH_OUTPUT || "nine-rules-benchmark.json");

const PROFILES = Object.freeze({
  local: ["R1", "R3", "R5", "R6", "R8"],
  golhex: ["R1", "R2", "R3", "R7", "R8", "R9"],
  full: RULES.map((rule) => rule.id),
});

// Code-derived cost model. Keep this next to the benchmark so timing data is not
// interpreted without knowing which rule actually scans which dimension.
// T = trace length, P = population size returned by config.population().
const HOT_PATH_ANALYSIS = Object.freeze({
  R1: {
    traceLengthComplexity: "O(1)",
    note: "Reads the current/last state only relative to trace length.",
  },
  R2: {
    traceLengthComplexity: "O(T)",
    note: "Materializes progress over the full trace with trace.map(); ORDERED may then scan its bounded window, so the full map remains the trace-length hot path.",
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
    note: "Uses trace.findIndex(terminalPredicate); the benchmark puts the terminal state last, deliberately exercising the full scan.",
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
    golhex: "Expected to grow with T because R2 performs a full trace map and R7 performs a worst-case full terminal scan in this fixture.",
    full: "Expected to grow with T for the same R2/R7 reason; R4 population cost is held constant by fixed P=12.",
  },
});

function buildTrace(length) {
  return Array.from({ length }, (_, i) => ({
    u: i % 7,
    q: { q: i % 11, r: -((i % 11) >> 1) },
    d: { q: 1, r: 0 },
    progress: i,
    terminal: i === length - 1,
    population: Array.from({ length: 12 }, (__, j) => ({ id: j, bucket: (i + j) % 4 })),
  }));
}

const config = Object.freeze({
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

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function stats(samples) {
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

function statusHistogram(result) {
  return Object.fromEntries(
    Object.values(STATUS).map((status) => [
      status,
      result.rules.filter((rule) => rule.status === status).length,
    ]),
  );
}

function benchmarkOne(trace, enabled) {
  // Keep total processed states roughly comparable across trace lengths while
  // retaining enough samples for a useful p95 at the largest default case.
  const iterations = Math.max(MIN_SAMPLES, Math.floor(TARGET_STATES / trace.length));
  const warmup = Math.max(5, Math.floor(iterations / 5));
  const options = { enabled, traceComplete: true };

  // Untimed semantic sanity probe: a benchmark that immediately falls into a
  // configuration error is a fast error path, not useful performance evidence.
  const probe = evaluateNineRules(trace, config, options);
  const configErrors = probe.rules.filter((rule) => rule.status === STATUS.CONFIG_ERROR);
  if (configErrors.length > 0) {
    throw new Error(`benchmark profile has CONFIG_ERROR: ${configErrors.map((rule) => rule.id).join(",")}`);
  }
  const probeStatusCounts = statusHistogram(probe);

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

const rows = [];
for (const length of LENGTHS) {
  const trace = buildTrace(length);
  for (const [profile, enabled] of Object.entries(PROFILES)) {
    const measured = benchmarkOne(trace, enabled);
    rows.push({
      profile,
      enabledRules: enabled.length,
      traceLength: length,
      ...measured,
    });
    console.log(
      `${profile.padEnd(6)} L=${String(length).padStart(4)} ` +
      `n=${String(measured.n).padStart(5)} ` +
      `p50=${measured.p50Ms.toFixed(4)}ms p95=${measured.p95Ms.toFixed(4)}ms ` +
      `mean=${measured.meanMs.toFixed(4)}ms`,
    );
  }
}

// Fit a simple least-squares line time = intercept + slope * traceLength per
// profile. R^2 describes this sample's linear fit quality; neither is a proof of
// algorithmic complexity. The code-derived model above remains authoritative.
function linearFit(profileRows) {
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

const scaling = Object.fromEntries(
  Object.keys(PROFILES).map((profile) => [
    profile,
    linearFit(rows.filter((row) => row.profile === profile)),
  ]),
);

const report = {
  schema: "hexgol.nine-rules-benchmark.v1",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  parameters: { targetStates: TARGET_STATES, minSamples: MIN_SAMPLES },
  profiles: PROFILES,
  lengths: LENGTHS,
  rows,
  scaling,
  hotPathAnalysis: HOT_PATH_ANALYSIS,
  interpretation: {
    thresholdPolicy: "observe-only; no CI performance threshold from a single machine",
    cachePolicy: "introduce incremental caching only if repeated production/UI measurements justify invalidation complexity",
    complexityPolicy: "timing-fit slope/R^2 are descriptive only; code-derived path analysis determines asymptotic claims",
  },
};

writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`wrote ${OUTPUT}`);
