---
title: "GolHex World Kernel — Architecture Decision Record"
date: 2026-07-10
status: proposed
scope: GolHex Lab / future 3D, scan and manufacturing bridges
---

# GolHex World Kernel — hardened candidate architecture

## Decision

GolHex remains a **true hex-topology experiment system**, but it does not force every geometry, physics or manufacturing problem into one representation. The system is split into three explicit domains:

1. **GolHex logic domain** — axial hex topology, discrete states, rules, experiments.
2. **Numerical model domain** — a solver and discretisation selected for the model (cellular automaton, finite volume, ODE, wave, event simulation, later FEM/particles).
3. **Geometry/manufacturing domain** — SDF/TSDF, triangle mesh, or parametric B-Rep, depending on the required output.

A renderer is a read-only projection of authoritative state. A manufacturing export is a validated conversion pipeline, not a screenshot or a direct dump of visible cells.

## Audit of the proposed claims

| Claim | Verdict | Corrected decision |
|---|---|---|
| `(q,r,z)` stacked hex prisms are intrinsically more isotropic than cubic voxels in 3D | False as a general claim | A stacked prism grid has six lateral and two vertical neighbours and is directionally biased. Use finite-volume geometry factors and quantify residual grid error; use another mesh when the model requires it. |
| One scalar `kappa` makes the prism world perfectly isotropic | False | Derive pair conductance from face area, centre distance, material coefficient and cell volume. This is conservative; it does not erase discretisation anisotropy. |
| Rust/WASM alone guarantees cross-platform bit identity | False | Pin toolchain and WASM artifact, use an explicitly selected WebAssembly profile, control reductions and test golden vectors. Define reproducibility profiles rather than a universal promise. |
| `libm::sin` is automatically guaranteed bit-identical everywhere | Unsupported | Treat the selected/pinned implementation as part of the backend contract and verify it. For exact discrete modes avoid transcendental functions. |
| BigInt Q32.32 should drive every field simulation | Rejected for MVP | Use exact BigInt only for integer mathematics such as Collatz classes. Use Float64 for numerical fields, with stability, convergence and tolerance tests. |
| A Web Worker guarantees an uninterrupted 120 Hz clock | False | The simulation advances by fixed logical ticks. Wall-clock scheduling may be late or throttled; catch-up work is bounded and explicit. |
| `SharedArrayBuffer` gives universal zero-copy rendering | False/conditional | It requires secure cross-origin isolation and synchronization. Even with shared CPU memory, GPU buffer upload remains a transfer. Keep a copy-based fallback. |
| Second-order Kuramoto is the universal physical model | False | It is one inertial oscillator model. Diffusion, mechanics, agents and quantum-like modes use different model/solver pairs. |
| Surface Nets, Marching Tetrahedra or Dual Contouring automatically guarantees a printable manifold | False | Consistent decomposition reduces cracks but does not remove all topology, self-intersection, orientation, tolerance or manufacturability failure modes. Validate every result. |
| GLB can be passed to CadQuery as precise CAD | False | GLB is a runtime/viewing mesh format. Manufacturing mesh output should be 3MF; editable engineering geometry requires feature reconstruction and STEP/B-Rep. |
| An aperture-4/7 global hex hierarchy is a direct local CAD refinement tree | False | DGGS hierarchies are useful for global indexing, but are not an exact conforming Euclidean subdivision of one local engineering hex cell. Defer adaptive refinement until interfaces are formally defined. |
| A hash makes a world state tamper-proof | False | A hash is an integrity fingerprint. Authenticity requires a signature or trusted append-only record. |
| A classical probe should be described as a Heisenberg effect | False | Classical sensor back-action is an explicit transfer/force/heat model. Quantum measurement is a separate model family. |

## Current implementation slice: GolHex Lab core

The first implementation deliberately avoids UI and 3D dependencies. It provides two **tested initial foundations** that can be used by the existing React/Canvas application.

