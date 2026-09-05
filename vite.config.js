import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Single source of truth for the app version: package.json `version`.
// Injected at build time as __APP_VERSION__ so the Splash/branding reads the
// REAL version (no hard-coded string). Reading here (not in app code) keeps the
// dependency build-time only — package.json is not bundled into the client.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
);

// GitHub Pages project sites are served below /<repo>/ by default. Keep local
// development at "/", but let the Pages workflow opt into the correct base.
const base = process.env.VITE_BASE_PATH || (process.env.GITHUB_PAGES === "true" ? "/HexGol/" : "/");

// v8 coverage instrumentation makes the compute-bound CN-solver tests (5000
// steps) run ~6x slower (measured: 5.4s -> 32s local). That is pure
// instrumentation overhead, not a logic regression, so coverage runs get a much
// larger per-test ceiling. Normal `vitest run` (no --coverage) keeps the tuned
// 20s ceiling. Ceiling only — fast tests still finish fast.
const coverageRun = process.argv.includes("--coverage") || process.env.COVERAGE === "1";

// Herkunftsmarke. Ohne sie sagt die ausgelieferte App nirgends, aus welchem Stand
// sie gebaut wurde -- und die Frage "passt live zur Quelle?" ist dann nicht
// beantwortbar, nicht bloss unbeantwortet. Belegt 2026-07-27: fuer vier Apps der
// Flotte liess sich das nicht klaeren, weil dist/ ausgenommen ist und die
// Buendelnamen nirgends sonst vorkommen.
// Absichtlich OHNE Zeitstempel: ein Zeitstempel macht jeden Build verschieden und
// zerstoert die Vergleichbarkeit, die hier gerade der Zweck ist.
// Einmal ermitteln, zweifach verwendet: vollstaendig in version.json (maschinen-
// lesbar, fuer den Abgleich live-gegen-Quelle) und verkuerzt als __APP_COMMIT__ in
// der sichtbaren Statuszeile. Eine Datei allein genuegt nicht -- wer die App vor
// sich hat, soll den Stand SEHEN, ohne eine URL von Hand zusammenzusetzen.
// Belegt 2026-08-11: die Versionsnummer stand ueber vier Commits unveraendert auf
// 33.4.0, quer durch ein ganzes Feature; an ihr war der ausgelieferte Stand
// grundsaetzlich nicht ablesbar.
// Sagt der Arbeitsbaum die Wahrheit? `git rev-parse HEAD` liefert den Commit, NICHT
// den Zustand des Baums. Ein Auslieferungs-Build mit uncommitteten Aenderungen
// erzeugt sonst eine version.json, die einen sauberen Commit behauptet, waehrend das
// Buendel etwas anderes enthaelt -- die Marke wuerde ausgerechnet bei der Frage
// luegen, fuer die sie gebaut wurde (Aegis-Audit 2026-08-11, P1).
const baumIstSchmutzig = (() => {
  const st = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", shell: false });
  if (st.status !== 0) return null;                    // git nicht verfuegbar -> unbekannt
  return st.stdout.split("\n").some((z) => z.trim() && !z.includes(".claude/"));
})();

const commitSha = (() => {
  // Die CI-Variable zuerst, `git` nur als Fallback: `git rev-parse` ist in
  // Build-Containern der unzuverlaessigere Weg (Gits "dubious ownership"-Schutz
  // schlaegt zu, wenn der Job unter fremder UID laeuft) und liefert dann kein
  // Fehlersignal, sondern still `null` -- eine Herkunftsmarke, die aussieht wie
  // eine Antwort und keine ist.
  // CF_PAGES_COMMIT_SHA: Cloudflare Pages (der KANONISCHE Auslieferungskanal,
  // golhex.pages.dev). GITHUB_SHA: GitHub Actions.
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  return git.status === 0 ? git.stdout.trim() : null;
})();

