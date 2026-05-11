# GHX036 Release Notes - v17.14

**Project:** GHX (KAT GHX, L003)
**Coworker Research / Coworkerz - 2026-05-07**
**Lineage:** v17.13 -> v17.14 (8 hardening items, audit-driven)

## Context

v17.13 introduced the telemetry pipeline (`PerformanceObserver` for LoAF /
longtask / event entries, ring buffer, CSV/JSON export) and the
`window.__TEST__` bridge that unblocks Playwright visual regression for
v17.15. A konstruktiv-kritisch self-audit against the rendered source
surfaced eight real defects. v17.14 closes them and ships the supporting
infrastructure (Vitest unit tests, Playwright e2e, three GH Actions
workflows, Dependabot).

## Lessons-Learned (carried forward)

1. **Source-of-Truth before test.** v17.12 reverted NR-G49 because the
   initial fix was driven by a faulty test rather than the production
   rendering convention. Same discipline applied here: every fix below
   was reproduced in a Vitest spec _before_ touching the App.
2. **Measure twice, allocate once.** Hot loops in JavaScript pay a real
   cost for `new Uint8Array(N)` calls inside an animation frame (NR-G56).
3. **Test bridges deserve lifecycle hygiene.** Stale `ready=true` on a
   teardown bridge bites you the moment a second test attaches (NR-G62).

## Fixes v17.13 -> v17.14

### NR-G56 (P0): persistent rowActive scratch buffer

`step()` allocated `new Uint8Array(ROWS)` every call for the quiescent-row
pre-scan. Under MAX speed on XXL grid this is 4 allocs per animation
frame (the `MAX_STEPS_PER_TICK` inner loop), 240 GC-eligible allocations
per second. The buffer is now persisted in `rowActiveRef` and grown only
when the grid changes; `fill(0)` runs in O(ROWS).

**Source:** Chrome DevTools Performance panel allocation timeline on a
60-second run at MAX speed, XXL grid, B2/S34 rule. v17.13 baseline showed
~14,400 short-lived 200-byte allocations; v17.14 shows zero.

### NR-G57 (P0): tool-aware first-touch in paintAt

v17.13 hard-coded tap-toggle semantics for the first touch regardless of
active tool. In TOOL_ERASE mode this meant single-tap on a dead cell
PAINTED it - the exact opposite of the user's intent. Same for ERASE-mode
single-tap on an alive cell that happened to be a different brush color
(would not change since `isAlive` short-circuit).

`paintAt` now branches on `toolR.current`:

| Tool        | First-touch behavior                              |
|-------------|---------------------------------------------------|
| TOOL_PAN    | Tap-toggle (legacy, intentional UX for pan-mode)  |
| TOOL_PAINT  | Paint only - never erase a cell on first touch    |
| TOOL_ERASE  | Erase only - never paint a cell on first touch    |

Stroke moves continue to use their tool-specific behavior unchanged.

### NR-G58 (P1): stats recompute on undo / restart / slot-load

`stats` (POP/R/B/Y display) was set inside `step()`. Manual operations
like `undo()`, `restart()`, slot A/B load and randomize did not reach
`step()` until the next sim tick, leaving the UI showing stats from
*before* the operation. Each manual mutation path now calls a new
`recomputeStats()` callback that walks the live buffer in O(N).

### NR-G59 (P1): pointer-type-aware auto-zoom in selectTool

`selectTool` always used the "touch" pxR threshold for the auto-zoom
decision. Mouse users got a larger-than-necessary zoom-in when switching
to PAINT/ERASE. v17.14 records the most recent pointerType in
`lastPointerTypeRef` (set on every `pointerdown`) and uses
`getPaintMinPxR(lastPointerTypeRef.current)` for the decision.

### NR-G60 (P1): cleanupGesture declared before its first reference

`cleanupGesture` was declared after `onPD`/`onPM`, both of which call it.
Functionally OK at call time (closure scope), but the source read
out-of-order and would have tripped a strict ESLint rule. v17.14
reorders so all gesture helpers are declared before any pointer handler.

### NR-G61 (P1): font load moved out of inline `<style>`

The JSX `<style>` block contained an `@import url(...)` for Google
Fonts. While React reuses the same string literal across renders, this
fights the browser's preconnect / preload prioritization and is
deprecated as of CSSOM Level 4. v17.14 declares fonts in `index.html`
with `<link rel="preconnect">` and `<link rel="stylesheet">`. The inline
`<style>` keeps only application-specific rules.

### NR-G62 (P1): __TEST__ bridge cleans `ready` on teardown

The bridge's effect cleanup ran `try { delete window.__TEST__ } catch(e){}`
without first setting `bridge.ready = false`. Any background task holding
a reference to the bridge object saw `ready=true` even after unmount.
v17.14 sets `ready=false` first, then deletes / falls back to assigning
`undefined` if `delete` was denied (some sandboxed contexts).

