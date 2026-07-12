# HexGol Mobile / PWA — Cross-Model Review Checklist

> Bounded **second-review lane** for the HexGol mobile / PWA release gates.
> Follow-up to the mobile PWA deploy audit (`HEXGOL_MOBILE_DEPLOY_AUDIT_2026-07-01.md`)
> and the 007 cross-family review lane. Resolves issue #116.

## Purpose

Give the mobile release gates an independent, **adversarial-constructive** second
opinion from a **different model family** than the one that produced the change.
Intended reviewer: **Gemini**, or another non-ChatGPT family when Gemini is
unavailable. This is a review *aid*, not an authority: CI checks (`unit`, `e2e`,
`mobile-render`) and human sign-off remain the only gates that can pass a release.

## When to run

- Before promoting a mobile/PWA change that touches: `public/sw.js`,
  `public/manifest.webmanifest`, `index.html` asset wiring, `vite.config.js`
  `base`, `src/main.jsx` SW registration, or `.github/workflows/deploy-pages.yml`.
- After a mobile PWA deploy audit, before the device-evidence gate.

## Guardrails (binding on the reviewer)

- Reviewer comments are **advisory only**.
- **No direct push to `main`** and **no PR merge** by the reviewer.
- **No automatic visual-baseline changes** (`test:e2e:update` is a deliberate human act).
- Every finding must **cite** a file, line, CI check, PR, or issue.
- **No "mobile-live" claim** without (a) a successful `deploy-pages` run for the
  reviewed head **and** (b) real-device evidence.

## Review scope + checklist

### 1. Manifest, scope, base path
- [ ] `manifest.webmanifest` is scope-safe: `start_url: "."`, `scope: "."`, relative icon `src` (no root-absolute `/…`). *(cf. `tests/unit/pwa-assets.test.js`)*
- [ ] `index.html` references manifest + icons via `%BASE_URL%…` (never `href="/…"`).
- [ ] `vite.config.js` `base` = `/HexGol/` under `GITHUB_PAGES=true`, `/` otherwise.
- [ ] Live check: `curl -sI https://marcohost33-maker.github.io/HexGol/manifest.webmanifest` → `200`.

### 2. Service-worker lifecycle + cache strategy
- [ ] SW registered **PROD-only** and API-guarded (`import.meta.env.PROD` + `"serviceWorker" in navigator`) with a base-safe `scope` (`src/main.jsx`).
- [ ] `CACHE_NAME` version is bumped whenever shell-cache semantics change (forces re-prime on `activate`).
- [ ] **Navigation requests are network-first** so a stale cached shell cannot trap an old app version (issue #115); static/hashed assets stay cache-first with an offline shell fallback (`public/sw.js`).
- [ ] Cross-origin requests are **not** cached (no opaque third-party font responses).
- [ ] `activate` deletes superseded `golhex-*` caches; `install` pre-caches only the shell.

### 3. GitHub Pages workflow
- [ ] `deploy-pages.yml` actions are **commit-SHA-pinned**; `permissions` limited to `contents:read, pages:write, id-token:write`; `persist-credentials: false` on checkout.
- [ ] Build runs with `GITHUB_PAGES=true`; artifact = `./dist`.
- [ ] Pages is enabled with **GitHub Actions** as source (`gh api repos/<owner>/HexGol/pages -q .build_type` → `workflow`).
- [ ] A `deploy-pages` run **succeeded** for the reviewed `main` head.

### 4. Mobile install checklist (device gate — human)
- [ ] **Android** (Chrome): install, offline reload, update activation after a new deploy.
- [ ] **iPhone/iOS Safari**: Add to Home Screen (manual, Share ▸ *Add to Home Screen* — no auto-prompt), relaunch, update behaviour. Note iOS storage caveats (Cache API ≈ 50 MB; script-writable storage may be evicted after ~7 days of non-use).
- [ ] Record device / OS / browser versions, date, result, and any limitations.

### 5. Knowledge transfer + drift
- [ ] Note **PR / NR candidates** worth extracting to the Coworkerz knowledge graph.
- [ ] Check for **duplicate/drift risk** after PR #113 and the closure of superseded PR #114 (two competing SW/deploy lanes must not coexist).
- [ ] Confirm docs (roadmap, AGENTS.md layout) match the shipped code (see #125).

## Gemini review prompt

> Review the HexGol mobile / PWA / deploy lane as an **adversarial constructive
> reviewer** from a non-ChatGPT model family. Scope: `public/sw.js`,
> `public/manifest.webmanifest`, `index.html`, `vite.config.js` (`base`),
> `src/main.jsx`, `.github/workflows/deploy-pages.yml`, and
> `tests/unit/pwa-assets.test.js`.
>
> For each of the five scope areas above, either confirm the gate is met with a
> cited file/line, or raise a concrete, reproducible finding. Pay special
> attention to: (1) the stale-shell update trap (does a fresh deploy's index.html
> reach an already-installed client?); (2) base-path correctness on the
> `/HexGol/` project subpath; (3) supply-chain hardening of the deploy workflow.
> Do **not** claim any mobile-live behaviour without a deploy run and real-device
> evidence. Output: a bulleted findings list, each tagged `[confirm]` or
> `[finding]`, with file:line citations. No code edits, no merge, no baseline
> changes.

## Web-founded references

- MDN — Web app manifests: install metadata (`name`, `short_name`, icons, `start_url`, `display`).
- web.dev — *Update* (PWA): keep `skipWaiting()` intentional; understand what the app shell caches and how users get updates.
- HTTP Archive Web Almanac 2025 — PWA chapter (service-worker + manifest adoption baselines).
- iOS/Safari PWA limitations (2025–2026): manual Add-to-Home-Screen, Cache API ≈ 50 MB, ~7-day script-writable storage eviction.

Sources:
- <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest>
- <https://web.dev/learn/pwa/update>
- <https://almanac.httparchive.org/en/2025/pwa>
- <https://brainhub.eu/library/pwa-on-ios>

---

*HexGol · docs/HEXGOL_MOBILE_PWA_CROSS_MODEL_REVIEW_CHECKLIST.md · resolves #116 ·
advisory second-review lane · CI + human gates remain authoritative.*
