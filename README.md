# GolHex

Hexagonal Game of Life **plus a real-valued physics layer** (Schneeflocke,
Wasser, Collatz, Genetik) and a norm-conserving **quantum tight-binding
simulation (HQST)** — single React component over a Canvas2D render path.

**Status:** research prototype / hobby-research app. It runs, it is unit- and
e2e-tested, and it is used interactively — but it is **not** a validated scientific
instrument. Nothing here has been peer-reviewed or externally reproduced. Numbers in
this file are measured on the author's machine unless a test file is named; treat them
as indicative, not as a benchmark result.

**This README doubles as an engineering log.** It records feature waves (v33/v34,
"AP-*", "PR-*", issue numbers) in the order they were built, in a mix of English and
German. It is honest about what exists, but it is not a tidy product page.

> **Coworker Research / Coworkerz** — the current version is authoritative in
> `package.json` (the `version` field). The `v31` re-convergence note below is
> retained as dated history, not a current-version claim.

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

## Zweck

GolHex ist eine **modulare Kausal-Experiment-Plattform mit echter Hex-Topologie**:
ein Carter-Bays Hexagonal-Game-of-Life-Kern, erweitert um eine reell-wertige
Physik-Schicht (Schnee, Wasser, Collatz, Genetik) und einen normerhaltenden
**HQST-Quanten-Tight-Binding-Solver**. Es ist bewusst **keine** universelle
Physik-Engine und kein CAD/FEM-Ersatz — jede Fähigkeit wird erst nach eigenem
Evidenz-Gate zugelassen (siehe `docs/ROADMAP.md`).

Arbeits-/Forschungs-Bausteine tragen im Repo etablierte Kurz-Codes
(z.B. `FVM-01` Hexprisma-Finite-Volumen, `ALG-00` Kern-Automat, `HQST`-Kern,
`OPO-01` Operator-Split; belegt in `docs/`) — die maschinenlesbare Repo-Landkarte
liegt in `00_landkarte/README.md`.

## Non-Goals

