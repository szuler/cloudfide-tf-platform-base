import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMutation,
  applyMutationPreferring,
  classifyMutationRun,
  DEFAULT_MUTATIONS,
  headlineResults,
  mutationTargetsFile,
  parseChangedLines,
  restResults,
  score,
} from "./mutate.ts";
import type { TestReport } from "./types.ts";

const byName = (name: string) => DEFAULT_MUTATIONS.find((m) => m.name === name)!;

test("applies a TLS downgrade", () => {
  const r = applyMutation('  min_tls_version = "TLS1_2"\n', DEFAULT_MUTATIONS[0]!);
  assert.equal(r.applied, true);
  assert.ok(r.result.includes('"TLS1_0"'));
});

test("is a no-op when the pattern is absent (negative)", () => {
  const r = applyMutation("account_tier = \"Standard\"\n", DEFAULT_MUTATIONS[0]!);
  assert.equal(r.applied, false);
  assert.equal(r.result, "account_tier = \"Standard\"\n");
});

test("boolean mutation preserves spacing via backref", () => {
  const m = DEFAULT_MUTATIONS.find((x) => x.name === "shared-key-on")!;
  const r = applyMutation("  shared_access_key_enabled       = false\n", m);
  assert.equal(r.applied, true);
  assert.ok(r.result.includes("shared_access_key_enabled       = true"));
});

test("dynamic-value-corrupt suffixes the iterator value, keeping it distinct", () => {
  const r = applyMutation("      category = enabled_log.value\n", byName("dynamic-value-corrupt"));
  assert.equal(r.applied, true);
  assert.equal(r.result, '      category = "${enabled_log.value}-mut"\n');
});

test("dynamic-value-corrupt leaves each.value and nested object access alone (negative)", () => {
  const m = byName("dynamic-value-corrupt");
  assert.equal(applyMutation("  url = each.value\n", m).applied, false);
  assert.equal(applyMutation("  name = rule.value.name\n", m).applied, false);
  assert.equal(applyMutation("  ip = rule.value[0]\n", m).applied, false);
});

test("each-value-corrupt suffixes each.value", () => {
  const r = applyMutation("  url                  = each.value\n", byName("each-value-corrupt"));
  assert.equal(r.result, '  url                  = "${each.value}-mut"\n');
});

test("validation-disabled prefixes the condition so multi-line conditions stay valid", () => {
  const r = applyMutation("    condition = contains(\n      [\"a\"], var.x)\n", byName("validation-disabled"));
  assert.equal(r.result, "    condition = true || contains(\n      [\"a\"], var.x)\n");
});

test("variables-only mutations do not target main.tf", () => {
  assert.equal(mutationTargetsFile(byName("validation-disabled"), "main.tf"), false);
  assert.equal(mutationTargetsFile(byName("validation-disabled"), "variables.tf"), true);
  assert.equal(mutationTargetsFile(byName("count-flip"), "main.tf"), true);
});

test("count-flip and bool-default flips", () => {
  assert.equal(applyMutation("  count = var.on ? 1 : 0\n", byName("count-flip")).result, "  count = var.on ? 0 : 1\n");
  assert.equal(applyMutation("  default     = true\n", byName("bool-default-off")).result, "  default     = false\n");
  assert.equal(applyMutation("  default = false\n", byName("bool-default-on")).result, "  default = true\n");
});

const TWO_DEFAULTS = [
  'variable "a" {', "  default = true", "}", 'variable "b" {', "  default = true", "}", "",
].join("\n");

test("prefers the occurrence on a changed line over an earlier untouched one", () => {
  const r = applyMutationPreferring(TWO_DEFAULTS, byName("bool-default-off"), new Set([5]));
  assert.equal(r.line, 5);
  assert.equal(r.inChange, true);
  assert.ok(r.result.includes('variable "a" {\n  default = true'));
  assert.ok(r.result.includes('variable "b" {\n  default = false'));
});

