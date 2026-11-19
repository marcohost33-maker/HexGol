# NR — Wasser-Golden-Vector erkennt FMA-Kontraktion nicht

**Datum:** 2026-11-19 | **Bezug:** `contracts/golhex-planar-water-golden-v1/`, PR #227

## Symptom

Die erste Fassung des Wasser-Vertrags verlangte vom Konsumenten "no fused multiply-add"
und legte nahe, der Vertrag pruefe das. Er prueft es nicht.

## Reproduzierter Mechanismus

`python3 -I scripts/verify-planar-water-golden.py contracts/golhex-planar-water-golden-v1 --arithmetic fma`
wertet `a + b * c` als eine fusionierte Operation aus (`math.fma`, Python 3.13) und
reproduziert trotzdem alle 26 Checkpoints bitgenau (Exit 0). Dieselbe Pruefung mit
`--arithmetic binary32` scheitert dagegen (Rand ab Tick 2, Torus ab Tick 1).

## Root-Cause

Die Zwischenwerte sind binary64, gespeichert wird binary32. Eine FMA aendert den
binary64-Zwischenwert um hoechstens eine Einheit der letzten Stelle. Das ueberlebt die
Rundung auf binary32 nur, wenn der Wert auf einer binary32-Rundungsgrenze liegt. In den
zwei Laeufen (2 x 12 Ticks, 36 Zellen) kommt das nicht vor.

## Konsequenz / Fix

- Die Aussage im Vertrag ist korrigiert: FMA auf den binary64-Zwischenwerten ist als
  **nicht erkannte** Abweichung ausgewiesen (`provenance.arithmeticControls`,
  `contracts/README.md`), nicht als gepruefte Bedingung.
- Der wahrscheinlichere Portierungsfehler (durchgehend binary32) ist gemessen erkannt
  und als Test verankert.
- Offen: ein Saatzustand, der eine binary32-Rundungsgrenze trifft, wuerde die Luecke
  schliessen. Er laesst sich nicht konstruieren, ohne den Vertrag auf einen Einzelfall
  zuzuschneiden; nicht umgesetzt.

## Falsifizierte Annahme

"Eine im Vertrag genannte Rechenvorschrift ist durch den Vertrag auch geprueft." Nur was
ein Gegenlauf mit der Abweichung tatsaechlich scheitern laesst, ist geprueft. Jede
Bedingung braucht ihre eigene Negativkontrolle; fehlt sie, gehoert die Bedingung als
ungeprueft markiert.
