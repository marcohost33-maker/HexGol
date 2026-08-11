---
name: project-9regel-evaluator-stand
description: GolHex 9-Regel-Evaluator (src/lib/nine-rules.js + Adapter + Panel) — ausgeliefert auf main @ a1409a7 mit 10 offenen Equalita-Auflagen, darunter ein konstantes overall=FAIL
metadata:
  type: project
---

Das 9-Regel-Semantikprofil (`src/lib/nine-rules.js`, `src/lib/golhex-nine-rules-adapter.js`,
Panel in `src/App.tsx`) wurde am 2026-08-11 als PR #137 nach `main` gesquasht (a1409a7) und ist
live auf GitHub Pages — **auf einem FAIL-Verdikt, ohne Nach-Verdikt**. Das Nach-Verdikt lief am
2026-08-11 03:35 nach: 9 PASS / 12 FAIL / 1 UNVERIFIED, Auflagen B1-B10 im
`G:\Meine Ablage\Vero\Equalita\VERDIKT_LOG.jsonl`.

Die drei Befunde, die man beim Wiederaufgreifen zuerst kennen muss:
- **`bewerteGolHex()` liefert konstant `overall: FAIL`** (40'000/40'000 Zufallszustaende). Grund:
  `validState()` verlangt `s.q`, `baueTrace()` liefert bewusst kein `q` ("eine Population hat
  keinen Ort") -> R1 immer FAIL, und FAIL dominiert `andAll`. Die Adapter-Suite prueft `overall`
  nur negativ (`not.toBe(PASS)`) und ist deshalb blind dafuer.
- **R4 im Adapter misst den Simulationsmodus, nicht Unterscheidung**: `population(s)=[s.u,s.aktiv]`;
  in rval-Modi gilt `pop===active` (`src/App.tsx:1017`) -> immer FAIL, sonst fast immer PASS.
- **`stabilUeberTrace` ist fuer R3/R9/R2-ORDERED-mit-Fenster weiterhin gelogen** — die Urteile
  kippen bei Trace-Verlaengerung, obwohl sie als endgueltig ausgewiesen sind.

**Why:** Diese drei sind konstruktiv (Modellierung), nicht kosmetisch — sie ueberleben jeden
weiteren Test-Anbau, solange die Entitaetswahl "Population" mit einem ortsverlangenden R1 kollidiert.

**How to apply:** Vor jeder weiteren Arbeit am 9-Regel-Modell zuerst B1 (R1 vs. ortlose Entitaet)
entscheiden — alles andere haengt daran. Siehe [[feedback-fremdmutanten-importieren-heilt-nicht]]
und [[reference-abnahme-engine-blind]].
