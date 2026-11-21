#!/usr/bin/env node
// Mutation check for contracts/golhex-planar-water-golden-v1: how much of stepWater do
// the fixtures actually pin? Each mutant is a one-place edit of the production stepWater
// source, written to a temporary copy of the engine; the generator is run against that
// copy and its checkpoints are compared with the committed fixtures.
//
// A mutant is "killed" when at least one profile notices it (a checkpoint hash differs,
// or the generator refuses the run because a value left [0,1] or mass drifted).
// Mutants marked `equivalent` cannot change the result for a binary32 field in [0,1];
// the reason is stated per mutant. The check fails when a non-equivalent mutant
// survives, when an equivalent one is suddenly killed (the reasoning was wrong), or when
// a pattern no longer matches the source (the list is stale).
//
//   node scripts/mutation-check-planar-water-golden.mjs          # table on stderr, exit 0/1
//   node scripts/mutation-check-planar-water-golden.mjs --json   # machine-readable on stdout
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

const MUTANTS = [
  { name: "gravity share 0.5 -> 0.4", from: "totalRoom) * 0.5", to: "totalRoom) * 0.4" },
  { name: "lateral share 0.25 -> 0.2", from: "* 0.25;", to: "* 0.2;" },
  { name: "gravity threshold 1e-6 -> 1e-3", from: "amt <= 1e-6", to: "amt <= 1e-3" },
  { name: "gravity threshold 1e-6 -> 1e-9", from: "amt <= 1e-6", to: "amt <= 1e-9" },
  { name: "lower neighbour k=4 ignored", from: "const r4 = d4 >= 0 ? Math.max(0, 1 - nw[d4]) : 0;", to: "const r4 = 0;" },
  { name: "lower neighbour k=5 ignored", from: "const r5 = d5 >= 0 ? Math.max(0, 1 - nw[d5]) : 0;", to: "const r5 = 0;" },
  { name: "equal split instead of proportional (k=4)", from: "flow * (r4 / totalRoom)", to: "flow * 0.5" },
  { name: "equal split instead of proportional (k=5)", from: "flow * (r5 / totalRoom)", to: "flow * 0.5" },
  { name: "gravity wraps on the torus (k=4)", from: "(j4 >= 0 && ((j4 / C) | 0) > r)", to: "(j4 >= 0)" },
  { name: "gravity wraps on the torus (k=5)", from: "(j5 >= 0 && ((j5 / C) | 0) > r)", to: "(j5 >= 0)" },
  { name: "outflow not limited by room", from: "Math.min(amt, totalRoom) * 0.5", to: "amt * 0.5" },
  { name: "outflow not limited by amount", from: "Math.min(amt, totalRoom) * 0.5", to: "totalRoom * 0.5" },
  { name: "capacity 1 -> 2", from: "Math.max(0, 1 - nw[d4])", to: "Math.max(0, 2 - nw[d4])" },
  { name: "gravity sweep top-down instead of bottom-up", from: "for (let i = n - 1; i >= 0; i--) {", to: "for (let i = 0; i < n; i++) {" },
  { name: "lateral exchange reads the live field (no snapshot)", from: "const diff = (w[i] - w[j]) * 0.25;", to: "const diff = (nw[i] - nw[j]) * 0.25;" },
  { name: "lateral neighbour k=3 -> k=2", from: "NL[i * 6 + 3]", to: "NL[i * 6 + 2]" },
  { name: "lateral flow sign flipped", from: "nw[i] -= diff; nw[j] += diff;", to: "nw[i] += diff; nw[j] -= diff;" },
  { name: "lateral flow one-sided (mass not conserved)", from: "nw[i] -= diff; nw[j] += diff;", to: "nw[i] -= diff;" },
  { name: "no lateral exchange", from: "const diff = (w[i] - w[j]) * 0.25;", to: "const diff = 0;" },
  { name: "donor not debited", from: "    nw[i] -= flow;\n", to: "\n" },
  {
    name: "threshold <= -> <", from: "amt <= 1e-6", to: "amt < 1e-6",
    equivalent: "amt is a binary32 value and 1e-6 is not representable in binary32, so amt == 1e-6 never holds",
  },
  {
    name: "lower-neighbour slots k=4 and k=5 swapped", from: "const j4 = NL[b + 4], j5 = NL[b + 5];", to: "const j4 = NL[b + 5], j5 = NL[b + 4];",
    equivalent: "the split is proportional to free room and r4 + r5 is commutative, so the two slots are interchangeable",
  },
  {
    name: "room without the max(0, ...) clamp", from: "Math.max(0, 1 - nw[d4])", to: "(1 - nw[d4])",
    equivalent: "a closed field never exceeds 1 (every share is <= the room and 1 is representable), so 1 - nw is never negative",
  },
  {
    name: "totalRoom <= 0 -> < 0", from: "if (totalRoom <= 0) continue;", to: "if (totalRoom < 0) continue;",
    equivalent: "totalRoom == 0 gives flow == 0, which the next guard skips",
  },
  {
    name: "flow <= 0 guard removed", from: "if (flow <= 0) continue;", to: "",
    equivalent: "past the two earlier guards amt > 1e-6 and totalRoom > 0, so flow > 0; with flow == 0 the body adds zeros",
  },
];

