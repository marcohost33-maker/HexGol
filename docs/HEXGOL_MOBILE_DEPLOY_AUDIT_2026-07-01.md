# HexGol Mobile Deploy Audit — 2026-07-01

Status: REVIEW-PATCH / keine Mobile-Produktionsfreigabe
Repo: marcohost33-maker/HexGol
Ziel: Handy-/Mobile-fähiger Deploy-Pfad mit PWA-Grundlage, GitHub Pages Workflow und klaren Release-Gates

## 0. Kurzurteil

HexGol ist fachlich und testseitig stark: React/Vite, Canvas-App, Mobile-Viewport-Projekte in Playwright, Unit-/E2E-Vertrag, visuelle Regression, SHA-gepinnte Actions und Branch-Protection-Konvention. Der aktuelle Mobile-/Deploy-Engpass liegt nicht primär in der Simulation, sondern im Veröffentlichungs- und Installationspfad:

- GitHub Pages Deploy-Workflow fehlte im sichtbaren Repo-Stand.
- Manifest existierte, war aber root-absolut (`start_url: "/"`, Icon-Pfade `"/icon..."`) und damit für GitHub-Pages-Projektpfade (`/<repo>/`) riskant.
- Ein Service-Worker-Asset fehlte im sichtbaren Repo-Stand; ohne Registrierung ist die PWA-Installations-/Offline-Kette nicht vollständig.
- `package.json` steht auf `33.4.0`, `package-lock.json` im sichtbaren Header noch auf `33.2.5`; das ist ein Release-Hygiene-Befund und muss separat korrigiert werden.

## 1. Validierter Ist-Stand

- Repo: `marcohost33-maker/HexGol`, private, default branch `main`.
- Paket: `hexgol`, Version `33.4.0`, Vite + React 19.2, Vitest, Playwright.
- `AGENTS.md` fordert PR-only, keine direkten Pushes auf main, required checks `unit` und `e2e`, keine Merge-Freigabe ohne grüne Gates.
- `index.html` referenziert Manifest und Icons bereits, nutzt `viewport-fit=cover` und Apple-Mobile-Meta.
- `public/manifest.webmanifest` existiert.
- `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png` existieren.
- `.github/workflows/unit-tests.yml` baut und testet mit Node 22.
- `.github/workflows/visual-regression.yml` fährt Playwright visual/e2e und enthält Mobile-Projekte im Playwright-Config.

## 2. Blinde Flecken / Lücken / Fehler

### F1 — Manifest war nicht projektpfad-sicher

Für GitHub Pages-Projektseiten liegt die Standard-URL unter `https://<owner>.github.io/<repo>/`. Root-absolute Pfade (`/manifest.webmanifest`, `/icon.svg`, `start_url: "/"`) zeigen dann auf die Owner-Root statt auf `/HexGol/`. Das ist für Mobile/Home-Screen-Installationen ein harter Pfadfehler.

### F2 — Kein sichtbarer Deploy-Workflow

Ohne `deploy-pages.yml` wird bei Merge nicht automatisch ein statischer Build nach GitHub Pages veröffentlicht. Das blockiert die Forderung „auf Handy/mobile update ist“.

### F3 — PWA-Kette unvollständig

Manifest + Icons reichen für Branding, aber robuste PWA-/Offline-Fähigkeit braucht zusätzlich einen Service Worker mit fetch handling und eine App-seitige Registrierung. Diese PR-Stufe legt das Worker-Asset an; die Registrierung im Entry bleibt als Blocker, weil der Tool-Sicherheitsfilter das Schreiben der Registrierungsstelle blockiert hat.

### F4 — Release-Hygiene: package-lock-Version hängt zurück

Der sichtbare Header von `package-lock.json` nennt noch `33.2.5`, während `package.json` `33.4.0` nennt. Das kann CI zwar nicht zwingend brechen, ist aber für reproduzierbare Release-Audits schlecht.

### F5 — Workflow-Dokumentation driftet

`AGENTS.md` sagt: kein `window.__TEST__`/Telemetry-Hook; `visual-regression.yml` kommentiert noch eine `__TEST__ bridge`. Das ist wahrscheinlich Kommentar-Drift, muss aber bereinigt werden, weil Testverträge in HexGol bewusst load-bearing sind.

## 3. Stärken

- Sehr starke Testkultur: Unit, Playwright, visual baselines, mobile project, deterministic screenshots.
- SHA-gepinnte Actions und zizmor-Orientierung.
- Branch-Protection-Konvention und Definition-of-Done sind explizit.
- Mobile-Layout ist bereits als einseitiges Handy-Layout dokumentiert und durch Playwright-Mobile-Projekte abgesichert.
- Canvas-/Touch-/Safe-Area-Themen wurden bereits detailliert behandelt.
- App hat manifestierte Icons und Apple-Touch-Basis.

## 4. Externe Best-Practice-Anker

