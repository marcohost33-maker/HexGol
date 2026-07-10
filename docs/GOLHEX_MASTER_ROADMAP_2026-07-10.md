---
title: "GolHex Research, World, 3D, Scan and Manufacturing — Master Roadmap"
date: 2026-07-10
status: candidate
scope: HexGol/GolHex research and product line
owner_model: role-based
source_of_truth: GitHub code/tests/CI > accepted ADRs > Drive canon > working notes
---

# GolHex Master Roadmap

## 1. Purpose

GolHex is developed as a modular causal experiment platform with a true hex-topology identity. It is not one universal physics engine and not a direct replacement for CAD, FEM, a scanner pipeline, an avatar engine or a digital-twin platform.

The long-term product family connects:

1. exact discrete mathematics;
2. conservative and model-specific numerical simulation;
3. experiment provenance, replay and uncertainty;
4. 2D/3D visualisation;
5. geometry reconstruction and validated mesh export;
6. calibrated mobile scanning;
7. Tool3D-Print manufacturing and print/rescan optimisation;
8. later entity, avatar and digital-shadow/twin bridges.

Each capability is admitted only after its own evidence gate.

## 2. Canonical scope and exclusions

### Core identity

- axial hex topology for logical neighbourhoods and experiments;
- authoritative state independent from rendering;
- explicit model/solver registry;
- deterministic event ordering and replay;
- verification, validation and uncertainty evidence attached to every model;
- unknown, unmeasured, below-detection and numerical zero remain distinct;
- no scientific or engineering claim beyond the validated range.

### Non-goals until separate approval

- no claim that physical space is fundamentally hexagonal;
- no universal Hexprism-based continuum physics;
- no medical/MRI interpretation in the base product;
- no digital-twin label without a concrete real counterpart and synchronisation contract;
- no phone-scan claim for unseen internal geometry or material strength;
- no claim that a generated mesh is printable before manufacturing validation;
- no direct GLB-to-CAD equivalence;
- no cross-platform bitwise reproducibility promise without a pinned backend profile.

## 3. Current baseline

### Existing product/repository strengths