### A. Exact number field

For positive odd `n`:

```text
k(n) = v2(3n + 1)
```

The implementation uses `BigInt`; exact layers are disjoint (`k = 1`, `k = 2`, ...). Cumulative layers (`k >= r`) may be derived by the view but are not stored as independent classes. Number inputs are accepted only inside JavaScript's safe-integer range; larger values must be supplied as `bigint` or integer strings.

### B. Conservative scalar field

For a regular hexagonal prism with edge length `a` and height `h`:

```text
base area     = 3*sqrt(3)/2 * a^2
volume        = base area * h
lateral face  = a*h
lateral d     = sqrt(3)*a
vertical face = base area
vertical d    = h
```

For a shared face `i-j`, the current finite-volume transfer is proportional to:

```text
D * (A_ij / d_ij) * (u_j - u_i)
```

The implementation processes each undirected pair once and adds equal/opposite changes, so a no-source/no-flux system conserves total scalar content up to floating-point roundoff. The explicit step fails closed above a conservative positivity bound.

### Current numerical scope and limits

The implemented scheme is intentionally narrow:

- regular, uniform stacked hexagonal prisms;
- one scalar, spatially uniform, non-negative diffusivity;
- scalar isotropic diffusion only;
- explicit Euler time integration;
- no-flux outer boundary only;
- source values interpreted as rates `du/dt`;
- no claim of spatial order, physical validation or continuum isotropy yet.

The two-point flux form is appropriate for this orthogonal, scalar case. Heterogeneous materials require a defined face transmissibility, commonly based on the two half-cell resistances rather than a casual arithmetic average. Anisotropic diffusion tensors or skewed/non-orthogonal meshes require another discretisation such as MPFA, mimetic methods or FEM.

Before the field mode is called verified, add:

1. analytic/reference cases and a Method-of-Manufactured-Solutions fixture;
2. time-step convergence;
3. spatial refinement convergence;
4. explicit tests for Dirichlet, Neumann and later Robin boundaries;
5. heterogeneous-coefficient interface tests;
6. dimensional/unit validation at the experiment-schema boundary.

## Reproducibility contract

GolHex uses three named levels:

- **R1 semantic:** same events and conclusions within declared tolerances.
- **R2 numerical:** state differences stay within a versioned norm/tolerance budget.
- **R3 bitwise/backend-local:** identical bytes only for a pinned backend, artifact, execution mode and reduction order.

The core exposes a canonical-byte-order Float64 fingerprint and a quantized fingerprint. The quantized form fails closed if `value / quantum` exceeds JavaScript's exact safe-integer range. Neither fingerprint is a cryptographic signature.

## Data layout decision

For a bounded axial hex disk, use deterministic dense indexing and a precomputed neighbour table. Do not use Cantor pairing in the hot loop. The coordinate map is build/query metadata; solver iteration uses the dense neighbour table. A later sparse/adaptive domain may use chunks or a locality-preserving key, but only after benchmark evidence.

The solver-facing layout may be Structure-of-Arrays. The renderer receives derived packed Float32 instance data. Renderer writes never mutate the authoritative solver arrays.

## Solver registry

Each model declares its state, units, conservation laws, valid range, boundary conditions, stability constraints and compatible integrators.

| Model family | Initial solver policy |
|---|---|
| Boolean/INT cellular automata | synchronous discrete double buffer |
| Conservative scalar diffusion | explicit FVM with bound; later implicit/IMEX |
| First/second-order oscillator networks | selected ODE or symplectic method, model-specific |
| Unitary HQST mode | retain the existing tested Crank–Nicolson path |
| Agents/events | deterministic event queue plus continuous substeps where needed |
| Rigid/deformable mechanics | separate future backend; not approximated by Kuramoto |

A solver is admitted only with a declared model equation, state units, boundary conditions, invariants, stability policy and verification fixtures.

## Measurement protocol

A measurement event records:

