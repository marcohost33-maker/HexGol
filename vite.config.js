import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
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
