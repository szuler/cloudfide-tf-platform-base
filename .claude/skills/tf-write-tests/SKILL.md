---
name: tf-write-tests
description: >-
  Write or update terraform test (.tftest.hcl) files for a Terraform module in this repo's
  style (mock_provider, command = plan). Use when a module's behaviour changed or lacks tests.
  Covers defaults, conditionals, variable validation (expect_failures), outputs, resource
  counts, edge/negative cases, and mocking data "external" so no script runs.
---

# Writing terraform tests

Tests live in `modules/<name>/tests/*.tftest.hcl`, use a mocked provider, and plan only — no
credentials, no real resources. Test **behaviour**, never restate the code.

## Shape to follow

```hcl
mock_provider "azurerm" {}

variables {
  # minimal valid inputs for the module
}

run "descriptive_behaviour_name" {
  command = plan

  assert {
    condition     = <expression over planned values>
    error_message = "why this must hold"
  }
}
```

## What to test (behaviour, not syntax)

- **Defaults:** set no optional input and assert the resulting attribute
  (e.g. a default `replication_type` produces the expected `account_replication_type`).
- **Conditionals / dynamic blocks:** toggle the input and assert the effect
  (e.g. a `dynamic` block present vs absent → count 1 vs 0).
- **Variable `validation`:** pass a bad value and assert the failure:
  ```hcl
  run "rejects_invalid_name" {
    command = plan
    variables { name = "Invalid-Name" }
    expect_failures = [var.name]
  }
  ```
  `expect_failures` on an input variable's `validation` block is verified to work here.
- **Outputs:** assert `output.<name>` where it encodes logic, not a pass-through.
- **Resource counts:** for `for_each`/`count`, assert `length(resource.x) == N` for a given
  input map/set (this is meaningful behaviour, not a tautology).
- **Edge / negative cases:** empty collections, a single element, a toggle flipped.

## Mock `data "external"` so no script executes

`function-app` runs `data "external" "build_info"` (a shell script) during plan. Mock it:

```hcl
mock_provider "azurerm" {}
mock_provider "external" {}

override_data {
  target = data.external.build_info
  values = { result = { revision = "test" } }
}
```

## Avoid tautologies

- Bad: `condition = azurerm_x.this.account_tier == "Standard"` when the code literally hard-codes
  `account_tier = "Standard"` with no logic — it only re-asserts a constant.
- Good: assert a value that depends on an **input**, a **default**, a **condition**, or a
  **count** — something that could break if the logic changed.
- A security-posture assertion on a hard-coded safe default *is* worth keeping (it guards
  against a future regression), but label it as a guard, not as behaviour coverage.

## Naming & hygiene

- `run` names describe the behaviour (`account_is_locked_down_by_default`,
  `creates_one_container_per_name`).
- One concern per `run` where practical; multiple `assert`s are fine within one concern.
- After writing, the module must `terraform validate` and `terraform test` cleanly. If a test
  fails, use the `tf-diagnose-test-failures` skill — do not edit the module to pass.
