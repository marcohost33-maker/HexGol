# GolHex — Modul-Inventar

Bestandsaufnahme der lastragenden Module (Stand 2026-07-18, abgeleitet aus
`src/` + `AGENTS.md`-Layout). Autoritativ bleibt der Code; dieses Inventar ist
ein Index für Orientierung/Review.

## Engine / Numerik-Kern

| Modul | Rolle | Code |
|---|---|---|
| `src/lib/sim-engine.js` | SINGLE-SOURCE: Regeln, GRID_SIZES, buildNeighbors, `stepLife`, rval-Steps, Farben | `ALG-00` |
| `src/lib/sim-core.js` | HQST tight-binding `applyH` + Crank-Nicolson `solveCN` | `HQST` |
| `src/lib/hex-geom.js` | Hex-Würfel-Koordinaten-Geometrie | — |
| `src/lib/golhex-lab-core.js` | H1-Lab: BigInt-Collatz, Hexprisma-FVM, konservative Diffusion, fail-closed Validierung | `FVM-01..06` |

## Render / IO

| Modul | Rolle |
|---|---|
| `src/lib/raster-render.js` | geteilter ImageData-Raster-Pfad (main + worker) |
| `src/lib/hex-render.js` | Hex-Canvas-Render-Pfad |
| `src/lib/recorder.js` | Recorder-State-Machine + Codec-Negotiation |
| `src/lib/snapshot.js` | Share/Download-Dispatcher + Filename/Watermark |
| `src/worker/render-worker.js` | opt-in off-main-thread Sim+Render |

## UI / State

| Modul | Rolle |
|---|---|
| `src/App.tsx` | UI + Main-Thread-Loop `step()`/`draw()` (regel-tragend) |
| `src/lib/presets.js` / `savestate.js` / `ui-gestures.js` / `popgraph.js` | Presets, Save/Restore, Gesten, Populations-Graph |
| `src/lib/ConwayIntro.jsx` / `Splash.jsx` | Intro-/Splash-Overlays |

## Tests / CI

- `tests/unit/` — Vitest (u.a. `step-life.test.js` Paritäts-Orakel,
  `golhex-lab-core.test.js`, `golhex-lab-verification.test.js`).
- Playwright e2e + Visual-Baselines (`maxDiffPixelRatio 0.03`).
- CI-Workflows: `unit-tests.yml`, `visual-regression.yml`, `encoding-guard.yml`,
  `zizmor.yml`.

> Vollständigkeit: dies listet die tragenden Module, nicht jede Datei —
> autoritative Enumeration via `ls src/lib/`. Marco-zu-bestätigen bei Rollenzweifeln.
</content>
