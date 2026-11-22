# Changelog — GolHex

Format lose angelehnt an [Keep a Changelog](https://keepachangelog.com/).
Autoritative Version: `package.json` (`version`-Feld). Dieser Einstieg wird ab
jetzt fortgeschrieben; ältere Historie liegt als datierte Notizen in `README.md`
und `docs/` (z.B. Re-Konvergenz 2026-06-04, v31→v31.0).

## [Unreleased]

### Changed
- **BEHAVIOUR CHANGE — Watzlawick A5 "sym" now implements the documented rule**
  (owner decision E3, 2026-11-22; branch `vero/engine-a5-int-fixes`). With S = the largest same-coloured
  neighbour group and K = the remaining live neighbours, survival additionally requires
  `K <= S` and birth requires `S > K`; the active rule's B/S thresholds apply to the
  total neighbour count. Up to v33.5.0, "sym" replaced the threshold count with the
  same-coloured count and had no K/S condition, so the documented rule existed nowhere
  in the code. Patterns and saved states that use A5 = sym evolve differently. "komp"
  is unchanged.
- **BEHAVIOUR CHANGE — INT rules (Callahan o/m/p) classify two neighbours by their
  real angle.** The classifier read the neighbour-table index as a position around the
  cell; the table order is up-left, up-right, left, right, down-left, down-right, so e.g.
  left+right (180 deg) counted as "o". Additionally an A4 ghost neighbour now carries its
  direction: with exactly two neighbours, one of them a ghost, every INT condition used to
  block the cell. INT patterns evolve differently.
- **Stats: A1 spontaneous births are now counted in `births`** (found by Codex on
  PR #228). The simulation itself is unchanged.
- The planar golden contracts pin the engine blob; their vector bytes regenerate
  identically, only the pinned blob differs (open owner decision, see the PR).
- **License: MIT -> Apache-2.0** (2026-10-16, owner decision when the repository went
  public). `LICENSE` is the unmodified apache.org text (SHA-256 cfc7749b96f63bd3...),
  `NOTICE` names the copyright holder (Coworker Research / Coworkerz) and records that
  versions released before 2026-10-16 (through commit 6a451fd, v33.5.0) stay MIT-licensed.
  `package.json` and `CITATION.cff` declare Apache-2.0. The build emits `LICENSE` and
  `NOTICE` into `dist/`, so the deployed app carries them (Apache-2.0 section 4).

### Added
- Planar water Golden Vector contract v1 (`contracts/golhex-planar-water-golden-v1/`,
  `scripts/generate-planar-water-golden.mjs`): two bit-exact `stepWater` profiles (edge,
  box-torus) for `golhex-3d`, each with a counterexample. Fixture strength is gated in
  `unit`: a mutation check of `stepWater` (20 of 20 non-equivalent mutants noticed) and a
  standard-library Python re-implementation that must reproduce every checkpoint, while
  all-binary32 arithmetic must not. Known blind spot, documented: fused multiply-add on
  the binary64 intermediates is not detected (`pr_nr/NR-water-golden-fma-blind-spot.md`).
  No engine change.
- Repo-Standard-14-Anschluss: `00_landkarte/`, `docs/ROADMAP.md`,
  `docs/ADR/ADR-001-*`, `inventar/`, `pr_nr/`, `todo/`, dieser Changelog
  (Content-Materialisierung Welle 1, Marco-Content-Review offen).

## [33.4.0]

- Aktuelle autoritative Version laut `package.json`.
- Kern: Hex-CA + reell-wertige Physik (Schnee/Wasser/Collatz/Genetik) + HQST
  Quanten-Tight-Binding; Single-Source-Engine `src/lib/sim-engine.js`;
  ImageData-Raster-Fast-Path; opt-in off-main-thread Worker.
- H1 „GolHex Lab"-Kern (`golhex-lab-core.js`): BigInt-Collatz, Hexprisma-FVM,
  konservative Diffusion mit fail-closed Validierung (PR #122/#124).

> Frühere Versionsstände sind in Repo-Historie (git) + Release-Notes
> (`docs/release-notes-v17.14.md`) dokumentiert; retroaktive Voll-Backfill
> dieses Changelogs ist nicht erfolgt (bewusst — kein erfundener Verlauf).
</content>
