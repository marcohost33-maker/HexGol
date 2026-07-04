# EVIDENCE_PACK_GOLHEX_WAVE_001

First bounded `NUMERICAL_SOLVER_RESULT` of the HQST line: a verification & validation (V&V)
evidence pack for the **GolHex HQST wave mode** — a finite-graph tight-binding /
Schrödinger-like solver (Crank-Nicolson / Cayley) shipped in `src/lib/sim-core.js`.

Protocol: `marcohost33-maker/HQST` → `docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001_PROTOCOL.md`
(ALG-001). Executor: **Codie** — self-precheck only; Equalita ratification + Data ledger pending.

## Result

**`NUMERICAL_SOLVER_RESULT` — PASS** on the CI-bounded grid. See `claim_decision.md` for the full
gate table and the explicit block on physical / topological overclaims.

Worst-case measured (eigener-lauf, seed 1234567, Node v24.17.0 / numpy 2.4.6 / scipy 1.17.1):

| Observable | Worst | Predeclared gate |
|---|---|---|
| O1 norm drift (f32 / f64) | 2.24e-5 / 2.24e-5 | 5e-3 / 1e-4 |
| O2 CN residual (rel) | 2.04e-7 | 1e-4 |
| O3 Hermiticity ‖H−H†‖_F | 0.0 | 1e-12 |
| CN-oracle (JS vs exact-CN, f64) | 1.69e-6 | 5e-5 |
| convergence order (fixed T) | 2.000 | ≥ 1.8 |

## What makes the oracles independent

The **Python** oracle (`ed_oracle.py`, numpy/scipy) rebuilds H from the neighbour list and computes
Hermiticity, the exact-CN propagator, `expm(-iHt)`, and analytic ring spectra — **no shared code**
with the JS solver (cross-language / cross-library). The JS unit test adds a **closed-form**
eigenmode-phase oracle. The O2 residual is recomputed in exact float64 on the *returned* solution.

## Layout

```
evidence_runner.mjs   # drives the SHIPPED JS solver -> results/*.csv + ed_export.json
ed_oracle.py          # independent numpy/scipy oracle -> results/*.csv, exit 0 = pass
commands.sh           # reproduce from a clean checkout
model.yaml            # Hamiltonian, scheme, oracles, non-claims
parameters.yaml       # grids + PREDECLARED thresholds + PRNG/seed/initial-state
experiment_card.yaml  # provenance / status
environment.lock      # recorded versions + base commit
ro-crate-metadata.json# machine-readable dataset descriptor (RO-Crate 1.1)
results/              # CSV/JSON evidence (norm drift, residuals, ED, Hermiticity, order, adversarial)
logs/                 # runner + oracle summaries
checksums.sha256      # SHA-256 over results/ + logs/
claim_decision.md     # tier decision + gate table + overclaim block
negative_results.md   # falsification: non-Hermitian blow-up, dt-convergence boundary
```

CI coverage: `tests/unit/hqst-vv.test.js` runs the core gates (Hermiticity, unitarity, residual,
eigenmode phase, and both falsification gates) inside the required `unit` check.

## Reproduce

```bash
bash docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001/commands.sh
```

Add `--full` to the `node` step for the extended local grid (24×24 torus, dt=0.20, V=0.1).

## Bounds (see negative_results.md)

Valid for **Hermitian H** and **a·ρ(H) < 1** (ρ(H) ≤ 6J + max|V|). Non-Hermitian graphs break norm
conservation (correctly caught by O3); over-large dt makes `solveCN` **report** non-convergence
rather than silently pass. No physical / CMB / quantum-hardware / topological claim is made.
