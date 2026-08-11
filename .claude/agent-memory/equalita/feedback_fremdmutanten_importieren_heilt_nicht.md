---
name: feedback-fremdmutanten-importieren-heilt-nicht
description: Importierte Fremd-Mutanten in die eigene Sonde zu uebernehmen hebt den Score auf 100%, ohne die Testguete zu heilen — immer eine FRISCHE, ungesehene Liste fahren
metadata:
  type: feedback
---

Ein Mutation-Score gegen eine Liste, die der Autor kennt, misst nur, was der Autor bedacht hat.
Werden fremde Ueberlebende in die eigene Sonde **uebernommen**, steigt der Score auf 100 %, ohne
dass die Suite besser diskriminiert. Ein Nach-Verdikt muss deshalb IMMER eine frische, dem
Gepruefeten unbekannte Mutantenliste fahren.

**Why:** Belegt am GolHex-9-Regel-Modell (2026-08-11): meine ersten 7 Fremd-Mutanten ueberlebten
zu 5; Vero uebernahm genau diese fuenf als F1-F5, danach meldete die Sonde 18/18 = 100 %. Eine
frische Liste (E1-E20) fand sofort zwei echte Ueberlebende, die je ein definitives FAIL in ein
definitives PASS kippen. Das ist Teaching-to-the-Test, kein Guetenachweis.

**How to apply:**
- Neue Mutanten VOR dem Lesen der fremden Sondendatei entwerfen; danach nur noch auf Ueberschneidung
  pruefen und Doppelte streichen.
- Grenzwert-Mutanten (`>` -> `>=`) und Guard-Entfernungen sind die produktivste Klasse — sie
  ueberlebten hier beide.
- **Aequivalente Mutanten aussondern und benennen**: ein Ueberleben ist erst dann ein Befund, wenn
  ein beobachtbarer Ausgabeunterschied gezeigt ist (hier fielen 2 von 5 Ueberlebenden als
  aequivalent raus). Sonst meldet man eine Luecke, die keine ist.
- Sonden, die die Zieldatei umschreiben, nur auf einer Kopie ausserhalb des Repos fahren.

Siehe [[project-9regel-evaluator-stand]].