### NR-G63 (P1): __TEST__.step pauses sim before deterministic step

Tests that called `step(1)` while the rAF sim loop was also ticking saw
double steps. Both the bridge's manual step and the sim-loop's
auto-step incremented `genRef.current` in the same animation frame. The
bridge now reads `rR.current`, sets `setRunning(false)` if it was
running, performs the deterministic steps, then restores `setRunning(true)`.

### NR-G64 (P1): aria-busy on canvas wrapper during transitions

The grid-resize path runs inside `useTransition`. While `isPending` is
true the canvas remains visible but rendering is paused on the new
buffer. v17.14 sets `aria-busy="true"` on the canvas wrapper for the
duration of the transition so screen readers announce the state change.

## Carried forward

All NR-G3..G55 and F01..F19 fixes from prior versions remain intact.
Code remains ASCII-clean (no smart quotes, no special characters in
identifiers) and brace-balanced (0 / 0 / 0).

## v17.14.4 (L/XL/XXL paint reliability + square canvas)

Field report: "L, XL and XXL formats do not work - the hex cells cannot be
painted. The frame around the hex field should be adjusted, preferably
square, redesign the layout accordingly."

Investigation revealed two distinct issues:

1. The `FIT` button used `minZoom` which is `Math.max(cw/gw, ch/gh)` -
   that is FILL semantics, not FIT semantics. The grid filled the canvas
   in one axis and overflowed the other, so pressing FIT cropped the
   grid. Users had no way to actually see the whole grid.
2. The canvas wrapper had `flex: 1` so on laptop screens with the
   toolbar rows taking vertical space, the canvas became wide and short
   (e.g. 1280x250). Combined with the wide world-space grid (~1050 world
   units wide for every preset), the cells on L/XL/XXL were stretched
   horizontally and cramped vertically.

### NR-G81 (P0): true fit-inside semantics

`src/lib/hex.js` now exports two distinct zoom functions:
- `minZoom`: FILL behavior (Math.max). Kept for code that wants the
  "smallest zoom at which the canvas is filled by the grid" - no callers
  remain after v17.14.4 but the export is kept for downstream code.
- `fitInsideZoom`: FIT behavior (Math.min). The zoom at which the whole
  grid is visible inside the canvas, with letterboxing.

`fitView` switches to `fitInsideZoom` so it actually fits.

### NR-G82 (P0): FIT button is true fit-inside; PXR button is paintable reset

The FIT button now calls `fitView` (true fit-inside) so users always see
the whole grid. For grids whose fit-zoom yields below-paintable pxR
(common on L/XL/XXL in a square canvas), a new PXR button calls
`paintableView` which snaps to a zoom where cells are at least
`PAINT_MIN_PXR[pointerType]` pixels wide. The two buttons together cover
both user intents: "show me everything" and "make cells tappable."

### NR-G83 (P1): pan clamping

`applyView` now clamps the resulting `panX/panY` against `clampPan(...,
minVisibleRatio=0.2)` so the user cannot drag the grid completely off-
screen. The constraint keeps at least 20% of the canvas overlapping the
grid in both axes; users always have a visual anchor to re-orient.

Wheel/pinch/Z+/Z- handlers also switch their zoom floor from `minZoom`
(FILL) to `fitInsideZoom` (FIT). This lets users zoom out to see the
whole grid via the wheel, matching the FIT button's reach.

### NR-G84 (P0): square canvas wrapper on laptop

The canvas wrapper now applies a new CSS class `.ghx-canvas-frame` with
`aspect-ratio: 1 / 1` on viewports >= 900px wide. The frame is centered
within the available vertical space via flexbox. Below 900px it falls
back to `4 / 3`; below 640px it disables the constraint entirely (fills
the available space, as before).

The square frame is sized by `width: min(100%, calc(100vh - 280px))` so
it never exceeds either axis. The 280px reserve accounts for header +
toolbars + footer. On a typical 1280x800 laptop the canvas frame
becomes ~520x520 device-px, which is plenty for paintable XXL cells
(pxR=12 yields ~500x500 visible world units, or ~70% of the grid).

### Test surface

35 / 35 Vitest specs pass:
- +1 fitInsideZoom is Math.min of ratios (different from minZoom)
- +1 fitInsideZoom guards against zero / negative dimensions
- +1 fitView centers using true fit-inside (200px Y-letterbox for 800x800
  canvas with 1000x500 grid)
- +4 clampPan keeps grid mostly visible in 4 directions
- Existing tests updated for new minZoom floor (0.04 from 0.08)

Production build: 248.95 kB / 79.14 kB gzip on Vite 8 + React 19.

## v17.14.3 (web-research-driven hardening pass)

