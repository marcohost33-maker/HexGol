# todo/ — OFFENE_THEMEN (GolHex)

Lokaler Anschluss an das Vero-`OFFENE_THEMEN`-Board. Single-Source für
repo-lokale offene Punkte; strategische/übergreifende Themen laufen im
zentralen `OFFENE_THEMEN.md` (Vero Meta).

## Offene Themen (Stand 2026-11-19)

- **H1 Voll-Validierung** — `golhex-lab-core.js` hat interne Verifikations-Fixtures,
  aber keine vollständige Validierung (siehe `docs/H1_NUMERICAL_VERIFICATION_PLAN.md`).
- **Mobile/PWA Real-Device-Gate** — kein „läuft/validiert" ohne Beleg vom echten
  Ziel (`docs/HEXGOL_MOBILE_DEPLOY_AUDIT_2026-07-01.md`).
- **PWA network-first-Nav** — `index.html` NICHT als Offline-Shell cachen
  (bekannte NR-Klasse #126, torn shell vermeiden).
- **Geometrie/Mesh-Bridge** — validierte Export-Pipeline (ADR-001, Roadmap M3) offen.
- **Golden-Vector-Abnahme in golhex-3d** — Produzentenseite liegt vor: Life v1/v2 und
  Wasser v1 (`contracts/`). Offen ist die Konsumentenseite: `golhex-3d` muss die Fixtures
  unveraendert uebernehmen und gegen jeden Checkpoint pruefen (R03-Re-Audit 2026-11-19,
  `HEXGOL_PRODUCER_PARITY`). Weitere Profile (INT-Regeln, Masken/Rahmenformen, Schnee)
  erst bei Bedarf des Konsumenten.
- **Dependabot-Stau** — #208 (TypeScript 7), #213, #223–#226 offen; wie #221 in einer
  CI-Runde buendeln, TypeScript 7 getrennt bewerten.
- **Liegengebliebene PRs** — #175, #178 (CSP, September) und #198 (durch #218 ersetzt)
  entscheiden: mergen oder schliessen.
- **Repo-Standard-14** — Content-Materialisierung erfolgt (Welle 1); copier-Adoption
  (`.copier-answers.yml`) + Equalita-Verifikation + Marco-Content-Review offen.

> Erledigtes wird nach `archiv/` datiert verschoben, nicht still gelöscht.
> Priorisierung: Marco-zu-bestätigen.
</content>
