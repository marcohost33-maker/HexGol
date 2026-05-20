# GolHex v19.1 — Single-File Standalone (Coworkerz-Lineage)

Diese Variante ist eine **parallele, alternative Implementierung** von GolHex —
nicht ein Replacement für `src/App.jsx`. Sie lebt im Coworkerz-Single-File-React-
Pattern: alles in einer `.jsx`-Datei, baut zu einem standalone HTML-Bundle, kein
externer Server nötig.

## Files

- `golhex_v19_1.jsx` (~92 KB) — Single-File-Source (audit-driven, 13 Findings adressiert):
  - Buffer-Pool für Worker↔Main state-post (zero-alloc steady state)
  - Memoized Btn + stable callbacks (no toolbar re-render storm)
  - Gen-Counter-Dirty-Draw (safe alternative zum broken v18.5.2-Boolean-Dirty)
  - Delta-Sync für placePattern
  - Undo/Redo Snapshot-Pool
  - Touch-aware TAP_THRESHOLD
  - Page-Visibility-Auto-Pause
- `GolHex-v19.1-standalone.html` (~239 KB) — gebautes Single-File-Bundle
- `GolHex-v19.1-PWA.zip` (~83 KB) — PWA-Distribution

## Lineage

Lokal entstanden v18.x → v19.0 → v19.1 (2026-05-19/20) als experimentelle
Single-File-Architektur. Performance-Patterns extrahiert in
`Vero/Recherche/Allgemein/2026-05-20_react-worker-performance-patterns.md`.

## Verhältnis zur Hauptlinie

- **`src/App.jsx`** (Hauptlinie): React-App mit Tests, Workflows, lib/-Struktur
- **`experimental/v19.1/`** (diese Variante): Coworkerz-Single-File, Standalone-First

Beide sind GolHex, mit unterschiedlichen Distribution-Strategien. Welche zur
"kanonischen" wird, ist eine offene strategische Frage (siehe Vero/Vero Pläne/).
