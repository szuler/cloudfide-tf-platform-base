import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedTestPath, scopeViolations } from "./scope.ts";

test("allows tftest files and tests-dir helpers", () => {
  assert.equal(isAllowedTestPath("modules/network/tests/main.tftest.hcl"), true);
  assert.equal(isAllowedTestPath("modules/network/tests/fixtures/main.tf"), true);
  assert.equal(isAllowedTestPath("stacks/data-platform/tests/x.tftest.hcl"), true);
});

test("rejects infra and other files (negative)", () => {
  assert.equal(isAllowedTestPath("modules/network/main.tf"), false);
  assert.equal(isAllowedTestPath("modules/network/variables.tf"), false);
  assert.equal(isAllowedTestPath(".github/workflows/tf-test-agent.yml"), false);
  assert.equal(isAllowedTestPath("scripts/run-tests.ts"), false);
});

test("scopeViolations returns only disallowed files, sorted", () => {
  const v = scopeViolations([
    "modules/network/tests/main.tftest.hcl",
    "modules/network/main.tf",
    "README.md",
  ]);
  assert.deepEqual(v, ["README.md", "modules/network/main.tf"]);
});

test("empty changeset has no violations", () => {
  assert.deepEqual(scopeViolations([]), []);
});

test("backslash infra path is still a violation (negative)", () => {
  assert.deepEqual(scopeViolations(["modules\\function-app\\main.tf"]), [
    "modules/function-app/main.tf",
  ]);
});
