import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTestJson, reportIsPass } from "./tf-report.ts";

const PASS = [
  JSON.stringify({
    type: "test_run",
    "@level": "info",
    test_run: { path: "tests/main.tftest.hcl", run: "a", progress: "complete", status: "pass" },
  }),
  JSON.stringify({
    type: "test_summary",
    test_summary: { status: "pass", passed: 3, failed: 0, errored: 0, skipped: 0 },
  }),
].join("\n");

const FAIL = [
  JSON.stringify({
    type: "test_run",
    test_run: { path: "tests/main.tftest.hcl", run: "a", progress: "complete", status: "fail" },
  }),
  JSON.stringify({
    type: "diagnostic",
    "@level": "error",
    "@message": "Test assertion failed: TLS must be 1.2",
  }),
  JSON.stringify({
    type: "test_summary",
    test_summary: { status: "fail", passed: 2, failed: 1, errored: 0, skipped: 0 },
  }),
].join("\n");

test("parses passing output", () => {
  const r = parseTestJson(PASS);
  assert.equal(r.summary?.passed, 3);
  assert.equal(r.runs.length, 1);
  assert.equal(reportIsPass(r), true);
});

test("parses failing output and diagnostics (negative)", () => {
  const r = parseTestJson(FAIL);
  assert.equal(r.summary?.failed, 1);
  assert.equal(reportIsPass(r), false);
  assert.ok(r.diagnostics.some((d) => d.includes("TLS")));
});

test("tolerates non-JSON noise lines", () => {
  const r = parseTestJson(`not json\n${PASS}\nalso not json`);
  assert.equal(r.parseErrors, 2);
  assert.equal(reportIsPass(r), true);
});

test("null / empty report is not a pass (negative)", () => {
  assert.equal(reportIsPass(null), false);
  assert.equal(reportIsPass(parseTestJson("")), false);
});
