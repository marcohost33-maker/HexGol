import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