A web-research-driven audit (React 19 useTransition guidance, Playwright CI
best practices for canvas apps, web.dev INP/LoAF guide) plus an internal
deep-audit produced eleven additional hardening items. Most are P1 -
real bugs that would surface under enough load or specific timing - and
two are P0 stability fixes for the test bridge.

### Test infrastructure

- **NR-G70 (P1): explicit cancelAnimationFrame on rAF cleanup.** The rAF
  loop relied on an `on=false` flag check inside the loop body. That works
  but leaves one already-scheduled frame to drain after unmount. React 19
  StrictMode rerunning effects exercises this path on every mount.
  cancelAnimationFrame on the stored id is the documented React 19 pattern
  (react.dev/reference/react/StrictMode).

- **NR-G71 (P1): Playwright CI determinism via Docker + cache + masking.**
  visual-regression and update-snapshots workflows now run inside the
  Microsoft Playwright Docker image (mcr.microsoft.com/playwright:v1.48.0-noble)
  so baselines and assertions execute against an identical font / library
  environment. Browser binaries are cached via actions/cache@v4. Visual
  specs use `mask: [.ghx-stats, .ghx-badges]` to exclude time-dependent UI
  chrome (FPS, GEN, gps, transition badge) from the diff. The
  playwright.config also locks colorScheme=dark, reducedMotion=reduce,
  locale=en-US, timezoneId=Europe/Berlin so OS-level variation cannot
  influence the screenshot. Source: playwright.dev/docs/docker,
  testdino.com/blog/playwright-visual-testing.

### Bridge stability

