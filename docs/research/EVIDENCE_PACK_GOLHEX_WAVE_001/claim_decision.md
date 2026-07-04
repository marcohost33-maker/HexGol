# Claim decision — EVIDENCE_PACK_GOLHEX_WAVE_001

- Date: 2026-07-04
- Repo / base commit: `marcohost33-maker/HexGol` @ `62a565f316f74ac6057135ab36046a7710c62745`
- Solver under test: `src/lib/sim-core.js` (`applyH` + `solveCN`, Crank-Nicolson / Cayley)
- Executor: Codie (Coworkerz). **NOT self-certified** — Equalita ratification + Data ledger pending.

## Result tier

**`NUMERICAL_SOLVER_RESULT` — PASS (CI-bounded grid).**

> The GolHex HQST wave mode is numerically validated as a finite-graph tight-binding wave
> solver for the declared parameter range (J in [0.05, 0.20], dt in [0.025, 0.20], V in
> {0, 0.1}; ring / open-hex-patch / periodic-hex graphs; a*rho(H) < 1).

Herkunfts-Label of every number below: **eigener-lauf** (this pack, CI-bounded grid, seed 1234567),
reproducible via `commands.sh`. Node v24.17.0 / numpy 2.4.6 / scipy 1.17.1.

## Gate table (measured vs predeclared threshold)

| Gate | Predeclared | Measured (worst) | Verdict |
|---|---|---|---|
| O1 norm drift, Float32 | <= 5e-3 | **2.24e-5** | PASS |
| O1 norm drift, Float64 | <= 1e-4 | **2.24e-5** | PASS |
| O2 CN residual (rel), f32 | <= 1e-4 | **2.04e-7** | PASS |
| O2 CN residual (rel), f64 | <= 1e-4 | **1.85e-7** | PASS |
| O3 Hermiticity ‖H−H†‖_F | <= 1e-12 | **0.0** | PASS |
| ring spectrum vs analytic | <= 1e-10 | **3.9e-16** | PASS |
| CN-oracle (JS vs exact-CN), f64 | <= 5e-5 | **1.69e-6** | PASS |
| convergence order (fixed T) | >= 1.8 | **2.000** | PASS |
| main-grid non-convergence | 0 | **0** | PASS |

Diagnostic (recorded, not gated): O4 expm ED scheme error worst **4.59e-4** (grows as O(dt²), as
expected for CN); fixed-step-count order slope **~3.0** (= 3rd-order *local* truncation × fixed n).

## Why each gate is an INDEPENDENT oracle (not self-check)

- O3 / ring spectrum / CN-exact / expm ED are computed in **Python (numpy/scipy)** from the neighbour
  list only — **no shared code** with the JS solver (cross-language, cross-library).
- The eigenmode-phase gate uses a **closed-form** CN eigenvalue `exp(-i·2·atan(a·E_k)·n)`.
- O2 residual is recomputed in **exact float64** on the *returned* solution — it is the linear-system
  residual, **not** the solver's internal fixpoint increment.

## Falsification / boundary of validity (see negative_results.md)

- **Non-Hermitian graph** (directed ring): solver converges perfectly (residual 6e-10) yet norm blows
  up to ~1.25e3. Proves the residual gate alone is INSUFFICIENT; O3 Hermiticity is a *necessary*
  independent gate. Matches protocol fail-condition "graph symmetry assumptions not checked".
- **Over-large dt** (hex torus, a·rho(H) >= ~0.9): `solveCN` correctly returns `false`
  (dt=1.5 conv=false; dt>=2.0 conv=false + residual up to 3.6e14). Non-convergence is REPORTED,
  never silently passed.

## Explicit non-claims (overclaim block)

- This is **not** a physical spacetime, CMB, or real-quantum-hardware result.
- This is **not** a topological (Chern/Haldane) result; boundary type (open/torus/hex) is a graph
  choice, not a topological phase.
- Validity is bounded to `a*rho(H) < 1` and Hermitian H. Outside that region the scheme is not claimed.

## Maturity

PC/surrogate-verified (Node + Python oracle, CI-bounded grid). **Open:** Equalita L1 ratification,
Data ledger record, and `--full` extended grid (24×24 torus, dt=0.20, V=0.1) not run in CI.
