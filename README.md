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
single React component over a Canvas2D render path. It supports eight grid
sizes from 40x50 (S) up to **500x500 (5XL = 250,000 cells)**, 16 birth/survival
rules plus one **formula rule** (`WZL`, see below), three brush colors with two
color-mixing strategies, a **selectable domain frame (rectangle / circle /
hexagon / triangle)**, a real-valued physics layer (snow / water / Collatz /
genetics) and a unitary **HQST** quantum tight-binding mode, and a
tactile-brutalism UI.

### Grid sizes + circle radius (AP-2)

The size `<select>` covers S … 5XL (500x500 = 250,000 cells; the cell count is
shown per option). The **circle frame uses an explicit radius** instead of the
size dropdown: a slider + number field (**10 … 500, default 250**) sizes the
grid to fit the disc (`circleGridDims(radius)`). Circle r=500 spans a
1001×871 bounding grid (~680k cells in the disc; verified
`tests/manual/ap2-instantiation.mjs`).

Safety (fail-closed, honest, no silent crash):
- Square/hexagon/triangle share a **cell-budget cap** (`CELL_CAP = 250,000`).
- Very large grids (> 250k cells) show a **memory warning** (8-GB-PC / phone honesty).
- **HQST is locked above `HQST_CELL_CAP` (90,000 cells)** with an honest in-UI
  message — Crank-Nicolson would be unusably slow at giant grids; the boolean
  CA (Game of Life) is the primary path for the maximal sizes. (Performance
  numbers are measured separately by Data, not asserted here.)

### Long-press colour wheel (AP-3)

A **long press** (hold ~500 ms with movement below an 8 px touch-slop) on a hex
cell opens a **radial 12-colour wheel** centred on the press point. Selecting a
colour does **both** (Marco decision M-3): it colours the pressed cell
immediately **and** switches the active brush colour, so you keep painting in the
new colour. Cancel by tapping outside the ring (or releasing without a pick).

- Works with **mouse** (long click) and **touch**, unified through Pointer
  Events; the native context menu is suppressed so a touch long-press / right
  click never pops the OS menu.
- **Gesture-conflict resolution** (web-validated, B4/B5): a fast swipe past the
  slop, a second finger (pinch), or an early release all cancel the long-press —
  so pan/zoom/paint behave exactly as before; the wheel is purely additive.
- In the OffscreenCanvas-worker path (AP-1) the colour change is pushed to the
  worker via the existing `state` postMessage bridge (`syncWorkerState`), so the
  off-main-thread render reflects the new cell colour too.
- The wheel is only visible during an active long-press, so it does **not**
  appear in the canvas visual baselines. Behaviour is covered by
  `tests/e2e/longpress-colorwheel.spec.ts`.

### v33 layout (PR-A): top tabs · max field · stats line · bottom controls

The UI is a **single screen with no scrolling** on phone and desktop alike:

1. **Top bar (52px):** four content tabs — *1 Farben · 2 Formen · 3 Hex-Regeln ·
   4 Physik* — plus right-aligned action icons *📷 Snapshot* (**functional, PR-D**
   — share or download an image of the field) and *💾 Speichern*
   (**functional, PR-C** — opens the save-state panel) and *✕ App schliessen*.
   Tabs **3/4** open as an **overlay over the field**; tabs **1/2** open the
   **left drawer** (PR-B, see below). Tapping the active tab again closes it.
2. **Field maximal:** the canvas fills the space between the top bar and the stats
   line (`flex-grow`); zoom *+ / − / Fit* are floating 44px buttons bottom-right.
3. **Stats line (34px):** *Gen · Pop · +births / −deaths · Gen/s · rule chip
   (B/S) · frame+size chip*. Updated throttled (~4 Hz, decoupled from the rAF draw
   loop) so a running sim never thrashes the DOM.
4. **Bottom controls:** *⏮ 1. Figur (**functional, PR-C**) · Undo · Redo (disabled,
   PR-C) · **▶ Play** (60px, centre) · Schritt · Random · Leeren (red, set apart)*,
   plus a Tempo slider (TURBO step preserved). Touch targets ≥48px,
   `padding-bottom: env(safe-area-inset-bottom)`.

