# Negative results & boundaries of validity — EVIDENCE_PACK_GOLHEX_WAVE_001

Honest record of where the solver / gates break. Source: `results/adversarial.csv`
(eigener-lauf, seed 1234567). These are DESIGNED failures used to bound the claim.

## N1 — Non-Hermitian H silently satisfies the linear solve but violates unitarity

Directed ring (forward-only adjacency) -> H is NOT Hermitian.

| dt | conv_all | residual_rel_max | norm_drift_max |
|---|---|---|---|
| 0.05 | true | 6.25e-10 | 3.03e0 |
| 0.20 | true | 3.20e-09 | 1.25e3 |

The Crank-Nicolson fixpoint **converges to machine precision** (residual ~1e-9) yet the norm
**explodes**. Lesson: a small O2 residual does NOT imply a physical (norm-conserving) evolution.
The O3 Hermiticity check is a *necessary, independent* precondition. Any future graph/boundary
that is not verified symmetric must be treated as invalid for a conservation claim.

## N2 — Over-large dt: fixpoint iteration diverges (correctly reported)

Hex 8×8 torus (degree 6), J=0.20, so rho(H) <= 6J = 1.2; convergence needs a·rho(H) < 1
i.e. dt < ~1.67.

| dt | a·(6J) | conv_all | blow_up | residual_rel_max |
|---|---|---|---|---|
| 1.0 | 0.60 | true  | false | 6.9e-6 |
| 1.5 | 0.90 | **false** | false | 1.2e-4 |
| 2.0 | 1.20 | **false** | **true** | 6.8e4 |
| 3.0 | 1.80 | **false** | **true** | 3.6e14 |

`solveCN` returns `false` at/above the convergence boundary; the evidence gate must treat
`conv=false` as a FAIL, never silently accept the (garbage) output. Confirmed: no config in the
main CI grid (all a·rho(H) <= ~0.6) triggers non-convergence.

## N3 — Degenerate spectrum does NOT break the solver

Ring_64, V=0 has many degenerate eigenpairs (-2J cos(2πk/64)). dt=0.2, 300 steps:
conv=true, norm_drift 1.5e-12, residual 1.0e-7. Degeneracy alone is not a failure mode here.

## Bounded-validity summary

- **Valid** for Hermitian H and a·rho(H) < 1 (rho(H) <= 6J + max|V|).
- **Invalid / not claimed** for non-symmetric adjacency (non-Hermitian H) or a·rho(H) >= ~0.9.
- The shipped solver trades exact unitarity for speed: a 60-iteration fixpoint to TOL 2e-6 leaves a
  residual ~2e-7 and a norm drift ~2e-5 — an exact linear solve would reach ~1e-13. This is a
  correctness/performance trade, documented, not a defect (still 200× below the 5e-3 protocol gate).

## Non-convergence is NOT a physical effect

Per protocol: any `conv=false` / norm blow-up is a **numerical** breakdown of the iteration, and is
never to be interpreted or labelled as a physical (e.g. gain/loss, topological) phenomenon.
