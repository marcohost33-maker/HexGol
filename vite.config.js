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
function emitVersionJson() {
  return {
    name: "hexgol-version-json",
    generateBundle() {
      const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
      const commit = git.status === 0 ? git.stdout.trim() : null;
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version: `v${pkg.version}`, commit }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