// Fail-closed. Der Auslieferungs-Build ist genau der, bei dem die Herkunft zaehlt --
// ein stilles `"commit": null` dort macht die Marke wertlos, ohne dass es jemand
// merkt. Lieber ein roter Build als eine Datei, die Auskunft vortaeuscht.
// Greift fuer BEIDE Auslieferungswege; lokale Builds und Tests bleiben unberuehrt.
// CF_PAGES ist in jeder Cloudflare-Pages-Build-Umgebung gesetzt.
// DEPLOY_BUILD=1 setzt die Doppelklick-Bat: der Weg, ueber den heute TATSAECHLICH
// ausgeliefert wird (`wrangler pages deploy` vom Rechner). Ohne ihn griff der Guard
// ausgerechnet dort nie -- CF_PAGES setzt nur Cloudflares eigene Build-Umgebung,
// GITHUB_PAGES ist seit dem Abschalten toter Code (Aegis-Audit 2026-08-11, P1).
const istAuslieferung =
  process.env.DEPLOY_BUILD === "1" ||
  process.env.CF_PAGES === "1" ||
  process.env.GITHUB_PAGES === "true";

if (istAuslieferung && !commitSha) {
  throw new Error(
    "Auslieferungs-Build ohne ermittelbaren Commit: weder CF_PAGES_COMMIT_SHA noch " +
    "GITHUB_SHA noch `git rev-parse HEAD` lieferten einen Wert. Die Herkunftsmarke " +
    "waere leer -- Abbruch statt stiller Luecke.",
  );
}
// Nur wenn die Herkunft aus dem lokalen git stammt: eine CI-Variable beschreibt einen
// frischen Checkout, da gibt es keinen schmutzigen Baum.
const ausLokalemGit = !process.env.CF_PAGES_COMMIT_SHA && !process.env.GITHUB_SHA;
if (istAuslieferung && ausLokalemGit && baumIstSchmutzig) {
  throw new Error(
    "Auslieferungs-Build aus einem schmutzigen Arbeitsbaum: version.json wuerde " +
    `Commit ${String(commitSha).slice(0, 7)} behaupten, das Buendel enthaelt aber ` +
    "uncommittete Aenderungen. Erst committen (oder stashen), dann ausliefern.",
  );
}

function emitBuildMetadata() {
  return {
    name: "hexgol-build-metadata",
    generateBundle(_options, bundle) {
      // Vite content-hashes generated JS/CSS/assets. Feed those exact URLs into
      // the service-worker install set so a new shell and its referenced code are
      // cached atomically. Public icons/manifest are added by sw.js itself.
      const generatedAssets = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith("assets/"))
        .sort();
      const assetFingerprint = createHash("sha256")
        .update(generatedAssets.join("\n"))
        .digest("hex")
        .slice(0, 16);
      // Deploy builds always have a commit (guarded above). The deterministic
      // asset fingerprint keeps local/preview builds revisioned as well.
      const buildId = commitSha || `v${pkg.version}-${assetFingerprint}`;
      const precache = generatedAssets.map((fileName) => `./${fileName}`);

      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version: `v${pkg.version}`, commit: commitSha, build: buildId }, null, 2)}\n`,
      });
      // `sw.js` imports this classic worker script. Browser SW update checks include
      // importScripts() dependencies; registration uses updateViaCache="none" so a
      // changed build id/precache list cannot be hidden by the HTTP cache.
      this.emitFile({
        type: "asset",
        fileName: "sw-version.js",
        source:
          `self.__GOLHEX_BUILD__ = ${JSON.stringify(buildId)};\n` +
          `self.__GOLHEX_PRECACHE__ = ${JSON.stringify(precache)};\n`,
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Kurz-SHA reicht fuer den Blick; version.json traegt den vollen Wert.
    __APP_COMMIT__: JSON.stringify(commitSha ? commitSha.slice(0, 7) : null),
  },
  plugins: [react(), emitBuildMetadata()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.js"],
    include: ["tests/unit/**/*.test.{js,jsx,ts,tsx}"],
    // CN-Solver-Test (5000 Schritte) braucht ~5.2s auf langsamen CI-Runnern —
    // vitest-Default 5s ist zu knapp (Equalita-Befund PR#41, Perf-Flake kein Logik-Bug).
    testTimeout: coverageRun ? 120000 : 20000,
    coverage: {
      provider: "v8",
      // text = human-readable console table; json-summary = machine-readable
      // totals for the CI job-summary step (measure-first, no threshold gate yet);
      // html = local drill-down report. NO threshold set on purpose: the gate is
      // observe-only until the Ist-coverage baseline is known (Test-Center T4).
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**"],
    },
  },
});
