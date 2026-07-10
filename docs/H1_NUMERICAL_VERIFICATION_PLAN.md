# H1 Numerical Verification Plan

Status: candidate evidence plan

## Purpose

This plan defines the minimum evidence required before the GolHex scalar-field mode may be called numerically verified. The current implementation is a conservative explicit finite-volume prototype for uniform regular hexagonal prisms, scalar uniform diffusivity and no-flux outer boundaries.

## Claims under test

1. Exact integer modes compute the declared integer function without unsafe coercion.
2. Hex topology is reciprocal, unique and schema-stable.
3. Scalar transport conserves total content in closed/no-source systems up to a declared floating-point tolerance.
4. Constant fields remain invariant.
5. The explicit method exhibits first-order time convergence for supported fixtures.
6. Boundary and heterogeneous-material extensions are admitted only after their own tests.
7. No claim of continuum isotropy is made without directional refinement evidence.

## Verification matrix

| ID | Fixture | Reference | Metric | Initial acceptance |
|---|---|---|---|---|
| H1-MATH-01 | `v2` reference vectors | exact BigInt | exact equality | 100% |
| H1-MATH-02 | unsafe Number boundary | language integer semantics | fail closed | all cases |
| H1-TOPO-01 | disk/ring counts | closed-form formula | exact equality | 100% |
| H1-TOPO-02 | neighbour reciprocity | graph invariant | violations | 0 |
| H1-TOPO-03 | duplicate/self neighbours | graph invariant | violations | 0 |
| H1-FVM-01 | constant field | analytic steady state | max abs change | <= 1e-14 |
| H1-FVM-02 | two vertically coupled cells | analytic exponential decay | observed order | 0.8–1.2 |
| H1-FVM-03 | manufactured time-dependent field | prescribed exact solution/source | observed order | 0.8–1.2 |
| H1-FVM-04 | closed system | conservation law | relative content drift | <= 1e-12 per report fixture |
| H1-FVM-05 | positivity-bound run | discrete maximum principle candidate | min/max violation | <= tolerance |
| H1-FVM-06 | directional impulse | refinement study | directional error | report, no preset pass until baseline |
| H1-BC-01 | Dirichlet | analytic stationary profile | L2/Linf error | defined with implementation |
| H1-BC-02 | Neumann | analytic flux/profile | flux residual | defined with implementation |
| H1-BC-03 | Robin | analytic mixed case | residual/error | defined with implementation |
| H1-MAT-01 | two-material interface | series resistance | flux/profile error | defined with implementation |
| H1-PERF-01 | target devices | measured benchmark | P50/P95 tick, memory | budget set before UI release |

## Analytic two-cell fixture

For two equal cells coupled through one face, let

`r = D * (A/d) / V`.

The semi-discrete equations are

`du1/dt = r (u2-u1)`

`du2/dt = r (u1-u2)`.

The mean is conserved and the difference obeys

`d(t) = d(0) exp(-2 r t)`.

Run explicit Euler with `dt`, `dt/2`, and `dt/4` at fixed final time. The error ratio should approach 2 and observed order

`p = log(E_dt/E_dt2) / log(2)`

should approach 1.

## Manufactured-solution fixture

Choose a bounded spatial vector `g_i`, constant offset `c`, and

`u_i*(t) = c + exp(-t) g_i`.

For the implemented spatial operator `L`, prescribe

`s_i(t) = -exp(-t) g_i - L(u*(t))`.

Then `du*/dt = L(u*) + s`. Integrate with source evaluated at the start of each explicit step. Verify first-order time convergence. This fixture tests the assembled operator and source semantics without claiming physical validation.

## Directional/grid study

A stacked Hexprism grid remains directionally biased. For an impulse, compare second moments and radial profiles in lateral and vertical directions over multiple cell sizes while holding the physical domain and final time fixed. Report:

- lateral and vertical effective variance;
- ratio and absolute error against the continuum diffusion target;
- convergence with refinement;
- dependence on prism aspect ratio.

FVM geometry weighting is not described as eliminating anisotropy.

## Boundary-condition API ADR requirements

Before implementation, define:

- boundary-face representation rather than ghost values hidden in renderer state;
- Dirichlet value and time dependence;
- Neumann outward flux sign convention and units;
- Robin coefficients and dimensional checks;
- contribution to the explicit stability bound;
- conservation accounting for prescribed boundary fluxes.

## Heterogeneous materials

For scalar diffusivities on an orthogonal face, use half-cell resistances:

`T_ij = A_ij / (d_i/D_i + d_j/D_j)`.

Do not use an unqualified arithmetic mean. Tensor anisotropy, skewed cells and non-orthogonal grids require a separate method decision such as MPFA, mimetic discretisation or FEM.

## Evidence package

Every report must contain:

- source commit and lockfile;
- experiment schema/version;
- exact parameters and units;
- backend/platform;
- raw error tables;
- convergence calculation;
- plots generated from raw data;
- acceptance result;
- negative findings and limitations;
- RO-Crate metadata once the experiment schema exists.

## Release wording

- Before this plan passes: `experimental conservative scalar transport`.
- After H1-FVM verification passes: `numerically verified for the stated fixtures and discretisation`.
- Only after measurement validation: `validated for the stated intended use and conditions`.