### Live population graph (sparkline)

A slim, full-width **live sparkline** sits directly **above the controls** (between
the field and the stats line) and makes the run's dynamics — boom/collapse,
oscillation, stability — readable at a glance. It plots the **last ~200 generations**
of two series:

- **POP** (label top-left) — living cells (in physics mode: active cells) — the
  strong teal line (theme accent `#5CF0CC`).
- **AKTIV** (label bottom-left) — cells **changed this step** (life: births + deaths;
  physics mode: equals POP, no separate diff) — a thinner, paler line.

Both lines share one vertical scale, so POP sits above AKTIV when its value is larger.
The graph **only appears once ≥2 generations are buffered** and the **buffer resets**
on **Leeren / Random / rule change / mode change / field-size change**, so the curve
always matches the current run. Implementation: the ring buffer and path scaling are a
**pure, unit-tested module** (`src/lib/popgraph.js`); POP/AKTIV are reused from the
stats line, not recomputed. The `<canvas>` redraw is **throttled to ~6 Hz and decoupled
from the rAF draw loop** (it never redraws per animation frame). It is a separate
`<canvas>` (not the simulation canvas), so the visual-regression baselines are
unaffected.

### v33 (PR-C): save states (IndexedDB) + file export + "1. Figur" restore

- **💾 Speichern (save-state panel).** Named slots stored in **IndexedDB** (not
  localStorage — 50k–680k cells exceed the 5 MB string limit). The grid is kept as
  a compact **`Uint8Array`** (native binary in the store), the meta carries name,
  rule, frame, size, zoom, generation, seed. Save under a name (pre-filled with the
  date, **Enter** confirms), tap a slot to **load**, ✎ rename, 🗑 delete. An
  **autosave** slot is written on pause and on `beforeunload`/`pagehide`.
  `QuotaExceededError` surfaces as a plain user hint instead of failing silently.
- **File export / import.** Save as **`<name>.golhex.json`** (Blob + `<a download>`,
  no library) and re-load via `<input type=file>` + `FileReader`. The format carries
  a `version` field for forward-compatibility; loading a *newer* file fails closed
  with a clear message. Cells are Base64-encoded inside the JSON envelope; a
  680k-cell round-trip serialises in ~30 ms (measured, bit-exact).
- **⏮ "1. Figur" (Urzustand restore).** On the **first** Play (or Step) of a run, the
  field state — cells + ghosts + age + active rule + frame + size — is snapshotted as
  the *Urzustand*. ⏮ restores **exactly** that pre-first-Play state and stops the run.
  It is **distinct from Undo/Redo**: clearing, Random, or placing a figure/stamp
  resets the Urzustand slot (the next Play captures a fresh one). The button is
  disabled until a Urzustand exists.

### v33 (PR-D): snapshot — share or download an image of the field

- **📷 Snapshot** captures the visible field canvas and, in **one tap**, opens the
  system **share sheet** (Web Share API **Level 2**) or, if file sharing is
  unavailable, triggers a **download** — no intermediate dialog. The flow is
  `canvas.toBlob` → `File` → `navigator.canShare({files})` ? `navigator.share(...)`
  : `<a download>` + `ObjectURL` (revoked after the click). The share call runs
  inside the same user-gesture handler (iOS requirement). PNG (lossless — CA grids).
- **Download filename:** `golhex_<YYYY-MM-DD>_gen<N>.png`.
- **Watermark (optional, toggleable).** A small `GolHex · Gen N · <rule B/S>` label
  is drawn on a *copy* of the canvas (the live field is never touched); the
  checkbox in the snapshot status line turns it off.
- **Robustness:** `toBlob` null-guard (fails closed, no silent empty file), busy-flag
  against double-taps, large canvases stay responsive (`toBlob` is async). The pure
  helpers (`src/lib/snapshot.js`: filename/label builders + share-vs-download
  dispatcher) are unit-tested; e2e covers both the download path (PNG magic bytes)
  and the share path (stubbed `navigator.share`, asserting a PNG `File[]`).
