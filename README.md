# GolHex

Hexagonal Game of Life **plus a real-valued physics layer** (Schneeflocke,
Wasser, Collatz, Genetik) and a norm-conserving **quantum tight-binding
simulation (HQST)** — single React component over a Canvas2D render path.

> **v29.0 (v29L.2)** - Coworker Research / Coworkerz - 2026-06-01

> **Migration 2026-06-01 (v19.1 → v29L.2):** Dieses Repo wurde von der v19-
> Telemetrie-/`__TEST__`-Bridge-Linie auf die feature-reiche Drive-Linie
> **v29L.2** gehoben (kanonisch). Neu: waehlbarer **Rahmen Kreis/Rechteck**
> (Domaenen-Maske), **reellwertige Physik** + **HQST** (Crank-Nicolson, unitaer),
> Topologie-Kopplung (Torus/RP2), **TURBO**-Tempo. Der alte `window.__TEST__`-
> Bridge entfiel; die e2e-Suite ist jetzt ein funktionaler Smoke-Test
> (`tests/e2e/smoke.spec.ts`, keine Pixel-Baselines). `src/lib/hex.js` + Unit-
> Tests bleiben als unabhaengige Topologie-Bibliothek erhalten (Cleanup-Follow-up).

## What this is

GolHex is a Carter-Bays hex-topology cellular automaton implemented as a
single React component over a Canvas2D render path. It supports five grid
sizes from 40x50 (S) to 200x250 (XXL), 16 birth/survival rules plus one
**formula rule** (`WZL`, see below), three brush colors with two color-mixing
strategies, a **selectable domain frame (circle / rectangle)**, a real-valued
physics layer (snow / water / Collatz / genetics) and a unitary **HQST**
quantum tight-binding mode, and a tactile-brutalism UI.

### Real-valued physics + HQST quantum mode

Beyond the boolean Game-of-Life engine, **Physik (reellwertig)** switches to a
real-valued field layer: **Schneeflocke** (Reiter snowflake automaton),
**Wasser** (mass-conserving), **Collatz**, **Genetik** (Mendel/Hardy-Weinberg),
and **HQST** — a hexagonal tight-binding **time-dependent Schrödinger**
simulation integrated with **Crank-Nicolson** (Cayley form, norm-conserving /
unitary). A **TURBO** speed tier computes many generations per frame.

### Rendering

Hybrid Canvas2D renderer: large cells use batched (chunked) hex `Path2D` fills;
when cells get tiny (XXL / zoomed out, `hr·s < 3.5px`) it switches to a direct
**ImageData raster** (per-cell pixel blocks) so even a fully-populated 200×250
field stays at ~60fps.

## Rules

16 classic hex birth/survival rules (`B2/S34` … `B1/S245`) plus one **formula
rule** `WZL` (rule index 16). WZL maps **Watzlawick's five pragmatic axioms of
communication** onto the hex cell transition: symmetric vs. complementary
neighbours, relationship-coherence as a birth gate, and cell age as
"punctuation". The classic B/S rules and the WZL formula rule are implemented
inline in the app component (`src/App.tsx`). Full derivation:
[`docs/watzlawick-rule.md`](docs/watzlawick-rule.md).

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
  App.tsx          - main React component (~1960 lines, v29L.2)
  main.jsx         - React root mount
  lib/sim-core.js  - pure HQST core (applyH, solveCN — Crank-Nicolson); unit-tested
tests/
  unit/            - Vitest specs for src/lib/sim-core.js (CN norm conservation)
  e2e/             - Playwright smoke spec (functional, no pixel baselines)
.github/
  workflows/
    unit-tests.yml         - Vitest on push/PR
    visual-regression.yml  - Playwright on push/PR
    update-snapshots.yml   - manual baseline refresh
  dependabot.yml           - weekly npm + actions update PRs
docs/
  release-notes-v17.14.md  - this version's hardening list
  watzlawick-rule.md       - WZL formula-rule: Watzlawick's 5 axioms -> cell rule
```

## URL parameters

| Parameter | Purpose                                      |
|-----------|----------------------------------------------|
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
