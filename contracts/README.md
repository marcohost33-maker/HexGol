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
