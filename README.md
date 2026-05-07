# GolHex

Hexagonal Game of Life with telemetry pipeline, Safari trackpad support,
and a deterministic `window.__TEST__` bridge for browser automation.

> v17.14 - Coworker Research / Coworkerz - 2026-05-07

## What this is

GolHex is a Carter-Bays hex-topology cellular automaton implemented as a
single React component over a Canvas2D render path. It supports five grid
sizes from 40x50 (S) to 200x250 (XXL), 16 birth/survival rules, three brush
colors with two color-mixing strategies, and a tactile-brutalism UI.

The companion telemetry pipeline subscribes to the browser's
`PerformanceObserver` for `long-animation-frame`, `longtask`, and `event`
entry types, accumulates them into a 5,000-entry ring buffer, and exposes
CSV / JSON download from the diagnostic panel.

The `window.__TEST__` bridge is activated only when `?test=1` is present
in the URL. It exposes a small read-only state plus side-effect-free
actions (`step`, `randomize`, `clear`, `setRuleset`, `setGrid`,
`telemetry`, `perfStats`) so Playwright tests can drive the simulation
deterministically without mucking around with canvas pixel hit-testing.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static bundle in dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Testing

```bash
npm test             # unit tests (Vitest)
npm run test:watch   # vitest in watch mode
npm run test:e2e     # Playwright + visual baselines
```

The Playwright run starts the production preview automatically.

## Project layout

```
src/
  App.jsx          - main React component (~1600 lines)
  main.jsx         - React 18 root mount
  lib/hex.js       - pure functions (hex math, classifier, rng); unit-tested
tests/
  unit/            - Vitest specs for src/lib/hex.js
  e2e/             - Playwright specs using __TEST__ bridge
.github/
  workflows/
    unit-tests.yml         - Vitest on push/PR
    visual-regression.yml  - Playwright on push/PR
    update-snapshots.yml   - manual baseline refresh
  dependabot.yml           - weekly npm + actions update PRs
docs/
  release-notes-v17.14.md  - this version's hardening list
```

## URL parameters

| Parameter | Purpose                                      |
|-----------|----------------------------------------------|
| `?test=1` | install `window.__TEST__` bridge             |
| `?seed=N` | set the deterministic randomize() seed       |
| `#g=N`    | initial grid size index (0 = S, 4 = XXL)     |
| `#r=N`    | initial rule index                           |
| `#p=Name` | initial pattern (e.g. `Block`, `Pentagon`)   |
| `#w=0/1`  | wrap (`1`) or edge-clamp (`0`) topology      |
| `#m=circ` | color mix mode (`circ` or `maj`)             |
| `#d=N`    | density preset (0..4)                        |
| `#s=N`    | seed (also persisted in the URL hash)        |

## Hardware notes

- Cells render as sprite hexagons when on-screen radius >= 4 device-px,
  otherwise fall back to a stamp-mode `Uint32Array` blit.
- Sprite cache is LRU-capped at 10 entries; stamp cache at 8.
- Quiescent-row pre-scan skips inert rows during step. The scratch buffer
  is kept across calls (NR-G56) to avoid 240 GC-eligible allocations / sec
  on XXL at MAX speed.
- Dirty-bbox tracking lets the render path clip to the affected screen
  region when paint coverage is below 60%, with full-frame fallback above
  that or after viewport changes.

## License

MIT - see LICENSE.
