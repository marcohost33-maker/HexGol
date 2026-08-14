# GolHex — Best Practices (repo-lokal)

Destilliert aus `AGENTS.md` (§1–§5 + Definition of Done) und der Test-/Numerik-
Disziplin des Kerns. Autoritativ bei Konflikt: `AGENTS.md` (Priorität §1 > §2 …).

## Numerik / Korrektheit

- **Single-Source-Engine.** Regel-Logik cohesiv in `src/lib/sim-engine.js`
  (`stepLife`, GRID_SIZES, buildNeighbors). Kein zweiter Wahrheits-Ort.
- **Regel-Eintrag ist last-tragend.** `step()` in `src/App.tsx` muss die aktive
  Birth/Survival-Regel ehren; eine Hälfte ohne die andere ändern korrumpiert den
  Automaten — Unit-Tests zusammen anpassen.
- **Unabhängiges Orakel statt Selbst-Bestätigung.** Boolean-Transition gegen
  Paritäts-Orakel (`tests/unit/step-life.test.js`); H1-Lab gegen constant-field-
  Invarianz, diskretes Maximum-Prinzip, analytische Zwei-Zell-/Manufactured-Time-
  Konvergenz. Anisotropie **quantifizieren**, nicht wegdefinieren (ADR-001).
- **Fail-closed Input-Validierung** an öffentlichen Kern-Grenzen (BigInt-Collatz,
  FVM-Bandbreite > 0) — Negativ-/Edge-Input ist Teil von „Done", nicht Nachtrag.

## Tests / Determinismus

- e2e treibt **reale DOM-Controls + `<canvas>`**; kein `window.telemetry`-Hook
  (existiert nicht, PR#42). Fixer Seed + statische (nicht-laufende) Zustände für
  reproduzierbare Screenshots; nicht auf Animation-Frame-Timing asserten.
- Visual-Baselines sind **beabsichtigt** — `test:e2e:update` nie zum Rot→Grün-
  Übermalen echter Regressionen. `maxDiffPixelRatio 0.03`.

## Bundle / Dependencies

- Keine schweren Runtime-Dependencies (Bundle-Grösse = getrackte Eigenschaft).
- GitHub-Actions SHA-gepinnt (zizmor-gated); Bumps via Dependabot-PR.

## Definition of Done (Kurz)

`npm test` exit 0 · `npm run build` schreibt `dist/` · CI `unit`+`e2e` grün ·
Engine-Regel-Änderungen tragen Unit-Tests · Visual-Baseline-Änderungen begründet ·
README bei Regel/Control-Änderungen aktuell.

> Web-fundierte SOTA-Ergänzungen (z.B. neue Numerik-Verfahren): Marco-zu-bestätigen
> vor Aufnahme — dies ist der destillierte Ist-Stand, kein Wunschkatalog.
</content>
