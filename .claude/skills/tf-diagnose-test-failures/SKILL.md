---
name: tf-diagnose-test-failures
description: >-
  Run terraform tests for a module and, when they fail, decide whether the TEST is wrong
  (fix the test) or the CODE is wrong (keep the test, raise a finding). Use after writing or
  updating tests. Never modify infrastructure code to make a test pass.
---

# Diagnosing test failures

Run the module's tests and read failures carefully before changing anything.

```sh
cd modules/<name>
terraform init -backend=false
terraform test            # add -json for machine-readable output
```

## The one decision that matters: test fault vs code fault

For each failing assertion, ask: *what did the author intend the code to do?*

- **Test fault** — the assertion is wrong: wrong expected value, wrong attribute path, a
  tautology, an unknown ("known after apply") value asserted under plan, or a missing mock
  (e.g. a real `data "external"` executed). → **Fix the test.**
- **Code fault** — the code does something the module clearly should not (an insecure default,
  a wrong value, a broken condition, a count that doesn't match intent). → **Keep the test as
  the honest expression of intent, let it fail, and raise a finding** (`tf-risk-review`).
  **Never** change `main.tf`/`variables.tf`/etc. to make it pass.

If you cannot tell, prefer leaving the honest test and reporting a `hypothesis`-confidence
finding over silently weakening the test.

## Common mechanical causes (these are test faults — fix the test)

- **Unknown under plan:** mocked providers return "known after apply" for computed attributes
  during `command = plan`. Assert inputs, defaults, logic, or counts instead — not computed
  values like IDs. (`override_during = plan` or `override_resource`/`override_data` can supply
  a value when you genuinely need one.)
- **A data source ran for real:** add `mock_provider` for its provider and `override_data`.
- **Wrong attribute name/path:** check the provider schema and resource address, including
  `for_each` keys (`resource.this["key"]`).
- **Validation test shape:** `expect_failures = [var.<name>]` must name the variable whose
  `validation` block should trip; don't also add an `assert` for the same run.

## Never do

- Do not edit module code, defaults, or validations to turn a failure green.
- Do not delete or loosen an assertion that is catching a real problem.
- Do not mark a run as skipped to avoid a failure.
