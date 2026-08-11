---
name: reference-abnahme-engine-blind
description: G:\Meine Ablage\Vero\Tools\abnahme-protokoll.ps1 — als Gate strukturell blind; ERFUELLT belegt nur Prosa-Greps, nicht Verhalten. Nicht als Beleg annehmen.
metadata:
  type: reference
---

`G:\Meine Ablage\Vero\Tools\abnahme-protokoll.ps1` mit Definitionen unter
`G:\Meine Ablage\Vero\Meta\ABNAHMEN\*.json` ist Marcos Abnahme-Engine ("messbares Ziel -> Messung").
**Ein `ERFUELLT` dieser Engine ist kein Verifikations-Beleg.**

Grenzen, live falsifiziert am 2026-08-11 (`abnahme_golhex_9regel.json`):
- Der Gegenbeweis muss nur Exit != 0 liefern, nicht-trivial sein und ein Substanz-Token mit dem
  Pruefbefehl teilen. Alle 11 automatisierten Gegenbeweise dort suchen per Konstruktion unmoegliche
  Strings (`R10..R18`, `SCOPE.GIBTESNICHT`, `*-GIBTESNICHT.test.js`) und passieren alle drei Huerden.
- Zwei nachweislich FALSCHE Behauptungen wurden in meiner Kontrolldefinition als `ERFUELLT`
  gemeldet. Die Token-Huerde liess sich einmal allein durch das gemeinsame Cmdlet `Test-Path`
  erfuellen — Sprach-Keywords sind kein Gegenstands-Bezug.
- Die meisten Pruefbefehle sind `Get-Content`-Greps auf **Kommentare**. Damit haengt ein
  ERFUELLT an einer Formulierung: Kriterium G6 war auf 5ef2e7f gruen und ist auf a1409a7 rot,
  weil ein Kommentar umformuliert wurde — obwohl die Eigenschaft unveraendert blieb.

**Beim Pruefen:** ein protokolliertes "n ERFUELLT" immer gegen den Commit datieren, gegen den es
lief, und jedes Kriterium fragen: misst der Pruefbefehl Verhalten oder Text? Siehe
[[project-9regel-evaluator-stand]].
