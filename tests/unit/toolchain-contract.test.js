// Waechter fuer den Toolchain-Vertrag (2026-09-27, Session-Bericht 2026-09-21).
//
// Drei Behauptungen, die das Repo ueber sich selbst macht, und die bis heute
// niemand pruefte:
//
// 1. `package.json` -> `engines.node` versprach ">=20". Gemessen an der Lockdatei
//    lehnten 36 installierte Pakete diese Zusage ab -- jsdom 30 z.B. verlangt
//    `^22.22.2 || ^24.15.0 || >=26.0.0`, undici 8 `>=22.19.0`, jest-dom 7 `>=22`.
//    Node 20 ist ausserdem seit 2026-04-30 end-of-life. Ein `engines`-Feld, das
//    mehr verspricht, als die Abhaengigkeiten halten, ist schlimmer als keines:
//    es sagt dem naechsten Leser, Node 20 sei unterstuetzt.
//    Der Vertrag: unsere Zusage ist eine TEILMENGE jeder `engines.node`-Angabe in
//    der Lockdatei (`semver.subset`). Gelesen wird die Lockdatei, nicht
//    node_modules -- so ist das Urteil unabhaengig davon, was lokal installiert ist.
// 2. Jede `node-version` eines `actions/setup-node`-Schritts muss mit dieser
//    Zusage ueberlappen; sonst testet die CI eine Version, die wir nicht zusagen.
// 3. Dependabot kann das private `coworkerz-ci` nicht lesen. Jede Workflow-Datei,
//    die es aufruft, muss in `exclude-paths` stehen -- und jede Ausnahme muss noch
//    eine existierende Datei mit genau so einem Aufruf sein (keine Leiche, die
//    still eine ganz normale Workflow-Datei von Updates ausnimmt).
//
// Was hier NICHT geprueft wird: ob der echte Dependabot-Lauf danach gruen endet.
// Das zeigt sich nur auf GitHub; hier wird nur die Konfiguration geprueft, die ihn
// steuert (Pfad-Semantik gegen dependabot-core `FileFiltering.exclude_path?`
// nachgelesen: exakter Repo-Pfad ohne fuehrenden Slash trifft).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const workflowDir = join(root, ".github/workflows");
const workflows = readdirSync(workflowDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ path: `.github/workflows/${f}`, src: readFileSync(join(workflowDir, f), "utf8") }));

const PRIVATE_REUSABLE = /^\s*uses:\s*marcohost33-maker\/coworkerz-ci\//m;

/** Ranges, die unsere Zusage `promise` NICHT voll abdecken (leer = Vertrag haelt). */
function enginesViolations(promise, lockfile) {
  const out = [];
  for (const [key, meta] of Object.entries(lockfile.packages ?? {})) {
    const wanted = meta?.engines?.node;
    if (!key || typeof wanted !== "string") continue; // "" ist das Projekt selbst
    let ok = false;
    try {
      ok = semver.subset(promise, wanted);
    } catch {
      ok = false; // unlesbarer Range -> fail-closed
    }
    if (!ok) out.push(`${key.replace(/^.*node_modules\//, "")}@${meta.version}: ${wanted}`);
  }
  return out;
}

/** `exclude-paths`-Eintraege aus dem github-actions-Block von dependabot.yml. */
function githubActionsExcludePaths(src) {
  const block = src.split(/^\s*-\s*package-ecosystem:\s*/m).find((b) => b.startsWith("github-actions"));
  if (!block) return null;
  const m = block.match(/^(\s*)exclude-paths:\s*\n((?:\1\s+-\s*.+\n?)+)/m);
  if (!m) return [];
  return [...m[2].matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((x) => x[1]);
}

describe("toolchain contract: engines.node", () => {
  const promise = pkg.engines?.node;

  it("declares a valid engines.node range", () => {
    expect(typeof promise).toBe("string");
    expect(semver.validRange(promise)).not.toBeNull();
  });

  it("promises nothing a locked dependency rejects", () => {
    expect(enginesViolations(promise, lock)).toEqual([]);
  });

  it("is in sync between package.json and the lockfile root", () => {
    expect(lock.packages[""].engines?.node).toBe(promise);
  });

  it("discriminates: the old '>=20' promise is rejected", () => {
    // Gegenprobe gegen dieselbe Lockdatei: ohne sie koennte ein immer leeres
    // Ergebnis (z.B. falscher Schluessel) den Vertrag still gruen halten.
    expect(enginesViolations(">=20", lock).length).toBeGreaterThan(0);
  });

  it("every setup-node version in CI overlaps the promise", () => {
    const versions = workflows.flatMap((w) =>
      [...w.src.matchAll(/^\s*node-version:\s*["']?([^"'\s#]+)/gm)].map((m) => ({ file: w.path, v: m[1] })),
    );
    expect(versions.length).toBeGreaterThan(0);
    const bad = versions.filter(({ v }) => !semver.intersects(v, promise));
    expect(bad).toEqual([]);
  });
});

describe("toolchain contract: Dependabot vs. private reusable workflows", () => {
  const depSrc = readFileSync(join(root, ".github/dependabot.yml"), "utf8");
  const excluded = githubActionsExcludePaths(depSrc);
  const callers = workflows.filter((w) => PRIVATE_REUSABLE.test(w.src)).map((w) => w.path);

  it("has a github-actions update block", () => {
    expect(excluded).not.toBeNull();
  });

  it("excludes every workflow that calls the private coworkerz-ci", () => {
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.filter((c) => !excluded.includes(c))).toEqual([]);
  });

  it("excludes nothing else (no stale or overly broad exclusion)", () => {
    for (const p of excluded) {
      expect(p, `${p}: keine Globs -- neue Workflows sollen unter Dependabot bleiben`).not.toMatch(/[*?[\]{}]/);
      expect(existsSync(join(root, p)), `${p} existiert nicht mehr`).toBe(true);
      expect(callers, `${p} ruft kein privates coworkerz-ci mehr auf`).toContain(p);
    }
  });
});

describe("toolchain contract: test gates also run for stacked PRs", () => {
  // #185 zielte auf einen ungeschuetzten Zwischenbranch und lief ohne `unit`/`e2e`,
  // weil `pull_request: branches: [ main ]` fuer ihn keinen Lauf ausloeste.
  for (const file of ["unit-tests.yml", "visual-regression.yml"]) {
    it(`${file}: pull_request has no branches filter`, () => {
      const src = readFileSync(join(workflowDir, file), "utf8");
      const on = src.match(/^on:\s*\n([\s\S]*?)^\S/m)?.[1] ?? "";
      expect(on).toMatch(/^\s{2}pull_request:\s*$/m);
      const pr = on.match(/^\s{2}pull_request:\s*\n((?:\s{4,}.*\n|\s*#.*\n)*)/m)?.[1] ?? "";
      expect(pr).not.toMatch(/^\s+branches(-ignore)?:/m);
    });
  }
});
