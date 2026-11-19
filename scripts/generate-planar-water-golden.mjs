#!/usr/bin/env node
// Golden Vector producer for the real-valued WATER profile (contract family
// "golhex-planar-water-golden-v1"). Answers the open item from the golhex-3d R03 re-audit
// (2026-11-19, NR-GH3D-R03-03): the 2D water parity there was checked against a
// hand-mirrored copy of stepWater, so shared mistakes stay invisible. This producer is
// the independent upstream side: it drives ONLY the production buildNeighbors() and
// stepWater() and writes what they compute, bit for bit.
//
// No fluid logic lives here. Both counterexamples are produced by the same production
// function under a changed condition, never by a second implementation:
//  - "precision": the same seed with Float64Array buffers. stepWater is typed-array
//    agnostic, so this is the production code minus the binary32 store rounding -- the
//    mistake a consumer in another language makes first.
//  - "boundary": the same seed on the other neighbour table (edge vs box-torus).
// A seed that cannot tell the profile from its contrast is refused.
//
// State encoding: every cell is the IEEE-754 binary32 bit pattern as an unsigned 32-bit
// integer (`wBits`), so the fixture is lossless and free of decimal round-tripping. The
// state hash is SHA-256 over: tick as uint32 little-endian, then the cells as float32
// little-endian in row-major order.
//
// The life contracts v1/v2 are left untouched.
//
//   node scripts/generate-planar-water-golden.mjs contracts/golhex-planar-water-golden-v1   # write
//   node scripts/generate-planar-water-golden.mjs --check contracts/golhex-planar-water-golden-v1
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNeighbors, stepWater } from "../src/lib/sim-engine.js";

export const SCHEMA = "golhex-planar-water-golden-v1";
export const SOURCE_ENGINE_BLOB = "631c07d4713922ad0f433ba408e36609dc148517";
// Commit that last changed src/lib/sim-engine.js (the blob above); same as life v1/v2.
export const SOURCE_ENGINE_COMMIT = "15a1be0396ac72f754d8804220bb3f25d7b4a1c1";

/**
 * Seeds are explicit [row, col, value] triples (no PRNG); a value is stored through
 * Float32Array like the app's field, so 0.3 means fround(0.3).
 *  - edge: a full block above a partly filled floor, an isolated half-full cell and one
 *    cell below the 1e-6 gravity threshold. Exercises proportional splitting onto two
 *    lower neighbours, full receivers, the floor, and lateral equalisation.
 *  - torus: water in the first and last column, so the lateral exchange crosses the
 *    wrap. Gravity never wraps (stepWater only flows to a strictly larger row).
 */
export const WATER_PROFILES = Object.freeze([
  Object.freeze({
    id: "water-oddr-edge",
    profile: "rval:water|odd-r|edge|float32|closed-system",
    boundary: "edge", rows: 6, cols: 6, steps: 12,
    seed: [
      [0, 1, 1], [0, 2, 1], [0, 3, 1], [1, 1, 1], [1, 2, 1], [1, 3, 1],
      [2, 2, 0.3], [3, 4, 0.5], [2, 5, 1e-7],
      [5, 0, 1], [5, 1, 1], [5, 2, 0.75], [4, 1, 1],
    ],
    contrast: { kind: "precision", boundary: "edge" },
  }),
  Object.freeze({
    id: "water-oddr-torus",
    profile: "rval:water|odd-r|torus|float32|closed-system",
    boundary: "torus", rows: 6, cols: 6, steps: 12,
    seed: [
      [0, 0, 1], [1, 0, 1], [2, 0, 0.6], [0, 5, 0.9], [3, 5, 1], [4, 0, 0.2], [5, 5, 1], [5, 4, 0.4],
    ],
    contrast: { kind: "boundary", boundary: "edge" },
  }),
]);

function currentEngineBlob() {
  return execFileSync("git", ["hash-object", "src/lib/sim-engine.js"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  }).trim();
}

/** binary32 bit patterns of a field; a Float64Array is rounded to nearest-even first. */
function bitsOf(field) {
  const f32 = field instanceof Float32Array ? field : Float32Array.from(field);
  const view = new DataView(f32.buffer, f32.byteOffset, f32.byteLength);
  const out = new Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) out[i] = view.getUint32(i * 4, true);
  return out;
}

export function stateSha256(tick, wBits) {
  const bytes = new DataView(new ArrayBuffer(4 + wBits.length * 4));
  bytes.setUint32(0, tick, true);
  for (let i = 0; i < wBits.length; i += 1) bytes.setUint32(4 + i * 4, wBits[i], true);
  return createHash("sha256").update(new Uint8Array(bytes.buffer)).digest("hex");
}

/** Sum in index order, accumulated in binary64 (deterministic: one fixed order). */
function massOf(field) {
  let s = 0;
  for (let i = 0; i < field.length; i += 1) s += field[i];
  return s;
}

