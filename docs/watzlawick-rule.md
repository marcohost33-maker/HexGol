# Watzlawick-Regel (WZL) — die 5 Axiome als Zell-Transition

Eine GolHex-Regel, die Paul Watzlawicks **5 pragmatische Axiome der Kommunikation**
in eine **mathematische Transitionsformel** für hexagonale Zellen überführt.
Implementiert als `wzlRule` in `src/lib/hex.js`, ausgewählt als Regel **`WZL`**.

> Status: experimentelle, konzeptuell hergeleitete Regel. Die konkreten Schranken
> (Bänder, Schwellen) sind eine begründete Modellwahl und bewusst **tunebar** —
> sie sind kein „Beweis", sondern eine nachvollziehbare Abbildung der Axiome.

## Verfügbare Grössen pro Zelle (was die Engine liefert)

Jede Zelle hat im Hex-Gitter **6 Nachbarn**. Pro Schritt liefert die Engine:

| Symbol | Bedeutung | Wertebereich |
|---|---|---|
| `nc` | Anzahl **lebender** Nachbarn | 0 … 6 |
| `nR, nB, nY` | lebende Nachbarn je **Spezies/Farbe** (rot/blau/gelb), `nR+nB+nY = nc` | 0 … 6 |
| `alive` | lebt die Zelle selbst? | 0 / 1 |
| `age` | **analoges** Alter der Zelle (lebend = `ALIVE_T`=200, Trail klingt mit `FADE` ab) | 0 … 200 |

Daraus abgeleitet:

- **S = max(nR, nB, nY)** — die grösste **gleichartige** Nachbar-Gruppe → *symmetrisch*
- **K = nc − S** — die abweichenden Nachbarn → *komplementär*
- **ρ = S / nc** — **Beziehungs-Kohärenz** (1 = alle gleich, → 0 = zerstreut)
- **π = [ age ≥ 0,65 · ALIVE_T ]** — **Interpunktion**: 1, wenn die Zelle „etabliert" ist

## Die Regel (mathematische Formel)

Für eine Zelle gilt im nächsten Schritt:

```
GEBURT  (tot → lebend):
    nc ∈ {2, 3}   ∧   S > K   ∧   2·S ≥ nc            ( ⇔ ρ ≥ ½ )
    Farbe des Neugeborenen = dominante Spezies (cMix)

ÜBERLEBEN (lebend → lebend):
    2 ≤ nc ≤ (4 + π)   ∧   K ≤ S

SONST:
    Zerfall entlang des analogen Alters (age − FADE) → Tod
```

Als Prädikat (so in `wzlRule(nc,nR,nB,nY,alive,age)` implementiert):

```
alive=1:  survive ⟺  nc ≥ 2  ∧  nc ≤ 4 + π  ∧  K ≤ S
alive=0:  born    ⟺  2 ≤ nc ≤ 3  ∧  S > K  ∧  2·S ≥ nc
```

## Abbildung der 5 Axiome

1. **„Man kann nicht nicht kommunizieren."**
   Auch *abwesende* Nachbarn sind Teil des Felds: die Stille `6 − nc` zählt mit.
   **Isolation `nc < 2` = kommunikativer Kollaps** → kein Überleben, keine Geburt.
   Stille ist ein Signal, das unterdrückt — nicht ein neutrales Nichts.

2. **Inhalt & Beziehung (die Beziehung klassifiziert den Inhalt).**
   *Inhalt* = `nc` (wie viel kommuniziert wird). *Beziehung* = `ρ` (wie kohärent).
   Die Beziehung **gatet** den Inhalt: Geburt nur bei `ρ ≥ ½`. Und sie
   **klassifiziert** ihn: die dominante Spezies bestimmt die Farbe des Neugeborenen.

3. **Interpunktion der Ereignisfolge.**
   Eine *etablierte* Zelle (`π = 1`, hohes Alter) hat die Sequenz „interpunktiert"
   und ist robuster: die obere Dichte-Schranke steigt von 4 auf 5. Die Transition
   hängt damit von der **Geschichte** der Zelle ab, nicht nur vom Momentanzustand.

4. **Digitale & analoge Modalität.**
   Die **digitale** Entscheidung (Geburt/Überleben, binär) liest das **analoge**
   Feld (`age` via `π`). Beide Modalitäten koexistieren — exakt die `alive`-Flag
   (digital) + der `age`-Trail (analog) der Engine.

5. **Symmetrische vs. komplementäre Interaktion.**
   `S` (gleichartig, symmetrisch) vs. `K` (verschieden, komplementär). Überleben
   verlangt `K ≤ S` (Symmetrie wird nicht überstimmt); Geburt verlangt `S > K`
   (klare symmetrische Mehrheit). Komplementäre Übermacht destabilisiert.

## Implementierung

- `src/lib/hex.js` — `wzlRule(...)` (reine Funktion) + `RULES`-Eintrag
  `{ l: "WZL", B:[2], S:[2,3,4], fn: wzlRule }`. Das Feld **`fn`** macht aus der
  reinen B/S-LUT-Engine eine Formel-Regel; `B/S` dienen nur als Anzeige-Label/Fallback.
- `step()` (in `src/App.jsx`) und `classify()` (in `hex.js`) prüfen `RULES[ri].fn`:
  ist es gesetzt, ersetzt die Formel die `birthLUT`/`survLUT`-Abfrage. **Regeln ohne
  `fn` verhalten sich byte-identisch wie zuvor** (nur ein zusätzlicher Ternär-Check).

## Verhalten & Verifikation

- Direkt-Checks der Formel (Isolation kollabiert, Dyade gebiert, Saturation/Komplementarität
  sterben, Etablierte tolerieren mehr Dichte) bestätigt.
- `classify()`: WZL ist nicht-trivial und **distinkt** von B2/S34 (stabilisiert z.B.
  Strukturen, die B2/S34 sterben lässt). Tendiert für kleine Muster zu stabilen Still-Lifes.
- Alle 35 Unit-Tests grün; Visual-Regression läuft auf Regel 0 (unberührt).

## Tuning

Bewusste Modell-Parameter, die man variieren kann, ohne die Axiom-Struktur zu verletzen:
Geburts-Band `{2,3}`, Überlebens-Untergrenze `2` (Isolations-Schwelle, Axiom 1),
Dichte-Obergrenze `4` + Interpunktions-Bonus `+1`, Kohärenz-Schwelle `ρ ≥ ½`,
Etabliert-Schwelle `0,65·ALIVE_T`.

---
*GolHex · docs/watzlawick-rule.md · Coworkerz (Vero)*
