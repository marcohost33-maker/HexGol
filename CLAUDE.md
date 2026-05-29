# CLAUDE.md — GolHex

This file exists because Claude Code does not natively read `AGENTS.md`
([anthropics/claude-code#6235](https://github.com/anthropics/claude-code/issues/6235)).
The single-source-of-truth for agent instructions is `AGENTS.md` at the
repository root.

@AGENTS.md

---

## Claude-Code-specific notes (in addition to AGENTS.md)

- This file is the project-level layer. Path-scoped overrides (e.g. for
  `experimental/`) belong in a sibling `AGENTS.md` inside that directory, not here.
- Memory references like `[[memory:slug]]` in PR bodies are a Vero-internal
  convention, not a Claude Code feature.
- For tool-permission preferences specific to Claude Code, see
  `~/.claude/settings.json` (user-global) — do not commit machine-specific
  permissions here.

---

*Thin import layer. Do not duplicate AGENTS.md content here — edit AGENTS.md instead.*