/** Runs production stepWater with the app's buffer swap; checkpoints t = 0..steps. */
function run({ boundary, rows, cols, steps, seed }, FieldArray = Float32Array) {
  if (boundary !== "edge" && boundary !== "torus") throw new Error(`unknown boundary ${boundary}`);
  const tables = buildNeighbors(rows, cols, "box");
  const NL = boundary === "torus" ? tables.torus : tables.edge;
  const n = rows * cols;
  let w = new FieldArray(n), buf = new FieldArray(n);
  for (const [r, c, v] of seed) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) throw new Error(`seed cell outside ${rows}x${cols}: ${r},${c}`);
    if (!(v > 0 && v <= 1)) throw new Error(`seed value outside (0,1]: ${v}`);
    // Seeds are defined as binary32 values in both runs, so the float64 contrast differs
    // only in the arithmetic, not in its starting point.
    w[r * cols + c] = Math.fround(v);
  }
  const snapshot = (tick) => {
    const wBits = bitsOf(w);
    return { tick, wBits, massFloat64: massOf(w), stateSha256: stateSha256(tick, wBits) };
  };
  const checkpoints = [snapshot(0)];
  for (let tick = 1; tick <= steps; tick += 1) {
    // Same protocol as src/App.tsx and src/worker/render-worker.js: stepWater overwrites
    // its input with the post-gravity snapshot, the returned buffer is the new field.
    const out = stepWater(w, NL, cols, buf);
    buf = w; w = out;
    for (let i = 0; i < n; i += 1) {
      if (!(w[i] >= 0 && w[i] <= 1)) throw new Error(`tick ${tick}: cell ${i} left [0,1] or is NaN: ${w[i]}`);
    }
    checkpoints.push(snapshot(tick));
  }
  return { checkpoints, neighborTable: Array.from(NL) };
}

export function buildProfile(spec) {
  const main = run(spec);
  const alt = spec.contrast.kind === "precision"
    ? run(spec, Float64Array)
    : run({ ...spec, boundary: spec.contrast.boundary });
  const firstDiff = main.checkpoints.findIndex((cp, t) => cp.stateSha256 !== alt.checkpoints[t].stateSha256);
  if (firstDiff < 0) throw new Error(`${spec.id}: seed does not distinguish the profile from its contrast`);
  if (firstDiff === 0) throw new Error(`${spec.id}: contrast already differs in the seed`);
  if (spec.contrast.kind === "boundary" && main.neighborTable.every((v, i) => v === alt.neighborTable[i])) {
    throw new Error(`${spec.id}: torus and edge tables are identical`);
  }
  const mass0 = main.checkpoints[0].massFloat64;
  const maxMassDrift = Math.max(...main.checkpoints.map((cp) => Math.abs(cp.massFloat64 - mass0)));
  // Not a physics claim: a guard that the fixture does not freeze a visibly broken run.
  if (maxMassDrift > 1e-5) throw new Error(`${spec.id}: mass drift ${maxMassDrift} exceeds 1e-5`);
  return {
    schema: SCHEMA,
    profileId: spec.id,
    profile: spec.profile,
    source: {
      repo: "marcohost33-maker/HexGol",
      commit: SOURCE_ENGINE_COMMIT,
      enginePath: "src/lib/sim-engine.js",
      engineBlobSha: SOURCE_ENGINE_BLOB,
      engineFunction: "stepWater",
      neighborFunction: "buildNeighbors(rows, cols, \"box\")." + spec.boundary,
      generator: "scripts/generate-planar-water-golden.mjs",
    },
    provenance: {
      reproducibilityLevel: "R3-within-nodejs-backend",
      canonicalReferenceBackend: { runtime: "Node.js", language: "ECMAScript modules" },
      arithmetic: "IEEE-754 binary64 for every intermediate (+ - * / min max only), stored to binary32 round-to-nearest-even; no fused multiply-add",
      stateEncoding: "wBits: binary32 bit pattern per cell as uint32, row-major",
      stateSha256Input: "uint32le(tick) || float32le(w[0]) || ... || float32le(w[n-1])",
      massFloat64: "sum of w in index order, accumulated in binary64 (diagnostic, not a gate)",
      bufferProtocol: "out = stepWater(w, NL, cols, buf); buf = w; w = out",
      seed: null,
      initialStateSource: "explicit seed; no PRNG",
      tickSequence: main.checkpoints.map(({ tick }) => tick),
    },
    topology: {
      layout: "pointy-top-odd-r", rows: spec.rows, cols: spec.cols, boundary: spec.boundary,
      neighborsPerCell: 6, neighborTable: main.neighborTable,
      neighborSlots: "k=3 is the right neighbour (lateral exchange), k=4 and k=5 the two lower neighbours (gravity)",
    },
    model: {
      family: "rval-water",
      openSystem: false,
      gravityThreshold: 1e-6,
      gravityShare: 0.5,
      lateralShare: 0.25,
      capacity: 1,
    },
    initial: {
      description: "explicit [row, col, value] triples; value is stored as binary32",
      cells: spec.seed.map(([r, c, v]) => [r, c, v]),
    },
    counterexample: {
      changes: spec.contrast.kind,
      description: spec.contrast.kind === "precision"
        ? "same production stepWater with Float64Array buffers (no binary32 store rounding), state rounded to binary32 for comparison"
        : "same seed on the " + spec.contrast.boundary + " neighbour table",
      firstDivergingTick: firstDiff,
      stateSha256AtFirstDivergingTick: alt.checkpoints[firstDiff].stateSha256,
    },
    maxMassDriftFloat64: maxMassDrift,
    checkpoints: main.checkpoints,
  };
}

export function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const current = currentEngineBlob();
  if (current !== SOURCE_ENGINE_BLOB) {
    throw new Error(`sim-engine.js changed: expected blob ${SOURCE_ENGINE_BLOB}, got ${current}. Create a new contract version instead of refreshing v1.`);
  }
  const check = process.argv.includes("--check");
  const dir = process.argv.filter((a) => a !== "--check")[2] ?? "contracts/golhex-planar-water-golden-v1";
  if (!check) mkdirSync(dir, { recursive: true });
  let drift = 0;
  for (const spec of WATER_PROFILES) {
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