function stepWaterSpan(src) {
  const start = src.indexOf("function stepWater(");
  const end = src.indexOf("\n}\n", start);
  if (start < 0 || end < 0) throw new Error("stepWater not found in src/lib/sim-engine.js");
  return [start, end + 3];
}

export async function runMutationCheck() {
  const src = readFileSync(join(repo, "src/lib/sim-engine.js"), "utf8");
  const [a, b] = stepWaterSpan(src);
  const body = src.slice(a, b);
  const fixtureDir = join(repo, "contracts/golhex-planar-water-golden-v1");
  const work = mkdtempSync(join(tmpdir(), "golhex-water-mutants-"));
  const results = [];
  try {
    for (const [index, mutant] of MUTANTS.entries()) {
      const occurrences = body.split(mutant.from).length - 1;
      if (occurrences !== 1) {
        results.push({ name: mutant.name, status: "stale", detail: `pattern matches ${occurrences} times` });
        continue;
      }
      const dir = join(work, `m${index}`);
      mkdirSync(join(dir, "src/lib"), { recursive: true });
      mkdirSync(join(dir, "scripts"), { recursive: true });
      for (const f of ["sim-core.js", "hex-geom.js"]) cpSync(join(repo, "src/lib", f), join(dir, "src/lib", f));
      writeFileSync(join(dir, "src/lib/sim-engine.js"), src.slice(0, a) + body.replace(mutant.from, mutant.to) + src.slice(b));
      cpSync(join(repo, "scripts/generate-planar-water-golden.mjs"), join(dir, "scripts/generate-planar-water-golden.mjs"));
      const gen = await import(pathToFileURL(join(dir, "scripts/generate-planar-water-golden.mjs")).href);
      const perProfile = {};
      for (const spec of gen.WATER_PROFILES) {
        const fixture = JSON.parse(readFileSync(join(fixtureDir, `${spec.id}.json`), "utf8"));
        let out;
        try { out = gen.buildProfile(spec); } catch { perProfile[spec.id] = "refused"; continue; }
        const tick = out.checkpoints.findIndex((cp, t) => cp.stateSha256 !== fixture.checkpoints[t].stateSha256);
        perProfile[spec.id] = tick < 0 ? "survives" : `tick ${tick}`;
      }
      const killed = Object.values(perProfile).some((v) => v !== "survives");
      const expected = mutant.equivalent ? !killed : killed;
      results.push({
        name: mutant.name,
        status: killed ? "killed" : (mutant.equivalent ? "equivalent" : "SURVIVED"),
        ok: expected, perProfile, ...(mutant.equivalent ? { equivalent: mutant.equivalent } : {}),
      });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const bad = results.filter((r) => r.status === "stale" || r.ok === false);
  return {
    mutants: results.length,
    killed: results.filter((r) => r.status === "killed" && !r.equivalent).length,
    equivalent: results.filter((r) => r.status === "equivalent").length,
    failures: bad.map((r) => r.name),
    results,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const summary = await runMutationCheck();
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  else {
    for (const r of summary.results) {
      process.stderr.write(`${r.status.padEnd(10)} ${r.name.padEnd(52)} ${Object.entries(r.perProfile ?? {}).map(([k, v]) => `${k}: ${v}`).join("  ") || r.detail}\n`);
    }
    process.stderr.write(`\n${summary.mutants} mutants: ${summary.killed} killed, ${summary.equivalent} equivalent, ${summary.failures.length} failures\n`);
  }
  process.exitCode = summary.failures.length ? 1 : 0;
}
