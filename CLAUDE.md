# Claude Code — project instructions

The full agent contract (repo map, the agent's job, hard boundaries, test conventions,
reporting) is in `AGENTS.md`. Read it first; it is the source of truth.

@AGENTS.md

## Claude-specific pointers

- Custom agent: `.claude/agents/terraform-test-engineer.md`.
- Skills: `.claude/skills/` — `tf-write-tests`, `tf-diagnose-test-failures`,
  `tf-risk-review`, `tf-coverage-matrix`, `tf-review-tests` (independent critic pass).
- Deterministic helpers (run by the CI workflow steps, not by you):
  `.github/scripts/` (`detect-changed-modules`, `test-snapshot`, `run-tests`, `scope-guard`,
  `merge-report`, `mutation-check`, `commit-message`, `pr-comments`, `format-comment`,
  `run-metrics`, `audit-summary`).
- Locally, run Terraform with the pinned binary if `terraform` on PATH is too old:
  `TERRAFORM_BIN` is honoured by `.github/scripts/run-tests.ts`.
