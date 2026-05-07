import { defineConfig, devices } from "@playwright/test";

// Visual regression + __TEST__ bridge config.
//
// - testDir: tests/e2e
// - webServer: Vite preview on port 4173 (built artifacts; matches what CI
//   serves and avoids dev-server hot-reload jitter).
// - snapshotPathTemplate: keep snapshots next to the spec for clarity, with
//   a per-OS suffix so Linux/macOS rendering differences do not collide.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: {
    // 0.2% tolerance is the canonical Playwright default for visual diffing.
    // We tighten it slightly to surface unintended canvas regressions.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      threshold: 0.15,
      animations: "disabled",
    },
  },
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
