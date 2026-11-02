// Waechter-Pruefung fuer scripts/verify-bundle-size.mjs (Marco-Entscheid 2026-11-02).
//
// Geprueft wird der Waechter so, WIE ER LAEUFT -- als Prozess mit echtem Exit-Code,
// wie csp-contract-guard.test.js. Das Skript loest dist/ und bundle-budget.json
// ueber die EIGENE Position auf, also genuegt eine Mini-Kopie im Temp-Verzeichnis;
// die echte dist/ bleibt unberuehrt (der `unit`-Job baut erst NACH den Tests).
//
// Die erste Zelle ist die Gegenprobe zu allen anderen: ein Waechter, der jedes
// Buendel rot faerbt, ist so wertlos wie einer, der alles durchlaesst.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const script = join(root, "scripts/verify-bundle-size.mjs");
const dirs = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** Mini-Baum: scripts/verify-bundle-size.mjs, dist/assets/<files>, bundle-budget.json. */
function run({ files = {}, budget }) {
  const dir = mkdtempSync(join(tmpdir(), "hexgol-bundle-"));
  dirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "dist/assets"), { recursive: true });
  copyFileSync(script, join(dir, "scripts/verify-bundle-size.mjs"));
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(dir, "dist/assets", name), buf);
  if (budget !== undefined) {
    writeFileSync(join(dir, "bundle-budget.json"), typeof budget === "string" ? budget : JSON.stringify(budget));
  }
  const r = spawnSync(process.execPath, [join(dir, "scripts/verify-bundle-size.mjs")], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const compressible = Buffer.from("const hex = 'golhex';\n".repeat(4000));
const incompressible = randomBytes(60000);
const size = (buf) => ({ raw: buf.length, gzip: gzipSync(buf).length });
const budgetFor = (s, tol = 2) => ({ tolerance_percent: tol, baseline: { raw_bytes: s.raw, gzip_bytes: s.gzip } });

describe("bundle-size guard (scripts/verify-bundle-size.mjs)", () => {
  it("negative control: a bundle equal to its baseline is green", () => {
    const r = run({ files: { "index-a1.js": compressible }, budget: budgetFor(size(compressible)) });
    expect(r.out).toMatch(/\[bundle-size\] OK/);
    expect(r.code).toBe(0);
  });

  it("raw growth beyond the tolerance is red", () => {
    const s = size(compressible);
    const budget = budgetFor({ raw: Math.floor(s.raw / 1.03), gzip: s.gzip * 2 });
    const r = run({ files: { "index-a1.js": compressible }, budget });
    expect(r.out).toMatch(/FAIL .*Grenzwert ueberschritten/);
    expect(r.code).toBe(1);
  });

  it("gzip growth beyond the tolerance is red even when raw is within it", () => {
    const s = size(incompressible);
    const budget = budgetFor({ raw: s.raw, gzip: Math.floor(s.gzip / 1.05) });
    const r = run({ files: { "index-a1.js": incompressible }, budget });
    expect(r.code).toBe(1);
  });

  it("boundary: exactly at the limit is green, one byte over is red", () => {
    const s = size(compressible);
    expect(run({ files: { "index-a1.js": compressible }, budget: budgetFor(s, 0) }).code).toBe(0);
    expect(run({ files: { "index-a1.js": compressible }, budget: budgetFor({ ...s, raw: s.raw - 1 }, 0) }).code).toBe(1);
  });

  it("growth inside the tolerance stays green (the tolerance is real, not zero)", () => {
    const s = size(compressible);
    const budget = budgetFor({ raw: Math.ceil(s.raw / 1.015), gzip: Math.ceil(s.gzip / 1.015) }, 2);
    expect(run({ files: { "index-a1.js": compressible }, budget }).code).toBe(0);
  });

  it("fails closed without exactly one index-*.js", () => {
    const budget = budgetFor(size(compressible));
    expect(run({ files: {}, budget }).code).toBe(1);
    expect(run({ files: { "index-a1.js": compressible, "index-b2.js": compressible }, budget }).code).toBe(1);
  });

  it("fails closed on a missing, unreadable or non-numeric budget", () => {
    const files = { "index-a1.js": compressible };
    expect(run({ files }).code).toBe(1);
    expect(run({ files, budget: "{ not json" }).code).toBe(1);
    for (const bad of [null, "408516", Number.NaN, -1, 0]) {
      const budget = { tolerance_percent: 2, baseline: { raw_bytes: bad, gzip_bytes: 1e9 } };
      expect(run({ files, budget }).code, `raw_bytes=${String(bad)}`).toBe(1);
    }
    for (const tol of [null, -1, 26, "2"]) {
      const budget = { tolerance_percent: tol, baseline: { raw_bytes: 1e9, gzip_bytes: 1e9 } };
      expect(run({ files, budget }).code, `tolerance=${String(tol)}`).toBe(1);
    }
  });

  it("the committed bundle-budget.json is well-formed", () => {
    const b = JSON.parse(readFileSync(join(root, "bundle-budget.json"), "utf8"));
    expect(Number.isInteger(b.baseline.raw_bytes) && b.baseline.raw_bytes > 0).toBe(true);
    expect(Number.isInteger(b.baseline.gzip_bytes) && b.baseline.gzip_bytes > 0).toBe(true);
    expect(b.tolerance_percent).toBeGreaterThanOrEqual(0);
    expect(b.tolerance_percent).toBeLessThanOrEqual(25);
    expect(typeof b.reason).toBe("string");
  });

  it("is wired into npm run build after vite build", () => {
    const build = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.build;
    expect(build).toMatch(/^vite build && .*node scripts\/verify-bundle-size\.mjs/);
  });
});
