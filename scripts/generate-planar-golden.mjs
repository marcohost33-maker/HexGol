#!/usr/bin/env node
// Canonical cross-repo Golden Vector producer for ROADMAP-#5 "Parity VOR 3D".
// It drives the production HexGol stepLife() + buildNeighbors() implementation;
// no duplicate CA implementation lives in this file.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNeighbors, RMETA, stepLife } from "../src/lib/sim-engine.js";

export const SCHEMA = "golhex-planar-golden-v1";
export const SOURCE_ENGINE_COMMIT = "15a1be0396ac72f754d8804220bb3f25d7b4a1c1";
export const SOURCE_ENGINE_BLOB = "631c07d4713922ad0f433ba408e36609dc148517";
const ROWS = 5;
const COLS = 6;
const STEPS = 5;
const LIVE_COORDINATES = Object.freeze([[1,2],[1,3],[2,2],[2,3],[3,2]]);

function currentEngineBlob() {
  // Fail closed: an unreadable provenance source is not permission to emit a
  // fixture that still advertises the old engine blob.
  return execFileSync("git", ["hash-object", "src/lib/sim-engine.js"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  }).trim();
}

function checkpointStateSha256(checkpoint) {
  const canonicalState = JSON.stringify({
    tick: checkpoint.tick,
    col: checkpoint.col,
    age: checkpoint.age,
    ghost: checkpoint.ghost,
  });
  return createHash("sha256").update(canonicalState, "utf8").digest("hex");
}

export function buildPlanarGoldenV1() {
  const { edge, mask } = buildNeighbors(ROWS, COLS, "box");
  const n = ROWS * COLS;
  let col = new Uint8Array(n);
  let gh = new Uint8Array(n);
  let age = new Uint16Array(n);
  for (const [r,c] of LIVE_COORDINATES) {
    col[r * COLS + c] = 1;
    age[r * COLS + c] = 1;
  }

  const checkpoints = [{
    tick: 0,
    col: Array.from(col),
    age: Array.from(age),
    ghost: Array.from(gh),
    births: 0,
    deaths: 0,
  }];

  let nc = new Uint8Array(n), ng = new Uint8Array(n), na = new Uint16Array(n);
  for (let tick = 1; tick <= STEPS; tick += 1) {
    const stats = stepLife({
      col, gh, age, nc, ng, na,
      NL: edge,
      dmask: mask,
      meta: RMETA[0],             // canonical H:B2/S34
      colorMode: "mix",
      a1: false, a2: false, a3: false, a4: false,
      a5: "off", sysT: false, spN: 0, adia: false, tick,
    });
    [col, nc] = [nc, col];
    [gh, ng] = [ng, gh];
    [age, na] = [na, age];
    checkpoints.push({
      tick,
      col: Array.from(col),
      age: Array.from(age),
      ghost: Array.from(gh),
      births: stats.births,
      deaths: stats.deaths,
    });
  }

  return {
    schema: SCHEMA,
    source: {
      repo: "marcohost33-maker/HexGol",
      commit: SOURCE_ENGINE_COMMIT,
      enginePath: "src/lib/sim-engine.js",
      engineBlobSha: SOURCE_ENGINE_BLOB,
      engineFunction: "stepLife",
      workerTransition: "src/worker/render-worker.js -> shared stepLife core",
    },
    provenance: {
      reproducibilityLevel: "R3-within-nodejs-backend",
      canonicalReferenceBackend: {
        runtime: "Node.js",
        version: "22.23.2",
        npm: "10.9.8",
        language: "ECMAScript modules",
      },
      precision: {
        col: "uint8",
        age: "uint16",
        ghost: "uint8",
        neighborCounts: "integer",
      },
      seed: null,
      initialStateSource: "explicit five-cell fixture; no PRNG",
      tickSequence: checkpoints.map(({ tick }) => tick),
      checkpointStateEncoding: "canonical-json-v1:{tick,col,age,ghost}",
      checkpointStateSha256: checkpoints.map((checkpoint) => ({
        tick: checkpoint.tick,
        sha256: checkpointStateSha256(checkpoint),
      })),
    },
    topology: {
      layout: "pointy-top-odd-r",
      rows: ROWS,
      cols: COLS,
      boundary: "edge",
      neighborsPerCell: 6,
      neighborTable: Array.from(edge),
    },
    rule: {
      family: "totalistic-hex",
      label: "H:B2/S34",
      birth: [2],
      survival: [3,4],
      colorMode: "mix",
      a1: false, a2: false, a3: false, a4: false,
      a5: "off", sysT: false, spN: 0, adia: false,
    },
    initial: {
      description: "five-cell asymmetric seed; all living cells use color state 1",
      liveCoordinates: LIVE_COORDINATES.map(([r,c]) => [r,c]),
    },
    checkpoints,
  };
}

export function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  const current = currentEngineBlob();
  if (current !== SOURCE_ENGINE_BLOB) {
    throw new Error(
      `sim-engine.js changed: expected blob ${SOURCE_ENGINE_BLOB}, got ${current}. ` +
      "Generate a new contract version/provenance record instead of silently refreshing v1.",
    );
  }
  const body = canonicalJson(buildPlanarGoldenV1());
  const target = process.argv[2];
  if (target) writeFileSync(target, body, "utf8");
  else process.stdout.write(body);
  process.stderr.write(
    `golhex-planar-golden-v1 sha256=${createHash("sha256").update(body).digest("hex")}\n`,
  );
}