- mature HexGol application lineage, worker/performance work and test culture;
- real six-neighbour hex topology;
- multiple simulation modes including a tested HQST/Crank–Nicolson research path;
- visual, mobile-render and unit CI workflows;
- merged baseline (PR #122) adds exact Collatz classes and a small conservative scalar-field core.

### Merged #122 baseline status

PR #122 is merged (green `unit`/`e2e` CI + independent Equalita review: 549/549 unit tests, conservation drift 0.0, all negative-edge inputs throw). The implementation is an initial foundation, **not** a validated physical solver: spatial-discretisation accuracy beyond the two-cell manufactured-solution case is still an open verification gap (see H1).

Implemented scope:

- exact `v2(3n+1)` for positive odd integers with safe coercion;
- deterministic dense axial hex-disk stacks;
- precomputed six lateral plus two vertical neighbour slots;
- regular Hexprism geometry factors;
- explicit conservative scalar diffusion for uniform scalar diffusivity;
- no-flux exterior boundary;
- positivity-oriented explicit step ceiling;
- state comparison, canonical bit fingerprints and bounded quantised fingerprints;
- fail-closed world allocation cap.

Missing before numerical verification:

- analytic and manufactured reference solutions;
- time and space convergence;
- additional boundary conditions;
- heterogeneous material interfaces;
- unit/dimension schema;
- independent reference implementation;
- performance and memory benchmarks on target devices.

## 4. Findings from the last architecture iterations

### Retained

- renderer is read-only projection;
- exact integer mathematics uses BigInt;
- numerical fields use model-appropriate floating-point solvers with tolerances;
- FVM face geometry replaces arbitrary `kappa` tuning;
- solver registry replaces a universal Kuramoto/RK4 kernel;
- scan, mesh, CAD and manufacturing are separate bridges;
- perturbation is not called chaos without convergence and Lyapunov/ensemble evidence;
- hashes are integrity fingerprints, not authenticity proofs.

### Falsified or downgraded

- stacked Hexprisms are not intrinsically isotropic in 3D;
- FVM weights do not remove all grid anisotropy;
- Web Workers do not guarantee a real-time 120 Hz clock;
- SharedArrayBuffer is conditional and not GPU zero-copy;
- Rust/WASM or `libm` alone does not guarantee universal bit identity;
- BigInt fixed-point is not the default field-simulation representation;
- Surface Nets, Marching Tetrahedra and Dual Contouring do not automatically prove printability;
- H3/DGGS aperture hierarchies are not local conforming CAD refinement trees;
- inertial Kuramoto is one oscillator model, not a mechanics engine.

## 5. Programme structure

The programme is divided into twelve workstreams. Only W0–W4 are on the immediate critical path.

| ID | Workstream | Purpose | Depends on |
|---|---|---|---|
| W0 | Governance and evidence | Canon, claims, decisions, risks and release gates | none |
| W1 | Exact mathematics and topology | Integer modes, hex indexing, invariant topology | W0 |
| W2 | Numerical model laboratory | Verified FVM/ODE/wave/CA model implementations | W0, W1 |
| W3 | Experiment and reproducibility platform | Schemas, events, replay, provenance, UQ | W0–W2 |
| W4 | GolHex Lab UI | Small usable 2D experiment application | W1–W3 |
| W5 | Perturbation and diagnostics | A/B, ensembles, sensitivity, LiouScope bridge | W2–W4 |
| W6 | 3D scene and procedural geometry | Camera, shapes, transforms, fields-to-view | W3, W4 |
| W7 | Geometry bake and mesh QA | SDF/mesh extraction and geometry validation | W2, W6 |
| W8 | Mobile scan bridge | Calibrated capture, reconstruction and uncertainty | W3, W7 |
| W9 | Manufacturing bridge | 3MF/STL/STEP routing, Tool3D-Print, print/rescan | W7, W8, Tool3D-Print v1.2 |
| W10 | Entities and avatar bridge | Agents, bodies, animation and Nigin integration | W3, W6 |
| W11 | Digital shadow/twin | Real-object identity, synchronisation and control | W3, W8, W9 |
| W12 | Regulated research | Medical/MRI and other high-risk domains | separate governance approval |

## 6. Master roadmap

## Horizon H0 — Canonical reset and evidence baseline

**Objective:** convert the chat-derived concept into controlled programme artefacts.

Deliverables:

- accepted master roadmap;
- architecture decision index;
- terminology and claim-safety map;
- current-state inventory of code, tests, Drive artefacts and open PRs;
- model registry skeleton;
- risk and negative-results register;
- dependency map to LiouScope, Q-Forge, Scanner, Nigin and Tool3D-Print;
- explicit portfolio dependency: manufacturing integration follows the locked sequence DDE finalisation/export, P28/P29 unification, then Tool3D-Print v1.2.0.

Gate H0:

- one source-of-truth hierarchy;
- every item has owner role, status, evidence, next gate and dependency;
- no conflicting use of “validated”, “production-ready” or “digital twin”.

## Horizon H1 — Mathematical and numerical verification foundation

**Objective:** prove that the initial exact and diffusion modes compute what their specifications state.

### H1.1 Exact mathematics

- reference vectors for `v2`, Collatz exact classes and cumulative views;
- property-based tests over broad integer ranges;
- serialisation tests for bigint/string boundaries;
- independent slow reference implementation;
- performance limits and denial-of-service bounds.

Gate:

- exact agreement for all fixtures;
- no unsafe Number coercion;
- declared maximum input policy.

### H1.2 Topology

- neighbour reciprocity and uniqueness properties;
- disk count, ring count and coordinate conversion tests;
- layer boundary and vertical-neighbour tests;
- randomised topology property tests;
- memory profile for coordinate map versus packed indexing.

Gate:

- no invalid/self/duplicate neighbours;
- topology hash and schema version fixed;
- target-device memory budget met.

### H1.3 Scalar diffusion verification

- constant-field invariance;
- two-cell analytic decay;
- time-step convergence;
- spatial convergence on fixed physical domains;
- manufactured solution with known source;
- mass/content conservation;
- maximum-principle and positivity tests within declared conditions;
- Dirichlet, Neumann and Robin boundaries;
- heterogeneous scalar coefficients with resistance/harmonic face treatment;
- independent reference solver.

Gate:

- expected convergence behaviour demonstrated;
- conservation and boundary residual budgets met;
- validated numerical domain documented;
- no claim of continuum isotropy without directional refinement study.

## Horizon H2 — Experiment OS and reproducibility

**Objective:** make every result replayable, comparable and inspectable.

Deliverables:

- `golhex-experiment` schema with units, topology, model, solver, boundaries, seed, events and evidence version;
- append-only event log;
- deterministic event ordering;
- state snapshots and migration rules;
- R1/R2/R3 reproducibility profile field;
- canonical and tolerance fingerprints;
- provenance manifest containing source commit, build, platform and configuration;
- RO-Crate research package for benchmark and publication artefacts;
- negative-result and failed-experiment records.

Gate:

- clean-machine replay reproduces R1/R2 acceptance metrics;
- schema migration round-trip tests pass;
- experiment package contains code, config, input, output, metrics and provenance.

## Horizon H3 — GolHex Lab 0.1 product

**Objective:** a small, correct, useful application without premature 3D complexity.

Modes:

1. Exact Number Field;
2. Verified Conservative Field.

UI:

- radius/layers and units;
- source and boundary editor;
- start, pause, single-step, reset and replay;
- live stability and conservation diagnostics;
- exact table/reasoning view for number modes;
- experiment import/export;
- accessibility and keyboard support;
- no hidden renderer-to-state writes.

Quality gates:

- functional correctness and accessibility tests;
- target-device P50/P95 frame and tick metrics;
- visibility-gated benchmarks;
- simplest sufficiently fast renderer chosen using measured P95 results;
- existing two-layer rendering and fallback discipline preserved.

## Horizon H4 — Perturbation, sensitivity and uncertainty laboratory

**Objective:** distinguish dynamical sensitivity from numerical error and stochastic variation.

Deliverables:

- paired A/B runs with common random numbers;
- ensembles and parameter sweeps;
- finite-difference sensitivity with step-size study;
- finite-time Lyapunov candidate workflow with renormalisation policy;
- numerical error baseline from time/space refinement;
- parameter, measurement, model and numerical uncertainty separated;
- difference fields and causal event traces;
- LiouScope read-only diagnostic adapter.

Gate:

- no “chaos” classification from a single divergent pair;
- sensitivity result survives solver/refinement checks;
- uncertainty budget accompanies every claim.

## Horizon H5 — Model registry and additional verified solvers

**Objective:** expand complexity by adding models, not by overloading one equation.

Admission template per model:

- governing equation and intended use;
- state variables and units;
- topology/discretisation assumptions;
- solver and stability policy;
- conserved quantities/invariants;
- boundary conditions;
- reference and manufactured tests;
- validated range;
- prohibited uses;
- performance profile.

Candidate order:

1. reaction–diffusion;
2. damped wave equation;
3. first-order oscillator network;
4. inertial oscillator network;
5. existing HQST/Crank–Nicolson evidence consolidation;
6. event-driven agents;
7. mechanics only through a separate specialised backend.

## Horizon H6 — GolHex 3D Micro

**Objective:** make fields and procedural geometry spatially inspectable without changing solver truth.

Initial scene:

- 19 or 61 cells, optional layers;
- hex prism, sphere and cylinder primitives;
- translation, quaternion rotation and scale;
- camera, light and coordinate frame;
- height/colour/opacity mappings from state;
- play, pause, step and scrub snapshots;
- GLB for runtime/viewing scenes.

Architecture:

- renderer consumes immutable snapshots or versioned buffers;
- copy fallback is mandatory;
- SharedArrayBuffer is optional and deployment-gated;
- no direct physics state inside Three.js objects;
- no new heavy dependency without bundle, security and mobile benchmark.

Gate:

- renderer parity against 2D diagnostics;
- no simulation difference with renderer disabled;
- P95 interaction and render budgets on selected mobile/desktop targets.

## Horizon H7 — Geometry bake and mesh evidence

**Objective:** convert controlled scalar/SDF fixtures into validated meshes.

Stages:

1. synthetic analytic SDF fixtures: sphere, box, cylinder, torus and sharp-feature test;
2. globally consistent cell decomposition;
3. baseline Marching Tetrahedra research implementation;
4. welding, orientation and degeneracy cleanup;
5. boundary, manifold and self-intersection checks;
6. Hausdorff/distance error against analytic shape;
7. units and tolerance metadata;
8. GLB view export and 3MF manufacturing mesh export;
9. feature-preserving Dual Contouring only after baseline evidence.

Gate:

- zero unintended open/non-manifold edges;
- orientation and self-intersection checks pass;
- geometric error is below declared tolerance;
- repairs are logged and bounded;
- “printable” is granted only by the manufacturing bridge.

## Horizon H8 — Calibrated mobile scan benchmark

**Objective:** measure what phone scanning can reconstruct, not merely produce attractive meshes.

Pipeline:

- camera/intrinsic calibration;
- guided capture and coverage feedback;
- RGB/depth/IMU timestamp alignment where available;
- pose graph and loop closure;
- dynamic-object masking;
- TSDF/SDF or occupancy fusion;
- visibility and confidence field;
- surface extraction;
- scale calibration and error map;
- projection into GolHex analysis cells.

Benchmark objects:

- known cube and sphere;
- stepped gauge;
- holes and cylinders;
- matte versus difficult reflective/transparent surfaces;
- repeated scans under controlled lighting and distance.

Gate:

- declared device matrix;
- repeatability and accuracy distributions;
- hidden/unknown regions preserved as unknown;
- no manufacturing use beyond the validated feature and tolerance range.

## Horizon H9 — Tool3D-Print and closed manufacturing loop

**Objective:** establish a traceable scan/simulate/optimise/print/rescan loop.

Dependencies:

- Tool3D-Print v1.2.0 reached after the locked portfolio sequence;
- validated mesh fixtures from H7;
- calibrated scan benchmark from H8.

Pipeline:

- GolHex field/geometry handoff;
- format router: GLB viewing, 3MF printing, STEP/B-Rep engineering path;
- manifold, self-intersection, wall, clearance, overhang and machine-profile gates;
- print job provenance;
- post-print scan;
- registration and signed distance error map;
- optimisation objective with geometry, mass, print time and risk terms;
- bounded corrective iteration.

Gate:

- three repeated print/rescan cycles on calibration parts;
- dimensional error and repeatability budgets met;
- no silent repair or unit conversion;
- machine/material-specific evidence retained.

## Horizon H10 — Entities, humans and avatar bridge

**Objective:** support moving entities without conflating animation with mechanics or medical anatomy.

Tracks:

- generic rigid proxy entities;
- sensor/action/event interfaces;
- collision backend evaluation;
- path and behaviour models;
- Nigin avatar animation bridge;
- articulated body and rig representation;
- privacy-safe local storage and export controls.

Gate:

- deterministic replay for agent actions;
- animation and collision tests;
- no health, diagnosis or biomechanical accuracy claim.

## Horizon H11 — Digital shadow and twin maturity

Maturity labels:

- **Model:** purely virtual;
- **Replica:** linked to one captured object/version;
- **Shadow:** one-way updates from the real object;
- **Twin:** governed ongoing synchronisation;
- **Control Twin:** verified and authorised feedback to the real system.

Gate:

- stable real-object identity;
- calibration and synchronisation SLA;
- state freshness and uncertainty;
- audit log and access control;
- fail-safe behaviour before any control action.

## Horizon H12 — Regulated and medical research

This is a separate programme, not a normal feature wave.

Required before start:

- intended-use and regulatory classification;
- data protection impact assessment;
- consent, de-identification and access controls;
- clinical/domain partners;
- independent validation datasets;
- medical software lifecycle and risk standards as applicable;
- explicit non-diagnostic status until authorised.

## 7. Professional empirical workflow

Every research or engineering item follows the same evidence loop.

### Step 1 — Question and intended use

- state the decision the model must support;
- define users, environment and prohibited uses;
- write falsifiable hypotheses;
- define acceptance and rejection thresholds before implementation.

### Step 2 — Baseline and reference

- freeze current code/configuration;
- select analytic, manufactured, experimental or independent numerical reference;
- record known limitations and competing methods;
- define target devices and data sets.

### Step 3 — Experiment design

- independent variables, controls and confounders;
- sample sizes/repetitions where meaningful;
- time/space/precision refinements;
- random seed policy;
- metrics and statistical analysis;
- stopping and failure rules.

### Step 4 — Implementation

- smallest reversible PR;
- tests written with or before the implementation;
- no renderer or UI dependency in numerical kernels;
- explicit units and schemas;
- dependency/security review.

### Step 5 — Verification

- unit, property and metamorphic tests;
- analytic/manufactured solutions;
- convergence and conservation;
- reference implementation parity;
- fuzzing and malformed-input tests.

### Step 6 — Validation

- compare against measurements relevant to intended use;
- calibration data separated from validation data;
- report residuals and uncertainty;
- restrict the validated range.

### Step 7 — Uncertainty and sensitivity

- parameter, measurement, numerical and model uncertainty separated;
- sensitivity ranking;
- robust conclusions across plausible ranges;
- negative results retained.

### Step 8 — Performance and operations

- P50/P95/P99 latency, throughput, memory and energy where relevant;
- target-device matrix;
- cold start and long-run stability;
- hidden-tab/background behaviour;
- recovery, migration and rollback.

### Step 9 — Independent review

- code review by a different role/agent;
- claim review against evidence;
- reproducibility run from clean checkout;
- security and privacy review for relevant tracks.

### Step 10 — Release and archive

- signed/tagged release where applicable;
- SBOM, build provenance and dependency lock;
- RO-Crate experiment/evidence package;
- release evidence manifest;
- known limitations, negative results and rollback instructions.

## 8. Evidence levels

| Level | Meaning | Permitted wording |
|---|---|---|
| E0 | idea or untested claim | hypothesis, candidate |
| E1 | unit/property tests | implemented, internally tested |
| E2 | analytic/reference verification | numerically verified for stated fixtures |
| E3 | convergence, UQ and independent replication | evidence-supported within stated model domain |
| E4 | empirical validation for intended use | validated within declared conditions |
| E5 | production operational evidence | production-qualified for declared environment |

No component may inherit the evidence level of another layer. A valid solver does not validate a scanner; a manifold mesh does not prove printability; a calibrated scan does not prove material strength.

## 9. Quality and release gates

The release scorecard maps to current software product quality categories:

- functional suitability;
- performance efficiency;
- compatibility/interoperability;
- interaction capability and accessibility;
- reliability and recoverability;
- security;
- maintainability/testability;
- portability/adaptability;
- safety where relevant.

Every release candidate has measurable thresholds rather than adjectives.

Minimum production controls:

- protected main branch and required reviews;
- green deterministic CI matrix;
- dependency pinning and automated update policy;
- SAST, dependency and secret scanning;
- fuzz tests for parsers/kernels;
- reproducible build/provenance path;
- release artefact signing where applicable;
- security policy and incident process;
- telemetry is opt-in/minimal and privacy-reviewed.

## 10. Now / Next / Later execution plan

### NOW — WIP limit 3

1. **PR #122 follow-up verification** (baseline merged)
   - close remaining H1 numerical-verification gaps on the merged core;
   - spatial refinement study beyond the two-cell manufactured solution;
   - do not claim "numerically verified" until those gates pass.

2. **H1 numerical verification specification**
   - analytic two-cell fixture;
   - constant-field invariant;
   - manufactured solution design;
   - boundary-condition API ADR;
   - convergence report template.

3. **Programme canon**
   - approve this roadmap;
   - create model/claim/risk/negative-result registers;
   - reconcile with Drive `ROADMAP_NOW-NEXT-LATER`, open-themes board and GolHex lineage.

### NEXT

- implement H1 verification fixtures;
- define experiment schema and units;
- add property/fuzz tests;
- run mobile/desktop memory benchmarks;
- build the two-mode GolHex Lab UI adapter;
- package first RO-Crate evidence bundle.

### LATER

- perturbation/UQ laboratory;
- additional solver models;
- 3D Micro viewer;
- geometry bake benchmark;
- calibrated phone scan;
- Tool3D-Print bridge;
- entities/avatar;
- digital shadow/twin;
- regulated research.

## 11. Critical path

```text
Canon and evidence rules
  -> exact topology/math verification
  -> scalar solver verification
  -> experiment schema/replay/provenance
  -> GolHex Lab UI
  -> perturbation/UQ
  -> 3D viewer
  -> geometry bake validation
  -> scan benchmark
  -> Tool3D-Print manufacturing loop
  -> digital shadow/twin
```

Parallel but non-blocking research:

- HQST evidence consolidation;
- alternative solver research;
- avatar/Nigin interface design;
- LiouScope diagnostic adapters;
- future WASM/backend determinism evaluation.

## 12. Principal risks

| Risk | Consequence | Control |
|---|---|---|
| grand-scope expansion | no verified deliverable | WIP limit and evidence-gated horizons |
| visual plausibility mistaken for correctness | false scientific/engineering claims | renderer/state split and claim map |
| grid anisotropy | directional artefacts | directional benchmarks and alternative meshes |
| unstable/under-resolved solvers | fake butterfly effects | convergence and precision baselines |
| format confusion | invalid CAD/print output | fixed GLB/3MF/STEP roles |
| scan overclaim | unsafe reproduction | calibration, uncertainty and feature limits |
| silent mesh repair | changed geometry | repair provenance and bounded tolerances |
| dependency compromise | supply-chain risk | pinning, scanning, provenance and signing |
| private/medical data leakage | legal and safety harm | separate programme and privacy gates |
| documentation drift | conflicting truth | one canon and session-end update workflow |

## 13. Definition of final state

GolHex reaches top production quality only when:

- each active model has equation, units, solver, verification, uncertainty and validated-use documentation;
- experiments replay from clean environments with declared reproducibility profiles;
- UI, performance, security and accessibility gates are measured on target devices;
- scan and manufacturing claims are tied to calibration and machine/material evidence;
- releases include provenance, SBOM, evidence manifest and known limitations;
- digital-twin terminology is used only at the achieved synchronisation maturity;
- medical/high-risk use remains isolated until separately governed and validated.
