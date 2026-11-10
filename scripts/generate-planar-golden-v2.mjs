#!/usr/bin/env node
// Golden Vector producer v2 for golhex-3d Issue #22 ("expand HexGol parity v1 into a
// profile matrix"): stage 1 (second totalistic rule) and stage 2 (box-torus topology).
//
// Like v1 this drives ONLY the production HexGol buildNeighbors() + stepLife(); no CA
// logic lives here. One file per profile (Issue #22: "no single mega-fixture"), and every
// profile carries its own negative counterexample: the same seed run under the
// neighbouring profile (other rule, or other boundary) must diverge, and the first
// diverging tick is recorded. A profile whose seed cannot tell the two apart is refused.
//
// v1 (scripts/generate-planar-golden.mjs, contracts/golhex-planar-golden-v1.json) is left
// untouched: no silent regeneration of an old contract version.
//
//   node scripts/generate-planar-golden-v2.mjs contracts/golhex-planar-golden-v2   # write
//   node scripts/generate-planar-golden-v2.mjs --check contracts/golhex-planar-golden-v2
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNeighbors, RMETA, RULES, stepLife } from "../src/lib/sim-engine.js";

export const SCHEMA = "golhex-planar-golden-v2";
export const SOURCE_ENGINE_BLOB = "631c07d4713922ad0f433ba408e36609dc148517";
// Commit that last changed src/lib/sim-engine.js (the blob above); same as v1.
export const SOURCE_ENGINE_COMMIT = "15a1be0396ac72f754d8804220bb3f25d7b4a1c1";

const MODIFIERS_OFF = Object.freeze({
  colorMode: "mix", a1: false, a2: false, a3: false, a4: false,
  a5: "off", sysT: false, spN: 0, adia: false,
});

/**
 * The profile matrix rows produced here. `contrast` names what the counterexample changes.
 * Seeds are explicit (no PRNG) and chosen so that the defining property is exercised:
 *  - B2/S35: cells with exactly 4 and exactly 5 live neighbours occur (S34 and S35 differ
 *    exactly there);
 *  - torus: live cells sit on all four borders, so wrapped neighbours change counts.
 */
export const PROFILES_V2 = Object.freeze([
  Object.freeze({
    id: "b2s35-oddr-edge",
    profile: "H:B2/S35|odd-r|edge|single-color|no-modifiers",
    ruleIndex: 1, boundary: "edge", rows: 7, cols: 8, steps: 8,
    live: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [3, 5], [4, 3], [4, 4], [1, 3], [5, 4]],
    contrast: { kind: "rule", ruleIndex: 0, boundary: "edge" },
  }),
  Object.freeze({
    id: "b2s34-oddr-torus",
    profile: "H:B2/S34|odd-r|torus|single-color|no-modifiers",
    ruleIndex: 0, boundary: "torus", rows: 6, cols: 6, steps: 8,
    live: [[0, 0], [0, 1], [0, 5], [5, 0], [5, 5], [1, 0], [3, 5], [2, 0]],
    contrast: { kind: "boundary", ruleIndex: 0, boundary: "edge" },
  }),
]);

function currentEngineBlob() {
  return execFileSync("git", ["hash-object", "src/lib/sim-engine.js"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  }).trim();
}

function stateSha256(checkpoint) {
  const canonical = JSON.stringify({ tick: checkpoint.tick, col: checkpoint.col, age: checkpoint.age, ghost: checkpoint.ghost });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Runs the production engine; returns every checkpoint t = 0..steps. */
function run({ ruleIndex, boundary, rows, cols, steps, live }) {
  if (boundary !== "edge" && boundary !== "torus") throw new Error(`unknown boundary ${boundary}`);
  const tables = buildNeighbors(rows, cols, "box");
  const NL = boundary === "torus" ? tables.torus : tables.edge;
  const n = rows * cols;
  let col = new Uint8Array(n), gh = new Uint8Array(n), age = new Uint16Array(n);
  for (const [r, c] of live) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) throw new Error(`seed cell outside ${rows}x${cols}: ${r},${c}`);
    col[r * cols + c] = 1; age[r * cols + c] = 1;
  }
  const checkpoints = [{ tick: 0, col: Array.from(col), age: Array.from(age), ghost: Array.from(gh), births: 0, deaths: 0 }];
  let nc = new Uint8Array(n), ng = new Uint8Array(n), na = new Uint16Array(n);
  for (let tick = 1; tick <= steps; tick += 1) {
    const stats = stepLife({ col, gh, age, nc, ng, na, NL, dmask: tables.mask, meta: RMETA[ruleIndex], ...MODIFIERS_OFF, tick });
    [col, nc] = [nc, col]; [gh, ng] = [ng, gh]; [age, na] = [na, age];
    checkpoints.push({ tick, col: Array.from(col), age: Array.from(age), ghost: Array.from(gh), births: stats.births, deaths: stats.deaths });
  }
  return { checkpoints, neighborTable: Array.from(NL) };
}