```text
sensor model + calibration + footprint + latency + noise/bias + back-action + provenance
```

Three cases remain distinct:

1. passive query of simulated state;
2. sensor observation with noise but no modelled back-action;
3. active sensor whose force/heat/light/material interaction changes the next state.

A/B measurement studies reuse initial state, event log and random stream. They report solver error separately from intervention effect. `unknown`, `not measured`, `below detection limit` and numerical zero are separate states.

## Perturbation and chaos gate

A divergent pair is not by itself proof of chaos. A claim must survive:

- time-step and spatial-resolution convergence studies;
- precision/backend comparison;
- controlled perturbation size and renormalisation policy;
- ensemble runs;
- finite-time Lyapunov or other declared sensitivity metric;
- explicit separation of stochastic, numerical, parameter and model uncertainty.

Status vocabulary: `sensitive`, `numerically-unstable`, `stochastic`, `chaotic-candidate`, and only after evidence `chaotic-validated`.

## Geometry and manufacturing bridge

### MVP mesh path

For an engineering-independent scalar volume:

```text
versioned scalar field
-> globally consistent conforming cell decomposition
-> isosurface extraction
-> vertex welding and orientation
-> manifold/boundary/self-intersection checks
-> dimensional and manufacturing checks
-> 3MF for manufacturing or GLB for viewing
```

For the first exporter, investigate a **globally consistent prism-to-tetrahedra decomposition plus Marching Tetrahedra** before a custom prism Dual Contouring implementation. The diagonal choice must agree on every shared face; otherwise cracks remain possible. Marching Tetrahedra is an extraction method, not a printability proof. Feature-aware Dual Contouring remains an R&D track and must include a complete ambiguity policy, bounded QEF placement, sharp-feature tests and manifold validation.

A 3MF model mesh must satisfy manifold-edge and consistent-orientation requirements. Separate gates still check duplicate/degenerate geometry, self-intersection, units, minimum wall thickness, clearances, machine/material profile and repair provenance.

### CAD path

A triangle mesh is not parametric CAD. Engineering reconstruction is a separate path:

```text
scan/field -> segmentation -> feature fitting -> constraints -> B-Rep -> STEP
```

Do not claim exact holes, radii, fits, internal material or load capacity from an exterior phone scan without independent measurements and validation. glTF/GLB is retained for runtime viewing and animation, not as the authoritative engineering model.

## Scan bridge

The metric reconstruction source remains a calibrated point/depth pipeline (pose graph, loop closure, TSDF/SDF or occupancy, visibility and uncertainty). GolHex receives a projection of occupancy, signed distance, material hypothesis and confidence. Neural rendering may be a visual aid, never the sole metric manufacturing source without an accuracy benchmark.

The scan pipeline must report at least scale calibration, coverage, reprojection/depth residuals, hidden regions, confidence and an error map against a known calibration object before any manufacturing use.

## Product stages

1. **0.1a Number + conservative field core** — implemented and unit-tested.
2. **0.1b Numerical verification fixtures** — analytic/manufactured solutions, convergence and boundary conditions.
3. **0.2 Experiment record** — schema, units, event log, R1/R2 fingerprints and replay.
4. **0.3 UI adapter** — expose exact layers and verified field experiments through existing DOM controls.
5. **0.4 Perturbation Lab** — paired/ensemble runs and convergence reports.
6. **0.5 3D viewer** — optional lightweight renderer; no solver dependency on rendering.
7. **0.6 validated mesh prototype** — synthetic SDF fixtures first.
8. **0.7 calibrated-object phone scan benchmark** — metric error map.
9. **0.8 3MF print/rescan loop** — documented machine/material tolerances.
10. **1.0 versioned model registry and evidence gates**.

## Non-goals for 0.1

No universal world physics, no medical/MRI interpretation, no digital-twin claim, no feature-preserving CAD reconstruction, no neural scan dependency, no cross-platform bitwise promise, and no direct main-thread timing contract.
