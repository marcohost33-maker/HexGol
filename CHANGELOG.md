# Changelog — GolHex

Format lose angelehnt an [Keep a Changelog](https://keepachangelog.com/).
Autoritative Version: `package.json` (`version`-Feld). Dieser Einstieg wird ab
jetzt fortgeschrieben; ältere Historie liegt als datierte Notizen in `README.md`
und `docs/` (z.B. Re-Konvergenz 2026-06-04, v31→v31.0).

## [Unreleased]

### Changed
- **License: MIT -> Apache-2.0** (2026-10-16, owner decision when the repository went
  public). `LICENSE` holds the unmodified Apache-2.0 text, `NOTICE` the copyright holder
  (Coworker Research / Coworkerz) and the transition note; copies obtained before
  2026-10-16 remain available under MIT. `package.json` declares `"license": "Apache-2.0"`.

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
