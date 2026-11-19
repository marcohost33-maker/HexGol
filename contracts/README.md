# GolHex planar Golden Vector contract v1

Purpose: cross-repository parity evidence for `golhex-3d` ROADMAP-#5 ("Paritaet VOR 3D").

This is **not** a second engine. `scripts/generate-planar-golden.mjs` invokes the production
HexGol `buildNeighbors()` and `stepLife()` functions and emits a small deterministic fixture.

Scope v1:
- pointy-top odd-r, 5 x 6, edge boundary;
- canonical totalistic hex rule `H:B2/S34` (`RMETA[0]`);
- no A1-A5/System/adibatic modifiers;
- one asymmetric five-cell seed, one colour state;
- checkpoints t=0..5 include full `col`, `age`, `ghost`, births/deaths;
- the exact 6-neighbour table is part of the fixture so topology drift is observable.

Why B2/S34, not Conway B3/S23: the production HexGol catalogue is a six-neighbour hexagonal
automaton; it deliberately uses a B2-based canonical rule. v1 therefore tests the product's
actual semantics instead of importing a square-grid convention by name.

Provenance is pinned by the latest commit that changed `src/lib/sim-engine.js` and its exact Git
blob SHA. If that blob changes, v1 refuses a silent refresh: create/update a contract version and
review the semantic delta.

Regenerate/check:

```bash
node scripts/generate-planar-golden.mjs contracts/golhex-planar-golden-v1.json
npm test -- --run tests/unit/planar-golden-contract.test.js
```

Consumer rule: a downstream repository must vendor this fixture **unchanged**, record its SHA-256,
and test its adapter against every checkpoint. Passing v1 establishes only this bounded planar
H:B2/S34 profile; it does not establish parity for INT, Watzlawick, rval, HQST, torus, other frame
shapes, colour mixing, or 3D dynamics.

# GolHex planar Golden Vector contract v2 (profile matrix)

Purpose: `golhex-3d` Issue #22 ("expand HexGol parity v1 into a profile matrix"), stages 1 and 2.
`scripts/generate-planar-golden-v2.mjs` drives the same production `buildNeighbors()` and
`stepLife()` (engine blob `631c07d`, unchanged since v1) and writes one file per profile into
`contracts/golhex-planar-golden-v2/` (no single mega-fixture):

| file | profile | grid, ticks | counterexample |
|---|---|---|---|
| `b2s35-oddr-edge.json` | `H:B2/S35 (Bays)`, odd-r edge | 7 x 8, 0..8 | same seed under `H:B2/S34` |
| `b2s34-oddr-torus.json` | `H:B2/S34`, odd-r box-torus | 6 x 6, 0..8 | same seed with the edge boundary |

Every file records the first tick at which its counterexample diverges and that state's hash; a
seed that cannot tell a profile from its contrast is refused. For `H:B2/S35` live cells with exactly
4 and 5 neighbours must occur (only there S34 and S35 differ).

Torus caveat (measured 2026-11-10): the odd-r box-torus of `buildNeighbors()` is a torus only for an
**even** row count >= 4 with >= 3 columns. Odd row counts >= 3 give an asymmetric neighbour relation
(j next to i, but not i next to j); 1-2 rows or columns give self or duplicate neighbours. All box
presets in `GRID_SIZES` have even rows, so the app does not reach this; the v2 torus fixture uses 6 x 6.

```bash
node scripts/generate-planar-golden-v2.mjs contracts/golhex-planar-golden-v2          # write
node scripts/generate-planar-golden-v2.mjs --check contracts/golhex-planar-golden-v2  # verify
npm test -- --run tests/unit/planar-golden-v2-contract.test.js
```

v1 is untouched by v2. If `sim-engine.js` changes, the v2 generator refuses to refresh: create v3.

# GolHex planar water Golden Vector contract v1 (real-valued profile)

Purpose: the open item of the `golhex-3d` R03 re-audit (2026-11-19, NR-GH3D-R03-03). The 2D water
parity there was checked against a hand-mirrored copy of `stepWater`, so a mistake shared by both
sides stays invisible. `scripts/generate-planar-water-golden.mjs` is the independent upstream side:
it drives only the production `buildNeighbors()` and `stepWater()` (engine blob `631c07d`, the same
as v1/v2) and writes one file per profile into `contracts/golhex-planar-water-golden-v1/`:

| file | profile | grid, ticks | counterexample |
|---|---|---|---|
| `water-oddr-edge.json` | water, odd-r edge, closed system | 6 x 6, 0..12 | same seed, `Float64Array` buffers (no binary32 store rounding) |
| `water-oddr-torus.json` | water, odd-r box-torus, closed system | 6 x 6, 0..12 | same seed with the edge boundary |

Both counterexamples come from the same production function under a changed condition, never from a
second implementation. Each diverges at tick 1; a seed that cannot tell a profile from its contrast is
refused.

State encoding: each cell is its IEEE-754 binary32 bit pattern as an unsigned 32-bit integer
(`wBits`, row-major), so nothing is lost to decimal printing. `stateSha256` is SHA-256 over
`uint32le(tick)` followed by the cells as little-endian float32.

Arithmetic a consumer must reproduce: every intermediate is binary64 using only `+ - * / min max`,
and every write into the field rounds to binary32 (nearest-even). No fused multiply-add: in C, C++
or Rust the compiler must not contract `a + b * c` (for GCC/Clang `-ffp-contract=off`). The buffer
protocol is `out = stepWater(w, NL, cols, buf); buf = w; w = out`; the lateral exchange reads the
post-gravity snapshot, not the field being written.

Measured 2026-11-19: `scripts/verify-planar-water-golden.py`, a standard-library Python
re-implementation written from that recipe, reproduces all 26 checkpoints bit for bit (Python 3.13),
and reports the cell when one bit of a fixture is flipped. It is a consumer reference, not run in CI.

```bash
node scripts/generate-planar-water-golden.mjs contracts/golhex-planar-water-golden-v1          # write
node scripts/generate-planar-water-golden.mjs --check contracts/golhex-planar-water-golden-v1  # verify
npm test -- --run tests/unit/planar-water-golden-contract.test.js
python3 -I scripts/verify-planar-water-golden.py contracts/golhex-planar-water-golden-v1       # by hand
```

What passing establishes: this 2D water automaton on these two bounded box profiles, without the
open-system exchange. What it does not: any other frame shape or mask, snow/HQST/Collatz/genes, the
3D CVFD water model of `golhex-3d` (a different operator, not a slice of this one), or any physical
validity. `stepWater` is a game-style cellular fluid, not a calibrated flow model. `massFloat64` in
the fixture is a diagnostic: mass is conserved pairwise in exact arithmetic, and the binary32 store
leaves a drift below 1e-6 over these runs.

The life contracts v1 and v2 are untouched. If `sim-engine.js` changes, the generator refuses to
refresh: create a new contract version.
