# GitHub Copilot — repository instructions

The full agent contract is in `AGENTS.md` at the repository root. Read it first.

@/AGENTS.md

## Portability note

This solution is built and tested on Claude Code (`claude-code-action`). The agent and skill
definitions live under `.claude/` (`.claude/agents/`, `.claude/skills/`), and the shared
behaviour contract is `AGENTS.md`, which Copilot also reads.

To run the same agent under the GitHub Copilot coding agent, the thin adapter is:

- Copilot already reads `AGENTS.md` (above) and this file — so the boundaries and test
  conventions apply unchanged.
- Mirror the Claude agent/skills into Copilot's locations if you want Copilot to run them
  natively: `.github/agents/*.agent.md` (from `.claude/agents/`) and `.github/skills/*/SKILL.md`
  (from `.claude/skills/`). The *content* is the same; only the directory differs. Keep
  `AGENTS.md` as the single source of truth and keep those files thin.

No logic is duplicated: both tools derive their behaviour from `AGENTS.md`.
