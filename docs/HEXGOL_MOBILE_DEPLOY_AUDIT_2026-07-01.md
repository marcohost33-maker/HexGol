# HexGol Mobile Deploy Audit — 2026-07-01

Status: REVIEW-PATCH / deploy-ready only after CI + Pages source verification
Scope: HexGol v33.4.0 mobile/PWA/deploy hardening

## Auftrag

HexGol wie NIGIN kritisch pruefen, aktualisieren, GitHub-Stand validieren, blinde Flecken finden, Mobile/Handy-Update und Deployment-Pfad haerten, nach internen Methoden ausfuehren und ein 007-Handoff vorbereiten.

## Aktueller belegter Stand

- Repo: `marcohost33-maker/HexGol`, private, default branch `main`.
- Aktuelle App-Version in `package.json`: `33.4.0`.
- v33.4.0 wurde durch PR #112 gemerged.
- v33.4.0 deckt die Physik-Gradient/Spezies-CVD-Welle ab: CVD-Encoding fuer Physik-Modi, Okabe-Ito-Spezies-Familien, Lebenszyklus-Formen, Eck-Glyph, Inspect-on-Tap und Legenden-/Toggle-Verfeinerungen.
- Mobile-spezifische CI existiert: `.github/workflows/mobile-render.yml` prueft `mobile-hexshape` und `mobile-perf-budget` ueber den reusable coworkerz-ci Workflow.
- Manifest und iOS-Meta existieren in `index.html` und `public/manifest.webmanifest`.

## Kritische Luecken

### L1 — Kein belegter Deploy-Workflow im Repo

Es existieren CI-Workflows fuer Unit, Visual Regression und Mobile Render, aber kein eindeutig belegter Pages/Static-Deploy-Workflow. Damit ist nicht beweisbar, dass v33.4.0 auf dem Handy ausgeliefert ist.

### L2 — Kein belegter Service Worker

Manifest + Apple-Meta reichen fuer PWA-Anmutung, aber die robuste Installierbarkeit und kontrollierte Mobile-Update-Story brauchen Service Worker + Update-Mechanik.

### L3 — Subpath-/Custom-Domain-Frage offen

Aktuelle absolute Pfade sind fuer Custom-Domain-Root plausibel, koennen aber GitHub-Pages-Subpath-Deploys brechen. Vor Produktion muss klar sein: Custom Domain root oder `/<repo>/`.

### L4 — PR #112 hat keine sichtbaren Workflow-Runs am Merge-Commit

Der Merge-Commit v33.4.0 wurde als Release-Bump gemerged, aber die hier sichtbaren API-Abfragen zeigten keine Workflow-Runs/Statuses am Merge-Commit. Das ist kein Beweis fuer Failure, aber ein Deploy-/Status-Blindspot.

### L5 — AGENTS.md ist versionsstale

AGENTS.md beschreibt noch `Version: 31.0.0`, obwohl `package.json` `33.4.0` fuehrt. Das ist kein Runtime-Bug, aber ein Agenten-/Audit-Risiko.

## Externe Best-Practice-Anker

- web.dev: PWA-Installation basiert auf Web App Manifest und browserabhaengigen Kriterien; iOS/iPadOS haben keinen Browser-Prompt und nutzen Add-to-Home-Screen ueber das Share-Menue. Quelle: https://web.dev/learn/pwa/installation/
- MDN: Service Worker sind der programmierbare Proxy fuer Offline-/Cache-/Update-Faehigkeit. Quelle: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- MDN: Web App Manifest beschreibt Name, Icons, Start-URL, Display-Modus und weitere Installationsmetadaten. Quelle: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
- Vite: Static Deploy erzeugt `dist/`; GitHub Pages fuer Vite braucht korrektes `base`, Source `GitHub Actions` und einen Deploy-Workflow. Quelle: https://vite.dev/guide/static-deploy.html

## Produktionsreife Mobile-Definition

HexGol gilt als Mobile-Deploy-ready erst wenn:

1. `npm ci`, `npm test`, `npm run build` gruen sind.
2. Mobile Render CI gruen ist.
3. PWA manifest lint: `name`, `short_name`, `start_url`, `scope`, `display`, 192/512 icon vorhanden.
4. Service Worker registriert und fail-safe: App funktioniert ohne SW weiter.
5. Update-Mechanik vorhanden: neuer SW kann v33.4.0 ausrollen, ohne Endlos-Reload.
6. GitHub Pages oder anderes Hosting ist explizit dokumentiert.
7. Deploy-Workflow publiziert `dist/` und gibt die URL als Environment/Output aus.
8. iPhone/Android Reality-Check ist dokumentiert: Add-to-Home-Screen, Start, Canvas sichtbar, Touch/Long-Press, Snapshot/Share, CVD Toggle.
9. AGENTS.md/README-Status ist nicht versionswiderspruechlich.

## Naechster technischer PR

Ziel: `feat(pwa): add mobile install/update and pages deploy gate`.

Scope:

- Service Worker in `public/sw.js`.
- Registration-Modul in `src/lib/register-sw.js`.
- Import in `src/main.jsx`.
- Manifest subpath-sicher machen, falls GitHub Pages unter Repo-Pfad deployt.
- `vite.config.js` mit expliziter `base`-Policy.
- `.github/workflows/deploy-pages.yml` fuer `dist/` nach GitHub Pages.
- Docs/README: Mobile Deploy Runbook.
- AGENTS.md Version/Workflow-Liste aktualisieren.

## Fail-Closed-Regel

Nicht behaupten: "ist auf Handy aktualisiert", solange kein erfolgreicher Deploy-Run und kein realer Mobile-Check dokumentiert sind.

Korrekte Formulierung bis dahin:

> v33.4.0 ist im Repo gemerged. Mobile/PWA-Auslieferung ist vorbereitet/gehaertet, aber erst nach Deploy-Run + Handy-Check als ausgeliefert zu behaupten.

## 007 Challenge

Entscheidungspunkt: Soll HexGol auf GitHub Pages unter `https://marcohost33-maker.github.io/HexGol/` laufen oder auf einer Custom Domain/root path? Diese Entscheidung bestimmt `base`, Manifest-URLs und Service-Worker-Scope.
