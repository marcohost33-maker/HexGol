# pr_nr/ — Problem-Recognition & Negativ-Resultate (GolHex)

Ablage für destillierte **Problem-Erkenntnisse (PR)** und **Negativ-Resultate
(NR)** dieses Repos: was gescheitert ist, welcher Root-Cause, und welche
Annahme dadurch falsifiziert wurde. Ziel: Wiederholungsfehler vermeiden
(recall-then-build).

## Konvention

- Ein Eintrag je Datei: `NR-<slug>.md` bzw. `PR-<slug>.md`.
- Struktur: Symptom → reproduzierter Mechanismus → Root-Cause → Konsequenz/Fix →
  falsifizierte Annahme.
- Belegpflicht: jeder Claim mit Tool-Output/Commit/PR-Referenz.

## Bekannte Repo-NRs (aus Bestand, hier verankert)

- **NR — `window.telemetry`/`window.perfStats`-Hook existiert nicht.** Frühere
  Docs behaupteten eine Test-Bridge; verifiziert PR#42, dass keine existiert.
  Konsequenz: e2e treibt reale DOM-Controls + `<canvas>`, kein globaler Hook.
- **NR — eingefrorenes Inline-Bundle in `index.html`.** Seit PR#31 bündelte
  `npm run build` `src/`-Änderungen nicht mehr, weil ein eingecheckter Inline-Bundle
  den Vite-Entry überschrieb. Fix: `index.html` = Vite-Entry (`/src/main.jsx`).
- **NR — Prismen-Isotropie-Fehlschluss.** Gestapelte Hex-Prismen sind NICHT
  intrinsisch isotroper als Voxel; skalares `kappa` macht sie nicht isotrop
  (ADR-001). Anisotropie quantifizieren, nicht wegdefinieren.

> Weitere NR/PR bei Bedarf ergänzen. Diese Liste ist ein Startpunkt aus dem
> Bestands-Wissen (AGENTS.md / ADR), nicht abschliessend.
</content>