- **iOS reality-anchor:** Web-Share-of-files on iOS Safari is historically fragile
  (verified only on a real device per `EVALUATION_STRATEGY §8`). The download
  fallback guarantees the feature works even where share is unavailable.

> Live physics (`rval`) save is intentionally out of scope here — those fields are
> `Float32`, which needs its own format; the save/load/export path covers the
> boolean **Lebenswelt** mode and reports an honest message in physics mode.

### Pattern gallery + presets (1-tap load)

A **Muster-Galerie** in **Tab 3 (Hex-Regeln)** loads curated start-seeds in **one
tap** — a built-in tile sets the field **and** its matching rule + grid size at once,
then re-hydrates through the **existing save-state load path** (`applyLoadedState`); no
new loading logic. Each tile shows a **mini-render** of the seed (sampled dots, like the
mockup). It builds directly on top of the save/snapshot mechanism above.

**Honesty (no fake "famous" objects).** The classic square-grid Game-of-Life objects
(Conway glider, blinker) **do not exist** on the 6-neighbour hex topology — they are not
periodic oscillators/spaceships there. The gallery therefore claims **no famous named
patterns**. Every built-in is an **honestly named, reproducible start-seed** (concrete
cell positions + a chosen hex rule); the gallery loads exactly that initial state, and
what evolves is the dynamics of the chosen rule — not a pre-claimed outcome. All six
built-ins are **verified alive** (they do not die out within 20 generations of their
rule, across every grid size) by a unit-test oracle, not by eyeballing:

| Tile | Rule | Honest origin |
|------|------|---------------|
| **Zentral-Cluster** | H:B2/S34 | central 6-cell seed under canonical hex Life — small stable oscillator. |
| **Gleit-Keim** | H:B2/S34 | diagonal start chain — honest seed, **not** a glider (none exist on hex). |
| **Schnee-Start** | H:B2/S35 (Carter-Bays) | hexagonal ring seed → crystalline fixed state. |
| **Dicht-Cluster** | H:B12/S34 | dense 4×4 block — long-lived growing cluster. |
| **Wellen-Start** | H:B23/S34 | offset double-row → growing wave fronts. |
| **Faecher-Start** | H:B2/S23 | V-shaped double line → symmetric growing fan. |

**Own presets** are saved with **"+ Eigener"** (saves the current Lebenswelt field as a
preset, name prompt) and persist in **`localStorage`** (these seeds are small — a central
patch, not the full huge grid — so a synchronous store is the right fit, vs. the IndexedDB
used for full save-states). Own tiles load on tap and carry a **Loeschen** action.
Pure logic — serialise/deserialise/validate (**fail-closed** on corrupt/foreign/future
objects) + thumbnail sampling — lives in the unit-tested module `src/lib/presets.js`; the
preset format **is** the existing `golhex.savestate` envelope, so presets round-trip and
validate through the same code as save-states. Live physics (`rval`) preset-save is out of
scope (same honest reason as save-states). e2e drives it via real DOM controls (open the
gallery, tap a built-in, assert the field changes via the visible `Pop` counter) — no
`window` hook, and no visual baseline is touched.

Where the old controls moved: brush/colours + colour mode → **Tab 1**; pattern
stamp + ring/disc colour-wheel stamp → **Tab 2**; rule source/INT, rule + **size
(S–5XL)** select, **pattern gallery + presets**, topology/frame + circle radius,
worker toggle + big-grid notices,
Watzlawick axioms, systems-theory, legend → **Tab 3**; sim mode (life/physics),
real-valued rules (snow/water/HQST/Collatz/genes) + solver + seed, LiouScope
recorder, Globalarchiv snapshot, stats detail → **Tab 4**. **No function is removed
or made unreachable** — only re-grouped behind the tabs.

### v33 (PR-B): left drawer + stamp mathematics

Tabs **1 Farben** and **2 Formen** open a **drawer that slides in from the left**
and overlays only the left portion — the field stays visible (and, in stamp mode,
tappable) on the right. The drawer opens via a **visible handle** (`❯`, left edge)
as the primary affordance and via the tab tap; an edge-swipe is a non-required
bonus (iOS-back-gesture conflict, so no hard `preventDefault` and the handle is
not on the exact system edge). Closes via the handle/`❮`, or — in *Farben* mode —
a tap on the right scrim.

