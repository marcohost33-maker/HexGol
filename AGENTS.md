---
name: hexgol-agents-md
description: AI coding agent instructions for GolHex (hexagonal Game of Life)
version: "1.2"
last_updated: 2026-06-03
priority_when_in_conflict: 1
---

# AGENTS.md — GolHex

> AI Coding Agent Instructions. Tool-agnostic format per
> [agents.md](https://agents.md/) (Linux Foundation AAIF standard, Dec 2025).
> Read by Codex, Cursor, Goose and others. Claude Code does not read AGENTS.md
> natively (issue anthropics/claude-code#6235); see `CLAUDE.md`, which imports
> this file via `@AGENTS.md`. Coworkerz convention: AGENTS.md is the
> single-source-of-truth; `CLAUDE.md` is the thin import layer.

> **Priority when working agreements conflict:** lower number wins.
> §1 (working agreements) > §2 (conventions) > §3 (don't) > §4 (do) > §5 (when stuck).

## Project context

- **Stack:** JavaScript + Vite, React 19 (exact pins: `package.json`), Vitest 5 (unit), Playwright (e2e +
  visual regression). Package name `hexgol`, `"private": true`.
- **Purpose:** GolHex is a Carter-Bays **hex-topology cellular automaton**
  (Hexagonal Game of Life) with real-valued physics modes (snow, water, unitary
  HQST quantum wave), Safari trackpad support, and 16 classic hex birth/survival
  rules (`B2/S34` … `B1/S245`) plus INT and formula rules.
- **e2e contract (no `window` hooks).** There is **no** `window.telemetry` /
  `window.perfStats` bridge — earlier docs claimed one; it does not exist (verified
  PR#42). Playwright drives the app through **real DOM controls** (buttons like
  `Random`, `Start`, `Kreis`, the size `<select>`) plus the `<canvas>`, and asserts
  the *observable* contract: canvas mounts, controls present/usable, **zero
  console/page errors**, and stable **visual baselines** (canvas-only screenshots,
  `maxDiffPixelRatio 0.03`). Determinism comes from a fixed **seed** and **static
  (non-running) states** in the visual specs, not from a JS hook. The worker
  (`src/worker/render-worker.js`) posts an internal `telemetry` *message* to the
  main thread — that is a `postMessage` type, not a global test hook.
- **Version:** authoritative in `package.json` (the `version` field) — never
  hard-code the number here; engine + UI live in `src/App.tsx`;
  pure cores extracted to `src/lib/sim-core.js` (HQST applyH/solveCN) and
  `src/lib/hex-geom.js` (hex cube geometry), both unit-tested.
- **License:** MIT
- **Visibility:** PRIVATE (marcohost33-maker/HexGol)
- **KANON anchor:** `ENGINE-HEXGOL` in `Vero/Meta/KANON/KANON_APPS.yaml`
- **DEPLOY — es gibt genau EINE Live-URL: <https://golhex.pages.dev>**
  Cloudflare Pages, Projekt `golhex`. Kanonisch seit 2026-06-07 (`KANON_APPS.yaml`
  → `ENGINE-HEXGOL.web_deploy`). Build: `npm run build` → `dist/`, **ohne**
  `GITHUB_PAGES` (base bleibt `/`, die App liegt auf der Domain-Wurzel).
  **GitHub Pages ist abgeschaltet** (2026-08-11). Es existierte parallel unter
  `marcohost33-maker.github.io/HexGol/` und lief inhaltlich auseinander — am
  2026-08-11 wurde ein Deploy dort als erledigt gemeldet, während die echte App
  einen Monat alt war. Zwei Live-URLs für dieselbe App sind die Fehlerquelle, nicht
  die Redundanz. Wer „ist es live?" prüft, prüft **golhex.pages.dev** und
  vergleicht `/version.json` (`commit`) gegen `git rev-parse HEAD`.
  **Der Deploy läuft NICHT automatisch.** Das Pages-Projekt `golhex` hat keinen
  Git-Provider (`wrangler pages project list` → Spalte `Git Provider: No`); ein
  Merge auf `main` ändert an der Auslieferung nichts.

  **Der bequeme und sichere Weg ist der Doppelklick auf
  `Vero-Bats\golhex-cloudflare-deploy.bat`** — er holt `main`, setzt
  `DEPLOY_BUILD=1` und bricht bei jedem Fehlschlag ab. Wer von Hand ausliefert,
  muss **alle drei** Bedingungen selbst herstellen; jede einzelne kann sonst eine
  falsche Auslieferung erzeugen, die der `version.json`-Vergleich **nicht** auffängt:

  1. **`DEPLOY_BUILD=1`** — sonst bleibt der Herkunfts-Wächter in `vite.config.js`
     stumm, und `version.json` behauptet einen sauberen Commit, obwohl das Bündel
     uncommittete Änderungen enthält.
  2. **`HEAD == origin/main`** — der Wächter prüft nur auf uncommittete Änderungen,
     **nicht auf den Branch**. Aus einem sauberen Feature-Branch heraus geht sonst
     ungemergter Code als `main`-Deployment live, und der Vergleich
     „live gegen `git rev-parse HEAD`" besteht trotzdem — er vergleicht ja denselben
     Checkout mit sich selbst.
  3. **Abbruch bei Build-Fehler** — Build und Upload müssen verkettet sein. Der
     Wächter wirft beim Laden der Vite-Konfiguration, also **bevor** `dist/` geleert
     wird; ohne Verkettung lädt der nächste Befehl das alte Bündel hoch und macht
     aus fail-closed ein fail-open.

  ```bat
  REM  Windows (cmd) — && bricht die Kette bei jedem Fehlschlag ab
  git fetch origin && git rev-parse HEAD > "%TEMP%\h.txt" && git rev-parse origin/main > "%TEMP%\m.txt" || exit /b 1
  fc "%TEMP%\h.txt" "%TEMP%\m.txt" >nul || ( echo HEAD ungleich origin/main -- Abbruch & exit /b 1 )
  set DEPLOY_BUILD=1
  npm run build && npx wrangler pages deploy dist --project-name=golhex --branch=main
  ```
  ```powershell
  # PowerShell
  git fetch origin
  if ((git rev-parse HEAD) -ne (git rev-parse origin/main)) { throw "HEAD ungleich origin/main -- nicht ausliefern" }
  $env:DEPLOY_BUILD = "1"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen -- kein Upload" }
  npx wrangler pages deploy dist --project-name=golhex --branch=main
  ```
  ```bash
  # bash/zsh
  git fetch origin
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "HEAD ungleich origin/main"; exit 1; }
  DEPLOY_BUILD=1 npm run build && npx wrangler pages deploy dist --project-name=golhex --branch=main
  ```

  Am bequemsten ist der Doppelklick auf `Vero-Bats\golhex-cloudflare-deploy.bat` —
  er setzt die Variable bereits. Das gilt für **alle 13** Cloudflare-Pages-Projekte
  des Portfolios: keines ist git-angebunden (enumeriert am 2026-08-11). Solange das
  so ist, ist „gemergt" **kein** Beleg für „ausgeliefert"; nur `/version.json` ist
  einer — und der Beleg taugt nur, wenn der Wächter beim Bauen scharf war.

## Repository layout

```
index.html                # app entry
vite.config.js            # Vite build config
playwright.config.ts      # e2e + visual-regression config
src/
  ├── App.tsx             # UI + main-thread loop: step()/draw() honour the active
  │                       #   birth/survival rule (load-bearing); imports the engine
  ├── main.jsx            # React entry
  ├── lib/
  │   ├── sim-engine.js   # SINGLE-SOURCE engine: rules, GRID_SIZES, buildNeighbors,
  │   │                   #   boolean stepLife (unit-tested parity), all rval steps
  │   │                   #   (snow/water/HQST/collatz/genes), colours
  │   ├── sim-core.js     # HQST tight-binding applyH + Crank-Nicolson solveCN
  │   ├── hex-geom.js     # hex cube-coordinate geometry (Red Blob Games)
  │   ├── raster-render.js# shared ImageData raster path (main + worker, no copy-drift)
  │   ├── snapshot.js     # pure share/download dispatcher + filename/watermark (Web Share L2)
  │   ├── recorder.js     # pure recorder state machine + codec negotiation + mockable
  │   │                   #   captureStream/MediaRecorder controller (Feature 2 video)
  │   ├── worker-support.js# OffscreenCanvas feature-detection (fail-closed)
  │   ├── golhex-lab-core.js# H1 "GolHex Lab" core: exact BigInt Collatz layer,
  │   │                   #   dense axial hex-prism stacks, Hexprism FVM geometry,
  │   │                   #   conservative scalar diffusion + positivity step ceiling,
  │   │                   #   fail-closed input validation (PR #122/#124)
  │   ├── hex-render.js   # hex canvas rendering path
  │   ├── cell-style.js   # cell colour/style helpers
  │   ├── presets.js      # rule/scene presets
  │   ├── hexforge-2d.js  # Issue #128: deterministic 2D silhouette->cell-mask
  │   │                   #   adapter (6 parametric shapes, gates fail-closed,
  │   │                   #   golden hashes in tests/unit/hexforge-2d.test.js)
  │   ├── popgraph.js     # population-graph overlay
  │   ├── savestate.js    # save/restore world state
  │   ├── ui-gestures.js  # pointer/trackpad gesture handling
  │   ├── ConwayIntro.jsx # square-Conway intro overlay
  │   └── Splash.jsx      # splash screen
  └── worker/
      └── render-worker.js# AP-1: opt-in off-main-thread sim+render (Stufe 1)
tests/                    # Vitest unit + Playwright e2e + visual baselines + manual/
  └── unit/
      ├── golhex-lab-core.test.js         # H1 lab-core unit + fail-closed edge tests
      └── golhex-lab-verification.test.js # H1 verification fixtures: constant-field
                                          #   invariance, discrete maximum principle,
                                          #   analytic two-cell + manufactured time
                                          #   convergence (internal, not full validation)
experimental/             # spikes — not shipped in the main bundle
docs/
.github/workflows/
  ├── unit-tests.yml         # primary CI — Vitest (required check: unit) — PR only
  ├── visual-regression.yml  # Playwright visual baselines (required check: e2e) — PR only
  ├── mobile-render.yml      # 2 mobile render/perf specs (reusable) — PR only
  ├── update-snapshots.yml   # snapshot refresh helper
  ├── encoding-guard.yml     # UTF-8 / line-ending guard
  └── zizmor.yml             # workflow security audit (SHA-pinned)
```

## Build / test commands

**Node:** `^22.22.2 || ^24.15.0 || >=26.0.0` (`package.json` → `engines`). Node 20 is
end-of-life since 2026-04-30 and is rejected by the locked toolchain (jsdom 30,
undici 8, jest-dom 7). The range is the one every `engines.node` in
`package-lock.json` accepts; `tests/unit/toolchain-contract.test.js` fails if the
promise and the lockfile drift apart, or if a CI `setup-node` leaves the range.
Regenerate the lockfile with **npm ≥ 11** (`npx npm@11 install …`): npm 10 strips
the `libc` fields from `package-lock.json`, and npm 11 `--package-lock-only` does
**not** restore them once lost (measured 2026-09-27). The same test compares
`os`/`cpu`/`libc` of every installed package against its lock entry, so a stripped
lockfile turns `unit` red. Dependabot itself runs npm 11 and keeps the fields.
Packages that pin each other exactly via `peerDependencies` (today
`vitest` ↔ `@vitest/coverage-v8`) must share one Dependabot group; the test derives
those pairs from the lockfile.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static bundle in dist/
npm run preview      # serve dist/ on http://localhost:4173

npm test             # unit tests (Vitest, run-once)
npm run test:watch   # vitest watch mode
npm run test:e2e     # builds first, then Playwright + visual baselines
npm run test:e2e:update   # refresh Playwright snapshots (use deliberately)
```

## §1 Working agreements

1. **Branch protection active.** `main` requires the CI checks `unit` and `e2e`
   to be green. No direct pushes; PRs only. (`enforce_admins: true` — the rule
   applies to User1 as well; a direct push is rejected by the protection hook.
   `required_reviews: 0`, so a green PR can be self-merged.)
   **Gates live on the PR.** Since 2026-08-11 the **test and deploy** workflows no
   longer run on `push: main` — there they judged an already-merged commit and could
   prevent nothing. All gating happens on the pull request. A merge therefore runs no
   test job; `encoding-guard` and `zizmor` still fire on `push: main` when the merge
   touches `.github/**`, which is intended (they guard the workflow files themselves).
   **Stacked PRs are tested too.** `unit-tests.yml`, `visual-regression.yml` and
   `mobile-render.yml` trigger on *every* `pull_request`, not only those based on
   `main` (since 2026-09-27; #185 was merged into an unprotected intermediate
   branch without `unit`/`e2e` ever running). On such a branch the checks are
   visible but not enforced — only `main` has branch protection.
2. **Backup-First on destructive ops.** Before any `git push --force`, branch
   delete, or ref-PATCH: capture pre-SHA, run the op, verify post-SHA.
3. **Visual baselines are intentional.** Do not blanket-run
   `test:e2e:update` to make red turn green. Update a snapshot only when the
   visual change is the *intended* result of your diff, and say so in the PR.
   **Snapshot-refresh trigger gotcha:** `update-snapshots.yml` commits refreshed
   baselines back to the branch using the implicit `GITHUB_TOKEN`. A push made
   with `GITHUB_TOKEN` does **not** trigger further workflow runs (GitHub's
   recursion guard), so after that bot commit `gh pr checks` shows
   *"no checks reported"* and the required `unit`/`e2e` checks never run on the
   new head. **Fix:** close + reopen the PR (`gh pr close N && gh pr reopen N`) —
   this fires `pull_request: reopened`, which re-runs the checks PR-attached.
   (`gh workflow run --ref <branch>` runs them too, but as `workflow_dispatch`,
   not attached to the PR's required-check gate.)
4. **The rule entry is load-bearing.** `step()` in `src/App.tsx` honours the
   active birth/survival rule (B/S thresholds + INT configuration constraints);
   changing one half without the other corrupts the automaton. Add/adjust unit
   tests together. The boolean transition core now lives in `src/lib/sim-engine.js`
   `stepLife` (pure, guarded by the parity oracle `tests/unit/step-life.test.js`);
   the HQST solver core lives in `src/lib/sim-core.js`.
5. **Reality-Anchor.** Prefer "unit + e2e green (verified <date>)" over
   "should work". No claims without test-belege.
6. **Plain paths in code-blocks** for file references (clickable in CLI).

## §2 Conventions

- **Single-file-leaning core.** Keep the hex logic cohesive in `src/App.tsx` + `src/lib/`;
  split only when a module boundary genuinely helps (Coworkerz GolHex style).
- **Determinism for tests.** Drive the simulation through **real DOM controls**
  + the `<canvas>`; assert the observable contract (controls present, 0 console
  errors, visual baselines). Use the fixed seed + static (non-running) states for
  reproducible screenshots; do not assert on raw animation-frame timing. (There is
  no `window.telemetry`/`window.perfStats` hook — see Project context.)
- **Pinned actions.** GitHub Actions are SHA-pinned (zizmor-gated). Let
  Dependabot bump them via PR; don't hand-edit SHAs.
- **Docs:** `README.md` documents the rule set and controls; keep it current
  when rules or hooks change.

## Branch & PR conventions (agents)

- **One agent = one branch prefix:** `claude/<task>` (Claude Code), `codex/<task>`
  (OpenAI Codex), `bot/<task>` (CI/automation). Human-led work: `feat|fix|docs/<task>`.
- **Agent output opens as a Draft PR** and stays draft until Definition-of-Done is
  verified; then mark ready.
- **Label agent PRs:** `agent:claude` / `agent:codex` / `agent:bot`.
- **Auto-merge over manual merge:** enable `gh pr merge --auto --squash` once required
  checks exist; a second concurrent PR must rebase on the updated main.
- **No concurrent agent pushes** to the same repo: serialize, or split work by branch
  namespace and let auto-merge order the merges.

## §3 Don't

- Don't merge without `unit` and `e2e` green.
- Don't run `test:e2e:update` to silence a real visual regression.
- Don't use `--no-verify`, `--no-gpg-sign`, `--force` without explicit User1 OK.
- Don't add heavy runtime dependencies — the bundle size is a tracked property.
- Don't leak `GITHUB_TOKEN` in logs or workflow output.

## §4 Do

- Do add/adjust Vitest unit tests with any change to rule logic (`src/App.tsx` / `src/lib/`).
- Do update Playwright baselines only for intended visual changes, and note it.
- Do keep `README.md` rule/controls documentation in sync.
- Do run `npm test` and `npm run test:e2e` locally before pushing. **Never call
  `npx playwright test` directly** for a verdict: Playwright serves `dist/` via
  `npm run preview` but does not build it, so a bare call silently tests the
  *previous* build. Proven 2026-08-11: a mutated source passed `5 passed` without a
  rebuild and correctly failed `2 failed` after one. `npm run test:e2e` builds first.

## §5 When stuck

- See `README.md` for the rule set, controls, and topology overview.
- Inspect `src/App.tsx` (`step()`, `draw()`) for the automaton core.
- Check `playwright.config.ts` + `tests/` for how the simulation is driven.
- **Escalate after 3 failed attempts at the same step** — stop and ask in a PR
  draft or issue instead of looping.

## Definition of Done

A change is "done" only when **all** of the following hold:

| # | Check | Exit-Code / Evidence |
|---|---|---|
| 1 | `npm test` (Vitest) runs cleanly | exit 0 |
| 2 | `npm run build` produces a bundle | exit 0, `dist/` written |
| 3 | Required CI checks green on the PR | `unit` + `e2e` |
| 4 | engine rule changes carry matching unit tests | tests present, `unit` green |
| 5 | Visual-baseline changes are intentional and explained | PR body notes the change |
| 6 | `README.md` updated if rules/controls/hooks changed | PR diff contains doc update |
| 7 | PR body contains Summary + Test plan checklist | manual review |

A PR that misses any of 1–7 is not "ready", regardless of how reviewers feel
about the design.

---

*Tier-1 rollout 2026-05-29 (v1.1). Format spec: <https://agents.md/>.*
