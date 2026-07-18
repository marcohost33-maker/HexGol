# ADR-001 — Echte Hex-Topologie mit explizitem Domänen-Split

- **Status:** accepted (destilliert aus `docs/GOLHEX_WORLD_KERNEL_ADR_2026-07-10.md`, Status dort: proposed)
- **Datum:** 2026-07-18 (Erst-Materialisierung im ADR-Standard-Pfad)
- **Scope:** GolHex-Kern + zukünftige 3D-/Scan-/Manufacturing-Bridges

## Kontext

GolHex ist als Hex-Topologie-Automat entstanden. Bei der Erweiterung um Physik-
Modi, Numerik und (später) Geometrie/Manufacturing droht der Fehler, **jedes**
Problem in **eine** Repräsentation zu zwingen. Zwei konkrete Falsch-Claims wurden
im Kernel-Audit widerlegt: (a) gestapelte Hex-Prismen `(q,r,z)` seien intrinsisch
isotroper als kubische Voxel (falsch: 6 laterale + 2 vertikale Nachbarn → gerichtet
verzerrt); (b) ein skalares `kappa` mache die Prismen-Welt perfekt isotrop (falsch:
Paar-Konduktanz muss aus Flächen-, Distanz-, Material- und Volumen-Faktoren
abgeleitet werden — konservativ, aber löscht die Diskretisierungs-Anisotropie nicht).

## Entscheidung

GolHex bleibt ein **echtes Hex-Topologie-Experiment-System**, erzwingt aber keine
Einheits-Repräsentation. Der Kern wird in drei explizite Domänen getrennt:

1. **Logik-Domäne** — axiale Hex-Topologie, diskrete Zustände, Regeln, Experimente.
2. **Numerik-Domäne** — Solver/Diskretisierung je Modell gewählt (CA, Finite-Volumen,
   ODE, Welle, Event-Sim, später FEM/Partikel).
3. **Geometrie/Manufacturing-Domäne** — SDF/TSDF, Dreiecks-Mesh oder parametrisches
   B-Rep je nach gefordertem Output.

Ein Renderer ist eine **read-only Projektion** autoritativen Zustands. Ein
Manufacturing-Export ist eine **validierte Konvertier-Pipeline**, kein Screenshot
und kein direkter Dump sichtbarer Zellen.

## Konsequenzen

- Numerische Anisotropie wird **quantifiziert** (FVM-Geometrie-Faktoren), nicht
  wegdefiniert.
- Neue Fähigkeiten müssen ihr eigenes Evidenz-Gate passieren (siehe `docs/ROADMAP.md`).
- Single-Source-Engine (`src/lib/sim-engine.js`) bleibt regel-tragend; Cores sind
  pur + unit-getestet.

## Referenzen

- `docs/GOLHEX_WORLD_KERNEL_ADR_2026-07-10.md` (ausführlicher Audit, Quelle)
- `docs/H1_NUMERICAL_VERIFICATION_PLAN.md`
</content>