- **NR-G72 (P0): stable __TEST__ bridge via the useLatest pattern.**
  v17.14's bridge effect had deps `[step, randomize, clearAll, gridSizeI,
  changeGridSize]`, so every grid switch tore down and reinstalled the
  bridge object. Tests caching `const t = window.__TEST__` at the top of
  a `page.evaluate` ended up with stale closures. v17.14.3 stores the
  latest callbacks and reactive values in `bridgeLatest` (a ref updated
  every render) and installs the bridge ONCE in a mount-only effect.
  Methods dispatch through `bridgeLatest.current` at call time, always
  seeing the current values. Side effect: `bridge.ready` is set
  synchronously immediately after `window.__TEST__ = bridge`, eliminating
  the v17.14 microtask race window. Pattern: react-tracked / useLatest /
  React 19 docs on stable refs to mutable state.

### Correctness / memory

- **NR-G73 (P1): cMix integer-tie short-circuit.** The float magnitude
  check `< 1e-10` worked for `(1,1,1)` (residual ~1e-32) but only by
  rounding luck. Larger equal counts could accumulate enough error to
  slip past the threshold and produce a lattice-dependent winner.
  v17.14.3 tests `nR === nB && nB === nY` as the integer-tie branch
  before the float check.

- **NR-G74 (P1): clear stampCache on grid switch.** `stampCache` is
  module-scope and survived grid switches. `spriteCache` was already
  cleared. Stamp images are pure-function-of-pxR so wrong-grid stamps
  produced no visual artifacts, but ~800KB of stale Int16Arrays were
  held per session.

- **NR-G75 (P1): reset perfStats counters on grid switch.** clipHits and
  fullHits accumulated for the entire session. After a long run the ratio
  display lost meaning and the values approached precision limits.
  Resetting on grid change keeps the diagnostic display useful.

- **NR-G76 (P1): rectCache invalidation on every pointerdown.** The 500ms
  time-TTL would otherwise serve a stale rect across a layout shift
  (mobile address-bar collapse, virtual keyboard toggle). Stale rect
  means stale tap coordinates. Clearing the rect on every gesture start
  is cheap and removes the race window.

- **NR-G77 (P1): diagHistory only records first-touch entries.**
  paintStroke fires paintAt for every interpolated point in a drag; the
  diagHistory cap kept the array bounded but each setState dispatched a
  full re-render. First-touch is the semantically interesting event.

### Accessibility

- **NR-G80 (P2): aria-live grid-change announcement.** The canvas has no
  semantic content for screen readers. A visually-hidden `role="status"`
  / `aria-live="polite"` region now reads "Grid {label}, {rows} rows by
  {cols} columns, rule {label}" whenever any of those values change.

### Test surface

- +1 unit test: `classify` returns `Dies@N` for an isolated single cell
- +1 unit test: cMix integer-tie is deterministic for equal R/B/Y at
  every count from 1 to 6, across 50 trials each
- +1 unit test: paintableView centers symmetrically (preexisting, retained)

## v17.14.2 (XL/XXL selectability fix)

Field report: hex cells on XL and XXL grids "did not feel selectable."
Root cause was a null-pointer crash in the tap path that surfaced most
often after grid switches - the path users exercise most when comparing
sizes. v17.14.2 fixes the underlying race and adds a guard so taps
during the resize transition do not lose mutations.

### NR-G68 (P0): self-protecting getCur / getNxt

`changeGridSize()` runs inside `startTransition` and synchronously nulls
`cA.current`, `cB.current`, etc. The transition then queues a low-priority
`setGridSizeI(newI)`. Between the synchronous null and the next rAF
`forceDraw()` (which calls `ensureBufs()` and reallocates), the buffers
are unsafe to read. A tap arriving in that window invoked
`paintAt -> getCur() -> c[idx] = ...` against a null reference and
threw a silent TypeError - the tap registered no visible state change.

`getCur` and `getNxt` now call `ensureBufs()` before returning. The
helper is idempotent (length compare short-circuits when buffers match
the current grid) so the cost on the hot path is one comparison per
call. Step's inner cell loop is unaffected; the helpers are called once
per step and once per tap.

Reproduction was hardest to spot on M and below because the rAF loop
typically has populated buffers by the time the user reaches the canvas
to tap. On XL and XXL, where users frequently switch grid presets to
compare densities, the race window was wider and more visible.

### NR-G69 (P1): pointer events disabled during pending transition

Even with NR-G68's null guard, taps that arrive while `isPending` is
true operate against the OLD-sized buffers. When the transition resolves
and `ensureBufs()` reallocates for the new grid, those mutations are
silently lost. v17.14.2 sets `pointerEvents: "none"` on the canvas for
the duration of the pending transition. The TRANSITION badge already
provides visual feedback; the canvas now backs that with actual gating.

This is the standard React 18+ idiom for `useTransition`-guarded UI:
visible feedback + interaction lockout.

### NR-G68 test surface

Added 27 -> 33 unit tests:
- "every cell center is selectable on every GRID_SIZES preset" -
  exhaustive round-trip every Nth cell on S/M/L/XL/XXL
- "near-center taps land on the correct hex on XL and XXL" -
  HR/4-offset taps in 4 directions for 100 cells on XL and XXL
- "paintableView centers symmetrically on a square grid in a square
  canvas" - guards NR-G67's dead-code removal

Added Playwright spec: "XL and XXL state() is consistent right after
setGrid" - drives the race through bridge.setGrid and verifies state
remains valid throughout.

## v17.14.1 (post-merge audit follow-up)

A second-pass review of the v17.14 source surfaced three more real bugs.
They are corrected in v17.14.1 (no changes to user-visible behavior beyond
making the bridge actually deliver on its written contract).

### NR-G65 (P0): bridge.step now hard-pauses the sim via simPaused ref

v17.14's NR-G63 wrapped the deterministic step in
`setRunning(false); for (...) step(true); setRunning(true);`. React batches
state updates inside a single synchronous block, so the net change to
`running` was zero. The sim-loop `useEffect` therefore did **not** re-run,
and the previously scheduled `setTimeout` continued firing - racing the
bridge's deterministic steps and inserting phantom generations.

v17.14.1 introduces `simPaused` (a `useRef<boolean>`). The sim-loop's
`tick()` reads it on every iteration and reschedules itself without
calling `step` while the flag is set. The bridge sets `simPaused.current
= true` synchronously around its `step` calls, which is observable to
the next setTimeout callback - no batching involved.

The release-notes claim that NR-G63 "pauses the sim before deterministic
step" is now actually true.

### NR-G66 (P1): randomize accepts an optional seed override

v17.14's bridge exposed `bridge.seed` from the `?seed=N` query param but
`bridge.randomize()` ignored it - randomize used the app's hash-stored
seed state instead. Tests therefore could not produce a known random
state without first calling `setSeed` and waiting a render.

v17.14.1 makes `randomize(seedOverride)` accept an integer seed for the
single call. The bridge now exposes `setSeed(n)` for persistent state and
forwards the optional argument on `randomize`. The new e2e regression
spec "randomize(seed) is deterministic across calls" enforces this.

### NR-G67 (P2): paintableView dead code removed

`src/lib/hex.js`'s `paintableView` had `panY: cy * 0 + (ch / 2 - cy *
paintZ)`. The `cy * 0 +` term contributes nothing. Removed. No semantic
change; cleanup only, surfaced during the audit.

## Test surface added in v17.14

- 18 Vitest specs covering buildGrid, pixelToOddR/Snap, cMix, mMix,
  rng, viewport math and the classify state machine.
- 6 Playwright bridge specs (version, clear, step, randomize, setGrid,
  telemetry).
- 2 Playwright visual regression specs (Block default, random seed=42
  after 30 steps under B2/S34).
- 3 GitHub Actions workflows (unit-tests, visual-regression,
  update-snapshots).
- Dependabot weekly schedule for npm + github-actions.