/** Exercised neighbour counts of live cells over the run (shows S4/S5 actually occur). */
function liveNeighbourCounts(checkpoints, table) {
  const seen = new Set();
  for (const cp of checkpoints.slice(0, -1)) {
    for (let i = 0; i < cp.col.length; i += 1) {
      if (cp.col[i] === 0) continue;
      let live = 0;
      for (let k = 0; k < 6; k += 1) { const j = table[i * 6 + k]; if (j >= 0 && cp.col[j] !== 0) live += 1; }
      seen.add(live);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

export function buildProfile(spec) {
  const rule = RULES[spec.ruleIndex];
  const main = run(spec);
  const alt = run({ ...spec, ruleIndex: spec.contrast.ruleIndex, boundary: spec.contrast.boundary });
  const firstDiff = main.checkpoints.findIndex((cp, t) => stateSha256(cp) !== stateSha256(alt.checkpoints[t]));
  if (firstDiff < 0) throw new Error(`${spec.id}: seed does not distinguish the profile from its contrast`);
  const counts = liveNeighbourCounts(main.checkpoints, main.neighborTable);
  if (spec.contrast.kind === "rule" && !(counts.includes(4) && counts.includes(5))) {
    throw new Error(`${spec.id}: S34/S35 differ only at 4 and 5 live neighbours; seed exercises ${counts}`);
  }
  if (spec.contrast.kind === "boundary" && main.neighborTable.every((v, i) => v === alt.neighborTable[i])) {
    throw new Error(`${spec.id}: torus and edge tables are identical`);
  }
  const alternate = RULES[spec.contrast.ruleIndex];
  return {
    schema: SCHEMA,
    profileId: spec.id,
    profile: spec.profile,
    source: {
      repo: "marcohost33-maker/HexGol",
      commit: SOURCE_ENGINE_COMMIT,
      enginePath: "src/lib/sim-engine.js",
      engineBlobSha: SOURCE_ENGINE_BLOB,
      engineFunction: "stepLife",
      neighborFunction: "buildNeighbors(rows, cols, \"box\")." + spec.boundary,
      generator: "scripts/generate-planar-golden-v2.mjs",
    },
    provenance: {
      reproducibilityLevel: "R3-within-nodejs-backend",
      canonicalReferenceBackend: { runtime: "Node.js", language: "ECMAScript modules" },
      precision: { col: "uint8", age: "uint16", ghost: "uint8", neighborCounts: "integer" },
      seed: null,
      initialStateSource: "explicit seed; no PRNG",
      tickSequence: main.checkpoints.map(({ tick }) => tick),
      checkpointStateEncoding: "canonical-json-v1:{tick,col,age,ghost}",
      checkpointStateSha256: main.checkpoints.map((cp) => ({ tick: cp.tick, sha256: stateSha256(cp) })),
    },
    topology: {
      layout: "pointy-top-odd-r", rows: spec.rows, cols: spec.cols, boundary: spec.boundary,
      neighborsPerCell: 6, neighborTable: main.neighborTable,
    },
    rule: { family: "totalistic-hex", label: rule.l, birth: [...rule.B], survival: [...rule.S], ...MODIFIERS_OFF },
    initial: { description: "explicit seed; all living cells use color state 1", liveCoordinates: spec.live.map(([r, c]) => [r, c]) },
    counterexample: {
      changes: spec.contrast.kind,
      rule: { label: alternate.l, birth: [...alternate.B], survival: [...alternate.S] },
      boundary: spec.contrast.boundary,
      firstDivergingTick: firstDiff,
      stateSha256AtFirstDivergingTick: stateSha256(alt.checkpoints[firstDiff]),
    },
    exercisedLiveNeighbourCounts: counts,
    checkpoints: main.checkpoints,
  };
}

export function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const current = currentEngineBlob();
  if (current !== SOURCE_ENGINE_BLOB) {
    throw new Error(`sim-engine.js changed: expected blob ${SOURCE_ENGINE_BLOB}, got ${current}. Create v3 instead of refreshing v2.`);
  }
  const check = process.argv.includes("--check");
  const dir = process.argv.filter((a) => a !== "--check")[2] ?? "contracts/golhex-planar-golden-v2";
  if (!check) mkdirSync(dir, { recursive: true });
  let drift = 0;
  for (const spec of PROFILES_V2) {
    const body = canonicalJson(buildProfile(spec));
    const file = join(dir, `${spec.id}.json`);
    const sha = createHash("sha256").update(body).digest("hex");
    if (check) {
      const same = readFileSync(file, "utf8") === body;
      if (!same) drift += 1;
      process.stderr.write(`${file}: ${same ? "reproduced" : "DRIFTED"} sha256=${sha}\n`);
    } else {
      writeFileSync(file, body, "utf8");
      process.stderr.write(`${file} sha256=${sha}\n`);
    }
  }
  process.exitCode = drift ? 1 : 0;
}
