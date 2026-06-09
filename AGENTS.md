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

- **Stack:** JavaScript + Vite, React 19.2, Vitest (unit), Playwright (e2e +
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
- **Version:** 31.0.0 (see `package.json`) — engine + UI live in `src/App.tsx`;
  pure cores extracted to `src/lib/sim-core.js` (HQST applyH/solveCN) and
  `src/lib/hex-geom.js` (hex cube geometry), both unit-tested.
- **License:** MIT
- **Visibility:** PRIVATE (marcohost33-maker/HexGol)
- **KANON anchor:** `ENGINE-HEXGOL` in `Vero/Meta/KANON/KANON_APPS.yaml`

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
  │   └── worker-support.js# OffscreenCanvas feature-detection (fail-closed)
  └── worker/
      └── render-worker.js# AP-1: opt-in off-main-thread sim+render (Stufe 1)
tests/                    # Vitest unit + Playwright e2e + visual baselines + manual/
experimental/             # spikes — not shipped in the main bundle
docs/
.github/workflows/
  ├── unit-tests.yml         # primary CI — Vitest (required check: unit)
  ├── visual-regression.yml  # Playwright visual baselines (required check: e2e)
  ├── update-snapshots.yml   # snapshot refresh helper
  ├── encoding-guard.yml     # UTF-8 / line-ending guard
  └── zizmor.yml             # workflow security audit (SHA-pinned)
```

## Build / test commands

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static bundle in dist/
npm run preview      # serve dist/ on http://localhost:4173

npm test             # unit tests (Vitest, run-once)
npm run test:watch   # vitest watch mode
npm run test:e2e     # Playwright + visual baselines
npm run test:e2e:update   # refresh Playwright snapshots (use deliberately)
```

## §1 Working agreements

1. **Branch protection active.** `main` requires the CI checks `unit` and `e2e`
   to be green. No direct pushes; PRs only.
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
- Do run `npm test` and `npm run test:e2e` locally before pushing.

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
