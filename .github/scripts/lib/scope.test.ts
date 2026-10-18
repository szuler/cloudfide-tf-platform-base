import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedTestPath, parsePorcelain, scopeViolations, testPathChanges } from "./scope.ts";

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

test("provider lock file is an ignorable artifact, not a violation", () => {
  assert.deepEqual(scopeViolations(["modules/log-analytics-workspace/.terraform.lock.hcl"]), []);
});

test("parsePorcelain handles untracked, modified and renamed entries", () => {
  const out = [
    "?? modules/x/tests/main.tftest.hcl", // untracked (new test file)
    " M modules/x/main.tf", // modified tracked infra
    "?? modules/x/.terraform.lock.hcl", // untracked artifact
    "R  a/old.ts -> a/new.ts", // rename
  ].join("\n");
  const files = parsePorcelain(out);
  assert.deepEqual(files, [
    "modules/x/tests/main.tftest.hcl",
    "modules/x/main.tf",
    "modules/x/.terraform.lock.hcl",
    "a/new.ts",
  ]);
  // the only real violation here is the modified infra file
  assert.deepEqual(scopeViolations(files), ["a/new.ts", "modules/x/main.tf"]);
});

test("testPathChanges keeps test files only, skips the lock file, uses a rename's new path", () => {
  const nameStatus = [
    "A\tmodules/df/tests/main.tftest.hcl",
    "M\tmodules/df/main.tf",
    "A\tmodules/df/.terraform.lock.hcl",
    "R087\tmodules/df/tests/old.tftest.hcl\tmodules/df/tests/new.tftest.hcl",
    "",
  ].join("\n");
  assert.deepEqual(testPathChanges(nameStatus), [
    { status: "A", path: "modules/df/tests/main.tftest.hcl" },
    { status: "R", path: "modules/df/tests/new.tftest.hcl" },
  ]);
});