**Stamps (Tab 2 Formen):** four types — *Ring · Scheibe · Hexagon · Frei* (the
free-form brush is a UI stub; its mask geometry arrives in PR-E). Two stepper rows:

- **Größe 1–4** = the hex **ring distance `n`** (cube `hexDist`), *not* a world-space
  `min(R,C)·0.42` heuristic (math audit **P1.2**). A ring of distance `n` has exactly
  **6n** cells; a disk has **1 + 3n(n+1)** (Red Blob Games; unit-tested in
  `tests/unit/hex-geom.test.js`).
- **Farbanzahl 1–3** = `k` colours distributed **symmetrically**. Because `6n` is
  divisible by 1/2/3 for every `n`, a ring splits into `k` remainder-free
  contiguous sectors of `6n/k` cells; disk/hex sectors are angle-based around the
  centre (Itten order, red at top, clockwise). A **live mini-preview** renders the
  exact cells that will be placed.
- **Placing:** pick type/size/colours in the drawer, then **tap the field** — the
  stamp is placed at the tap (no confirm button); the last stamp is remembered.
  Stamps **respect the domain mask** (audit **P1.1**): out-of-domain cells are
  skipped, so nothing flashes-and-vanishes on the next step. `placeColorWheel` and
  the pattern stamp got the same mask guard. Covered by
  `tests/e2e/stamp-drawer.spec.ts` (mobile project).

Geometry primitives live in `src/lib/hex-geom.js`: `cubeRing(center, n)`,
`cubeDisk(center, n)`, `kColorByIndex(len, k)`, `sectorByAngle(...)` — pure,
re-exported through `sim-engine.js`, unit-tested (54 geom tests).

- On viewports `≥768px` (desktop) the structure is identical; the panel overlay is
  reused (no separate desktop layout system).
- The close button (`×`, *App schliessen*) — Coworkerz back/close requirement —
  stays visible in the viewport at all times (`closeApp()`: `history.back()` in a
  launcher tab, else `window.close()` with an honest browser-tab fallback).
- Uses `100dvh` + `viewport-fit=cover` + `env(safe-area-inset-*)` for notch/home
  indicator. Canvas and the colour wheel set `user-select: none` +
  `-webkit-touch-callout: none` so a long-press never triggers text selection or
  the iOS callout. Covered by `tests/e2e/mobile-onepage.spec.ts` (mobile project,
  390×844).

### Domain frames + topology

Six frame shapes define the simulation domain (cells outside are permanent
walls); box/hexagon/triangle pick the largest inscribed shape that fills the hex
field, while the circle uses an **explicit radius** (see above):

| Frame | Geometry | Torus coupling |
|-------|----------|----------------|
| **Rechteck** (box) | full grid | periodic wrap (the only shape that tiles the plane cleanly) |
| **Kreis** (circle) | disc of the chosen radius (10–500, default 250), clamped to the inscribed maximum | antipodal identification = real projective plane (RP²) |
| **Hexagon** | exact regular hexagon via cube-coord hex distance (`hexDist ≤ r`); 6 corners are `r` steps along the 6 cube directions, derived from the mask (corner-BBox == mask-BBox, verified) | bounded (no wrap) |
| **Dreieck** (triangle) | equilateral, point-up, via three half-plane sign tests | bounded (no wrap) |
| **Ellipse** (v33 PR-E) | world-space test `((x−cx)/a)² + ((y−cy)/b)² ≤ 1` with two half-axes `a` (horizontal) / `b` (vertical), each clamped to the grid (fail-closed); `a = b` is exactly a circle | bounded (no wrap) |
| **Frei** (freeform, v33 PR-E) | user-drawn polygon; mask via **winding-number** (Hormann-Agathos 2001), point-on-edge counts as inside — correct even for self-intersecting shapes (where even-odd fails). Press **Zeichnen**, then drag a closed stroke on the field | bounded (no wrap) |

