---
reifegrad: aktiv
repo: HexGol
produkt: GolHex
---

# GolHex — Repo-Landkarte

Maschinen-/Menschen-lesbare Orientierung. Quelle der Wahrheit für Code bleibt
`src/`; diese Landkarte ist ein Index, kein Duplikat.

## Code:

```
index.html                # Vite-Entry (/src/main.jsx)
vite.config.js            # Build-Config
playwright.config.ts      # e2e + Visual-Regression
src/
  App.tsx                 # UI + Main-Thread-Loop: step()/draw() (regel-tragend)
  main.jsx                # React-Entry
  lib/
    sim-engine.js         # SINGLE-SOURCE Engine: Regeln, GRID_SIZES, stepLife
    sim-core.js           # HQST applyH + Crank-Nicolson solveCN
    hex-geom.js           # Hex-Würfel-Geometrie (Red Blob Games)
    golhex-lab-core.js    # H1-Lab: BigInt-Collatz, Hexprisma-FVM, Diffusion
    raster-render.js      # geteilter ImageData-Raster-Pfad (main + worker)
    recorder.js           # Recorder-State-Machine + Codec-Negotiation
    ...                   # weitere Render-/UI-/Preset-Module (siehe inventar/)
  worker/render-worker.js # opt-in off-main-thread Sim+Render
tests/                    # Vitest-Unit + Playwright-e2e + Visual-Baselines
experimental/             # Spikes — nicht im Haupt-Bundle
docs/                     # Roadmap, ADR, Research, Verification-Plan
```

## Domänen (aus ADR-001)

- **Logik-Domäne** — axiale Hex-Topologie, diskrete Zustände, Regeln (`ALG-00`).
- **Numerik-Domäne** — modell-gewählter Solver (CA, FVM `FVM-01..06`, HQST, ODE).
- **Geometrie/Manufacturing-Domäne** — SDF/TSDF/Mesh/B-Rep je nach Output.

## Weiterführend

- Nordstern + Meilensteine: `docs/ROADMAP.md`
- Erst-Architektur-Entscheid: `docs/ADR/ADR-001-hex-topology-domain-split.md`
- Modul-Inventar: `inventar/README.md`
- Offene Punkte: `todo/README.md`
- Problem-/Negativ-Erkenntnisse: `pr_nr/README.md`
</content>
</invoke>
