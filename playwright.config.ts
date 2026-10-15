import { defineConfig, devices } from "@playwright/test";

// Visual regression + DOM-driven e2e config.
//
// e2e contract: NO window/__TEST__ bridge. Specs drive the app through real DOM
// controls (buttons, the size <select>) plus the <canvas> and assert the
// observable contract (see AGENTS.md "e2e contract").
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
// Security contract (#176): Vite preview does not apply Cloudflare Pages'
// dist/_headers. The e2e server is therefore the tiny static
// scripts/serve-dist-with-headers.mjs server, which applies the checked-in `/*`
// header block to EVERY response. That means existing service-worker and
// OffscreenCanvas worker specs exercise their production resources under the
// same CSP as the document instead of only the CSP smoke test doing so.
//
// Snapshots live under tests/e2e/__snapshots__ with a per-OS suffix, which
// `snapshotPathTemplate` below spells out explicitly (`{platform}`). Until
// issue #167 that suffix was CLAIMED here and absent from the template: the
// override dropped it, so a Linux CI baseline was also the comparison target
// for a local Windows or macOS run. The visual-regression workflow runs inside
// the official Microsoft Playwright Docker image, so CI baselines are always
// generated and asserted in identical environments (playwright.dev/docs/docker)
// -- but a developer's machine is not that environment, and a missing baseline
// for their platform is the honest outcome there, not a silent wrong compare.
// The claim is guarded by tests/unit/visual-baseline-contract.test.js, so it
// cannot drift back into a comment that describes a property the code lacks.
// The first-open education intro (ConwayIntro) is a fixed full-screen overlay
// that intercepts pointer events until dismissed. Every existing functional spec
// drives the app directly and is unaware of it, so we pre-seed the "seen" flag in
// localStorage for the whole suite via a storageState whose origin matches the
// preview server. The intro's OWN spec (conway-intro.spec.ts) clears the flag for
// its first-open cases (test.use storageState + addInitScript). Keep this origin
// in sync with `use.baseURL` / the webServer port below.
const INTRO_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const INTRO_SEEN_STORAGE = {
  cookies: [],
  origins: [
    {
      origin: INTRO_ORIGIN,
      localStorage: [{ name: "golhex_intro_seen_v1", value: "1" }],
    },
  ],
};

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
    storageState: INTRO_SEEN_STORAGE,
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
  // `{platform}` is load-bearing (issue #167): font rasterisation, device pixel
  // ratio and GPU compositing differ per OS, and one baseline is NOT canvas-only
  // -- `worker-overlay-outline` captures the `.ghx-canvas` CONTAINER, because the
  // shot has to composite the worker-owned field canvas with the main-thread
  // overlay canvas stacked on top of it. That container is a div carrying a 1px
  // border, a 14px radius and an inset box-shadow, i.e. compositor-painted chrome,
  // which is exactly the case that makes a shared cross-OS baseline flake.
  // `{projectName}` is deliberately NOT in the template: no spec matched by the
  // `mobile` project takes a screenshot today. That is a measured fact, not an
  // assumption -- the guard test asserts it and fails when it stops holding.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}-{platform}{ext}",
  projects: [
    {
      name: "chromium",
      // Desktop-Baseline (Visual-Regression + bestehende Funktions-e2e). Diese
      // Specs erwarten alle Controls inline sichtbar (Layout >=768px => kein Sheet).
      testIgnore: /(mobile-onepage|mobile-hexshape|mobile-perf-budget|mobile-layout|stamp-drawer|savestate|snapshot|record|frame-pan-touch)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // AP-4: 1-Seiten-Mobile-Beleg. Handy-Hochkant-Viewport (iPhone 12/13/14-Klasse,
      // 390x844). Belegt: Kern-Controls + Leinwand + Zurueck/Schliessen im Viewport
      // sichtbar OHNE Scroll; Sekundaeres im Bottom-Sheet erreichbar.
      name: "mobile",
      testMatch: /(mobile-onepage|mobile-hexshape|mobile-perf-budget|mobile-layout|stamp-drawer|savestate|snapshot|record|frame-pan-touch)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "node scripts/serve-dist-with-headers.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
