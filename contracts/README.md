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