test("falls back to the first occurrence when no changed line matches", () => {
  const r = applyMutationPreferring(TWO_DEFAULTS, byName("bool-default-off"), new Set([99]));
  assert.equal(r.line, 2);
  assert.equal(r.inChange, false);
  assert.ok(r.result.startsWith('variable "a" {\n  default = false'));
});

test("placing keeps lookaheads exact: the chosen match is the one replaced (edge)", () => {
  const src = "  a = x.value.name\n  b = y.value\n";
  const r = applyMutationPreferring(src, byName("dynamic-value-corrupt"));
  assert.equal(r.line, 2);
  assert.equal(r.result, '  a = x.value.name\n  b = "${y.value}-mut"\n');
});

test("parses new-side changed lines from a -U0 diff", () => {
  const diff = [
    "diff --git a/modules/m/main.tf b/modules/m/main.tf",
    "--- a/modules/m/main.tf",
    "+++ b/modules/m/main.tf",
    "@@ -29,2 +29,7 @@ resource",
    "@@ -40 +45 @@",
    "@@ -50,3 +54,0 @@",
    "diff --git a/modules/m/gone.tf b/modules/m/gone.tf",
    "--- a/modules/m/gone.tf",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
  ].join("\n");
  const lines = parseChangedLines(diff);
  assert.deepEqual([...lines.get("modules/m/main.tf")!], [29, 30, 31, 32, 33, 34, 35, 45]);
  assert.equal(lines.has("modules/m/gone.tf"), false);
});

test("headline and rest split by scope; score leaves invalid mutants out", () => {
  const results = [
    { name: "a", file: "main.tf", inChange: true, outcome: "caught" as const, hint: "" },
    { name: "b", file: "main.tf", inChange: false, outcome: "survived" as const, hint: "" },
    { name: "c", file: "main.tf", inChange: false, outcome: "invalid" as const, hint: "" },
  ];
  assert.deepEqual(headlineResults({ dir: "d", scope: "change", results }).map((r) => r.name), ["a"]);
  assert.deepEqual(restResults({ dir: "d", scope: "change", results }).map((r) => r.name), ["b", "c"]);
  assert.equal(headlineResults({ dir: "d", scope: "suite-created", results }).length, 3);
  assert.deepEqual(restResults({ dir: "d", scope: "suite-created", results }), []);
  assert.deepEqual(score(results), { caught: 1, scored: 2, invalid: 1 });
});

function report(partial: Partial<TestReport>): TestReport {
  return { summary: null, runs: [], diagnostics: [], parseErrors: 0, ...partial };
}
const summary = (status: string, failed: number, errored: number) =>
  ({ status, passed: 1, failed, errored, skipped: 0 });

test("a passing suite on a mutant means the mutant survived", () => {
  assert.equal(classifyMutationRun(true, report({ summary: summary("pass", 0, 0) })), "survived");
});

test("a failed assertion means caught", () => {
  const r = report({ summary: summary("fail", 1, 0), runs: [{ file: "t", run: "r", status: "fail" }] });
  assert.equal(classifyMutationRun(true, r), "caught");
});

test("an unmet expect_failures (errored run) means caught", () => {
  const r = report({
    summary: summary("error", 0, 1),
    runs: [{ file: "t", run: "r", status: "error" }],
    diagnostics: ["Error: Missing expected failure"],
  });
  assert.equal(classifyMutationRun(true, r), "caught");
});

test("a failed run still counts as caught when Terraform then crashes (no summary)", () => {
  const r = report({ runs: [{ file: "t", run: "r", status: "fail" }] });
  assert.equal(classifyMutationRun(true, r), "caught");
});

test("a broken mutant is invalid, never caught (negative)", () => {
  const errored = report({
    summary: summary("error", 0, 1),
    runs: [{ file: "t", run: "r", status: "error" }],
    diagnostics: ["Error: Invalid reference"],
  });
  assert.equal(classifyMutationRun(true, errored), "invalid");
  assert.equal(classifyMutationRun(true, report({})), "invalid"); // crash: no summary
  assert.equal(classifyMutationRun(false, report({ summary: summary("pass", 0, 0) })), "invalid");
});