- **Kein** universeller Physik-Solver / CAD- / FEM- / Digital-Twin-Ersatz.
- **Kein** `window.telemetry`/`window.perfStats`-Test-Hook (existiert nicht,
  verifiziert PR#42 — e2e treibt reale DOM-Controls + `<canvas>`).
- **Keine** schweren Runtime-Dependencies (Bundle-Grösse ist getrackte Eigenschaft).
- **Kein** direkter Zell-Dump als Fertigungs-Export — Manufacturing ist eine
  validierte Konvertier-Pipeline, kein Screenshot (siehe ADR).

> **Archiv-Konvention:** Abgelöste/veraltete Dokumente wandern nach `archiv/`
> (datiert), nicht gelöscht — Provenienz bleibt erhalten. Offene Punkte laufen
> als `OFFENE_THEMEN`-Anschluss in `todo/README.md`.

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

A **13th choice sits in the centre of the wheel — "empty cell / erase"**
(Marco wish 2026-06-14): a dark, dashed swatch with a strike-through symbol,
visually distinct from the 12 colour tones. Picking it **clears the pressed cell
(sets it dead)** and switches the brush to the eraser (`brush = "erase"`, the same
path as the panel "Leer" swatch), so you can keep wiping cells empty — including
on drag, consistent with the existing paint interaction. `aria-label` is
"Leere Zelle / loeschen". (Tapping outside the ring still cancels; only the centre
tap erases.) The wheel-selection decision is the pure, unit-tested
`wheelSelectionEffect` helper in `src/lib/ui-gestures.js` (fail-closed on invalid
selection).

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
   4 Physik* — plus right-aligned action icons *ⓘ Einführung* (re-opens the
   education intro, see below), *📷 Snapshot* (**functional, PR-D**
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

### First-open education intro (Conway / Game of Life / GolHex)

On the **first visit** — right after the branding splash — a small, dismissable
overlay introduces the project: who **John Horton Conway** was (British
mathematician, 1937–2020, inventor of *Game of Life* in 1970), what **Game of
Life** is (a cellular automaton whose simple birth/survival rules produce
emergent gliders and oscillators), and what **GolHex** adds (a hexagonal
Carter-Bays topology, real-valued physics modes incl. the HQST quantum wave, and
16 rule sets). *„Los geht's"* closes it and stores a `localStorage` flag
(`golhex_intro_seen_v1`), so it never auto-appears again. You can re-open it any
time via the dezent **ⓘ** button in the top bar. Implemented in
`src/lib/ConwayIntro.jsx`; the branding splash (`src/lib/Splash.jsx`) is separate
and unchanged.

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
  (verified only on a real device per an internal real-device gate (that document is not part of this repository)). The download
  fallback guarantees the feature works even where share is unavailable.

### v34 (Feature 2): record the field evolution → shareable video

- **⏺ REC** (next to 📷) records the **animated evolution** of the field as a
  video clip. Tap to start (a live `mm:ss` timer appears), tap **⏹** to stop. When
  the clip is ready a **📤** button shares it through the same Web-Share-Level-2 /
  download dispatcher as the snapshot. Filename `golhex_<YYYY-MM-DD>_clip.<ext>`.
- **Dependency-free, no GIF library.** Encoding uses the native
  `canvas.captureStream(30)` → `MediaRecorder` path — **zero added runtime deps**
  (a GIF encoder such as `gif.js` would be a tracked-bundle heavy dep, AGENTS.md §3).
  Bundle stays at ~102 KB gzip; `src/lib/recorder.js` is plain JS.
- **Container/codec is negotiated** via `MediaRecorder.isTypeSupported()` in
  preference order **`video/mp4;codecs=h264` → `video/mp4` → `video/webm;codecs=vp9`
  → vp8 → webm**. mp4/h264 is first because it is the *only* container iOS Safari
  supports and is the most broadly re-shareable on Apple devices; Chrome/Firefox/
  Android fall through to WebM.
- **Honest browser / iOS support matrix** (researched 2026-06-09 — verify on a real
  device per an internal real-device gate (that document is not part of this repository) before claiming "works on iPhone"):

  | Browser / platform | `MediaRecorder` | `canvas.captureStream` | Result |
  |---|---|---|---|
  | Chrome / Edge (desktop, Android) | ✅ | ✅ | WebM clip, shares/downloads (verified headless chromium) |
  | Firefox (desktop) | ✅ | ✅ | WebM clip |
  | **iOS / iPadOS Safari** | ✅ (14.5+) | ⚠️ **historically broken** | **MP4 clip on newer iOS; may produce an empty clip or freeze on older versions** |

  iOS caveat detail: `canvas.captureStream()` + `MediaRecorder` has long-standing
  WebKit issues — the captured video track sometimes carried no valid data and
  `MediaRecorder.stop()` could freeze the page ([WebKit Bug 181663][wk181663]).
  2026 WebKit fixes improve this, but it is **not promised** here without a real
  iPhone test. The UI shows a permanent *"Video evtl. nur Desktop/neueres iOS"*
  hint, detects support **fail-closed** (no `MediaRecorder`/`captureStream` → the
  REC button is hidden, app stays usable), and treats a **0-byte clip as an honest
  error** rather than offering an empty file.
- **Robustness:** pure state machine `idle → recording → encoding → idle` (illegal
  transitions rejected, `error` state on missing API / recorder error / empty clip),
  `mm:ss` duration formatter, codec negotiation and the mockable controller are all
  unit-tested (`src/lib/recorder.js`, `tests/unit/recorder.test.js`); e2e drives the
  real REC button through a start/stop cycle asserting **zero console errors** plus a
  graceful-disabled path (no `MediaRecorder` → button absent, no crash).

[wk181663]: https://bugs.webkit.org/show_bug.cgi?id=181663

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

### HexForge 2D silhouettes (Issue #128 first scope)

The gallery carries a second tile row, **HEXFORGE 2D (SILHOUETTEN)**: six planar
symbol shapes (`rounded-cross`, `four-lobe-clover`, `spiky-rosette`,
`thin-eight-star`, `jagged-starburst`, `radial-burst`) defined as **explicit
parametric silhouettes** (star-shaped radial functions r(θ)) and rasterised
deterministically onto the hex cell centres of the **current grid** — a
silhouette-to-cell-graph adapter, **not** 3D wireframe lines interpreted as
cells (the explicit non-goal of Issue #128).

The adapter (`src/lib/hexforge-2d.js`, pure + unit-tested) enforces the issue's
gates fail-closed with typed errors:

- **Explicit projection** — scale, rotation, centre, hex orientation
  (`pointy-oddr`) and all shape parameters live in the preset spec; nothing is
  implicit.
- **Deterministic hash** — FNV-1a over the canonical spec + sorted cell list;
  golden hashes for all six shapes are pinned in
  `tests/unit/hexforge-2d.test.js`.
- **Topology gates** — exactly 1 connected component, 0 enclosed holes.
  Raster pinholes at concave notches (aliasing artefacts — the star-shaped
  silhouettes are simply connected, so enclosed dead regions cannot be real)
  are sealed deterministically; the sealed count is reported in `stats.sealed`
  and `sealHoles: false` switches to the strict gate instead.
- **Cell-budget guard** (`E_BUDGET`), empty/degenerate silhouette rejection
  (`E_EMPTY`/`E_DEGENERATE`), NaN/out-of-range parameter rejection (`E_PARAM`).
- **Round-trip** through the existing `.golhex.json` savestate envelope with
  hash re-verification on import (`E_HASH`) and a version gate for
  newer/incompatible presets (`E_VERSION`).

Loading a tile rasterises for the current grid size and re-hydrates through the
standard `applyLoadedState` path (rule H:B2/S34, static state — the sim does
not auto-start). e2e covers the tiles functionally (`hexforge-gallery.spec.ts`)
and pins one visual baseline per shape (`hexforge-visual.spec.ts`).

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
- **Farbanzahl 1–3** = `k` colours distributed **symmetrically**, with **as
  equal a cell count per colour as possible**. Because `6n` is divisible by 1/2/3
  for every `n`, a ring splits into `k` remainder-free contiguous sectors of
  `6n/k` cells. Disk/hex stamps form **balanced angular sectors**
  (`balancedAngularSectors`, `src/lib/hex-geom.js`): the disk cells are ordered by
  angle (Itten order, red at top, clockwise; centre cell first → colour 0) and cut
  into `k` equal contiguous index-blocks, so each colour is a connected wedge and
  the per-colour counts differ by **at most one** (`|max − min| ≤ 1`, exactly equal
  only when `cellCount % k == 0`). This fixes the earlier per-cell angle split,
  which gave uneven sector sizes (e.g. disk `n=2`, `k=3`: `8/5/6` → now `7/6/6`).
  A **live mini-preview** renders the exact cells that will be placed (preview ==
  result). Unit-tested in `tests/unit/hex-geom.test.js`.
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

Hybrid Canvas2D renderer: cells render as real **hexagons** (`Path2D`) whenever
the grid is normal-sized; only genuinely large grids (L and bigger, `hr ≤ 5`)
with sub-resolution cells (`hr·s < 2px`) switch to a direct **ImageData raster**
(per-cell pixel blocks) so even a fully-populated 200×250 field stays at ~60fps.
The render-path choice is the pure, REQUIRED-tested `usesRasterPath(pxR, hr)`
(`src/lib/ui-gestures.js`): it gates on **cell-size identity (`hr`)** as well as
`pxR`, so the default grid is **always hexagonal on every viewport width** — a
bare `pxR` threshold let narrow phones (≤375px) raster the default grid into
*squares* (hex-cells-load-bearing; guarded by `tests/unit/raster-gate.test.js` +
`tests/e2e/mobile-hexshape.spec.ts`).

**Colorblind-safe encoding (F10 + F10-ext, opt-in).** A *Farbenblind-sicher*
checkbox (under **DARSTELLUNG**, default **off**) re-encodes the render so it no
longer relies on colour alone (WCAG 1.4.1). When **off** the render is
**byte-identical** to the default (all visual baselines stay valid). When **on**:

*Species (boolean Game-of-Life) — orthogonal two-channel design.* The 12 Itten
species keep their identity instead of collapsing: **colour = species family**
(6 CVD-safe Okabe-Ito hues, survives to ~2px) and **form = lifecycle** (survives
greyscale). 6 × 4 = 24 CVD-safe combinations.

| Lifecycle (form) | Encoding | Species family (colour) | Okabe-Ito |
|---|---|---|---|
| Survivor | full fill | red family (ids 1-2) | sky-blue `#56B4E9` * |
| Newborn  | fill + central **hole** | orange (3-4) | `#E69F00` |
| Dying    | **ring/outline** only, in the real last-known family | yellow (5-6) | `#F0E442` |
| Dead     | thin line (unchanged) | green (7-8) | `#009E73` |
| | | blue (9-10) | `#0072B2` |
| | | violet (11-12) | `#CC79A7` |

\* family 0 uses sky-blue (not vermillion) for a wider deuteranopia gap. The exact
12th bit (member A/B inside a family) shows as a **corner glyph** above ~10px cell
size and is always available via **inspect-on-tap/hover** (exact species name + hue).
Below ~3px the form cue degrades gracefully to colour-only (`formParams(pxR)`).

*Physics gradients (snow / water / HQST / collatz)* now use **cividis** (Nuñez,
Anderton & Renslow 2018) — a CVD-optimised colormap whose **luminance is
monotonic**, so the field value is readable even in full greyscale. The discrete
Mendel genotype field uses three pairwise CVD-distinct Okabe-Ito tones.

The colour/form/colormap logic lives in the pure, unit-tested `cell-style.js`
(`familyOf`, `formParams`, `cividisRGB`, `GENE_CVD`; oracles
`tests/unit/cvd-validation.test.js` + `cell-style.test.js`, incl. WCAG 1.4.11
≥3:1 contrast and Machado-2009 pairwise ΔE > 10 for all six families). It works in
**all** render paths — main-thread `draw()`, the worker (`src/lib/hex-render.js`)
and the sub-pixel raster fast-path (`src/lib/raster-render.js`, family colour only,
exact species via tap) — and persists in `localStorage` (`golhex_cvd_v1`). Worker
parity (#111): the worker now carries its own persistent last-live colour buffer
(`lastLive` in `src/worker/render-worker.js`, mirroring the main thread's
`lastLiveColorRef`), so the worker dying-ring shows the **true** last-known
species family too — the neutral family is only the fallback for cells that never
held a family. The lifecycle stays encoded by **form** (ring vs. fill/hole,
WCAG 1.4.1), so this is a species-colour fix, not a CVD-safety change.

**OffscreenCanvas worker (Stufe 1, opt-in).** A *Worker (Beta)* toggle (visible
only when the browser supports `OffscreenCanvas` + `transferControlToOffscreen` +
`Worker` — fail-closed feature detection) moves the simulation step **and** the
raster render off the main thread via `transferControlToOffscreen`, keeping the
UI thread free for input. Default **off**: the proven main-thread path is the
fallback for old/Safari browsers and for the gesture/Path2D-detail/incremental
paths. The engine and **both render paths** are shared (one source of truth)
between the main thread (`src/App.tsx`) and the worker
(`src/worker/render-worker.js`) via `src/lib/sim-engine.js`,
`src/lib/raster-render.js` (squares) and `src/lib/hex-render.js` (hexagons).

**Worker renders hexagons when zoomed in (5XL-squares fix, 2026-06-11).** The
worker now chooses raster vs. hexagons with the **same** pure
`usesRasterPath(pxR, hr)` gate as the main thread — not raster-only. On a huge
grid (e.g. 5XL = 250k, `hr = 1.3`) it rasters squares while zoomed out
(`pxR < 2`, sub-pixel) but switches to real **`Path2D` hexagons** once zoomed in
(`pxR ≥ 2`), drawing only the **viewport-visible** cells (culling) so 250k cells
stay interactive instead of freezing. Before this fix the worker drew squares at
*every* zoom level (Marco's recurring "5XL renders squares" bug). The worker posts
a `renderMode` message (`raster`/`hex`) that the app mirrors onto
`canvas[data-render-mode]` — the observable e2e marker (no `window` hook), guarded
by `tests/e2e/worker-hex-zoom.spec.ts` + `tests/unit/render-worker.test.js`.

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

Three rule families, all defined in `src/lib/sim-engine.js` (not inline in
`src/App.tsx`):

- **16 totalistic hex birth/survival rules** — `H:B2/S34` … `H:B1/S245`
  (`RULES`, `sim-engine.js:114-123`).
- **4 isotropic non-totalistic (INT) rules** — `INT H:B2o/S2` … `INT H:B2om/S2`
  (`INT_RULES`, `sim-engine.js:143-148`); at exactly 2 neighbours the *arrangement*
  (ortho / meta / para) decides.
- **One Watzlawick "communication band" rule** — `WATZ_RULE = B2,3 / S1-5`
  (`sim-engine.js:159`). It is **not** a 17th entry of the rule dropdown: it is a
  separate `watzOnly` toggle that replaces the selected rule's metadata
  (`src/App.tsx:1167`).

The Watzlawick layer maps Paul Watzlawick's pragmatic axioms of communication onto
the cell transition. Axioms A1–A4 (silence, relationship-over-content, punctuation
via cell age, analog "ghost" state) act on the transition; **A5** (symmetric vs.
complementary — count only same-coloured resp. differently-coloured neighbours) is a
separate opt-in mode (`sim-engine.js:548-549`, UI toggle `src/App.tsx:3700`).

The canonical axiom registry is
[`src/lib/watzlawick-axioms.js`](src/lib/watzlawick-axioms.js). `WATZLAWICK_AXIOMS`
exports all five and types the difference between them: A1-A4 carry
`control: { kind: "boolean" }`, A5 carries
`control: { kind: "mode", options: ["off", "sym", "komp"] }`.

The separate `AXIOMS` array in `sim-engine.js:185-190` is the **UI adapter for the
four Boolean toggles** and holds only a1-a4 on purpose. It is not a second axiom
list: the registry *derives* those four from it instead of restating their labels,
so there is one source and not two. `tests/unit/watzlawick-axioms.test.js` goes red
if the two drift apart, if the exported list is not exactly A1-A5, or if A5 is ever
remodelled as a fifth Boolean -- that last one is issue #147, closed by commit
b855a45.

Full derivation: [`docs/watzlawick-rule.md`](docs/watzlawick-rule.md).

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
  App.tsx          - main React component (4577 lines, measured 2026-09-12)
  main.jsx         - React root mount
  worker/          - OffscreenCanvas render worker
  lib/             - 21 modules; the pure, unit-tested ones are listed below
  lib/sim-engine.js- rule tables (RULES / INT_RULES / WATZ_RULE), grid sizes, cell caps, step kernel
  lib/sim-core.js  - pure HQST core (applyH, solveCN — Crank-Nicolson); unit-tested
  lib/hex-geom.js  - pure hex cube-coord geometry (oddRToCube/cubeToOddR/hexDist/CUBE_DIRS); unit-tested
  lib/popgraph.js  - pure population-sparkline ring buffer + path scaling (push/reset/buildPaths); unit-tested
  lib/presets.js   - pure pattern-gallery: built-in seeds (verified alive), serialize/validate (fail-closed), localStorage persistence, thumbnail sampling; unit-tested
  lib/snapshot.js  - pure share/download dispatcher + filename/watermark builders (Web Share L2 + <a download>); unit-tested
  lib/recorder.js  - pure recorder state machine + codec negotiation + mockable captureStream/MediaRecorder controller (Feature 2 video); unit-tested
  (further modules: cell-style, golhex-lab-core, golhex-nine-rules-adapter,
   hex-render, hexforge-2d, nine-rules, raster-render, savestate, ui-gestures,
   worker-support, watzlawick-axioms, typography, ConwayIntro.jsx, Splash.jsx)
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
