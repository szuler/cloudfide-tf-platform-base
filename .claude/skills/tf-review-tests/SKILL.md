---
name: tf-review-tests
description: >-
  Independently review terraform test (.tftest.hcl) files you did NOT write and try to reject
  each assertion as weak, tautological, or misleading. Use as a fresh-context critic pass after
  tests are written, to catch what an author's self-review misses. Produces a per-test verdict
  (keep / strengthen / drop) with a reason; never edits infrastructure code.
---

# Reviewing terraform tests as an independent critic

You are a **critic**, not the author. Assume you did **not** write these tests. An author's own
review is biased toward defending their work — your job is the opposite: **try to reject every
assertion**, and keep only the ones that survive. Independence is the whole point; if you find
yourself justifying a test, stop and ask whether it would convince a sceptical reviewer.

Read `AGENTS.md` first — the same hard boundaries bind you. You may edit **test files only**
(`**/*.tftest.hcl`, helpers under `modules|stacks/<name>/tests/`). Never touch `main.tf`,
`variables.tf`, `outputs.tf`, `versions.tf`, workflows, scripts, or anything else.

## For every `run` and every `assert`, try to reject it

Ask these in order; the first "yes" is a reason to strengthen or drop:

1. **Tautology / relevance.** Does the assertion just restate a hard-coded literal from the
   module that is **not** tied to an input, a `default`, a conditional, a `count`/`for_each`, or
   output logic? If the assertion mirrors a constant in `main.tf`, it proves nothing — the test
   and the code would always agree by construction. *(This is exactly the `sku == "PerGB2018"`
   case: a hard-coded, non-security value asserted back at itself.)*
   - **One exception:** a guard on a hard-coded **safe security default** (e.g. `min_tls_version
     == "TLS1_2"`, `default_action == "Deny"`) is worth keeping — it catches a future security
     regression. It must read as a guard, not as behaviour coverage, and it must be
     security-relevant. Billing tiers, SKUs, names, and cosmetic constants do **not** qualify.
   - **A guard must protect the safe direction.** An assertion that pins a risky value — an
     over-broad role, a public-access default of `true`, `ftps_state = "AllAllowed"`, anything
     the risk review reports as a finding — is not a guard, whatever its `error_message` says.
     It cements the risk. Verdict: `drop`, or `strengthen` by renaming it to "current behaviour —
     see the finding". Never *add* such an assertion yourself.
2. **Would it still pass if the code were subtly wrong?** If a plausible wrong implementation
   (a swapped default, a dropped `var.` wiring, an off-by-one count) would leave this assertion
   green, the test is weak. A good assertion fails when the behaviour it names breaks.
   - **Counts are not values.** If an input collection maps into `for_each` resources or
     `dynamic` blocks and the test only checks `length(...)`, a bug that corrupts every value
     but keeps the count passes. That is a `strengthen`: add an assertion on the values.
3. **Does it assert something plan + mocks cannot know?** Computed / "known after apply" values
   (IDs, generated endpoints) are unknown under `command = plan` with a mocked provider. An
   assertion that appears to check one is either dead or secretly relying on a mock default —
   drop it or make the dependency explicit.
4. **Does the name match what it asserts?** A `run` called `account_is_locked_down` that only
   checks a tag is misleading. Rename to the truth, or split the concern.
5. **Is it redundant?** Two runs that exercise the same behaviour with no added input or branch
   add maintenance cost, not coverage. Keep the clearer one.

Then, as a coverage check (see `tf-coverage-matrix`), ask what obvious behaviour is **missing** —
a `default` that reaches a resource with no test, a `validation` block with no `expect_failures`
case, a conditional with only one branch exercised. A gap is as much a review finding as a weak
test.

## Verdict and what you may change

Produce a verdict for each `run` (or assertion): **keep**, **strengthen**, or **drop**, each with
a one-line reason. Whether you may edit is decided by the workflow and stated in your prompt:

- **edit** mode (the author changed tests in this run): you may apply a `strengthen` or `drop`
  edit directly to the test file, under the rules below.
- **review-only** mode (the author changed no tests): change no test file. Give the verdicts,
  set `applied: false`, and describe the change you would make in `reason`. A new push that
  needs no new tests must not grow the suite; the person decides.

When you do edit:

- **Strengthen means: make the test catch a plausible bug in the behaviour it names.** Adding an
  assertion that restates a hard-coded literal from `main.tf` (e.g. `use_managed_identity ==
  true` when the code says `use_managed_identity = true`) is not strengthening — it is the
  tautology from check 1. Only a security guard qualifies, and then its `error_message` and your
  reason must say it is a regression guard, not behaviour coverage.
- Record every change (what and why) so a human can see it — do not silently delete coverage.
- Never weaken or drop an assertion that is catching a **real** code problem. If a test fails
  because the *code* is wrong, that is a finding (`tf-diagnose-test-failures` /
  `tf-risk-review`), not a weak test — keep it.
- When unsure, **flag, don't delete.** Prefer leaving a test with a `strengthen` note over
  removing coverage on a guess. Decisions that remove coverage lean toward the human.

After any edit, the module must still `terraform test` cleanly — run it (`tf-diagnose-test-failures`).

## Report

Fold your verdicts into the structured report under a `testReview` array:

```json
"testReview": [
  { "file": "modules/<name>/tests/main.tftest.hcl", "run": "<run name>",
    "verdict": "keep|strengthen|drop", "reason": "one line",
    "applied": true }
]
```

Be honest about uncertainty and don't pad with noise. A clean verdict ("all runs survive
review") is a valid, useful result — say so rather than inventing nitpicks.
