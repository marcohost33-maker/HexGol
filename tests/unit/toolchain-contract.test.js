// Waechter fuer den Toolchain-Vertrag (2026-09-27, Session-Bericht 2026-09-21).
//
// Fuenf Behauptungen, die das Repo ueber sich selbst macht, und die bis heute
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
// 4. Direkte Abhaengigkeiten, die einander per peerDependency EXAKT pinnen
//    (heute @vitest/coverage-v8 <-> vitest), muessen in derselben Dependabot-Gruppe
//    stehen. Sonst bumpt Dependabot sie in getrennten PRs, von denen jeder fuer sich
//    ERESOLVE ist -- so geschehen mit #180 und #191. Die Paare werden aus der
//    Lockdatei ABGELEITET, nicht hier aufgezaehlt: ein neues Paar ist sofort erfasst.
// 5. Plattform-Metadaten (`os`/`cpu`/`libc`) jedes installierten Pakets stehen
//    unveraendert in der Lockdatei. npm 10 streicht `libc` beim Neuschreiben, und
//    `npm install --package-lock-only` mit npm 11 stellt es NICHT wieder her
//    (gemessen 2026-09-27: 0 -> 0 Felder). Ein Normalisierungs-Diff kann die Drift
//    also nicht fangen; der Abgleich gegen das installierte Manifest kann es.
//
// Was hier NICHT geprueft wird: ob der echte Dependabot-Lauf danach gruen endet.
// Das zeigt sich nur auf GitHub; hier wird nur die Konfiguration geprueft, die ihn
// steuert (Pfad-Semantik gegen dependabot-core `FileFiltering.exclude_path?`
// nachgelesen: exakter Repo-Pfad ohne fuehrenden Slash trifft).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Gruppen des npm-Blocks von dependabot.yml: { name: [pattern, ...] }. */
function npmGroups(src) {
  const block = src.split(/^\s*-\s*package-ecosystem:\s*/m).find((b) => b.startsWith("npm"));
  if (!block) return null;
  const lines = block.split("\n");
  const start = lines.findIndex((l) => /^\s*groups:\s*$/.test(l));
  if (start < 0) return {};
  const base = lines[start].search(/\S/);
  const groups = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    if (indent <= base) break;
    const name = line.match(/^\s*([\w@./-]+):\s*$/);
    if (name && indent === base + 2) {
      current = groups[name[1]] = [];
      continue;
    }
    const item = line.match(/^\s*-\s*["']?([^"'#\s]+)["']?/);
    if (item && current) current.push(item[1]);
  }
  return groups;
}

