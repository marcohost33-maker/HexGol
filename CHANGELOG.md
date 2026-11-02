# Changelog — GolHex

Format lose angelehnt an [Keep a Changelog](https://keepachangelog.com/).
Autoritative Version: `package.json` (`version`-Feld). Dieser Einstieg wird ab
jetzt fortgeschrieben; ältere Historie liegt als datierte Notizen in `README.md`
und `docs/` (z.B. Re-Konvergenz 2026-06-04, v31→v31.0).

## [Unreleased]

### Changed
- **License: MIT -> Apache-2.0** (2026-10-16, owner decision when the repository went
  public). `LICENSE` is the unmodified apache.org text (SHA-256 cfc7749b96f63bd3...),
  `NOTICE` names the copyright holder (Coworker Research / Coworkerz) and records that
  versions released before 2026-10-16 (through commit 6a451fd, v33.5.0) stay MIT-licensed.
  `package.json` and `CITATION.cff` declare Apache-2.0. The build emits `LICENSE` and
  `NOTICE` into `dist/`, so the deployed app carries them (Apache-2.0 section 4).

### Added
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
