# GolHex

Hexagonal Game of Life **plus a real-valued physics layer** (Schneeflocke,
Wasser, Collatz, Genetik) and a norm-conserving **quantum tight-binding
simulation (HQST)** — single React component over a Canvas2D render path.

> **v31.0** - Coworker Research / Coworkerz - 2026-06-04

> **Re-Konvergenz 2026-06-04 (v29L.3b + v31 → v31.0):** Die Produktlinie
> (Drive-`golhex v31`) und die Repo-Linie (v29L.3b mit `sim-core.js`-Extraktion +
> ImageData-Raster-Fast-Path) wurden wieder zusammengefuehrt. **v31 fuehrt** als
> `src/App.tsx`-Basis; die Repo-Deltas wurden nachgezogen. Neu in v31 ggue.
> v29L.2: zwei zusaetzliche **Rahmenformen Hexagon/Dreieck** (kubische
> Koordinaten), TORUS-Korrektur (nur Box kachelt; Circle antipodal RP2;
> Hexagon/Dreieck berandet), **inkrementelles Neuzeichnen** + **Touch-Haertung**
> (s.u.). Nachgezogene Repo-Deltas: HQST-Kern in `src/lib/sim-core.js`,
> Hex-Wuerfelgeometrie in `src/lib/hex-geom.js` (beide unit-getestet, Single
> Source), **ImageData-Raster-Fast-Path** (Vollredraw winziger Zellen),
> **TURBO**-Tempo, Coworkerz-Schliessen-Button.
>
> Build-Fix: `index.html` ist wieder der Vite-Entry (`/src/main.jsx`); seit PR#31
> war ein eingefrorenes Inline-Bundle eingecheckt, sodass `npm run build` die
> `src/`-Aenderungen nicht mehr buendelte.

## What this is

GolHex is a Carter-Bays hex-topology cellular automaton implemented as a
single React component over a Canvas2D render path. It supports five grid
sizes from 40x50 (S) to 200x250 (XXL), 16 birth/survival rules plus one
**formula rule** (`WZL`, see below), three brush colors with two color-mixing
strategies, a **selectable domain frame (rectangle / circle / hexagon /
triangle)**, a real-valued physics layer (snow / water / Collatz / genetics)
and a unitary **HQST** quantum tight-binding mode, and a tactile-brutalism UI.

### Domain frames + topology

Four frame shapes define the simulation domain (cells outside are permanent
walls); each picks the largest inscribed shape that fills the hex field:

| Frame | Geometry | Torus coupling |
|-------|----------|----------------|
| **Rechteck** (box) | full grid | periodic wrap (the only shape that tiles the plane cleanly) |
| **Kreis** (circle) | largest inscribed disc | antipodal identification = real projective plane (RP²) |
| **Hexagon** | exact regular hexagon via cube-coord hex distance (`hexDist ≤ r`); 6 corners are `r` steps along the 6 cube directions, derived from the mask (corner-BBox == mask-BBox, verified) | bounded (no wrap) |
| **Dreieck** (triangle) | equilateral, point-up, via three half-plane sign tests | bounded (no wrap) |

The hexagon outline and mask share one source of truth
(`src/lib/hex-geom.js`); the cell count is an exact centered-hexagonal number
`1 + 3r(r+1)` (unit-tested in `tests/unit/hex-geom.test.js`).

### Touch / pointer controls

- **Canvas + sliders** use `touch-action: none` and a non-passive `touchmove`
  listener so painting / pan / pinch-zoom don't scroll the page; plain vertical
  scroll outside those elements is passed through (`touch-action: pan-y` +
  `overscroll-behavior: contain` on the root).
- **Wheel / trackpad-pinch zoom** is proportional (exponential), with the
  `ctrlKey` trackpad-pinch gesture handled smoothly (Figma/tldraw/Excalidraw
  pattern) via a non-passive `wheel` listener.
- All buttons meet the **WCAG 2.2 ≥44px** touch-target size with a visible
  keyboard focus ring; reduced-motion is respected.

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
index.html         - Vite entry (loads /src/main.jsx)
src/
  App.tsx          - main React component (~2200 lines, v31)
  main.jsx         - React root mount
  lib/sim-core.js  - pure HQST core (applyH, solveCN — Crank-Nicolson); unit-tested
  lib/hex-geom.js  - pure hex cube-coord geometry (oddRToCube/cubeToOddR/hexDist/CUBE_DIRS); unit-tested
tests/
  unit/            - Vitest: sim-core.test.js (CN norm conservation + convergence flag),
                     hex-geom.test.js (hexagon frame == mask, centered-hex number)
  e2e/             - Playwright smoke + visual baselines (life random, XXL circle frame)
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
