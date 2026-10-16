---
name: tf-coverage-matrix
description: >-
  Define and measure test "coverage" for a Terraform module when backfilling tests across a
  whole module (not just a diff). terraform test has no native coverage metric, so build an
  honest behaviour matrix (module behaviours vs tests that exercise them) and fill the gaps.
---

# Coverage as a behaviour matrix

`terraform test` has **no native coverage number**. Don't invent one. Instead, define coverage
honestly as: *which of a module's observable behaviours are exercised by a test.*

## Build the matrix

1. Read the module (`main.tf`, `variables.tf`, `outputs.tf`) and list its **observable
   behaviours** — the things a plan can show and a test can assert:
   - every variable `default` that reaches a resource attribute,
   - every variable `validation` block (→ an `expect_failures` case),
   - every conditional / `dynamic` block (both branches),
   - every `for_each`/`count` (cardinality for a representative input),
   - every `output` that encodes logic,
   - security-relevant hard-coded settings worth guarding against regression.
2. For each behaviour, note whether an existing test exercises it.
3. The **gaps** are your work list.

Example (storage-account): TLS1_2 guard ✓, public-blob off ✓, network Deny ✓, container count ✓,
name validation ✓ — gaps: `shared_access_key_enabled=false`, `https_traffic_only_enabled`,
`is_data_lake → is_hns_enabled`, default `replication_type`.

## Fill gaps, then self-review as a reviewer

- Write the missing tests with `tf-write-tests`; run them with `tf-diagnose-test-failures`.
- Then review each new test critically and **reject weak ones**:
  - Does it assert behaviour that could actually break, or just restate a constant?
  - Would it still pass if the code were subtly wrong? If yes, it's weak — strengthen or drop it.
  - Is it independent and clearly named?
- Prefer fewer strong tests over many shallow ones.

## Report coverage honestly

State coverage as "behaviours exercised / behaviours identified" for the module, and list what
is intentionally **not** covered and why (e.g. computed values unknown under plan, real API
behaviour, runtime). Never imply tests prove more than plan + mocks can show.
