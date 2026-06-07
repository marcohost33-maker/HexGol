import { defineConfig, devices } from "@playwright/test";

// Visual regression + __TEST__ bridge config.
//
// CI determinism is the priority here:
//   - viewport is locked to 1280x800 for every project so OS scaling does
//     not change the canvas size between dev and CI
//   - animations: "disabled" via expect.toHaveScreenshot disables CSS
//     animations and transitions during the screenshot
//   - reducedMotion: "reduce" tells the app to suppress its own
//     animation-driven decoration (the .scanlines overlay) so it never
//     contributes to pixel diffs
//   - prefers-color-scheme is locked to "dark" so the theme cannot flip
//     between machines
//
// Snapshots live under tests/e2e/__snapshots__ with per-OS suffixes via the
// default Playwright behavior so a Linux baseline does not break a local
// macOS dev run. The visual-regression workflow runs inside the official
// Microsoft Playwright Docker image so baselines are always generated and
// asserted in identical environments (playwright.dev/docs/docker).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["junit", { outputFile: "playwright-report/junit.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    colorScheme: "dark",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
  },
  expect: {
    // toHaveScreenshot tolerance. maxDiffPixelRatio=0.001 catches >0.1% of
    // pixels changing - tight enough to surface real regressions but
    // tolerant of the sub-pixel rasterization noise canvas2D produces in
    // headless Chromium. threshold=0.15 is the per-pixel YIQ delta tolerance.
    // Tuned 2026-05-23: maxDiffPixelRatio 0.001 -> 0.03 because the
    // hexagonal canvas baseline shows recurring ~3% (5066/217k px) drift
    // across sequential CI runs with identical code+baseline. Root cause is
    // sub-pixel anti-aliasing non-determinism in headless chromium canvas2D
    // when drawing thousands of equilateral hex outlines. 0.03 tolerates
    // observed drift but still catches real bugs (10%+ on structural diffs).
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.03,
      threshold: 0.15,
      animations: "disabled",
      caret: "hide",
    },
  },
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
  projects: [
    {
      name: "chromium",
      // Desktop-Baseline (Visual-Regression + bestehende Funktions-e2e). Diese
      // Specs erwarten alle Controls inline sichtbar (Layout >=768px => kein Sheet).
      testIgnore: /(mobile-onepage|stamp-drawer|savestate)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // AP-4: 1-Seiten-Mobile-Beleg. Handy-Hochkant-Viewport (iPhone 12/13/14-Klasse,
      // 390x844). Belegt: Kern-Controls + Leinwand + Zurueck/Schliessen im Viewport
      // sichtbar OHNE Scroll; Sekundaeres im Bottom-Sheet erreichbar.
      name: "mobile",
      testMatch: /(mobile-onepage|stamp-drawer|savestate)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
