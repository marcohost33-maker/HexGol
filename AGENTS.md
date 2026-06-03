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
  (Hexagonal Game of Life) with a telemetry pipeline, Safari trackpad support,
  and 16 classic hex birth/survival rules (`B2/S34` … `B1/S245`) plus one
  formula rule. The simulation exposes hooks (`telemetry`, `perfStats`) so
  Playwright tests can drive it deterministically.
- **Version:** 19.1.0 (see `package.json`)
- **License:** MIT
- **Visibility:** PRIVATE (marcohost33-maker/HexGol)
- **KANON anchor:** `ENGINE-HEXGOL` in `Vero/Meta/KANON/KANON_APPS.yaml`

## Repository layout

```
index.html                # app entry
vite.config.js            # Vite build config
playwright.config.ts      # e2e + visual-regression config
src/
  └── lib/hex.js          # hex topology core — step() and classify()
                          #   honour the active birth/survival rule
src/ (rest)               # UI + telemetry pipeline
tests/                    # Vitest unit tests + Playwright e2e + visual baselines
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
4. **The rule entry is load-bearing.** `step()` and `classify()` in
   `src/lib/hex.js` honour the active birth/survival rule — changing one
   without the other corrupts the automaton. Add/adjust unit tests together.
5. **Reality-Anchor.** Prefer "unit + e2e green (verified <date>)" over
   "should work". No claims without test-belege.
6. **Plain paths in code-blocks** for file references (clickable in CLI).

## §2 Conventions

- **Single-file-leaning core.** Keep the hex logic cohesive in `src/lib/hex.js`;
  split only when a module boundary genuinely helps (Coworkerz GolHex style).
- **Determinism for tests.** Drive the simulation through the exposed hooks
  (`telemetry`, `perfStats`); do not rely on timing/animation frames in assertions.
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

- Do add/adjust Vitest unit tests with any change to `hex.js` rule logic.
- Do update Playwright baselines only for intended visual changes, and note it.
- Do keep `README.md` rule/controls documentation in sync.
- Do run `npm test` and `npm run test:e2e` locally before pushing.

## §5 When stuck

- See `README.md` for the rule set, controls, and topology overview.
- Inspect `src/lib/hex.js` (`step()`, `classify()`) for the automaton core.
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
| 4 | `hex.js` rule changes carry matching unit tests | tests present, `unit` green |
| 5 | Visual-baseline changes are intentional and explained | PR body notes the change |
| 6 | `README.md` updated if rules/controls/hooks changed | PR diff contains doc update |
| 7 | PR body contains Summary + Test plan checklist | manual review |

A PR that misses any of 1–7 is not "ready", regardless of how reviewers feel
about the design.

---

*Tier-1 rollout 2026-05-29 (v1.1). Format spec: <https://agents.md/>.*