The hexagon outline and mask share one source of truth
(`src/lib/hex-geom.js`); the cell count is an exact centered-hexagonal number
`1 + 3r(r+1)` (unit-tested in `tests/unit/hex-geom.test.js`). The ellipse and
freeform outlines are likewise drawn from the same parameters/polygon as their
masks (outline == mask). Ellipse + freeform masks are unit-tested against
independent oracles (analytic ellipse area; winding-vs-even-odd on a star
polygon) in `tests/unit/pr-e-ellipse-freeform.test.js`.

**Ellipse controls:** two sliders **Achse a** (horizontal) / **Achse b**
(vertical), 5–500 grid steps. **Freeform controls:** **Zeichnen** toggles draw
mode; drag a closed stroke on the canvas (released stroke closes the polygon and
builds the mask); **Leeren** clears the drawn shape.

**Worker render (≥90k cells) — single source of truth.** Above the auto-worker
threshold the OffscreenCanvas worker owns rendering; the main thread must
**explicitly push** state to it (`syncWorkerState`). Every pause-time edit
(Random, Leeren, Undo, pattern/colour-wheel place, rval seed, stamp, load,
restore) now syncs — otherwise the worker keeps its stale (empty) copy and the
field renders blank (regression `tests/e2e/frame-render.spec.ts`, which asserts
the mask actually reaches the screen, not just "no console errors"). Known minor
gap: the worker does not draw the thin frame **outline** (the masked cells still
show the shape); main-thread grids draw it. **Zoom (−/Fit/+) and the
Farben/Stempel handle live in a bar *below* the field** so the whole hex field /
frame is always unobstructed.

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

**OffscreenCanvas worker (Stufe 1, opt-in).** A *Worker (Beta)* toggle (visible
only when the browser supports `OffscreenCanvas` + `transferControlToOffscreen` +
`Worker` — fail-closed feature detection) moves the simulation step **and** the
raster render off the main thread via `transferControlToOffscreen`, keeping the
UI thread free for input. Default **off**: the proven main-thread path is the
fallback for old/Safari browsers and for the gesture/Path2D-detail/incremental
paths. The engine and raster code are shared (one source of truth) between the
main thread (`src/App.tsx`) and the worker (`src/worker/render-worker.js`) via
`src/lib/sim-engine.js` + `src/lib/raster-render.js`.

**Auto-worker on giant grids (M-2).** Switching to a grid with **≥ `HQST_CELL_CAP`
(90,000) cells** turns the worker **on automatically** (with a plain-language
notice) whenever `OffscreenCanvas` is available — the main thread otherwise
freezes there. The threshold is the single source from `sim-engine.js` (the same
constant as the HQST lock), not duplicated. The user toggle always wins: turning
the worker **off** on a giant grid keeps it off (with a "can freeze" warning) and
the choice persists; switching back to a small grid leaves the worker state as the
user last set it. On browsers without `OffscreenCanvas` the behaviour is unchanged
plus an honest giant-grid warning. Locked HQST (above the cap) keeps its existing
lock + step-skip; the auto-worker does not override it.

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

The Playwright run starts the production preview automatically. It has two
projects: **`chromium`** (desktop, 1280×800 — functional + visual baselines) and
**`mobile`** (390×844 — the AP-4 one-page layout proof, `mobile-onepage.spec.ts`).
Run one with `npm run test:e2e -- --project=mobile`.

## Project layout

```
index.html         - Vite entry (loads /src/main.jsx)
src/
  App.tsx          - main React component (~2200 lines, v31)
  main.jsx         - React root mount
  lib/sim-core.js  - pure HQST core (applyH, solveCN — Crank-Nicolson); unit-tested
  lib/hex-geom.js  - pure hex cube-coord geometry (oddRToCube/cubeToOddR/hexDist/CUBE_DIRS); unit-tested
  lib/popgraph.js  - pure population-sparkline ring buffer + path scaling (push/reset/buildPaths); unit-tested
  lib/presets.js   - pure pattern-gallery: built-in seeds (verified alive), serialize/validate (fail-closed), localStorage persistence, thumbnail sampling; unit-tested
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
| `#g=N`    | initial grid size index (0 = S … 7 = 5XL 500x500) |
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
