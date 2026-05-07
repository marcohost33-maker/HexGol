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
