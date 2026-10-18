---
name: tf-risk-review
description: >-
  Review changed Terraform for things a reviewer should know — insecure defaults, weak
  TLS/FTP, public network exposure, over-broad roles/permissions, secrets without sensitive,
  missing tags, risky data sources. Produce structured findings with location, impact,
  confidence (fact vs hypothesis) and a suggested direction. Signal over noise.
---

# Reviewing changed Terraform for risk

You are the reviewer's extra pair of eyes. Report what matters; stay quiet otherwise. You
never change the code — you inform.

## What to look for

- **Public network exposure:** `public_network_access_enabled` / `public_network_enabled`
  defaulting to or set `true`; `default_action` not `Deny`; missing network ACLs.
- **Transport security:** TLS below 1.2; `ftps_state = "AllAllowed"` (permits plaintext FTP);
  `https_only`/`https_traffic_only_enabled` disabled.
- **Identity & access:** over-broad role assignments (e.g. `*Owner` where a reader/contributor
  would do), wildcard scopes, `shared_access_key_enabled = true` where identity-based auth is
  expected.
- **Secrets & data:** secret-like variables without `sensitive = true`; secrets in `*.tfvars`
  or defaults; `data "external"` running scripts.
- **Operational hygiene:** missing `tags`, missing diagnostic settings/retention, missing
  `purge_protection`/soft-delete on key material.

## Each finding must state

- **Location:** `file:line`.
- **What** is wrong (one sentence).
- **Why it matters** (the concrete risk).
- **Confidence:** `fact` (you can see it directly), `likely` (strong inference), or
  `hypothesis` (worth a look, not certain). Never present a guess as a fact.
  - A setting written in the repo (e.g. `min_tls_version = "TLS1_1"`) is a `fact` — you see it.
  - A claim about a **provider default that the module does not set** (e.g. "`azurerm`
    defaults `internet_ingestion_enabled` to `true`") is at most `likely`, never `fact`: you
    have no network access to confirm it against the pinned provider version (`azurerm ~> 4.0`).
    Phrase it as "per the azurerm docs — verify against the pinned version" and set
    `confidence: "likely"`. What you *can* state as `fact` is only that the module itself does
    not set the attribute.
  - The same applies to **lists of provider or Azure values** you quote from memory (allowed
    log categories, SKUs, API versions): mark them "from memory — verify against the Azure/
    azurerm docs for the pinned version". The finding can still be a `fact` (e.g. "validation
    does not check names"); the list you suggest is not.
- **Suggested direction** — a direction for a human, not a decision or a code change.

Severity: `high` (security/data exposure), `medium` (weakened posture), `low` (hygiene),
`info` (FYI).

## Discipline

- Only report what the **diff** touches or what the changed behaviour makes relevant. Do not
  audit the whole repo unless asked (that's the backfill task).
- Prefer a few high-signal findings over a long noisy list.
- A finding is something a reviewer should act on or weigh. Do not report things that are
  already fine ("secure default — no action needed"); if it needs no decision, leave it out.
- If the change is clean, report no findings — that is a valid, useful result.
- A finding is **not** a reason to edit the code or to weaken a test. It goes in the report for
  a human to decide.
