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
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