- MDN: Web-App-Manifests liefern Browsern Installationsmetadaten wie Name und Icons; typische Manifest-Beispiele enthalten `name`/`short_name`, Icons, `start_url`, `display`, `theme_color`, `background_color`.
- Vite: Für GitHub Pages-Projektseiten muss `base` auf `/<REPO>/` gesetzt werden; für Owner-/Custom-Domain-Root kann `base` `/` bleiben.
- GitHub Pages: GitHub Pages hostet statische HTML/CSS/JS-Websites aus Repos und kann optional einen Build-Prozess ausführen.
- Chrome/Workbox: Precaching ist eine Kernaufgabe im Service Worker; für einfache Apps reicht konservatives App-Shell-Caching, komplexere Routing-/Caching-Strategien gehören in spätere Workbox-/injectManifest-Stufen.
- PWA-Security-Forschung 2025/2026: PWA-Installations- und Berechtigungsgrenzen sind browserübergreifend uneinheitlich. HexGol sollte daher keine stillen Berechtigungs-/Native-Claims machen und PWA als convenience layer, nicht als sicherheitskritische Verpackung behandeln.

## 5. In dieser PR vorbereitete Änderungen

- `vite.config.js`: GitHub-Pages-Basepfad über `GITHUB_PAGES=true` bzw. `VITE_BASE_PATH` steuerbar.
- `.github/workflows/deploy-pages.yml`: SHA-gepinnter Pages-Deploy-Workflow, Node 22, `npm ci`, Unit-Test, Build, Upload, Deploy.
- `public/manifest.webmanifest`: `start_url`/`scope` relativ gesetzt (`.`), Icons relativ gesetzt.
- `public/sw.js`: konservatives App-Shell-Worker-Asset erstellt.
- `tests/unit/pwa-assets.test.js`: Manifest-/Icon-Guards ergänzt.

## 6. Offene Blocker vor echter Mobile-Freigabe

1. Service Worker im Entry registrieren, z.B. in `src/main.jsx` nach dem React-Mount:

```js
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
```

2. `index.html`-Assetlinks projektpfad-sicher machen, ideal mit Vite-HTML-Base-Replacement oder relativen Links.
3. `package-lock.json`-Header auf `package.json` synchronisieren, vorzugsweise durch `npm install --package-lock-only` oder normalen `npm install` im Repo.
4. Workflow-Kommentar-Drift (`__TEST__ bridge`) korrigieren.
5. PR-CI vollständig abwarten: `unit` + `e2e` grün.
6. Erst nach grünem Merge läuft der Pages-Deploy auf `main`; danach mobile URL auf echtem Handy prüfen.

## 7. Produktionsreife Roadmap

### Phase A — Mobile Deploy RC

Ziel: installierbarer, deploybarer Mobile-Webstand ohne Behauptung echter Offline-Produktionsreife.

Gates:

- `npm ci` grün.
- `npm test` grün.
- `npm run build` mit `GITHUB_PAGES=true` grün.
- Manifest-Test grün.
- Icons vorhanden.
- Deploy-Workflow angelegt und SHA-gepinnt.
- Kein Merge ohne required checks.

### Phase B — PWA Completion

Ziel: vollständige PWA-Basiskette.

Gates:

- Service Worker wird in Production registriert.
- Service Worker scope == `import.meta.env.BASE_URL`.
- Offline-Fallback liefert mindestens App-Shell nach Erstbesuch.
- Keine Fremdorigin-/Font-Responses werden blind gecacht.
- Playwright-Smoke testet Manifest, SW-Registration und App-Mount.

### Phase C — Mobile Device Verification

Ziel: echter Handy-Beleg statt CI-Behauptung.

Gates:

- iPhone Safari: öffnen, Add to Home Screen, Start vom Homescreen, Canvas sichtbar, Controls nutzbar.
- Android Chrome: Install Prompt/Home-Screen, Start, Canvas sichtbar, Controls nutzbar.
- Offline nach Erstbesuch: App-Shell lädt oder zeigt ehrlichen Offline-Hinweis.
- Snapshot/Share und Record-Pfade behalten iOS-Caveats.

### Phase D — Release Hygiene

Ziel: reproduzierbarer Release.

Gates:

- `package.json` und `package-lock.json` synchron.
- Tag z.B. `v33.4.1-mobile-rc` nach Merge.
- Release Notes enthalten: Mobile/PWA, Deploy URL, bekannte Caveats.
- `AGENTS.md` und README Versions-/Deploy-Pfade aktualisiert.

### Phase E — Production Hardening

Ziel: wiederholbarer Mobile-Release-Prozess.

Gates:

- Lighthouse/PWA-Audit als optionaler Workflow oder manueller Nachweis.
- Bundle-size Budget dokumentiert.
- Pages-Deploy-URL als PR-/Release-Output sichtbar.
- Rollback: letzter grüner Pages-Deploy/Tag ist bekannt.
- 007-Log enthält Status, offene Blocker, genau eine Rückfrage/Challenge.

## 8. Entscheidung

Diese PR darf als `mobile-deploy-rc` betrachtet werden, nicht als vollständige Mobile-Produktionsfreigabe. Produktionsreif wird HexGol Mobile erst nach Phase B + C + D.