/** Dependabot-Muster: `*` passt auf beliebige Zeichen. */
function matches(pattern, name) {
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`);
  return re.test(name);
}

function groupOf(groups, name) {
  const hits = Object.entries(groups).filter(([, pats]) => pats.some((p) => matches(p, name)));
  return hits.length ? hits[0][0] : null; // Dependabot: erste passende Gruppe gewinnt
}

/** Paare direkter Abhaengigkeiten, die einander per peerDependency exakt pinnen. */
function exactPeerPins(manifest, lockfile) {
  const direct = { ...manifest.dependencies, ...manifest.devDependencies };
  const pairs = [];
  for (const dep of Object.keys(direct)) {
    const peers = lockfile.packages?.[`node_modules/${dep}`]?.peerDependencies ?? {};
    for (const [peer, range] of Object.entries(peers)) {
      if (peer in direct && semver.valid(range)) pairs.push([dep, peer, range]);
    }
  }
  return pairs;
}

const PLATFORM_KEYS = ["os", "cpu", "libc"];

/** Lock-Eintraege, deren os/cpu/libc vom installierten Manifest abweichen. */
function platformDrift(lockfile, projectRoot) {
  const drift = [];
  let checked = 0;
  for (const [key, meta] of Object.entries(lockfile.packages ?? {})) {
    if (!key.startsWith("node_modules/")) continue;
    const manifestPath = join(projectRoot, key, "package.json");
    if (!existsSync(manifestPath)) continue; // fremde Plattform: nicht installiert
    const installed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!PLATFORM_KEYS.some((k) => installed[k] || meta[k])) continue;
    checked++;
    for (const k of PLATFORM_KEYS) {
      if (JSON.stringify(installed[k]) !== JSON.stringify(meta[k])) {
        drift.push(`${key}: ${k} lock=${JSON.stringify(meta[k])} installiert=${JSON.stringify(installed[k])}`);
      }
    }
  }
  return { checked, drift };
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
  // #185 zielte auf einen ungeschuetzten Zwischenbranch und lief ohne `unit`/`e2e`/`mobile-render`,
  // weil `pull_request: branches: [ main ]` fuer ihn keinen Lauf ausloeste.
  for (const file of ["unit-tests.yml", "visual-regression.yml", "mobile-render.yml"]) {
    it(`${file}: pull_request has no branches filter`, () => {
      const src = readFileSync(join(workflowDir, file), "utf8");
      const on = src.match(/^on:\s*\n([\s\S]*?)^\S/m)?.[1] ?? "";
      expect(on).toMatch(/^\s{2}pull_request:\s*$/m);
      const pr = on.match(/^\s{2}pull_request:\s*\n((?:\s{4,}.*\n|\s*#.*\n)*)/m)?.[1] ?? "";
      expect(pr).not.toMatch(/^\s+branches(-ignore)?:/m);
    });
  }
});

describe("toolchain contract: exact peer pins share a Dependabot group", () => {
  const groups = npmGroups(readFileSync(join(root, ".github/dependabot.yml"), "utf8"));
  const pairs = exactPeerPins(pkg, lock);

  it("reads the npm groups", () => {
    expect(groups).not.toBeNull();
    expect(Object.keys(groups).length).toBeGreaterThan(0);
  });

  it("finds the exact peer pins (derived from the lockfile, not listed here)", () => {
    // Nicht leer: sonst waere der naechste Test vakuos gruen.
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("every exactly pinned pair is bumped together", () => {
    const split = pairs
      .map(([a, b, range]) => ({ pair: `${a} -> ${b}@${range}`, a: groupOf(groups, a), b: groupOf(groups, b) }))
      .filter(({ a, b }) => a === null || a !== b);
    expect(split).toEqual([]);
  });

  it("discriminates: without '@vitest/*' the vitest pair is split", () => {
    const without = { ...groups, vite: groups.vite.filter((p) => p !== "@vitest/*") };
    expect(groupOf(without, "@vitest/coverage-v8")).not.toBe(groupOf(without, "vitest"));
  });
});

describe("toolchain contract: lockfile keeps platform metadata (libc)", () => {
  const { checked, drift } = platformDrift(lock, root);

  it("checks at least one installed platform-specific package", () => {
    // Auf jeder unterstuetzten Plattform ist mindestens ein rolldown-Binding installiert.
    expect(checked).toBeGreaterThan(0);
  });

  it("os/cpu/libc in the lockfile match the installed manifests", () => {
    expect(drift).toEqual([]);
  });

  it("discriminates: an npm-10-style lockfile without libc is caught", () => {
    // Synthetische Fixture statt der installierten Pakete dieses Rechners: unter
    // Windows/macOS sind nur win32-/darwin-Bindings installiert, die kein `libc`
    // tragen -- eine Gegenprobe am echten node_modules waere dort rot, obwohl die
    // Lockdatei stimmt (Codex-Review P2 auf 9784ba4). Den ECHTEN Abgleich oben fuehrt
    // die Linux-CI mit Biss; auf anderen Plattformen ist er schwaecher, aber korrekt.
    const dir = mkdtempSync(join(tmpdir(), "toolchain-libc-"));
    try {
      const key = "node_modules/@fixture/binding-linux-x64-gnu";
      const platform = { os: ["linux"], cpu: ["x64"], libc: ["glibc"] };
      mkdirSync(join(dir, key), { recursive: true });
      writeFileSync(join(dir, key, "package.json"), JSON.stringify({ name: "@fixture/binding-linux-x64-gnu", ...platform }));
      const intact = { packages: { "": {}, [key]: { version: "1.0.0", ...platform } } };
      const stripped = structuredClone(intact);
      delete stripped.packages[key].libc;

      expect(platformDrift(intact, dir)).toEqual({ checked: 1, drift: [] });
      const caught = platformDrift(stripped, dir);
      expect(caught.checked).toBe(1);
      expect(caught.drift).toEqual([`${key}: libc lock=undefined installiert=["glibc"]`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
