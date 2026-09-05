# GolHex — Threat-Model (leichtgewichtig)

Stand 2026-09-05. GolHex ist eine **rein clientseitige, statische Web-App/PWA**
(React + Canvas2D, Vite-Bundle) ohne Backend, ohne Login, ohne Nutzer-Accounts.
Dieses Modell ist bewusst minimal und bei Deploy-Änderungen neu zu prüfen.

## Datenklassifikation

- **Keine personenbezogenen Daten (PII).** Die App verarbeitet ausschliesslich
  lokal erzeugten Simulations-Zustand (Zellgitter, Physik-Parameter). Save/Restore
  (`savestate.js`) schreibt lokal (Browser-Storage/Download), nicht in die Cloud.
- **Kein Tracking / keine Analytics / keine Outbound-Requests** zur Laufzeit.
  Snapshots/Video (`snapshot.js`/`recorder.js`) bleiben lokal (Web-Share / Download).

## Trust-Boundaries + Risiken

| Grenze | Risiko | Mitigation |
|---|---|---|
| Statisches Hosting (PWA) | Stale/torn oder gemischte Service-Worker-Shell-Generation | build-revisioniertes, atomisches Precache von HTML-Shell + aktuellen Vite-Hash-Assets; network-first Navigation; HTML-Fallback ausschliesslich für Navigation; keine erzwungene `skipWaiting()`/`clients.claim()`-Übernahme |
| Supply-Chain (npm/Actions) | kompromittierte Dependency/Action | SHA-gepinnte Actions (zizmor), Dependabot, minimale Runtime-Deps |
| Client-Storage | lokaler Zustand von anderen lokalen Apps lesbar | keine Secrets gespeichert; nur Sim-State (nicht sensibel) |
| Worker/OffscreenCanvas | Feature-Detection-Fehler | fail-closed (`worker-support.js`) |

## Nicht im Scope

- Server-seitige Bedrohungen (es gibt keinen Anwendungsserver; statisches Hosting bleibt als Infrastruktur-Grenze relevant).
- Authentifizierung/Autorisierung (keine Accounts).
- Verschlüsselung ruhender Daten (keine sensiblen Daten gespeichert).

> Bei künftiger Aufnahme von Backend/Sync/Accounts ist dieses Modell zu
> überarbeiten (dann auch `DATA_CLASSIFICATION.md` ergänzen).
