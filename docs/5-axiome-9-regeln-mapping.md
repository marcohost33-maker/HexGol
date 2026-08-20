# GolHex — Grounded Mapping: 5 Watzlawick-Axiome ↔ 9-Regel-Profil

Stand: 2026-08-13 · Status: DESIGN/SEMANTIC CROSSWALK · keine Äquivalenzbehauptung

## Quellen und Claim-Grenze

Die projektinterne kanonische Quelle für **„5 Axiome“** ist `docs/watzlawick-rule.md`:
Sie operationalisiert Paul Watzlawicks fünf pragmatische Kommunikationsaxiome in der
WZL-Zellregel. Das **9-Regel-Profil** ist separat in `src/lib/nine-rules.js` als allgemeineres
semantisches Profil mit STATE/TRANSITION/TRACE/CLASSIFIER-Geltungsbereichen definiert.

Diese beiden Systeme haben **verschiedene Gegenstände**. Deshalb bedeutet eine Kante in
dieser Matrix nicht `Axiom == Regel`. Sie sagt nur, welche 9-Regel-Semantik eine
Watzlawick-Operationalisierung voraussetzt, unterstützt oder teilweise überlappt.

Beziehungsarten:

- `PREREQUISITE` — notwendige Modellvoraussetzung, aber nicht Inhalt des Axioms.
- `STRONG_OVERLAP` — dieselbe beobachtbare/operationale Unterscheidung ist tragend.
- `SUPPORTING_OVERLAP` — relevante Teilsemantik, aber das Axiom enthält mehr.
- `NO_DIRECT` — keine belastbare direkte Korrespondenz; nicht aus Namensähnlichkeit mappen.

## Axiom-zentrierte Matrix

| 5-Axiom-Quelle | Projekt-Operationalisierung | Primäre 9-Regel-Beziehung | Zusätzliche Beziehung | Begründung / Grenze |
|---|---|---|---|---|
| **A1 — Man kann nicht nicht kommunizieren** | `6 - nc` (Stille/Abwesenheit) ist Teil des Feldzustands; Isolation `nc < 2` kollabiert | **R4 Unterscheidet — STRONG_OVERLAP** | R1 Ist — `PREREQUISITE` | A1 benötigt die Unterscheidbarkeit von Signal/Abwesenheit. R1 stellt nur einen gültigen Zustand bereit; R4 ist keine vollständige Kommunikationstheorie. |
| **A2 — Inhalt & Beziehung** | Inhalt=`nc`; Beziehung=`rho=S/nc`; Beziehung gatet Geburt und klassifiziert dominante Spezies | **R4 Unterscheidet — STRONG_OVERLAP** | R1 Ist — `PREREQUISITE` | Das aktive/strukturelle Klassifizieren in R4 ist der engste 9-Regel-Anker. Das 9-Regel-Profil enthält jedoch keine eigene Inhalts-/Beziehungsachse. |
| **A3 — Interpunktion der Ereignisfolge** | Alter/Geschichte (`pi`) verändert die zulässige nächste Transition | **R3 War — STRONG_OVERLAP** | R2 Wird — `SUPPORTING_OVERLAP`; R8 Ändert — `SUPPORTING_OVERLAP` | A3 ist explizit historieabhängig. R3 bindet Vorgeschichte; R2 Verlauf; R8 nur die konkrete intrinsische Zustandsänderung. Keine einzelne Regel bildet „Interpunktion“ vollständig ab. |
| **A4 — Digitale & analoge Modalität** | digitale alive-Entscheidung + analoges `age`/Trail koexistieren | **R4 Unterscheidet — SUPPORTING_OVERLAP** | R8 Ändert — `SUPPORTING_OVERLAP` | R4 kann Modalitäten auseinanderhalten, R8 deren Zustandsänderung beobachten. Das 9-Regel-Profil kodiert aber keine Digital/Analog-Typentheorie; daher keine starke Gleichsetzung. |
| **A5 — Symmetrische vs. komplementäre Interaktion** | `S=max(nR,nB,nY)` vs. `K=nc-S`; Überleben `K<=S`, Geburt `S>K` | **R4 Unterscheidet — STRONG_OVERLAP** | R1 Ist — `PREREQUISITE` | Die zentrale Operation ist Klassifikation zweier Beziehungsformen. R5 „Richtung“ ist **kein** Ersatz: räumliche Orientierung ist semantisch etwas anderes als symmetrisch/komplementär. |

## 9-Regel-zentrierte Gegenprüfung

| 9-Regel | Beziehung zu den 5 Axiomen | Urteil |
|---|---|---|
| **R1 Ist** | Voraussetzung für A1/A2/A5, aber kein Kommunikationsaxiom | `PREREQUISITE`, keine Entsprechung |
| **R2 Wird** | Verlaufskomponente von A3 | `SUPPORTING_OVERLAP` |
| **R3 War** | stärkster History-Anker für A3 | `STRONG_OVERLAP` |
| **R4 Unterscheidet** | trägt Signal/Abwesenheit (A1), Inhalts-/Beziehungsklassifikation (A2), Modalitätsunterscheidung (A4) und S/K-Klassifikation (A5) | mehrere Overlaps; nicht mit den vier Axiomen gleichsetzen |
| **R5 Richtung** | keine tragende Entsprechung | `NO_DIRECT` |
| **R6 Bewegt** | keine tragende Entsprechung | `NO_DIRECT` |
| **R7 Endet** | keine tragende Entsprechung | `NO_DIRECT` |
| **R8 Ändert** | Teilbezug zu A3/A4 | `SUPPORTING_OVERLAP` |
| **R9 Lebt** | **keine** Watzlawick-Entsprechung. Dass WZL in einem Cellular-Automaton läuft, macht „Leben“ nicht zum fünften Kommunikationsaxiom. | `NO_DIRECT` |

## Falsifikationsregeln für künftige Änderungen

1. Ein Mapping ist ungültig, wenn es nur aufgrund ähnlicher Wörter entsteht.
2. `R5 Richtung` darf nicht als A5 „symmetrisch/komplementär“ gemappt werden; das verwechselt
   räumliche Orientierung mit Beziehungstyp.
3. `R9 Lebt` darf nicht aus der Life-/CA-Metapher auf Watzlawick zurückprojiziert werden.
4. Ein neues starkes Mapping braucht eine explizite gemeinsame Observable/Operation in beiden
   Contracts, nicht nur philosophische Plausibilität.
5. Änderungen an `docs/watzlawick-rule.md` oder `src/lib/nine-rules.js` invalidieren diese
   Matrix bis zur erneuten Gegenprüfung.

## Bekannter SoT-Defekt

Zum Zeitpunkt dieses Mappings exportiert `src/lib/sim-engine.js` in `AXIOMS` nur A1–A4,
obwohl `docs/watzlawick-rule.md` eindeutig A1–A5 definiert. Das ist als Issue #147 erfasst.
Die Matrix groundet deshalb gegen die vollständige WZL-Dokumentation und behauptet **nicht**,
dass der aktuelle `AXIOMS`-Export bereits vollständig ist.
