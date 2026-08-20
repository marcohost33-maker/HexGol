# GolHex — Roadmap (Nordstern + Meilensteine)

> Kurz-Roadmap für den Repo-Standard-Anschluss. Die ausführliche Produktlinien-
> Roadmap liegt in `docs/GOLHEX_MASTER_ROADMAP_2026-07-10.md` (Status: candidate);
> dieses Dokument ist der destillierte Nordstern, kein Duplikat.

## Nordstern

GolHex wird zu einer **modularen Kausal-Experiment-Plattform mit echter
Hex-Topologie**: exakte diskrete Mathematik + konservative, modell-spezifische
Numerik + Experiment-Provenienz/Replay → 2D/3D-Visualisierung → validierte
Geometrie/Mesh-Rekonstruktion → (später) kalibriertes Scannen und
Print-/Manufacturing-Bridge. **Jede Fähigkeit wird erst nach ihrem eigenen
Evidenz-Gate zugelassen** — kein Feature ohne unabhängiges Orakel.

## Meilensteine (aus dem Repo abgeleitet)

1. **M1 — Kern stabil (erreicht/laufend).** Hex-CA + reell-wertige Physik + HQST
   norm-erhaltend; Single-Source-Engine `src/lib/sim-engine.js`; Unit-Parität
   (`stepLife`) + Playwright-Visual-Baselines grün. Version-of-Truth: `package.json`.
2. **M2 — H1 Lab-Kern verifiziert.** `golhex-lab-core.js`: BigInt-Collatz,
   Hexprisma-FVM (`FVM-01..06`), konservative Diffusion mit fail-closed Validierung;
   interne Verifikations-Fixtures (constant-field-Invarianz, diskretes Maximum-
   Prinzip, analytische Zwei-Zell-/Manufactured-Time-Konvergenz). Voll-Validierung
   offen (siehe `docs/H1_NUMERICAL_VERIFICATION_PLAN.md`).
3. **M3 — Geometrie/Mesh-Bridge.** Validierte Mesh-Export-Pipeline statt Zell-Dump
   (ADR-001 Domänen-Split); Evidenz-Gate vor Manufacturing.
4. **M4 — Mobile/PWA + Scan.** Real-Device-Gate (kein „läuft" ohne Beleg vom
   echten Ziel — vgl. `docs/HEXGOL_MOBILE_DEPLOY_AUDIT_2026-07-01.md`).

## Status

Reifegrad: **aktiv**. Detaillierte Priorisierung/Priorität → `todo/README.md`.
Änderungen an Zeitachse/Scope: Marco-zu-bestätigen (Entwurf abgeleitet aus Bestand).
</content>
