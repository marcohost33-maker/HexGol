import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
const istAuslieferung = process.env.CF_PAGES === "1" || process.env.GITHUB_PAGES === "true";
if (istAuslieferung && !commitSha) {
  throw new Error(
    "Auslieferungs-Build ohne ermittelbaren Commit: weder CF_PAGES_COMMIT_SHA noch " +
    "GITHUB_SHA noch `git rev-parse HEAD` lieferten einen Wert. Die Herkunftsmarke " +
    "waere leer -- Abbruch statt stiller Luecke.",
  );
}

function emitVersionJson() {
  return {
    name: "hexgol-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version: `v${pkg.version}`, commit: commitSha }, null, 2)}\n`,
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
  plugins: [react(), emitVersionJson()],
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
